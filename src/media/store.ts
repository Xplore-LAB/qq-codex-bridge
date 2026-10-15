import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,stat,realpath,copyFile,chmod} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,relative} from 'node:path';
import {createReadStream} from 'node:fs';
import type {Config} from '../config/schema.js';
import type {Attachment,IncomingAttachment,MediaKind} from '../domain/types.js';
import {download} from './download.js';
export function safeName(name:string){return basename(name.replaceAll('\\','/')).replace(/[^\p{L}\p{N}._-]/gu,'_').slice(0,120)||'attachment';}
export function kind(path:string):MediaKind{const ext=extname(path).toLowerCase();return ['.png','.jpg','.jpeg','.webp','.gif'].includes(ext)?'image':['.mp4','.mov','.webm','.mkv'].includes(ext)?'video':['.mp3','.wav','.ogg','.silk','.amr','.m4a','.flac'].includes(ext)?'voice':'file';}
export async function fileHash(path:string){const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);return hash.digest('hex');}
export async function sniffImage(path:string){const fd=await open(path,'r');try{const bytes=Buffer.alloc(16);const {bytesRead}=await fd.read(bytes,0,16,0);const b=bytes.subarray(0,bytesRead);return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||b[0]===255&&b[1]===216&&b[2]===255||/^GIF8[79]a/.test(b.toString('ascii'))||b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';}finally{await fd.close();}}
export class MediaStore {
 constructor(readonly config:Config){}
 async receive(items:IncomingAttachment[],taskId:string):Promise<Attachment[]>{
  if(items.length>this.config.limits.attachments)throw new Error('附件数量超限');const files:Attachment[]=[];
  for(const a of items){
   if(a.size&&a.size>this.config.limits.fileBytes)throw new Error('附件大小超限');
   const suffix:Record<string,string>={'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','audio/wav':'.wav','audio/mpeg':'.mp3','video/mp4':'.mp4'};
   const name=safeName(a.filename||'attachment'+(suffix[a.content_type||'']||''));const path=join(this.config.mediaDir,'inbox',taskId,randomUUID()+'-'+name);
   const result=await download(a.voice_wav_url||a.url,path,this.config.limits.fileBytes);
   const mime=a.voice_wav_url?'audio/wav':a.content_type||result.mime;const type=kind(path);
   if(type==='image'&&!await sniffImage(path))throw new Error('图片内容与文件扩展名不匹配');
   files.push({path,name,mime,kind:type,bytes:result.bytes,sha256:await fileHash(path),transcript:a.asr_refer_text?.slice(0,12000)});
  }return files;
 }
 async stage(path:string){
  if(!isAbsolute(path))throw new Error('发送文件必须使用绝对路径');const real=await realpath(path);const roots=[...this.config.sendRoots,this.config.mediaDir].map(r=>join(r));
  if(!roots.some(root=>{const rel=relative(root,real);return rel===''||!rel.startsWith('..')&&!isAbsolute(rel);}))throw new Error('文件不在允许发送的目录中');
  const withinMedia=relative(this.config.mediaDir,real);const inspected=!withinMedia.startsWith('..')&&!isAbsolute(withinMedia)?withinMedia:real;
  if(inspected.split('/').some(p=>p.startsWith('.'))||/\.(pem|key)$/i.test(real))throw new Error('不能发送隐藏文件或密钥');
  const info=await stat(real);if(!info.isFile()||info.size>this.config.limits.fileBytes)throw new Error('文件类型或大小不符合限制');
  if(kind(real)==='image'&&!await sniffImage(real))throw new Error('图片文件内容无效');
  const out=join(this.config.mediaDir,'outbox',randomUUID()+'-'+safeName(real));await mkdir(dirname(out),{recursive:true,mode:0o700});await copyFile(real,out);await chmod(out,0o600);return out;
 }
}
export function splitReply(reply:string){const files:{kind:MediaKind;path:string}[]=[];const text=reply.replace(/<qq(image|video|voice|file)>([^<>\n]+)<\/qq\1>/g,(_all,type:MediaKind,path:string)=>{files.push({kind:type,path:path.trim()});return '';}).trim();return {text,files};}
