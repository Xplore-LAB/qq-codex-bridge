import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import type {Config} from '../../config/schema.js';
import {object,string,type Agent,type AgentEvent,type Task,type Json} from '../../domain/types.js';
import type {TurnStartParams} from '../../../generated/codex/v2/TurnStartParams.js';
import type {ThreadResumeParams} from '../../../generated/codex/v2/ThreadResumeParams.js';
export class CodexClient implements Agent {
 connected=false;connectionId='';private ws?:WebSocket;private seq=0;
 private pending=new Map<number,{resolve:(v:Json)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
 private eventsEmitter=new EventEmitter();private connecting?:Promise<void>;
 constructor(private config:Pick<Config,'socket'>){}
 onEvent(listener:(event:AgentEvent)=>void){this.eventsEmitter.on('event',listener);return ()=>{this.eventsEmitter.off('event',listener);};}
 async connect(){if(this.connected)return;if(this.connecting)return this.connecting;this.connecting=this.open();try{await this.connecting;}finally{this.connecting=undefined;}}
 private async open(){
  const ws=new WebSocket('ws+unix://'+this.config.socket+':/rpc',{maxPayload:32*1024*1024});this.ws=ws;this.connectionId=randomUUID();
  ws.on('message',data=>{try{this.receive(JSON.parse(data.toString()) as unknown);}catch{this.eventsEmitter.emit('event',{method:'bridge/protocolError',params:{}});}});
  ws.on('close',()=>{this.connected=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Codex connection closed'));}this.pending.clear();this.eventsEmitter.emit('event',{method:'bridge/disconnected',params:{connectionId:this.connectionId}});});
  ws.on('error',()=>{});
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{ws.terminate();reject(new Error('Codex connect timeout'));},10000);ws.once('open',()=>{clearTimeout(timer);resolve();});ws.once('error',e=>{clearTimeout(timer);reject(e);});});
  try{await this.call('initialize',{clientInfo:{name:'qq_codex_bridge_v2',title:'QQ Codex Bridge',version:'2.0.0'},capabilities:{experimentalApi:true,requestAttestation:false}});ws.send(JSON.stringify({method:'initialized'}));this.connected=true;}
  catch(e){ws.close();throw e;}
 }
 private receive(raw:unknown){const m=object(raw);if(m.id!==undefined&&!m.method){const id=Number(m.id),p=this.pending.get(id);if(!p)return;clearTimeout(p.timer);this.pending.delete(id);if(m.error)p.reject(new Error(string(object(m.error).message)||'Codex RPC error'));else p.resolve(object(m.result));return;}
  if(typeof m.method==='string')this.eventsEmitter.emit('event',{method:m.method,params:object(m.params),...(typeof m.id==='number'||typeof m.id==='string'?{id:m.id}:{})} satisfies AgentEvent);
 }
 async call(method:string,params:unknown):Promise<Json>{const ws=this.ws;if(!ws||ws.readyState!==WebSocket.OPEN)throw new Error('Codex not connected');return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex RPC timeout: '+method));},20000);this.pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
 respond(id:string|number,result:unknown){if(!this.connected||!this.ws)throw new Error('Codex not connected');this.ws.send(JSON.stringify({id,result}));}
 readThread(id:string){return this.call('thread/read',{threadId:id,includeTurns:false}).then(r=>object(r.thread));}
 resume(id:string){const p:ThreadResumeParams={threadId:id,excludeTurns:true};return this.call('thread/resume',p).then(r=>object(r.thread));}
 async submit(task:Task){
  const params:TurnStartParams={threadId:task.threadId,clientUserMessageId:task.id,input:[{type:'text',text:task.prompt||task.text,text_elements:[]},...task.files.flatMap(f=>[...(f.kind==='image'?[f.path]:[]),...(f.images||[])]).map(path=>({type:'localImage' as const,path}))]};
  const result=await this.call('turn/start',params);const turn=object(result.turn);const id=string(turn.id);if(!id)throw new Error('Codex did not return turn id');return id;
 }
 async cancel(threadId:string,turnId:string){await this.call('turn/interrupt',{threadId,turnId});}
 async turn(threadId:string,turnId:string){
  let cursor:string|undefined;for(let page=0;page<100;page++){
   const response=await this.call('thread/turns/list',{threadId,limit:50,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});
   const turns=Array.isArray(response.data)?response.data:[];const turn=turns.map(object).find(t=>t.id===turnId);if(turn)return turn;
   cursor=string(response.nextCursor)||undefined;if(!cursor)break;
  }return undefined;
 }
 async close(){this.connected=false;const ws=this.ws;if(!ws)return;await new Promise<void>(resolve=>{if(ws.readyState===WebSocket.CLOSED){resolve();return;}const t=setTimeout(()=>{ws.terminate();resolve();},1000);ws.once('close',()=>{clearTimeout(t);resolve();});ws.close();});}
}
