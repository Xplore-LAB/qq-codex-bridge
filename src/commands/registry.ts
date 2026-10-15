import {randomUUID} from 'node:crypto';
import type {Config} from '../config/schema.js';
import type {Store} from '../storage/database.js';
import type {Channel,Incoming,Json} from '../domain/types.js';
import type {Runner} from '../services/runner.js';
export class Commands {
 constructor(private config:Config,private store:Store,private runner:Runner,private channel:Channel){}
 async handle(msg:Incoming){
  if(!this.config.owner||msg.peerId!==this.config.owner||msg.accountId!==this.config.accountId)throw new Error('发送者未授权');
  const [name='',...args]=msg.text.trim().split(/\s+/);if(!name.startsWith('/'))return false;
  const allowed=['/status','/help','/cancel','/retry','/session','/voice','/approve','/remind'];if(!allowed.includes(name))return false;
  const key='command:'+msg.accountId+':'+msg.messageId;if(this.store.get(key))return true;this.store.set(key,{state:'received',at:Date.now()});
  let reply='';
  try{
   if(name==='/help')reply='/status 查看状态\n/cancel [任务ID] 取消本人任务\n/retry [任务ID] 重试结果投递\n/session [会话ID] 查看/切换会话\n/voice on|off 语音回复\n/remind 5m 内容；/remind list；/remind cancel ID\n支持文字、图片、视频、语音及文件。';
   if(name==='/status'){
    const tasks=this.store.tasks().filter(t=>t.peerId===msg.peerId);const latest=tasks.at(-1);
    reply=`QQ：${this.channel.online?'已连接':'未连接'}\nCodex：${this.runner.agent.connected?'已连接':'未连接'}\n模式：${this.config.backend}\n会话：${this.store.get<string>('thread:'+msg.accountId+':'+msg.peerId)||this.config.threadId}\n最近任务：${latest?latest.id.slice(0,8)+' '+latest.status:'无'}${latest?.error?'\n错误：'+latest.error:''}\n语音转写：${this.config.voice.enabled&&this.config.voice.stt?'已配置':'未配置'}；语音合成：${this.config.voice.enabled&&this.config.voice.tts?'已配置':'未配置'}`;
   }
   if(name==='/cancel'){const task=await this.runner.cancel(msg.peerId,args[0]);reply='已请求取消任务 '+task.id.slice(0,8);}
   if(name==='/retry'){const task=this.runner.retry(msg.peerId,args[0]);task.target=msg.target;this.store.saveTask(task);reply='已安排重试结果投递 '+task.id.slice(0,8);}
   if(name==='/session'){
    if(args[0]){if(this.store.tasks(['running','waiting_approval','submitting']).some(t=>t.peerId===msg.peerId))throw new Error('有正在执行的任务，请先等待完成或取消');await this.runner.agent.readThread(args[0]);this.store.set('thread:'+msg.accountId+':'+msg.peerId,args[0]);reply='已绑定现有会话 '+args[0];}
    else reply='当前会话：'+(this.store.get<string>('thread:'+msg.accountId+':'+msg.peerId)||this.config.threadId);
   }
   if(name==='/voice'){if(!['on','off'].includes(args[0]||''))throw new Error('用法：/voice on 或 /voice off');if(args[0]==='on'&&(!this.config.voice.enabled||!this.config.voice.tts))throw new Error('尚未配置 TTS，请先在本机配置语音服务');this.store.set('voice:'+msg.accountId+':'+msg.peerId,args[0]==='on');reply='语音回复已'+(args[0]==='on'?'开启':'关闭');}
   if(name==='/approve'){this.runner.approvals.decide(args[0]||'',args[1]||'',msg.peerId);reply='审批决策已提交。';}
   if(name==='/remind')reply=this.remind(msg,args);
   this.store.set(key,{state:'completed',at:Date.now()});
  }catch(e){reply=e instanceof Error?e.message:'指令失败';this.store.set(key,{state:'failed',at:Date.now()});}
  await this.channel.sendText(msg.target,reply);return true;
 }
 private remind(msg:Incoming,args:string[]){
  const own=this.store.reminders().filter(r=>r.peerId===msg.peerId&&r.accountId===msg.accountId);
  if(args[0]==='list')return own.filter(r=>r.status==='pending').map(r=>`${String(r.id).slice(0,8)} ${new Date(Number(r.dueAt)).toLocaleString('zh-CN')} ${r.text}`).join('\n')||'没有待触发提醒。';
  if(args[0]==='cancel'){const r=own.find(r=>String(r.id).startsWith(args[1]||'')&&r.status==='pending');if(!r||!args[1])throw new Error('未找到待触发提醒');r.status='cancelled';this.store.saveReminder(r);return '提醒已取消。';}
  const m=/^(\d+)(s|m|h|d)$/.exec(args[0]||'');const text=args.slice(1).join(' ');if(!m||!text)throw new Error('用法：/remind 5m 喝水，时间单位 s/m/h/d');
  const duration=Number(m[1])*({s:1000,m:60000,h:3600000,d:86400000}[m[2] as 's'|'m'|'h'|'d']);if(duration<10000||duration>30*86400000)throw new Error('提醒时间范围为 10 秒至 30 天');
  const id=randomUUID();this.store.saveReminder({id,peerId:msg.peerId,accountId:msg.accountId,target:{scope:'c2c',targetId:msg.peerId},text:text.slice(0,2000),dueAt:Date.now()+duration,status:'pending'});return `提醒已创建 ${id.slice(0,8)}。QQ 主动消息仍受平台限制。`;
 }
 async reminders(){for(const r of this.store.reminders().filter(r=>r.status==='pending'&&Number(r.dueAt)<=Date.now())){
  r.status='sending';this.store.saveReminder(r);try{const receipt=await this.channel.sendText({scope:'c2c',targetId:String(r.peerId)},'提醒：'+String(r.text));r.status='sent';r.receipt=receipt.id;}catch(e){r.status='failed';r.error=e instanceof Error?e.message:'发送失败';}this.store.saveReminder(r);
 }}
 recover(){for(const r of this.store.reminders().filter(r=>r.status==='sending')){r.status='uncertain';this.store.saveReminder(r);}}
}
