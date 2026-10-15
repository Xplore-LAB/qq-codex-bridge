import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexClient} from '../../src/agents/codex/client.js';
import {object,type Task} from '../../src/domain/types.js';
test('JSON-RPC client initializes, preserves session policy, correlates events and handles approvals',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qq-rpc-')),socket=join(root,'rpc.sock'),server=createServer(),wsServer=new WebSocketServer({server});
 const seen:Record<string,unknown>[]=[];const replies:Record<string,unknown>[]=[];
 wsServer.on('connection',ws=>ws.on('message',raw=>{const m=object(JSON.parse(raw.toString()));if(!m.method){replies.push(m);return;}seen.push(m);if(!m.id)return;const method=m.method;const params=object(m.params);
  const result=method==='initialize'?{}:method==='thread/read'||method==='thread/resume'?{thread:{id:params.threadId,status:{type:'idle'}}}:method==='turn/start'?{turn:{id:'actual-turn'}}:method==='thread/turns/list'?{data:[{id:'actual-turn',status:'completed',items:[]}],nextCursor:null}:{};
  ws.send(JSON.stringify({id:m.id,result}));if(method==='turn/start'){ws.send(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:'same',turnId:'actual-turn',itemId:'item',delta:'中文'}}));ws.send(JSON.stringify({id:'approval-1',method:'item/commandExecution/requestApproval',params:{threadId:'same',turnId:'actual-turn'}}));}
 }));
 await new Promise<void>(resolve=>server.listen(socket,resolve));const client=new CodexClient({socket}),events:unknown[]=[];client.onEvent(e=>events.push(e));
 try{
  await client.connect();assert.equal((await client.readThread('same')).id,'same');await client.resume('same');const task={id:'job',threadId:'same',text:'test',files:[]} as unknown as Task;assert.equal(await client.submit(task),'actual-turn');await new Promise(r=>setTimeout(r,10));client.respond('approval-1',{decision:'decline'});await client.cancel('same','actual-turn');assert.ok(events.length>=2);
  const resume=object(seen.find(m=>m.method==='thread/resume')?.params);assert.deepEqual(resume,{threadId:'same',excludeTurns:true});
  const start=object(seen.find(m=>m.method==='turn/start')?.params);assert.equal(start.approvalPolicy,undefined);assert.equal(start.sandboxPolicy,undefined);assert.equal(start.clientUserMessageId,'job');assert.equal(replies[0]?.id,'approval-1');assert.equal((await client.turn('same','actual-turn'))?.status,'completed');
 }finally{await client.close();wsServer.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
