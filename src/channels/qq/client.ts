import {QQBot,type QQBotInboundMessage,type ReplyTarget,type QQBotOptions,type InteractionEvent} from '@tencent-connect/qqbot-nodejs';
import {z} from 'zod';
import type {Config,Credentials} from '../../config/schema.js';
import type {Store} from '../../storage/database.js';
import {errorMessage,type Approval,type Channel,type Incoming,type MediaKind} from '../../domain/types.js';
import {log} from '../../observability/logger.js';
const attachment=z.object({url:z.string().min(1),content_type:z.string().optional(),filename:z.string().optional(),size:z.number().optional(),voice_wav_url:z.string().optional(),asr_refer_text:z.string().optional()});
export function normalize(msg:QQBotInboundMessage,accountId:string):Incoming{
 return {accountId,messageId:z.string().min(1).parse(msg.messageId),peerId:msg.senderId,target:msg.replyTarget,text:String(msg.content||'').trim().slice(0,60000),attachments:z.array(attachment).max(8).parse(msg.attachments||[]),refKey:msg.refMsgIdx,timestamp:Date.now()};
}
export function authenticationError(e:unknown){const v=e as {httpStatus?:number;bizCode?:number;message?:string};return v.httpStatus===401||[40014,42001].includes(v.bizCode||0)||/AccessToken|access.token.*(expired|invalid)|token.*过期/i.test(v.message||'');}
export async function freshToken<T>(bot:Pick<QQBot,'tokenManager'>,creds:Credentials,operation:()=>Promise<T>){try{return await operation();}catch(e){if(!authenticationError(e))throw e;bot.tokenManager.clearCache(creds.appId);await bot.tokenManager.getAccessToken(creds.appId,creds.appSecret);return operation();}}
export class QQChannel implements Channel {
 readonly bot:QQBot;online=false;
 private pendingSession:Parameters<NonNullable<QQBotOptions['sessionPersistence']>['save']>[0]|undefined;
 onMessage?:(message:Incoming,msg:QQBotInboundMessage)=>Promise<void>;
 onInteraction?:(peer:string,data:string)=>Promise<void>;
 constructor(private config:Config,private credentials:Credentials,private store:Store){
  this.bot=new QQBot({appId:credentials.appId,appSecret:credentials.appSecret,markdownSupport:config.markdown,sessionPersistence:{load:()=>store.get('gateway:'+config.accountId)||null,save:session=>{this.pendingSession=session;},clear:()=>{this.pendingSession=undefined;store.set('gateway:'+config.accountId,null);}}});
  this.bot.on('ready',()=>{this.online=true;this.checkpoint();log.info({event:'qq_ready'});});
  this.bot.on('resumed',()=>{this.online=true;log.info({event:'qq_resumed'});});
  this.bot.on('error',e=>{log.error({event:'qq_error',reason:errorMessage(e)});});
  this.bot.on('message',async(_ctx,msg)=>{
   if(msg.kind!=='c2c'||msg.senderIsBot)return;
   try{await this.onMessage?.(normalize(msg,config.accountId),msg);this.checkpoint();}
   catch(e){log.error({event:'inbound_rejected',reason:errorMessage(e)});if(msg.senderId===config.owner){try{await this.sendText(msg.replyTarget,'消息处理失败：'+errorMessage(e));}catch(sendError){log.warn({event:'inbound_error_notice_failed',reason:errorMessage(sendError)});}}}
  });
  this.bot.on('interaction',async(_ctx,event)=>{
   const peer=event.user_openid||event.data.resolved.user_id||'';const data=event.data.resolved.button_data||'';
   try{if(peer===this.config.owner&&data.startsWith('qqapprove:'))await this.onInteraction?.(peer,data);await this.bot.acknowledgeInteraction(event.id);}
   catch(e){log.warn({event:'approval_interaction_failed',reason:errorMessage(e)});}
  });
 }
 private checkpoint(){if(this.pendingSession)this.store.set('gateway:'+this.config.accountId,this.pendingSession);}
 async start(){await this.bot.start();}
 stop(){this.online=false;this.bot.stop();}
 async authCheck(){await this.bot.tokenManager.getAccessToken(this.credentials.appId,this.credentials.appSecret);return this.bot.tokenManager.getStatus(this.credentials.appId).status;}
 private call<T>(fn:()=>Promise<T>){return freshToken(this.bot,this.credentials,fn);}
 async sendText(target:ReplyTarget,text:string){const r=await this.call(()=>this.bot.sendText(target,text));if(!r?.id)throw new Error('QQ 未返回消息回执');return {id:r.id};}
 async sendMedia(target:ReplyTarget,type:MediaKind,path:string,name?:string){
  const source={localPath:path};const r=await this.call(()=>type==='image'?this.bot.sendImage(target,source):type==='video'?this.bot.sendVideo(target,source):type==='voice'?this.bot.sendVoice(target,source):this.bot.sendFile(target,source,{fileName:name}));
  if(!r.message?.id)throw new Error('媒体已上传但未收到发送回执');return {id:r.message.id};
 }
 async typing(target:ReplyTarget){await this.call(()=>this.bot.sendTyping(target,30));}
 async approval(target:ReplyTarget,a:Approval){
  const buttons=['accept','decline'].filter(decision=>a.allowed.includes(decision)).map(decision=>({id:a.id+'-'+decision,render_data:{label:decision==='accept'?'允许一次':'拒绝',visited_label:'已提交',style:decision==='accept'?1:0},action:{type:1,permission:{type:2},data:`qqapprove:${a.nonce}:${decision}`,click_limit:1}}));
  try{const r=await this.call(()=>this.bot.sendTextWithKeyboard(target,`Codex 请求审批\n${a.summary}`,{content:{rows:[{buttons}]}}));if(!r.id)throw new Error('审批消息缺少回执');return {id:r.id};}
  catch(e){log.warn({event:'approval_keyboard_unavailable',reason:errorMessage(e)});return this.sendText(target,`Codex 请求审批\n${a.summary}\n允许一次：/approve ${a.nonce} accept\n拒绝：/approve ${a.nonce} decline`);}
 }
 stream(target:ReplyTarget){if(!this.config.streaming.native||!target.msgId)return undefined;const session=this.bot.openStream({target,throttleMs:this.config.streaming.intervalMs});return {update:(text:string)=>session.update(text),complete:async()=>{const r=await session.complete();return r?.id?{id:r.id}:undefined;},cancel:()=>session.cancel()};}
}
