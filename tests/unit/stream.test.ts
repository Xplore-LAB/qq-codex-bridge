import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyProgress} from '../../src/services/reply-stream.js';
import type {Channel,Task} from '../../src/domain/types.js';
import {config,FakeChannel} from '../fixtures/fakes.js';
test('native streaming returns exactly the delivered text and failures fall back cleanly',async()=>{
 const sent:string[]=[];let failed=false;
 const channel=new FakeChannel() as Channel;channel.stream=()=>({async update(text:string){if(failed)throw new Error('platform denied');sent.push(text);},async complete(){return {id:'native-receipt'};},cancel(){}});
 const cfg=config({streaming:{enabled:true,native:true,intervalMs:1000}}),progress=new ReplyProgress(cfg,channel),task={id:'task',target:{scope:'c2c',targetId:'owner'},reply:'a'.repeat(13000)} as Task;
 await progress.delta(task,'item','a');const receipt=await progress.finish(task);assert.equal(receipt?.id,'native-receipt');assert.equal(receipt?.text.length,12000);assert.equal(sent.at(-1)?.length,12000);
 failed=true;await progress.delta({...task,id:'other'},'item','test');assert.equal(await progress.finish({...task,id:'other'}),undefined);
});

test('waiting uses typing; native stream contains only monotonic answer text',async()=>{
 const updates:string[]=[];let opened=0,completed=0;
 const channel=new FakeChannel() as Channel;channel.stream=()=>{opened++;return {async update(text:string){updates.push(text);},async complete(){completed++;return {id:'same-message'};},cancel(){}};};
 const p=new ReplyProgress(config({streaming:{enabled:true,native:true,intervalMs:1000}}),channel),task={id:'loading',target:{scope:'c2c',targetId:'owner'},reply:'你好'} as Task;
 await p.start(task);await p.delta(task,'reply','你');await p.delta(task,'reply','好');assert.deepEqual(updates,['你','你好']);const receipt=await p.finish(task);assert.equal(updates[0],'你');assert.equal(updates.at(-1),'你好');assert.equal(opened,1);assert.equal(completed,1);assert.equal(receipt?.id,'same-message');
});

test('stream never rewrites previously submitted text prefixes',async()=>{
 const updates:string[]=[];const channel=new FakeChannel() as Channel;channel.stream=()=>({async update(text:string){updates.push(text);},async complete(){return {id:'r'};},cancel(){}});
 const p=new ReplyProgress(config({streaming:{enabled:true,native:true,intervalMs:1000}}),channel),t={id:'prefix',target:{scope:'c2c',targetId:'owner'},reply:'正式答案'} as Task;
 await p.delta(t,'one','旧内容');await p.delta(t,'one','继续');assert.deepEqual(updates,['旧内容','旧内容继续']);assert.equal(await p.finish(t),undefined);assert.equal(updates.at(-1),'旧内容继续');
});
