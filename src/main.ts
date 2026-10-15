import {existsSync,readFileSync} from 'node:fs';
import {mkdir,writeFile,chmod,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import QRCode from 'qrcode';
import {startQrConnect} from '@tencent-connect/qqbot-connector';
import {configPath,credentialsPath,root,loadConfig,loadCredentials,migrateConfig,initializeConfig,atomicJson,type Config} from './config/schema.js';
import {Store} from './storage/database.js';
import {importLegacy} from './storage/migrate.js';
import {CodexClient} from './agents/codex/client.js';
import {QueueAgent} from './agents/codex/queue.js';
import {QQChannel} from './channels/qq/client.js';
import {conflictingOpenClawAccount} from './channels/qq/ownership.js';
import {Runner} from './services/runner.js';
import {Commands} from './commands/registry.js';
import {acquireLock} from './observability/lock.js';
import {log} from './observability/logger.js';
import {errorMessage,object,string} from './domain/types.js';
const exec=promisify(execFile);
async function bind(config:Config){
 const old=existsSync(credentialsPath)?loadCredentials():undefined;let settled=false;const abort=new AbortController();
 try{await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{abort.abort();reject(new Error('扫码绑定等待超时，请重新运行 npm run bind'));},10*60000);
  startQrConnect({
   async onQrDisplayed(url){try{await QRCode.toFile(join(config.stateDir,'bind-qr.png'),url,{width:420,margin:3});await chmod(join(config.stateDir,'bind-qr.png'),0o600);await writeFile(join(config.stateDir,'bind-url.txt'),url,{mode:0o600});atomicJson(join(config.stateDir,'bind-status.json'),{status:'waiting_for_scan',updatedAt:new Date().toISOString()});console.log('扫码入口：'+join(config.stateDir,'bind-qr.png'));}catch(e){clearTimeout(timer);reject(e);}},
   onSuccess(credentials){const first=credentials[0];if(!first){clearTimeout(timer);reject(new Error('绑定未返回凭据'));return;}
    if(settled)return;settled=true;clearTimeout(timer);
    if(conflictingOpenClawAccount(first.appId)){reject(new Error('该机器人仍配置在 OpenClaw 中，请选择独立机器人或先明确迁移现有通道'));return;}
    if(first.appId!==old?.appId||!config.owner){delete config.owner;config.pairCode=randomBytes(12).toString('hex');}
    config.accountId=first.appId;atomicJson(credentialsPath,{appId:first.appId,appSecret:first.appSecret});atomicJson(configPath,config);
    atomicJson(join(config.stateDir,'bind-status.json'),{status:config.owner?'bound':'awaiting_pair',updatedAt:new Date().toISOString()});console.log(config.owner?'绑定完成，已保留配对用户。':'绑定完成，请私聊机器人发送 /pair '+config.pairCode);resolve();
   },onFailure(error){clearTimeout(timer);reject(error);},onQrExpired(){log.info({event:'binding_qr_expired'});}
  },{displayQrCodeToConsole:false,signal:abort.signal});
 });}finally{abort.abort();}
}
async function main(){
 const command=process.argv[2]||'check';
 if(command==='init'){
  const {values}=parseArgs({args:process.argv.slice(3),options:{thread:{type:'string'},'app-id':{type:'string'},owner:{type:'string'},legacy:{type:'string'},'state-dir':{type:'string'},'media-dir':{type:'string'},socket:{type:'string'}}});
  const config=values.legacy?migrateConfig(values.legacy):initializeConfig({threadId:values.thread,accountId:values['app-id'],owner:values.owner,stateDir:values['state-dir'],mediaDir:values['media-dir'],socket:values.socket});
  await mkdir(config.stateDir,{recursive:true,mode:0o700});const store=new Store(join(config.stateDir,'bridge.db'));const result=values.legacy?importLegacy(store,config,join(values.legacy,'..','state.json')):{imported:0};store.close();console.log(JSON.stringify({configPath,stateDir:config.stateDir,...result}));return;
 }
 if(!['check','offline','probe','bind','auth-check','start'].includes(command))throw new Error('Unknown command: '+command+' (use --help)');
 const config=loadConfig();await mkdir(config.stateDir,{recursive:true,mode:0o700});await mkdir(config.mediaDir,{recursive:true,mode:0o700});
 if(command==='bind'){const release=await acquireLock(join(config.stateDir,'bind.lock.sock'));try{await bind(config);}finally{await release();}return;}
 const store=new Store(join(config.stateDir,'bridge.db'));
 if(command==='check'||command==='offline'){
  const credentials=existsSync(credentialsPath)?loadCredentials():undefined;const version=await exec('codex',['--version']);console.log(JSON.stringify({status:'offline_ready',backend:config.backend,threadId:config.threadId,sqlite:store.db.prepare('select sqlite_version() as version').get(),codex:version.stdout.trim(),socketExists:existsSync(config.socket),credentialsConfigured:!!credentials,sharedBotConfigured:!!(credentials&&conflictingOpenClawAccount(credentials.appId)),tasks:store.tasks().length,qqConnected:false}));store.close();return;
 }
 const agent=config.backend==='app-server'?new CodexClient(config):new QueueAgent(store);
 if(command==='probe'){
  try{await agent.connect();const t=await agent.readThread(config.threadId);console.log(JSON.stringify({connected:true,sameThread:t.id===config.threadId,status:t.status,backend:config.backend}));}finally{await agent.close();store.close();}return;
 }
 const channel=new QQChannel(config,loadCredentials(),store);
 if(command==='auth-check'){try{console.log('QQ_AUTH',await channel.authCheck());}finally{channel.stop();store.close();}return;}
 if(command!=='start'){store.close();throw new Error('未知命令：'+command);}
 if(conflictingOpenClawAccount(loadCredentials().appId)){store.close();throw new Error('该机器人仍在 OpenClaw 中启用；请使用独立机器人或先完成通道迁移，避免一条消息触发两个代理');}
 const release=await acquireLock(join(config.stateDir,'bridge.lock.sock'));
 let shuttingDown=false;let loop:Promise<void>=Promise.resolve();let timer:NodeJS.Timeout|undefined;
 const runner=new Runner(config,store,agent,channel);const commands=new Commands(config,store,runner,channel);
 await runner.recover();commands.recover();
 channel.onMessage=async(msg,raw)=>{
  if(shuttingDown)return;
  if(!config.owner){
   if(!config.pairCode||msg.text!=='/pair '+config.pairCode)return;
   config.owner=msg.peerId;delete config.pairCode;atomicJson(configPath,config);await channel.sendText(msg.target,'QQ ↔ Codex 已配对，支持文字和附件。/help 查看功能。');return;
  }
  if(msg.peerId!==config.owner)return;
  if(await commands.handle(msg))return;
  if(msg.refKey){const quoted=raw.msgElements?.[0];msg.quoteText=quoted?.content;}
  const {task}=await runner.accept(msg);
  if(raw.msgIdx)store.putRef(config.accountId,msg.peerId,raw.msgIdx,{text:msg.text,taskId:task.id,files:task.files});
 };
 channel.onInteraction=async(peer,data)=>{const [,nonce='',decision='']=data.split(':');runner.approvals.decide(nonce,decision,peer);};
 const shutdown=async()=>{if(shuttingDown)return;shuttingDown=true;if(timer)clearInterval(timer);channel.stop();await loop.catch(()=>{});await runner.flushEvents();await agent.close();store.close();await release();};
 for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,()=>{void shutdown().then(()=>process.exit(0));setTimeout(()=>process.exit(1),15000).unref();});
 try{
  await agent.connect();await agent.readThread(config.threadId);
  let cycling=false;
  timer=setInterval(()=>{if(shuttingDown||cycling)return;cycling=true;loop=(async()=>{try{await runner.tick();await commands.reminders();}catch(e){log.error({event:'worker_failed',reason:errorMessage(e)});}finally{cycling=false;}})();},1500);
  log.info({event:'bridge_start',backend:config.backend});await channel.start();
 }finally{await shutdown();}
}
main().catch(e=>{log.error({event:'fatal',reason:errorMessage(e)});process.exitCode=1;});
