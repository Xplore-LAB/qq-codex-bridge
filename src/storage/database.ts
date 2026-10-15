import Database from 'better-sqlite3';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Task,TaskStatus,Incoming,Delivery,Approval,Json} from '../domain/types.js';
export class Store {
 readonly db:Database.Database;
 constructor(path:string){
  if(path!==':memory:'){mkdirSync(dirname(path),{recursive:true,mode:0o700});}
  this.db=new Database(path);this.db.pragma('journal_mode = WAL');this.db.pragma('busy_timeout = 5000');this.db.pragma('foreign_keys = ON');
  this.db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);INSERT OR IGNORE INTO migrations VALUES(1);
  CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, account_id TEXT NOT NULL,peer_id TEXT NOT NULL,event_id TEXT NOT NULL,status TEXT NOT NULL,turn_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,event_id));
  CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status,created_at);
  CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),seq INTEGER NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(task_id,seq));
  CREATE TABLE IF NOT EXISTS refs(account_id TEXT NOT NULL,peer_id TEXT NOT NULL,ref_key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account_id,peer_id,ref_key));
  CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,nonce TEXT UNIQUE NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL,data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY,peer_id TEXT NOT NULL,due_at INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);`);
  if(path!==':memory:')chmodSync(path,0o600);
 }
 getTask(id:string):Task|undefined{const row=this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id) as {data:string}|undefined;return row?JSON.parse(row.data) as Task:undefined;}
 tasks(statuses?:TaskStatus[]):Task[]{const rows=(statuses?this.db.prepare(`SELECT data FROM tasks WHERE status IN (${statuses.map(()=>'?').join(',')}) ORDER BY created_at`).all(...statuses):this.db.prepare('SELECT data FROM tasks ORDER BY created_at').all()) as {data:string}[];return rows.map(r=>JSON.parse(r.data) as Task);}
 saveTask(task:Task){task.updatedAt=Date.now();this.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,turn_id=excluded.turn_id,updated_at=excluded.updated_at,data=excluded.data').run(task.id,task.accountId,task.peerId,task.eventId,task.status,task.turnId||null,task.createdAt,task.updatedAt,JSON.stringify(task));}
 enqueue(msg:Incoming,threadId:string,backend:Task['backend'],limit:number):{task:Task;fresh:boolean}{return this.db.transaction(()=>{
  const old=this.db.prepare('SELECT data FROM tasks WHERE account_id=? AND event_id=?').get(msg.accountId,msg.messageId) as {data:string}|undefined;
  if(old)return {task:JSON.parse(old.data) as Task,fresh:false};
  const pending=this.tasks(['received','preparing','queued','submitting','running','waiting_approval']);if(pending.length>=limit)throw new Error('任务队列已满');
  const task:Task={id:randomUUID(),accountId:msg.accountId,peerId:msg.peerId,eventId:msg.messageId,target:msg.target,text:msg.text,incoming:msg.attachments,files:[],status:'received',threadId,backend,createdAt:Date.now(),updatedAt:Date.now(),refKey:msg.refKey,quoteText:msg.quoteText};this.saveTask(task);return {task,fresh:true};
 })();}
 deliveries(taskId:string):Delivery[]{return (this.db.prepare('SELECT data FROM deliveries WHERE task_id=? ORDER BY seq').all(taskId) as {data:string}[]).map(r=>JSON.parse(r.data) as Delivery);}
 saveDelivery(d:Delivery){this.db.prepare('INSERT INTO deliveries VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data').run(d.id,d.taskId,d.seq,d.state,JSON.stringify(d));}
 stageDeliveries(task:Task,parts:Delivery[]){this.db.transaction(()=>{if(this.deliveries(task.id).length)return;for(const part of parts)this.saveDelivery(part);task.status='delivering';this.saveTask(task);})();}
 putRef(account:string,peer:string,key:string,value:unknown){this.db.prepare('INSERT INTO refs VALUES(?,?,?,?) ON CONFLICT(account_id,peer_id,ref_key) DO UPDATE SET data=excluded.data').run(account,peer,key,JSON.stringify(value));}
 getRef<T>(account:string,peer:string,key:string):T|undefined{const row=this.db.prepare('SELECT data FROM refs WHERE account_id=? AND peer_id=? AND ref_key=?').get(account,peer,key) as {data:string}|undefined;return row?JSON.parse(row.data) as T:undefined;}
 set(key:string,value:unknown){this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key,JSON.stringify(value));}
 get<T>(key:string):T|undefined{const row=this.db.prepare('SELECT data FROM kv WHERE key=?').get(key) as {data:string}|undefined;return row?JSON.parse(row.data) as T:undefined;}
 saveApproval(a:Approval){this.db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(a.id,a.nonce,a.status,a.expiresAt,JSON.stringify(a));}
 approvals():Approval[]{return (this.db.prepare('SELECT data FROM approvals').all() as {data:string}[]).map(r=>JSON.parse(r.data) as Approval);}
 getApproval(nonce:string):Approval|undefined{const row=this.db.prepare('SELECT data FROM approvals WHERE nonce=?').get(nonce) as {data:string}|undefined;return row?JSON.parse(row.data) as Approval:undefined;}
 claimApproval(nonce:string,peer:string,account:string,connectionId:string):Approval{
  return this.db.transaction(()=>{const a=this.getApproval(nonce);if(!a||a.peerId!==peer||a.accountId!==account||a.connectionId!==connectionId||a.status!=='pending'||a.expiresAt<=Date.now())throw new Error('审批不存在、已处理或已过期');a.status='uncertain';this.saveApproval(a);return a;})();
 }
 reminders():Json[]{return (this.db.prepare('SELECT data FROM reminders ORDER BY due_at').all() as {data:string}[]).map(r=>JSON.parse(r.data) as Json);}
 saveReminder(r:Json){this.db.prepare('INSERT INTO reminders VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(r.id,r.peerId,r.dueAt,r.status,JSON.stringify(r));}
 close(){this.db.close();}
}
