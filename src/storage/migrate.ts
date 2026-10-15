import {existsSync,readFileSync} from 'node:fs';
import type {Config} from '../config/schema.js';
import type {Store} from './database.js';
import {object,string,type Task} from '../domain/types.js';
export function importLegacy(store:Store,config:Config,path:string){
 if(store.get('legacyImported'))return {imported:0};let imported=0;
 if(existsSync(path)){
  const legacy=object(JSON.parse(readFileSync(path,'utf8')));
  for(const raw of Array.isArray(legacy.jobs)?legacy.jobs:[]){
   const job=object(raw),target=object(job.target);if(!job.id||!job.messageId||!target.targetId)continue;
   const status=job.status==='done'?'delivered':job.reply?'succeeded':'uncertain';
   const task:Task={id:string(job.id),accountId:config.accountId,peerId:string(target.targetId),eventId:string(job.messageId),threadId:string(job.threadId)||config.threadId,backend:'queue',target:{scope:'c2c',targetId:string(target.targetId),msgId:string(target.msgId)},text:string(job.text),incoming:[],files:[],status,reply:string(job.reply)||undefined,createdAt:Number(job.receivedAt)||Date.now(),updatedAt:Date.now(),error:status==='uncertain'?'旧任务迁移后需人工核对，未自动重新执行':undefined};
   if(!store.getTask(task.id)){store.saveTask(task);imported++;}
  }
 }
 store.set('legacyImported',{at:Date.now(),imported});return {imported};
}
