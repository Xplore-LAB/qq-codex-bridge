import test from 'node:test';
import assert from 'node:assert/strict';
import type {QQBot,QQBotInboundMessage} from '@tencent-connect/qqbot-nodejs';
import {freshToken,normalize} from '../../src/channels/qq/client.js';
test('invalid token clears cache and refreshes once; permission and timeout do not repeat sending',async()=>{
 let refreshed=0,cleared=0,calls=0;const bot={tokenManager:{clearCache(){cleared++;},async getAccessToken(){refreshed++;return 'token';}}} as unknown as Pick<QQBot,'tokenManager'>;
 const creds={appId:'bot',appSecret:'secret'};
 assert.equal(await freshToken(bot,creds,async()=>{if(++calls===1)throw new Error('AccessToken无效或过期');return 'receipt';}),'receipt');assert.equal(calls,2);assert.equal(refreshed,1);assert.equal(cleared,1);
 for(const reason of ['permission denied','Network error timeout']){calls=0;await assert.rejects(freshToken(bot,creds,async()=>{calls++;throw new Error(reason);}));assert.equal(calls,1);}
});
test('inbound attachment schema rejects malformed and excessive attachments',()=>{
 const msg={messageId:'id',senderId:'owner',content:' ',attachments:[{url:'https://example.com/a',content_type:'image/png'}],replyTarget:{scope:'c2c',targetId:'owner'}} as QQBotInboundMessage;
 assert.equal(normalize(msg,'bot').attachments.length,1);assert.throws(()=>normalize({...msg,attachments:Array(9).fill(msg.attachments![0])},'bot'));
 assert.throws(()=>normalize({...msg,attachments:[{url:'',content_type:'image/png'}]},'bot'));
});

test('same robot identity is not silently shared with an enabled OpenClaw channel',async()=>{
 const {conflictingOpenClawAccount}=await import('../../src/channels/qq/ownership.js');const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const dir=await mkdtemp(join(tmpdir(),'qq-ownership-'));
 try{const file=join(dir,'openclaw.json');await writeFile(file,JSON.stringify({channels:{qqbot:{enabled:true,appId:'same'}}}));assert.equal(conflictingOpenClawAccount('same',file),'default');assert.equal(conflictingOpenClawAccount('other',file),undefined);await writeFile(file,JSON.stringify({channels:{qqbot:{enabled:false,appId:'same'}}}));assert.equal(conflictingOpenClawAccount('same',file),undefined);}finally{await rm(dir,{recursive:true,force:true});}
});
