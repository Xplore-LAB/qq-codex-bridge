import type {Config} from '../config/schema.js';
import type {Channel,Task} from '../domain/types.js';
import {splitReply} from '../media/store.js';
export class ReplyProgress {
 private states=new Map<string,{items:Map<string,string>;last:number;stream?:ReturnType<Channel['stream']>;failed:boolean}>();
 constructor(private config:Config,private channel:Channel){}
 async delta(task:Task,itemId:string,delta:string){
  if(!this.config.streaming.enabled)return;
  let s=this.states.get(task.id);if(!s){s={items:new Map(),last:0,failed:false,stream:this.channel.stream(task.target)};this.states.set(task.id,s);}
  s.items.set(itemId,(s.items.get(itemId)||'')+delta);if(s.failed||Date.now()-s.last<this.config.streaming.intervalMs)return;
  s.last=Date.now();const text=splitReply([...s.items.values()].join('\n')).text.replace(/<qq(?:image|video|voice|file)>[^<]*$/,'').slice(-1500);
  if(!text)return;
  try{if(s.stream)await s.stream.update(text);else await this.channel.typing(task.target);}catch{s.failed=true;s.stream?.cancel();}
 }
 async finish(task:Task){const s=this.states.get(task.id);this.states.delete(task.id);if(!s?.stream||s.failed)return undefined;try{const text=splitReply(task.reply||'').text.slice(0,12000);await s.stream.update(text);const receipt=await s.stream.complete();return receipt?{...receipt,text}:undefined;}catch{s.stream.cancel();return undefined;}}
 cancel(taskId:string){this.states.get(taskId)?.stream?.cancel();this.states.delete(taskId);}
}
