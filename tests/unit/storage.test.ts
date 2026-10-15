import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../../src/storage/database.js';
import {message} from '../fixtures/fakes.js';
test('event uniqueness and peer-isolated quote references',()=>{
 const store=new Store(':memory:');try{const m=message();assert.equal(store.enqueue(m,'thread','app-server',20).fresh,true);assert.equal(store.enqueue(m,'thread','app-server',20).fresh,false);assert.equal(store.tasks().length,1);store.putRef('bot','owner','ref',{text:'private'});assert.equal(store.getRef('bot','other','ref'),undefined);assert.deepEqual(store.getRef('bot','owner','ref'),{text:'private'});}finally{store.close();}
});
test('queue capacity enforced transactionally without losing existing work',()=>{
 const s=new Store(':memory:');try{s.enqueue(message(),'thread','app-server',1);assert.throws(()=>s.enqueue(message(),'thread','app-server',1),/已满/);assert.equal(s.tasks().length,1);}finally{s.close();}
});
test('native SQLite persists state across restarts and restricts database permissions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qq-db-'));try{const path=join(root,'bridge.db');const a=new Store(path);const {task}=a.enqueue(message(),'same','app-server',20);a.close();const b=new Store(path);assert.equal(b.getTask(task.id)?.threadId,'same');assert.equal(b.db.pragma('journal_mode',{simple:true}),'wal');assert.equal((await stat(path)).mode&0o777,0o600);b.close();}finally{await rm(root,{recursive:true,force:true});}
});
