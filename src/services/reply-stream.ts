import type {Config} from '../config/schema.js';
import {errorMessage,type Channel,type Task} from '../domain/types.js';
import {log} from '../observability/logger.js';
import {splitReply} from '../media/store.js';
type ProgressState={items:Map<string,string>;last:number;stream?:ReturnType<Channel['stream']>;failed:boolean};
export class ReplyProgress {
 private states=new Map<string,ProgressState>();
 constructor(private config:Config,private channel:Channel){}
 private state(task:Task){let s=this.states.get(task.id);if(!s){s={items:new Map(),last:0,failed:false,stream:this.channel.stream(task.target)};this.states.set(task.id,s);}return s;}
 async start(task:Task){
  if(!this.config.streaming.enabled)return;const s=this.state(task);if(!s.stream)return;
  try{await s.stream.update('思考中…');s.last=Date.now();log.info({event:'stream_started',taskId:task.id});}catch(e){s.failed=true;s.stream.cancel();log.warn({event:'stream_failed',stage:'start',taskId:task.id,reason:errorMessage(e)});}
 }
 async delta(task:Task,itemId:string,delta:string){
  if(!this.config.streaming.enabled)return;const s=this.state(task);
  s.items.set(itemId,(s.items.get(itemId)||'')+delta);if(s.failed||(!s.stream&&Date.now()-s.last<this.config.streaming.intervalMs))return;
  s.last=Date.now();const text=splitReply([...s.items.values()].join('\n')).text.replace(/<qq(?:image|video|voice|file)>[^<]*$/,'').slice(0,12000);
  if(!text)return;
  try{if(s.stream)await s.stream.update(text);else await this.channel.typing(task.target);}catch(e){s.failed=true;s.stream?.cancel();log.warn({event:'stream_failed',stage:'update',taskId:task.id,reason:errorMessage(e)});}
 }
 async finish(task:Task){const s=this.states.get(task.id);this.states.delete(task.id);if(!s?.stream||s.failed)return undefined;try{const text=splitReply(task.reply||'').text.slice(0,12000);await s.stream.update(text);const receipt=await s.stream.complete();log.info({event:'stream_completed',taskId:task.id,receipt:!!receipt});return receipt?{...receipt,text}:undefined;}catch(e){s.stream.cancel();log.warn({event:'stream_failed',stage:'complete',taskId:task.id,reason:errorMessage(e)});return undefined;}}
 cancel(taskId:string){this.states.get(taskId)?.stream?.cancel();this.states.delete(taskId);}
}
