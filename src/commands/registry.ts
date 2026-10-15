import {randomUUID} from 'node:crypto';
import type {Config} from '../config/schema.js';
import type {Store} from '../storage/database.js';
import {errorMessage,object,string,type Channel,type Incoming,type Json} from '../domain/types.js';
import type {Runner} from '../services/runner.js';
export class Commands {
 constructor(private config:Config,private store:Store,private runner:Runner,private channel:Channel){}
 async handle(msg:Incoming){
  if(!this.config.owner||msg.peerId!==this.config.owner||msg.accountId!==this.config.accountId)throw new Error('发送者未授权');
  let [name='',...args]=msg.text.trim().split(/\s+/);if(!name.startsWith('/'))return false;
  name=({'/':'/help','/stop':'/cancel','/commands':'/help'} as Record<string,string>)[name]||name;
  const allowed=['/status','/help','/cancel','/retry','/session','/voice','/approve','/answer','/remind','/new','/resume','/fork','/model','/compact','/steer','/skills','/mcp','/apps','/usage','/rename','/history'];
  const key='command:'+msg.accountId+':'+msg.messageId;if(this.store.get(key))return true;this.store.set(key,{state:'received',at:Date.now()});
  let reply='';
  try{
   if(!allowed.includes(name))reply='未知命令：'+name+'。发送 /help 查看命令；普通路径请放在句子中。';
   if(['/new','/resume','/fork','/model','/compact','/steer','/skills','/mcp','/apps','/usage','/rename','/history'].includes(name))reply=await this.codex(msg,name,args);
   if(name==='/help')reply='/new 新建并切换\n/resume [编号或ID] 最近会话\n/fork 复制当前会话并切换\n/model [编号或模型名] [推理强度]\n/compact 压缩上下文\n/stop 停止当前任务\n/steer 内容：补充当前手机任务\n/skills、/mcp、/apps 查看能力\n/usage 额度\n/history 最近对话\n/rename 名称\n/answer 按问题提示回答\n'+'/status 查看状态\n/cancel [任务ID] 取消本人任务\n/retry [任务ID] 重试结果投递\n/session [会话ID] 查看/切换会话\n/voice on|off 语音回复\n/remind 5m 内容；/remind list；/remind cancel ID\n支持文字、图片、视频、语音及文件。';
   if(name==='/status'){
    const tasks=this.store.tasks().filter(t=>t.peerId===msg.peerId&&t.accountId===msg.accountId);const latest=tasks.at(-1);
    let details='';try{const t=await this.runner.agent.readThread(this.thread(msg));details=`\n模型：${t.model||'默认'} / ${t.reasoningEffort||'默认'}\n目录：${t.cwd||'默认'}\n会话状态：${object(t.status).type||'未知'}`;}catch{details='\n会话状态：暂时无法读取';}
    reply=`QQ：${this.channel.online?'已连接':'未连接'}\nCodex：${this.runner.agent.connected?'已连接':'未连接'}\n模式：${this.config.backend}\n会话：${this.store.get<string>('thread:'+msg.accountId+':'+msg.peerId)||this.config.threadId}\n最近任务：${latest?latest.id.slice(0,8)+' '+latest.status:'无'}${latest?.error?'\n错误：'+latest.error:''}${details}\n语音转写：${this.config.voice.enabled&&this.config.voice.stt?'已配置':'未配置'}；语音合成：${this.config.voice.enabled&&this.config.voice.tts?'已配置':'未配置'}`;
   }
   if(name==='/cancel'){const task=await this.runner.cancel(msg.peerId,args[0]);reply='已请求取消任务 '+task.id.slice(0,8);}
   if(name==='/retry'){const task=this.runner.retry(msg.peerId,args[0]);task.target=msg.target;this.store.saveTask(task);reply='已安排重试结果投递 '+task.id.slice(0,8);}
   if(name==='/session'){
    if(args[0]){this.idle(msg);await this.runner.agent.readThread(args[0]);this.store.set('thread:'+msg.accountId+':'+msg.peerId,args[0]);reply='已绑定现有会话 '+args[0];}
    else reply='当前会话：'+(this.store.get<string>('thread:'+msg.accountId+':'+msg.peerId)||this.config.threadId);
   }
   if(name==='/voice'){if(!['on','off'].includes(args[0]||''))throw new Error('用法：/voice on 或 /voice off');if(args[0]==='on'&&(!this.config.voice.enabled||!this.config.voice.tts))throw new Error('尚未配置 TTS，请先在本机配置语音服务');this.store.set('voice:'+msg.accountId+':'+msg.peerId,args[0]==='on');reply='语音回复已'+(args[0]==='on'?'开启':'关闭');}
   if(name==='/answer')reply=this.runner.questions.answer(args[0]||'',args[1]||'',args.slice(2).join(' '),msg.peerId,msg.accountId);
   if(name==='/approve'){this.runner.approvals.decide(args[0]||'',args[1]||'',msg.peerId);reply='审批决策已提交。';}
   if(name==='/remind')reply=this.remind(msg,args);
   this.store.set(key,{state:'completed',at:Date.now()});
  }catch(e){reply=errorMessage(e);this.store.set(key,{state:'failed',at:Date.now()});}
  for(let i=0;i<reply.length;i+=1500)await this.channel.sendText(msg.target,reply.slice(i,i+1500));return true;
 }
 private thread(msg:Incoming){return this.store.get<string>('thread:'+msg.accountId+':'+msg.peerId)||this.config.threadId;}
 private idle(msg:Incoming){if(this.store.tasks(['received','preparing','queued','submitting','running','waiting_approval']).some(t=>t.peerId===msg.peerId&&t.accountId===msg.accountId))throw new Error('仍有未完成任务，请等待完成或 /stop 后再操作');}
 private async rpc(method:string,params:Json){if(!this.runner.agent.call)throw new Error('该功能需要 App Server 后端');await this.runner.agent.connect();return this.runner.agent.call(method,params);}
 private async codex(msg:Incoming,name:string,args:string[]):Promise<string>{
  const threadId=this.thread(msg),key='thread:'+msg.accountId+':'+msg.peerId;
  if(name==='/new'||name==='/fork'){
   this.idle(msg);
   // New threads use the server's configured permission defaults; never loosen them here.
   const current=await this.runner.agent.readThread(threadId);
   const r=await this.rpc(name==='/new'?'thread/start':'thread/fork',name==='/new'?{cwd:current.cwd}:{threadId,excludeTurns:true});
   const id=string(object(r.thread).id);if(!id)throw new Error('服务器未返回新会话 ID');
   this.store.set(key,id);return '已'+(name==='/new'?'新建':'复制')+'并切换会话 '+id+'，直接发送内容即可。';
  }
  if(name==='/resume'){
   if(!args[0]){
    const r=await this.rpc('thread/list',{limit:15,sortKey:'updated_at',sortDirection:'desc'});
    const rows=Array.isArray(r.data)?r.data.map(object):[];
    this.store.set('sessions:'+key,{at:Date.now(),ids:rows.map(t=>t.id)});
    return rows.map((t,i)=>`${i+1}. ${string(t.name)||string(t.preview).slice(0,65)||t.id}`).join('\n')+'\n发送 /resume 编号，或 /resume 会话ID';
   }
   this.idle(msg);let id=args[0];
   if(/^\d+$/.test(id)){const menu=this.store.get<{at:number;ids:string[]}>('sessions:'+key);if(!menu||Date.now()-menu.at>600000)throw new Error('菜单已过期，请重新发送 /resume');id=menu.ids[Number(id)-1]||'';}
   if(!id)throw new Error('会话编号无效');await this.runner.agent.resume(id);this.store.set(key,id);return '已切换会话 '+id;
  }
  if(name==='/model'){
   const r=await this.rpc('model/list',{limit:100});const rows=Array.isArray(r.data)?r.data.map(object):[];
   if(!args[0]){const t=await this.runner.agent.readThread(threadId),choice=this.store.get<{model:string;effort?:string}>('model:'+threadId);return '当前/下次：'+(choice?.model||t.model||'继承会话设置')+' / '+(choice?.effort||t.reasoningEffort||'默认')+'\n'+rows.map((m,i)=>`${i+1}. ${m.model} [${(Array.isArray(m.supportedReasoningEfforts)?m.supportedReasoningEfforts:[]).map(x=>object(x).reasoningEffort).join(', ')}]`).join('\n')+'\n/model 模型名 [推理强度]，也可使用编号';}
   this.idle(msg);const m=/^\d+$/.test(args[0])?rows[Number(args[0])-1]:rows.find(m=>m.model===args[0]||m.id===args[0]);if(!m)throw new Error('模型不存在，请 /model 查看');
   const effort=args[1];if(effort&&!(Array.isArray(m.supportedReasoningEfforts)?m.supportedReasoningEfforts:[]).some(e=>object(e).reasoningEffort===effort))throw new Error('推理强度不受该模型支持');
   this.store.set('model:'+threadId,{model:m.model,effort:effort||m.defaultReasoningEffort});return '下次任务使用 '+m.model+(effort?' / '+effort:'');
  }
  if(name==='/compact'){this.idle(msg);await this.runner.agent.resume(threadId);await this.rpc('thread/compact/start',{threadId});return '已启动上下文压缩，/status 查看状态。';}
  if(name==='/rename'){if(!args.length)throw new Error('用法：/rename 会话名称');await this.rpc('thread/name/set',{threadId,name:args.join(' ')});return '会话已重命名。';}
  if(name==='/steer'){
   const text=args.join(' ');if(!text)throw new Error('用法：/steer 补充指令');
   const t=this.store.tasks(['running']).find(t=>t.threadId===threadId&&t.peerId===msg.peerId&&t.accountId===msg.accountId);
   if(!t?.turnId)throw new Error('没有本手机发起的执行中任务，直接发送内容可排队');
   await this.rpc('turn/steer',{threadId,expectedTurnId:t.turnId,clientUserMessageId:msg.messageId,input:[{type:'text',text,text_elements:[]}]});return '已补充到当前任务。';
  }
  if(name==='/skills'){
   const t=await this.runner.agent.readThread(threadId),r=await this.rpc('skills/list',{cwds:t.cwd?[t.cwd]:[]});
   return (Array.isArray(r.data)?r.data:[]).flatMap(x=>{const a=object(x);return (Array.isArray(a.skills)?a.skills:[]).map(s=>{const v=object(s);return '$'+v.name+' '+string(v.description).slice(0,85);});}).join('\n').slice(0,10000)||'未发现技能';
  }
  if(name==='/mcp'){const r=await this.rpc('mcpServerStatus/list',{threadId,limit:100});return (Array.isArray(r.data)?r.data:[]).map(x=>{const v=object(x);return v.name+' / '+(v.runtimeStatus||v.authStatus||'未知');}).join('\n')||'未发现 MCP 服务';}
  if(name==='/apps'){const r=await this.rpc('app/list',{threadId,limit:100});return (Array.isArray(r.data)?r.data:[]).map(x=>{const v=object(x);return v.name||v.id;}).join('\n')||'未发现应用';}
  if(name==='/usage'){const r=await this.rpc('account/rateLimits/read',{});return '账号额度窗口：\n'+JSON.stringify(r.rateLimits??r,null,2).slice(0,6000);}
  if(name==='/history'){
   const r=await this.rpc('thread/turns/list',{threadId,limit:5,sortDirection:'desc',itemsView:'full'});
   return (Array.isArray(r.data)?r.data:[]).map(x=>{const t=object(x);return (Array.isArray(t.items)?t.items:[]).map(i=>{const v=object(i);if(v.type==='agentMessage')return 'Codex：'+string(v.text).slice(0,500);if(v.type==='userMessage')return '你：'+(Array.isArray(v.content)?v.content:[]).map(c=>string(object(c).text)).join('').slice(0,500);return '';}).filter(Boolean).join('\n');}).reverse().join('\n\n')||'暂无对话';
  }
  return '暂不支持该命令';
 }
 private remind(msg:Incoming,args:string[]){
  const own=this.store.reminders().filter(r=>r.peerId===msg.peerId&&r.accountId===msg.accountId);
  if(args[0]==='list')return own.filter(r=>r.status==='pending').map(r=>`${String(r.id).slice(0,8)} ${new Date(Number(r.dueAt)).toLocaleString('zh-CN')} ${r.text}`).join('\n')||'没有待触发提醒。';
  if(args[0]==='cancel'){const r=own.find(r=>String(r.id).startsWith(args[1]||'')&&r.status==='pending');if(!r||!args[1])throw new Error('未找到待触发提醒');r.status='cancelled';this.store.saveReminder(r);return '提醒已取消。';}
  const m=/^(\d+)(s|m|h|d)$/.exec(args[0]||'');const text=args.slice(1).join(' ');if(!m||!text)throw new Error('用法：/remind 5m 喝水，时间单位 s/m/h/d');
  const duration=Number(m[1])*({s:1000,m:60000,h:3600000,d:86400000}[m[2] as 's'|'m'|'h'|'d']);if(duration<10000||duration>30*86400000)throw new Error('提醒时间范围为 10 秒至 30 天');
  const id=randomUUID();this.store.saveReminder({id,peerId:msg.peerId,accountId:msg.accountId,target:{scope:'c2c',targetId:msg.peerId},text:text.slice(0,2000),dueAt:Date.now()+duration,status:'pending'});return `提醒已创建 ${id.slice(0,8)}。QQ 主动消息仍受平台限制。`;
 }
 async reminders(){for(const r of this.store.reminders().filter(r=>r.status==='pending'&&Number(r.dueAt)<=Date.now())){
  r.status='sending';this.store.saveReminder(r);try{const receipt=await this.channel.sendText({scope:'c2c',targetId:String(r.peerId)},'提醒：'+String(r.text));r.status='sent';r.receipt=receipt.id;}catch(e){r.status='failed';r.error=e instanceof Error?e.message:'发送失败';}this.store.saveReminder(r);
 }}
 recover(){for(const r of this.store.reminders().filter(r=>r.status==='sending')){r.status='uncertain';this.store.saveReminder(r);}}
}
