import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MediaProcessor} from '../../src/media/process.js';
import {config} from '../fixtures/fakes.js';
import type {Attachment} from '../../src/domain/types.js';
const exec=promisify(execFile);
test('real FFmpeg converts audio and extracts bounded video frames without QQ connection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qq-av-'));try{
  const audio=join(root,'tone.wav');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-y',audio],{timeout:15000});
  const processor=new MediaProcessor(config({mediaDir:join(root,'media'),video:{frames:2,maxDurationSec:10,extractFrames:true}}));const mp3=await processor.audio(audio);assert.ok((await stat(mp3)).size>0);
  const video=join(root,'clip.mp4');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=160x90:d=1','-c:v','libx264','-threads','1','-y',video],{timeout:15000});
  const file:Attachment={path:video,name:'clip.mp4',kind:'video',mime:'video/mp4',bytes:100,sha256:'test-video'};await processor.prepare(file);assert.equal(file.images?.length,2);for(const path of file.images!)assert.ok((await stat(path)).size>0);
  await assert.rejects(processor.synthesize('test'),/尚未配置/);
 }finally{await rm(root,{recursive:true,force:true});}
});
