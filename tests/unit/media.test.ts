import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,readFile,mkdir,symlink,rm,open,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {attachmentUrl,publicAddress,writeLimited} from '../../src/media/download.js';
import {safeName,MediaStore,splitReply} from '../../src/media/store.js';
import {config} from '../fixtures/fakes.js';
test('rejects private/reserved IPv4, mapped IPv6, credentials and insecure URLs',()=>{
 for(const ip of ['0.0.0.0','127.0.0.1','10.1.2.3','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','198.18.0.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
 for(const url of ['http://example.com/a','file:///tmp/a','https://user:password@example.com/a','https://example.com:444/a'])assert.throws(()=>attachmentUrl(url));
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(attachmentUrl('//example.com/a').protocol,'https:');assert.equal(safeName('../../文 件.md'),'文_件.md');
});
test('bounded streaming removes partial files after overflow',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qq-write-'));try{
  const path=join(root,'file');await assert.rejects(writeLimited(Readable.from([Buffer.alloc(6),Buffer.alloc(6)]),path,10),/大小/);await assert.rejects(stat(path));
  assert.equal(await writeLimited(Readable.from([Buffer.from('中文')]),path,10),6);assert.equal(await readFile(path,'utf8'),'中文');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('stage validates real paths, hidden files, actual image bytes and file sizes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qq-stage-'));try{
  const allowed=join(root,'allowed');await mkdir(allowed);const media=join(root,'.local','media');
  const store=new MediaStore(config({mediaDir:media,sendRoots:[allowed],limits:{fileBytes:1024}}));
  const source=join(allowed,'指南.md');await writeFile(source,'指南');const staged=await store.stage(source);assert.equal(await readFile(staged,'utf8'),'指南');assert.equal((await stat(staged)).mode&0o777,0o600);
  assert.ok(await store.stage(staged));
  await writeFile(join(root,'secret'),'secret');await symlink(join(root,'secret'),join(allowed,'escape'));await assert.rejects(store.stage(join(allowed,'escape')),/允许/);
  await writeFile(join(allowed,'.env'),'secret');await assert.rejects(store.stage(join(allowed,'.env')),/隐藏/);
  await writeFile(join(allowed,'fake.png'),'<html>fake</html>');await assert.rejects(store.stage(join(allowed,'fake.png')),/图片/);
  const big=join(allowed,'big');const fd=await open(big,'w');await fd.truncate(1025);await fd.close();await assert.rejects(store.stage(big),/大小/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('only explicit media tags trigger upload; markdown links remain text',()=>{
 const r=splitReply('结果 <qqimage>/tmp/a.png</qqimage>\n<qqfile>/tmp/文档.md</qqfile>');assert.equal(r.text,'结果');assert.deepEqual(r.files,[{kind:'image',path:'/tmp/a.png'},{kind:'file',path:'/tmp/文档.md'}]);assert.equal(splitReply('[文档](/tmp/a.md)').files.length,0);
});
