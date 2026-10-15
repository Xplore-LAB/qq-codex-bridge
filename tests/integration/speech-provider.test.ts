import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {MediaProcessor} from '../../src/media/process.js';
import {config} from '../fixtures/fakes.js';
const exec=promisify(execFile);
test('STT/TTS provider adapter uses explicit environment key and enforces response size',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qq-provider-'));const requests:{path:string;auth?:string;body:Buffer}[]=[];
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));requests.push({path:req.url||'',auth:req.headers.authorization,body:Buffer.concat(chunks)});if(req.url==='/v1/audio/transcriptions'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'中文语音转写'}));}else{res.setHeader('Content-Type','audio/mpeg');res.end(Buffer.from('FAKE_AUDIO'));}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const baseUrl=`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
 process.env.QQ_TEST_SPEECH_KEY='test-only-secret';
 try{
  const processor=new MediaProcessor(config({mediaDir:join(root,'media'),voice:{enabled:true,stt:{baseUrl,model:'test-stt',keyEnv:'QQ_TEST_SPEECH_KEY'},tts:{baseUrl,model:'test-tts',keyEnv:'QQ_TEST_SPEECH_KEY'}}}));
  const audio=join(root,'tone.wav');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.1','-y',audio]);assert.equal(await processor.transcribe(audio),'中文语音转写');const tts=await processor.synthesize('测试');assert.equal(await readFile(tts,'utf8'),'FAKE_AUDIO');assert.equal((await stat(tts)).mode&0o777,0o600);assert.equal(requests.length,2);assert.equal(requests[0]?.auth,'Bearer test-only-secret');assert.ok(requests[0]?.body.includes(Buffer.from('test-stt')));
  const tiny=new MediaProcessor(config({mediaDir:join(root,'media'),limits:{fileBytes:2},voice:{enabled:true,tts:{baseUrl,model:'test-tts',keyEnv:'QQ_TEST_SPEECH_KEY'}}}));await assert.rejects(tiny.synthesize('test'),/超过/);
 }finally{delete process.env.QQ_TEST_SPEECH_KEY;await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
