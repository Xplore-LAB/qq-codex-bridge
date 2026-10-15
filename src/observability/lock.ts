import {createServer,createConnection,type Server} from 'node:net';
import {rm,chmod} from 'node:fs/promises';
export async function acquireLock(path:string):Promise<()=>Promise<void>>{
 const server=createServer(socket=>socket.end());
 async function listen(){await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,()=>{server.removeListener('error',reject);resolve();});});}
 try{await listen();}catch(e){if((e as NodeJS.ErrnoException).code!=='EADDRINUSE')throw e;
  const alive=await new Promise<boolean>(resolve=>{const c=createConnection(path);c.once('connect',()=>{c.destroy();resolve(true);});c.once('error',()=>resolve(false));c.setTimeout(1000,()=>{c.destroy();resolve(true);});});
  if(alive)throw new Error('已有 QQ-Codex 桥接实例在运行');await rm(path,{force:true});await listen();
 }
 await chmod(path,0o600);return ()=>new Promise<void>(resolve=>{server.close(()=>resolve());});
}
