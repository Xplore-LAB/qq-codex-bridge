import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openSync,readSync,closeSync,statSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {Store} from '../../storage/database.js';
import {codexHome} from '../../config/schema.js';
import {join} from 'node:path';
import {object,string,type Agent,type AgentEvent,type Task,type Json} from '../../domain/types.js';
const exec=promisify(execFile);
export async function rolloutPath(threadId:string){
 const py="import sqlite3,sys,pathlib; c=sqlite3.connect(pathlib.Path(sys.argv[2]).resolve().as_uri()+'?mode=ro',uri=True); r=c.execute('select rollout_path from threads where id=?',(sys.argv[1],)).fetchone(); print(r[0] if r else '')";
 const r=await exec('python3',['-c',py,threadId,join(codexHome,'state_5.sqlite')],{timeout:10000});const path=r.stdout.trim();if(!path||!existsSync(path))throw new Error('会话历史不存在');return path;
}
export class QueueAgent implements Agent {
 connected=true;connectionId='queue-'+randomUUID();constructor(private store:Store){}
 async connect(){}
 async readThread(id:string){await rolloutPath(id);return {id,status:{type:'idle'},degraded:true};}
 resume(id:string){return this.readThread(id);}
 onEvent(_listener:(event:AgentEvent)=>void){return ()=>{};}
 respond(){throw new Error('降级模式不能处理 QQ 审批');}
 async cancel(){throw new Error('降级模式不能安全取消已提交的 Codex 任务，请在电脑端处理');}
 async submit(task:Task){task.history=await rolloutPath(task.threadId);task.offset=statSync(task.history).size;this.store.saveTask(task);const args=['queue','--thread',task.threadId,'--message',task.prompt||task.text];for(const f of task.files){for(const image of [...(f.kind==='image'?[f.path]:[]),...(f.images||[])])args.push('--image',image);}await exec('codex',args,{timeout:30000,maxBuffer:1048576});return task.id;}
 async turn(_threadId:string,id:string):Promise<Json|undefined>{
  const task=this.store.getTask(id);if(!task)return undefined;
  if(!task.history||!existsSync(task.history))task.history=await rolloutPath(task.threadId);
  const offset=task.offset||0,size=statSync(task.history).size;if(size<offset)throw new Error('会话历史被截断');if(size===offset)return {id,status:'inProgress'};
  const bytes=Buffer.alloc(Math.min(size-offset,8*1024*1024)),fd=openSync(task.history,'r');let count:number;try{count=readSync(fd,bytes,0,bytes.length,offset);}finally{closeSync(fd);}const end=bytes.subarray(0,count).lastIndexOf(10);if(end<0)return {id,status:'inProgress'};
  for(const line of bytes.subarray(0,end).toString('utf8').split('\n')){
   let r:Json;try{r=object(JSON.parse(line));}catch{continue;}const m=object(r.payload);if(r.type!=='response_item'||m.type!=='message')continue;const text=(Array.isArray(m.content)?m.content:[]).map(c=>string(object(c).text)).join('\n');if(m.role==='user'&&text.includes('[QQ任务 '+task.id+']'))task.matched=true;if(task.matched&&m.role==='assistant'&&m.phase==='final_answer'){task.reply=text;break;}
  }
  task.offset=offset+end+1;this.store.saveTask(task);return task.reply?{id,status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:task.reply}]}:{id,status:'inProgress'};
 }
 async close(){this.connected=false;}
}
