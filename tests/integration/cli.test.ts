import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const exec=promisify(execFile),bin=resolve('bin/qq-codex-bridge.mjs');
test('installed CLI help and version need neither credentials nor a robot connection',async()=>{
 const help=await exec(process.execPath,[bin,'--help']);assert.match(help.stdout,/init --thread/);const version=await exec(process.execPath,[bin,'--version']);assert.equal(version.stdout.trim(),'2.0.0');
});
test('fresh init works without legacy files or secrets and refuses silent session changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qq-cli-'));const configDir=join(root,'config'),env={...process.env,QQ_BRIDGE_CONFIG_DIR:configDir};
 try{
  const r=await exec(process.execPath,[bin,'init','--thread','portable-thread','--state-dir',join(root,'state'),'--media-dir',join(root,'media')],{env});assert.match(r.stdout,/imported/);
  const config=JSON.parse(await readFile(join(configDir,'config.json'),'utf8'));assert.equal(config.threadId,'portable-thread');assert.equal(config.accountId,'unbound');await assert.rejects(stat(join(configDir,'credentials.json')));assert.equal((await stat(join(configDir,'config.json'))).mode&0o777,0o600);
  await assert.rejects(exec(process.execPath,[bin,'init','--thread','different-thread'],{env}));assert.equal(JSON.parse(await readFile(join(configDir,'config.json'),'utf8')).threadId,'portable-thread');
 }finally{await rm(root,{recursive:true,force:true});}
});
