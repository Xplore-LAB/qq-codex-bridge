import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyProgress} from '../../src/services/reply-stream.js';
import type {Channel,Task} from '../../src/domain/types.js';
import {config,FakeChannel} from '../fixtures/fakes.js';
test('native streaming returns exactly the delivered text and failures fall back cleanly',async()=>{
 const sent:string[]=[];let failed=false;
 const channel=new FakeChannel() as Channel;channel.stream=()=>({async update(text:string){if(failed)throw new Error('platform denied');sent.push(text);},async complete(){return {id:'native-receipt'};},cancel(){}});
 const cfg=config({streaming:{enabled:true,native:true,intervalMs:1000}}),progress=new ReplyProgress(cfg,channel),task={id:'task',target:{scope:'c2c',targetId:'owner'},reply:'a'.repeat(13000)} as Task;
 await progress.delta(task,'item','hello');const receipt=await progress.finish(task);assert.equal(receipt?.id,'native-receipt');assert.equal(receipt?.text.length,12000);assert.equal(sent.at(-1)?.length,12000);
 failed=true;await progress.delta({...task,id:'other'},'item','test');assert.equal(await progress.finish({...task,id:'other'}),undefined);
});
