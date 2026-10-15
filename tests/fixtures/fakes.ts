import {randomUUID} from 'node:crypto';
import type {ReplyTarget} from '@tencent-connect/qqbot-nodejs';
import {configSchema,type Config} from '../../src/config/schema.js';
import type {Agent,AgentEvent,Approval,Channel,Incoming,Json,MediaKind,Task} from '../../src/domain/types.js';
export function config(overrides:Record<string,unknown>={}):Config{return configSchema.parse({accountId:'bot',owner:'owner',threadId:'same-thread',stateDir:'/tmp/qq-test-state',mediaDir:'/tmp/qq-test-media',streaming:{enabled:false,native:false,intervalMs:1000},...overrides});}
export function message(overrides:Partial<Incoming>={}):Incoming{return {accountId:'bot',messageId:randomUUID(),peerId:'owner',target:{scope:'c2c',targetId:'owner',msgId:'origin'},text:'你好',attachments:[],timestamp:Date.now(),...overrides};}
export class FakeAgent implements Agent{
 connected=true;connectionId='test-connection';listeners:((event:AgentEvent)=>void)[]=[];submitted:Task[]=[];cancelled:string[]=[];responses:{id:string|number;result:unknown}[]=[];turns=new Map<string,Json>();active=false;submitError=false;
 async connect(){this.connected=true;}
 async readThread(id:string){return {id,status:{type:this.active?'active':'idle'}};}
 resume(id:string){return this.readThread(id);}
 async submit(task:Task){this.submitted.push(structuredClone(task));if(this.submitError)throw new Error('Codex RPC timeout');return 'turn-'+task.id;}
 async cancel(_thread:string,turn:string){this.cancelled.push(turn);}
 respond(id:string|number,result:unknown){this.responses.push({id,result});}
 onEvent(listener:(event:AgentEvent)=>void){this.listeners.push(listener);return ()=>{};}
 emit(event:AgentEvent){for(const listener of this.listeners)listener(event);}
 async turn(_thread:string,id:string){return this.turns.get(id)||{id,status:'inProgress'};}
 async close(){this.connected=false;}
}
export class FakeChannel implements Channel{
 online=true;sent:{kind:string;text:string}[]=[];fail=false;timeout=false;next=0;
 async sendText(_target:ReplyTarget,text:string){if(this.fail)throw new Error(this.timeout?'Network error timeout':'permission denied');this.sent.push({kind:'text',text});return {id:'receipt-'+(++this.next)};}
 async sendMedia(_target:ReplyTarget,kind:MediaKind,path:string){if(this.fail)throw new Error(this.timeout?'Network error timeout':'permission denied');this.sent.push({kind,text:path});return {id:'receipt-'+(++this.next)};}
 async typing(){}
 async approval(_target:ReplyTarget,a:Approval){this.sent.push({kind:'approval',text:a.nonce});return {id:'approval-'+(++this.next)};}
 stream(){return undefined;}
}
export const noMedia={async receive(){return [];},async stage(path:string){return path;}};
export const noProcessing={async prepare<T>(f:T){return f;},async synthesize(){return '/tmp/voice.mp3';},async outboundVoice(p:string){return p;}};
