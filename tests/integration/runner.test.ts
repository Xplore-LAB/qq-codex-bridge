import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../src/storage/database.js';
import {Runner} from '../../src/services/runner.js';
import {Commands} from '../../src/commands/registry.js';
import {config,message,FakeAgent,FakeChannel,noMedia,noProcessing} from '../fixtures/fakes.js';
function fixture(){const cfg=config(),store=new Store(':memory:'),agent=new FakeAgent(),channel=new FakeChannel(),runner=new Runner(cfg,store,agent,channel,noMedia,noProcessing);return {cfg,store,agent,channel,runner};}
test('unauthorized input is rejected; duplicate events execute once in same thread',async()=>{
 const f=fixture();try{await assert.rejects(f.runner.accept(message({peerId:'intruder'})),/未授权/);const msg=message();const {task}=await f.runner.accept(msg);await f.runner.accept(msg);await f.runner.tick();assert.equal(f.agent.submitted.length,1);assert.equal(f.agent.submitted[0]?.threadId,'same-thread');await f.runner.tick();assert.equal(f.agent.submitted.length,1);assert.equal(f.store.getTask(task.id)?.status,'running');}finally{f.store.close();}
});
test('active desktop turn is queued without being steered or overridden',async()=>{
 const f=fixture();try{f.agent.active=true;const {task}=await f.runner.accept(message());await f.runner.tick();assert.equal(f.agent.submitted.length,0);assert.equal(f.store.getTask(task.id)?.status,'queued');f.agent.active=false;await f.runner.tick();assert.equal(f.agent.submitted.length,1);}finally{f.store.close();}
});
test('results and attachments require receipts; delivery retry never resubmits agent work',async()=>{
 const f=fixture();try{const {task}=await f.runner.accept(message());await f.runner.tick();const running=f.store.getTask(task.id)!;f.agent.emit({method:'item/completed',params:{threadId:running.threadId,turnId:running.turnId,item:{type:'agentMessage',phase:'final_answer',text:'完成 <qqfile>/tmp/guide.md</qqfile>'}}});f.agent.emit({method:'turn/completed',params:{threadId:running.threadId,turn:{id:running.turnId,status:'completed',items:[]}}});await f.runner.flushEvents();f.channel.fail=true;await f.runner.tick();assert.equal(f.store.getTask(task.id)?.status,'delivery_failed');assert.equal(f.agent.submitted.length,1);f.channel.fail=false;f.runner.retry('owner');await f.runner.tick();assert.equal(f.store.getTask(task.id)?.status,'delivered');assert.equal(f.agent.submitted.length,1);assert.ok(f.channel.sent.some(s=>s.kind==='file'));}finally{f.store.close();}
});
test('restart preserves running turns and reconciles final results without replay',async()=>{
 const f=fixture();try{const {task}=await f.runner.accept(message());await f.runner.tick();const running=f.store.getTask(task.id)!;f.agent.turns.set(running.turnId!,{id:running.turnId,status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:'恢复后的结果'}]});const next=new Runner(f.cfg,f.store,f.agent,f.channel,noMedia,noProcessing);await next.recover();await next.tick();assert.equal(f.store.getTask(task.id)?.status,'delivered');assert.equal(f.agent.submitted.length,1);}finally{f.store.close();}
});
test('interrupted submitting is uncertain; interrupted sending never auto-repeats',async()=>{
 const f=fixture();try{const {task}=await f.runner.accept(message());task.status='submitting';f.store.saveTask(task);await f.runner.recover();await f.runner.tick();assert.equal(f.store.getTask(task.id)?.status,'uncertain');assert.equal(f.agent.submitted.length,0);task.status='delivering';f.store.saveTask(task);f.store.saveDelivery({id:'d',taskId:task.id,seq:0,kind:'text',content:'maybe sent',state:'sending'});await f.runner.recover();assert.equal(f.store.deliveries(task.id)[0]?.state,'uncertain');assert.throws(()=>f.runner.retry('owner'),/不确定/);}finally{f.store.close();}
});
test('cancellation targets only the requested owner turn',async()=>{
 const f=fixture();try{const {task}=await f.runner.accept(message());await f.runner.tick();const running=f.store.getTask(task.id)!;await f.runner.cancel('owner',task.id.slice(0,8));assert.deepEqual(f.agent.cancelled,[running.turnId]);await assert.rejects(f.runner.cancel('intruder',task.id),/没有/);}finally{f.store.close();}
});
test('real approval IDs are scoped to owner, turn, connection, expiry and single decision',async()=>{
 const f=fixture();try{const {task}=await f.runner.accept(message());await f.runner.tick();const running=f.store.getTask(task.id)!;
 f.agent.emit({method:'item/commandExecution/requestApproval',id:92,params:{threadId:running.threadId,turnId:running.turnId,command:'echo test',cwd:'/tmp'}});await f.runner.flushEvents();const a=f.store.approvals()[0]!;assert.equal(f.store.getTask(task.id)?.status,'waiting_approval');assert.throws(()=>f.runner.approvals.decide(a.nonce,'accept','intruder'));f.runner.approvals.decide(a.nonce,'accept','owner');assert.deepEqual(f.agent.responses,[{id:92,result:{decision:'accept'}}]);assert.throws(()=>f.runner.approvals.decide(a.nonce,'accept','owner'));assert.equal(f.agent.responses.length,1);
 }finally{f.store.close();}
});
test('expired approvals decline, never accept',async()=>{
 const f=fixture();try{const {task}=await f.runner.accept(message());await f.runner.tick();const running=f.store.getTask(task.id)!;f.agent.emit({method:'item/fileChange/requestApproval',id:3,params:{threadId:running.threadId,turnId:running.turnId}});await f.runner.flushEvents();const a=f.store.approvals()[0]!;a.expiresAt=Date.now()-1;f.store.saveApproval(a);f.runner.approvals.expire();assert.deepEqual(f.agent.responses,[{id:3,result:{decision:'decline'}}]);}finally{f.store.close();}
});
test('reminders and commands deduplicate and refuse unauthorized users',async()=>{
 const f=fixture();try{const cmd=new Commands(f.cfg,f.store,f.runner,f.channel);const m=message({text:'/remind 10s 喝水'});await cmd.handle(m);await cmd.handle(m);assert.equal(f.store.reminders().length,1);await assert.rejects(cmd.handle(message({peerId:'intruder',text:'/status'})),/未授权/);const reminder=f.store.reminders()[0]!;reminder.dueAt=Date.now()-1;f.store.saveReminder(reminder);await cmd.reminders();await cmd.reminders();assert.equal(f.channel.sent.filter(s=>s.text==='提醒：喝水').length,1);}finally{f.store.close();}
});
