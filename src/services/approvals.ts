import {randomBytes,randomUUID} from 'node:crypto';
import type {Config} from '../config/schema.js';
import type {Store} from '../storage/database.js';
import {object,string,type Agent,type AgentEvent,type Approval,type Channel,type Task} from '../domain/types.js';
const METHODS=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval']);
export class ApprovalService {
 constructor(private config:Config,private store:Store,private agent:Agent,private channel:Channel){}
 async receive(event:AgentEvent,task:Task){
  if(event.id===undefined||!METHODS.has(event.method))return false;
  const existing=this.store.approvals().find(a=>a.connectionId===this.agent.connectionId&&a.requestId===event.id);if(existing)return true;
  if(!this.config.approvals.enabled){this.agent.respond(event.id,{decision:'decline'});return true;}
  const request=event.params;const a:Approval={id:randomUUID(),taskId:task.id,threadId:task.threadId,turnId:task.turnId!,requestId:event.id,method:event.method,peerId:task.peerId,accountId:task.accountId,nonce:randomBytes(18).toString('base64url'),expiresAt:Date.now()+this.config.approvals.ttlMs,status:'pending',summary:[string(request.command)||'文件修改',string(request.cwd),string(request.reason)].filter(Boolean).join('\n').slice(0,1600),allowed:Array.isArray(request.availableDecisions)?request.availableDecisions.filter((d):d is string=>typeof d==='string'&&['accept','decline'].includes(d)):['accept','decline'],connectionId:this.agent.connectionId};
  this.store.saveApproval(a);task.status='waiting_approval';this.store.saveTask(task);await this.channel.approval(task.target,a);return true;
 }
 decide(nonce:string,decision:string,peer:string){
  if(!['accept','decline'].includes(decision))throw new Error('审批仅支持 accept 或 decline');
  const pending=this.store.getApproval(nonce);if(!pending||!pending.allowed.includes(decision))throw new Error('该审批不支持此决策');
  const task=this.store.getTask(pending.taskId);if(!task||task.status!=='waiting_approval'||task.turnId!==pending.turnId)throw new Error('原任务已结束或审批已失效');
  const a=this.store.claimApproval(nonce,peer,this.config.accountId,this.agent.connectionId);
  // Only answer a genuine server-initiated request on its originating connection.
  this.agent.respond(a.requestId,{decision});a.status='resolved';a.decision=decision;this.store.saveApproval(a);task.status='running';this.store.saveTask(task);
 }
 resolved(id:string|number){for(const a of this.store.approvals().filter(a=>a.requestId===id&&a.connectionId===this.agent.connectionId&&a.status==='pending')){a.status='resolved';this.store.saveApproval(a);const task=this.store.getTask(a.taskId);if(task?.status==='waiting_approval'){task.status='running';this.store.saveTask(task);}}}
 expire(){for(const a of this.store.approvals().filter(a=>a.status==='pending')){
  if(a.connectionId!==this.agent.connectionId){a.status='uncertain';this.store.saveApproval(a);continue;}
  if(a.expiresAt<=Date.now()){try{this.agent.respond(a.requestId,{decision:'decline'});}finally{a.status='expired';this.store.saveApproval(a);const task=this.store.getTask(a.taskId);if(task?.status==='waiting_approval'){task.status='running';this.store.saveTask(task);}}}
 }}
 finish(taskId:string){for(const a of this.store.approvals().filter(a=>a.taskId===taskId&&a.status==='pending')){a.status='expired';this.store.saveApproval(a);}}
}
