import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import https from 'node:https';
import type {IncomingMessage} from 'node:http';
import {open,rm,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {Readable} from 'node:stream';
export function publicAddress(ip:string){
 if(isIP(ip)===4){const [a=0,b=0,c=0]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||(a===192&&b===0)||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));}
 return isIP(ip)===6&&/^[23][0-9a-f]{3}:/i.test(ip)&&!/^2001:(db8|0|10|20):/i.test(ip)&&!/^2002:/i.test(ip);
}
export function attachmentUrl(value:string){const u=new URL(value.startsWith('//')?'https:'+value:value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw new Error('附件只支持公网 HTTPS 地址');return u;}
export async function writeLimited(stream:Readable,path:string,limit:number){
 await mkdir(dirname(path),{recursive:true,mode:0o700});const file=await open(path,'wx',0o600);let bytes=0;
 try{for await(const data of stream){const chunk=Buffer.isBuffer(data)?data:Buffer.from(data as string);bytes+=chunk.length;if(bytes>limit)throw new Error('附件超过大小限制');await file.write(chunk);}return bytes;}
 catch(e){await rm(path,{force:true});throw e;}
 finally{await file.close();stream.destroy();}
}
export async function download(url:string,path:string,limit:number,redirects=3):Promise<{bytes:number;mime:string}>{
 const u=attachmentUrl(url),addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('附件地址不能指向内网');
 const chosen=addresses[0]!;let request:ReturnType<typeof https.get>|undefined;
 const timer=setTimeout(()=>request?.destroy(new Error('附件下载总时限已到')),60000);
 try{
  const response=await new Promise<IncomingMessage>((resolve,reject)=>{request=https.get(u,{lookup:(_host,opts,cb)=>opts.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)},resolve);request.on('error',reject);request.setTimeout(15000,()=>request?.destroy(new Error('附件下载超时')));});
  if([301,302,303,307,308].includes(response.statusCode||0)){response.resume();if(!redirects||!response.headers.location)throw new Error('附件重定向过多');return await download(new URL(response.headers.location,u).href,path,limit,redirects-1);}
  if(response.statusCode!==200){response.resume();throw new Error('附件下载 HTTP '+response.statusCode);}
  if(Number(response.headers['content-length'])>limit){response.destroy();throw new Error('附件超过大小限制');}
  const bytes=await writeLimited(response,path,limit);return {bytes,mime:String(response.headers['content-type']||'').split(';')[0]||'application/octet-stream'};
 }finally{clearTimeout(timer);request?.destroy();}
}
