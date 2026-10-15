import {randomBytes} from 'node:crypto';
import {object,string,type Agent,type AgentEvent,type Channel,type Json,type Task} from '../domain/types.js';
import type {Store} from '../storage/database.js';
type Pending={nonce:string;requestId:string|number;connectionId:string;taskId:string;peerId:string;accountId:string;turnId:string;expiresAt:number;questions:Json[];answers:Record<string,{answers:string[]}>;done:boolean};
export class Questions {
 constructor(private store:Store,private agent:Agent,private channel:Channel){}
 async receive(event:AgentEvent,task:Task){
  if(event.method!=='item/tool/requestUserInput'||event.id===undefined)return false;
  const key='question-request:'+this.agent.connectionId+':'+event.id;if(this.store.get(key))return true;
  const qs=Array.isArray(event.params.questions)?event.params.questions.map(object):[];
  if(qs.some(q=>q.isSecret)){await this.channel.sendText(task.target,'Codex 请求敏感信息，请在电脑端回答。');return true;}
  const nonce=randomBytes(12).toString('hex');const p:Pending={nonce,requestId:event.id,connectionId:this.agent.connectionId,taskId:task.id,peerId:task.peerId,accountId:task.accountId,turnId:task.turnId!,expiresAt:Date.now()+600000,questions:qs,answers:{},done:false};
  this.store.set(key,nonce);this.store.set('question:'+nonce,p);
  const text=qs.map(q=>string(q.question)+'\n'+(Array.isArray(q.options)?q.options:[]).map((o,i)=>`${i+1}. ${object(o).label} ${string(object(o).description)}`).join('\n')+`\n/answer ${nonce} ${q.id} 答案或选项编号`).join('\n\n');
  for(let i=0;i<text.length;i+=1500)await this.channel.sendText(task.target,text.slice(i,i+1500));return true;
 }
 answer(nonce:string,questionId:string,text:string,peerId:string,accountId:string){
  const p=this.store.get<Pending>('question:'+nonce);if(!p||p.done||p.peerId!==peerId||p.accountId!==accountId||p.connectionId!==this.agent.connectionId||p.expiresAt<Date.now())throw new Error('问题已失效或无权回答');
  const task=this.store.getTask(p.taskId);if(!task||!['running','waiting_approval'].includes(task.status)||task.turnId!==p.turnId)throw new Error('原任务已结束');
  const q=p.questions.find(q=>q.id===questionId);if(!q||!text)throw new Error('问题ID或答案无效');
  if(/^\d+$/.test(text)&&Array.isArray(q.options)){const choice=q.options[Number(text)-1];if(!choice)throw new Error('选项编号无效');text=string(object(choice).label);}
  p.answers[questionId]={answers:[text]};
  if(p.questions.every(q=>p.answers[string(q.id)])){this.agent.respond(p.requestId,{answers:p.answers});p.done=true;}
  this.store.set('question:'+nonce,p);return p.done?'答案已提交。':'已记录，请继续回答其余问题。';
 }
}
