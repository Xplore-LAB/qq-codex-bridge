import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Config} from '../config/schema.js';
import {object,string,type Attachment} from '../domain/types.js';
const exec=promisify(execFile);
export class MediaProcessor {
 constructor(private config:Config){}
 async probe(path:string){const r=await exec('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration:stream=codec_type,codec_name','-of','json',path],{timeout:15000,maxBuffer:1024*1024});return object(JSON.parse(r.stdout));}
 async audio(path:string){const dir=join(this.config.mediaDir,'processed');await mkdir(dir,{recursive:true,mode:0o700});const out=join(dir,randomUUID()+'.mp3');await exec('ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',path,'-t','600','-vn','-ac','1','-ar','24000','-threads','1','-y',out],{timeout:60000,maxBuffer:1024*1024});return out;}
 async prepare(file:Attachment){
  if(file.kind==='video'&&this.config.video.extractFrames){
   const probe=await this.probe(file.path),duration=Number(object(probe.format).duration);if(!Number.isFinite(duration)||duration<=0||duration>this.config.video.maxDurationSec)throw new Error('视频时长无效或超过处理限制');
   const dir=join(this.config.mediaDir,'processed',file.sha256);await mkdir(dir,{recursive:true,mode:0o700});file.images=[];
   for(let i=0;i<this.config.video.frames;i++){const at=duration*(i+.5)/this.config.video.frames;const path=join(dir,`frame-${i}.jpg`);await exec('ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-ss',String(at),'-i',file.path,'-frames:v','1','-vf','scale=1280:720:force_original_aspect_ratio=decrease','-threads','1','-y',path],{timeout:30000,maxBuffer:1024*1024});file.images.push(path);}
  }
  if(file.kind==='voice'&&!file.transcript&&this.config.voice.enabled&&this.config.voice.stt)file.transcript=await this.transcribe(file.path);
  return file;
 }
 private provider(type:'stt'|'tts'){
  const p=this.config.voice[type];if(!this.config.voice.enabled||!p)throw new Error(type.toUpperCase()+' 尚未配置');const key=process.env[p.keyEnv];if(!key)throw new Error('缺少语音服务环境变量 '+p.keyEnv);return {p,key};
 }
 async transcribe(path:string){const {p,key}=this.provider('stt');const audio=await this.audio(path);const data=await readFile(audio);const form=new FormData();form.set('model',p.model);form.set('file',new Blob([new Uint8Array(data)],{type:'audio/mpeg'}),'voice.mp3');
  const r=await fetch(p.baseUrl.replace(/\/$/,'')+'/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error('STT HTTP '+r.status);const body=object(await r.json());const text=string(body.text);if(!text)throw new Error('STT 未返回转写文字');return text.slice(0,30000);
 }
 async synthesize(text:string){const {p,key}=this.provider('tts');const r=await fetch(p.baseUrl.replace(/\/$/,'')+'/audio/speech',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:p.model,voice:p.voice,input:text.slice(0,4000),response_format:'mp3'}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error('TTS HTTP '+r.status);if(Number(r.headers.get('content-length'))>this.config.limits.fileBytes){await r.body?.cancel();throw new Error('TTS 输出超过限制');}const chunks:Uint8Array[]=[];let size=0;if(!r.body)throw new Error('TTS 返回空响应');const reader=r.body.getReader();try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>this.config.limits.fileBytes){await reader.cancel();throw new Error('TTS 输出超过限制');}chunks.push(part.value);}}finally{reader.releaseLock();}const bytes=Buffer.concat(chunks);const dir=join(this.config.mediaDir,'processed');await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,randomUUID()+'.mp3');await writeFile(path,bytes,{mode:0o600});return path;}
 async outboundVoice(path:string){return ['.mp3','.silk','.wav','.ogg'].includes(extname(path).toLowerCase())?path:this.audio(path);}
}
