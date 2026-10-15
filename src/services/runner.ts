import {randomUUID} from 'node:crypto';
import {basename} from 'node:path';
import type {Config} from '../config/schema.js';
import type {Store} from '../storage/database.js';
import {errorMessage,object,string,type Agent,type AgentEvent,type Attachment,type Channel,type Delivery,type Incoming,type Json,type Task} from '../domain/types.js';
import {MediaStore,splitReply} from '../media/store.js';
import {MediaProcessor} from '../media/process.js';
import {ApprovalService} from './approvals.js';
import {Questions} from './questions.js';
import {ReplyProgress} from './reply-stream.js';
import {log} from '../observability/logger.js';
export interface MediaPort {receive(items:Incoming['attachments'],taskId:string):Promise<Attachment[]>;stage(path:string):Promise<string>}
export interface ProcessingPort {prepare(file:Attachment):Promise<Attachment>;synthesize(text:string):Promise<string>;outboundVoice(path:string):Promise<string>}
const active=['received','preparing','queued','submitting','running','waiting_approval'] as const;
export class Runner {
 readonly questions:Questions;readonly approvals:ApprovalService;private progress:ReplyProgress;private busy=false;private eventChain=Promise.resolve();private phases=new Map<string,string>();private early:AgentEvent[]=[];private lastPoll=0;private resumed=new Set<string>();
 constructor(readonly config:Config,readonly store:Store,readonly agent:Agent,readonly channel:Channel,private media:MediaPort=new MediaStore(config),private processing:ProcessingPort=new MediaProcessor(config)){
  this.questions=new Questions(store,agent,channel);this.approvals=new ApprovalService(config,store,agent,channel);this.progress=new ReplyProgress(config,channel);
  agent.onEvent(event=>{this.eventChain=this.eventChain.then(()=>this.onEvent(event)).catch(e=>log.error({event:'agent_event_failed',reason:errorMessage(e)}));});
 }
 async accept(message:Incoming){
  if(!this.config.owner||message.peerId!==this.config.owner||message.accountId!==this.config.accountId)throw new Error('发送者未授权');
  const threadId=this.store.get<string>('thread:'+message.accountId+':'+message.peerId)||this.config.threadId;
  const {task,fresh}=this.store.enqueue(message,threadId,this.config.backend,this.config.limits.queue);
  if(fresh){this.store.putRef(message.accountId,message.peerId,message.messageId,{text:message.text,taskId:task.id,files:[]});try{await this.channel.typing(message.target);}catch(e){log.warn({event:'typing_failed',taskId:task.id,reason:errorMessage(e)});}}
  return {task,fresh};
 }
 async recover(){
  for(const task of this.store.tasks(['preparing'])){task.status='received';this.store.saveTask(task);}
  for(const task of this.store.tasks(['submitting'])){task.status='uncertain';task.error='重启时任务提交结果不确定，请在电脑端核对；未自动重复执行';this.store.saveTask(task);}
  for(const d of this.store.db.prepare("SELECT data FROM deliveries WHERE state='sending'").all() as {data:string}[]){const delivery=JSON.parse(d.data) as Delivery;delivery.state='uncertain';delivery.error='进程中断，QQ 送达状态不确定';this.store.saveDelivery(delivery);const task=this.store.getTask(delivery.taskId);if(task){task.status='delivery_failed';task.error=delivery.error;this.store.saveTask(task);}}
 }
 private prompt(task:Task){
  const reference=task.refKey?this.store.getRef<{text:string;files:Attachment[];taskId?:string}>(task.accountId,task.peerId,task.refKey):undefined;
  if(reference?.taskId){const previous=this.store.getTask(reference.taskId);if(previous?.peerId===task.peerId&&previous.accountId===task.accountId)reference.files=previous.files;}
  const parts=[task.text||'请查看附件。'];
  if(reference)parts.push('[引用] '+reference.text,...reference.files.map(f=>f.path));
  else if(task.quoteText)parts.push('[引用] '+task.quoteText);
  else if(task.refKey)parts.push('[引用内容不可用]');
  for(const file of task.files){
   if(file.kind!=='image')parts.push('[附件] '+file.path);
   if(file.transcript)parts.push('[转写] '+file.transcript);
   if(file.images?.length)parts.push('视频仅抽取 '+file.images.length+' 帧。');
  }
  if(/发送|发给|发我|文件.*给我|下载|导出|保存|生成.*(?:图|文档|文件)|画|send|export|attach|download|draw/i.test(task.text))parts.push('回传文件用 <qqfile>绝对路径</qqfile>，图片用 qqimage，视频 qqvideo，语音 qqvoice；可暂存至 '+this.config.mediaDir+'/outbox。');
  return parts.join('\n');
 }
 async tick(){
  if(this.busy)return;this.busy=true;
  try{
   if(!this.agent.connected){await this.agent.connect();this.resumed.clear();}
   this.approvals.expire();
   for(const task of this.store.tasks(['running','waiting_approval'])){
    if(Date.now()-task.createdAt>this.config.limits.taskTimeoutMs){task.status='uncertain';task.error='等待超时；任务可能仍在 Codex 执行，请在电脑端核对';this.store.saveTask(task);this.approvals.finish(task.id);this.progress.cancel(task.id);await this.notify(task,task.error);continue;}
    if(Date.now()-this.lastPoll>4000&&task.turnId){try{if(!this.resumed.has(task.threadId)){await this.agent.resume(task.threadId);this.resumed.add(task.threadId);}const turn=await this.agent.turn(task.threadId,task.turnId);if(turn&&turn.status!=='inProgress')await this.finish(task,turn);}catch(e){log.warn({event:'turn_reconcile_failed',taskId:task.id,reason:errorMessage(e)});}}
   }
   if(Date.now()-this.lastPoll>4000)this.lastPoll=Date.now();
   for(const task of this.store.tasks(['succeeded','delivering']))await this.deliver(task);
   if(this.store.tasks(['running','waiting_approval','submitting']).length)return;
   const task=this.store.tasks(['received','queued'])[0];if(!task)return;
   try{
    if(task.status==='received'){
     task.status='preparing';this.store.saveTask(task);task.files=await this.media.receive(task.incoming,task.id);
     for(const f of task.files){try{await this.processing.prepare(f);}catch(e){f.transcript=(f.transcript||'')+'\n媒体预处理未完成：'+errorMessage(e);}}
     this.store.putRef(task.accountId,task.peerId,task.eventId,{text:task.text,taskId:task.id,files:task.files});task.prompt=this.prompt(task);task.status='queued';task.voiceReply=this.store.get<boolean>('voice:'+task.accountId+':'+task.peerId)||false;this.store.saveTask(task);
    }
    const thread=await this.agent.readThread(task.threadId);if(object(thread.status).type==='active')return;
    if(!this.resumed.has(task.threadId)){await this.agent.resume(task.threadId);this.resumed.add(task.threadId);}
    const choice=this.store.get<{model:string;effort?:Task['effort']}>('model:'+task.threadId);if(choice){task.model=choice.model;task.effort=choice.effort;}
    task.status='submitting';this.store.saveTask(task);await this.progress.start(task);task.turnId=await this.agent.submit(task);task.status='running';this.store.saveTask(task);
    const events=this.early.splice(0);for(const event of events)await this.onEvent(event);
   }catch(e){this.progress.cancel(task.id);task.error=errorMessage(e);task.status=task.status==='submitting'?'uncertain':'failed';this.store.saveTask(task);await this.notify(task,'任务未完成：'+task.error);}
  }finally{this.busy=false;}
 }
 async onEvent(event:AgentEvent){
  if(event.method==='bridge/disconnected'){this.resumed.clear();return;}
  if(event.method==='serverRequest/resolved'){const id=event.params.requestId;if(typeof id==='string'||typeof id==='number')this.approvals.resolved(id);return;}
  const p=event.params,threadId=string(p.threadId),turnId=string(p.turnId)||string(object(p.turn).id);
  const task=this.store.tasks(['running','waiting_approval','submitting']).find(t=>t.threadId===threadId&&t.turnId===turnId);
  if(!task){if(this.store.tasks(['submitting']).some(t=>t.threadId===threadId)&&this.early.length<200)this.early.push(event);return;}
  if(event.id!==undefined){if(await this.questions.receive(event,task))return;await this.approvals.receive(event,task);return;}
  if(event.method==='item/started'){const item=object(p.item);if(item.type==='agentMessage')this.phases.set(string(item.id),string(item.phase));}
  if(event.method==='item/agentMessage/delta'&&this.phases.get(string(p.itemId))!=='commentary')await this.progress.delta(task,string(p.itemId),string(p.delta));
  if(event.method==='item/completed'){const item=object(p.item);if(item.type==='agentMessage'&&item.phase==='final_answer'){task.reply=string(item.text);this.store.saveTask(task);}}
  if(event.method==='turn/completed')await this.finish(task,object(p.turn));
 }
 async finish(task:Task,turn:Json){
  const current=this.store.getTask(task.id);if(!current||!['running','waiting_approval'].includes(current.status))return;task=current;
  const items=Array.isArray(turn.items)?turn.items.map(object):[];const text=items.filter(i=>i.type==='agentMessage'&&i.phase==='final_answer').map(i=>string(i.text)).join('\n');
  task.reply=text||task.reply;
  this.approvals.finish(task.id);
  this.phases.clear();
  if(turn.status==='completed'){
   if(!task.reply){task.reply='任务已完成，但未获取到最终文字回复，请在电脑端查看。';}
   task.status='succeeded';this.store.saveTask(task);
   const receipt=await this.progress.finish(task);if(receipt)this.store.set('streamReceipt:'+task.id,receipt);
  }else{task.status=turn.status==='interrupted'?'cancelled':'failed';task.error=string(object(turn.error).message)||'Codex '+String(turn.status);this.progress.cancel(task.id);this.store.saveTask(task);await this.notify(task,'任务'+(task.status==='cancelled'?'已取消':'失败')+'：'+task.error);}
 }
 private async notify(task:Task,text:string){try{await this.channel.sendText(task.target,text);}catch(e){log.warn({event:'notice_failed',taskId:task.id,reason:errorMessage(e)});}}
 async deliver(task:Task){
  try{
   if(!this.store.deliveries(task.id).length){
    const parsed=splitReply(task.reply||'');if(parsed.files.length>this.config.limits.attachments)throw new Error('回复附件数量超限');const parts:Delivery[]=[];
    const streamed=this.store.get<{id:string;text:string}>('streamReceipt:'+task.id);
    const prefix=streamed&&parsed.text.startsWith(streamed.text)?streamed:undefined;
    if(prefix?.text)parts.push({id:randomUUID(),taskId:task.id,seq:parts.length,kind:'text',content:prefix.text,state:'sent',receipt:prefix.id});
    const remaining=parsed.text.slice(prefix?.text.length||0);
    for(let i=0;i<remaining.length;i+=1600)parts.push({id:randomUUID(),taskId:task.id,seq:parts.length,kind:'text',content:remaining.slice(i,i+1600),state:'pending'});
    for(const file of parsed.files){let path=await this.media.stage(file.path);if(file.kind==='voice')path=await this.processing.outboundVoice(path);parts.push({id:randomUUID(),taskId:task.id,seq:parts.length,kind:file.kind,content:path,name:basename(file.path),state:'pending'});}
    if(task.voiceReply&&parsed.text){try{const path=await this.processing.synthesize(parsed.text);parts.push({id:randomUUID(),taskId:task.id,seq:parts.length,kind:'voice',content:path,state:'pending'});}catch(e){log.warn({event:'tts_fallback_text',taskId:task.id,reason:errorMessage(e)});}}
    this.store.stageDeliveries(task,parts);
   }
   for(const d of this.store.deliveries(task.id)){
    if(d.state==='sent')continue;if(d.state==='uncertain')throw new Error('上次投递结果不确定，请先核对 QQ 是否已收到');
    d.state='sending';this.store.saveDelivery(d);
    try{const receipt=d.kind==='text'?await this.channel.sendText(task.target,d.content):await this.channel.sendMedia(task.target,d.kind,d.content,d.name);if(!receipt.id)throw new Error('缺少发送回执');d.state='sent';d.receipt=receipt.id;this.store.saveDelivery(d);this.store.putRef(task.accountId,task.peerId,receipt.id,{text:task.reply||'',taskId:task.id,files:task.files});}
    catch(e){d.error=errorMessage(e);d.state=/timeout|超时|Network error|ECONNRESET|socket hang up/i.test(d.error)?'uncertain':'failed';this.store.saveDelivery(d);throw e;}
   }
   task.status='delivered';delete task.error;this.store.saveTask(task);log.info({event:'task_delivered',taskId:task.id});
  }catch(e){task.status='delivery_failed';task.error=errorMessage(e);this.store.saveTask(task);log.error({event:'delivery_failed',taskId:task.id,reason:task.error});}
 }
 async cancel(peer:string,id?:string){const task=this.select(peer,id,['running','waiting_approval'])||this.select(peer,id,['received','queued']);if(!task)throw new Error('没有可取消的任务');
  if(task.turnId){await this.agent.cancel(task.threadId,task.turnId);}else{task.status='cancelled';this.store.saveTask(task);}this.progress.cancel(task.id);return task;
 }
 retry(peer:string,id?:string){const task=this.select(peer,id,['delivery_failed']);if(!task)throw new Error('没有可重试投递的任务');if(this.store.deliveries(task.id).some(d=>d.state==='uncertain'))throw new Error('送达状态不确定，请先在 QQ 核对，不自动重复发送');task.status='succeeded';delete task.error;this.store.saveTask(task);return task;}
 private select(peer:string,id:string|undefined,statuses:Task['status'][]){return this.store.tasks(statuses).filter(t=>t.peerId===peer&&t.accountId===this.config.accountId&&(!id||t.id.startsWith(id))).at(-1);}
 async flushEvents(){await this.eventChain;}
}
