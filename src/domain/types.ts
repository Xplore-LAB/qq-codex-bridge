import type {ReplyTarget} from '@tencent-connect/qqbot-nodejs';
export type Json=Record<string,unknown>;
export type TaskStatus='received'|'preparing'|'queued'|'submitting'|'running'|'waiting_approval'|'succeeded'|'failed'|'cancelled'|'delivering'|'delivered'|'delivery_failed'|'uncertain';
export type MediaKind='image'|'video'|'voice'|'file';
export interface IncomingAttachment {url:string;content_type?:string;filename?:string;size?:number;voice_wav_url?:string;asr_refer_text?:string}
export interface Attachment {path:string;name:string;mime:string;kind:MediaKind;bytes:number;sha256:string;transcript?:string;images?:string[]}
export interface Incoming {accountId:string;messageId:string;peerId:string;target:ReplyTarget;text:string;attachments:IncomingAttachment[];refKey?:string;quoteText?:string;timestamp:number}
export interface Task {model?:string;effort?:import('../../generated/codex/ReasoningEffort.js').ReasoningEffort;id:string;accountId:string;peerId:string;threadId:string;eventId:string;target:ReplyTarget;text:string;incoming:IncomingAttachment[];files:Attachment[];status:TaskStatus;turnId?:string;prompt?:string;reply?:string;error?:string;createdAt:number;updatedAt:number;refKey?:string;quoteText?:string;backend:'app-server'|'queue';history?:string;offset?:number;matched?:boolean;voiceReply?:boolean}
export interface Delivery {id:string;taskId:string;seq:number;kind:'text'|MediaKind;content:string;name?:string;state:'pending'|'sending'|'sent'|'failed'|'uncertain';receipt?:string;error?:string}
export interface Approval {id:string;taskId:string;threadId:string;turnId:string;requestId:string|number;method:string;peerId:string;accountId:string;nonce:string;expiresAt:number;status:'pending'|'resolved'|'expired'|'uncertain';summary:string;allowed:string[];decision?:string;connectionId:string}
export interface AgentEvent {method:string;params:Json;id?:string|number}
export interface Agent {call?(method:string,params:unknown):Promise<Json>;connected:boolean;connectionId:string;connect():Promise<void>;readThread(id:string):Promise<Json>;resume(id:string):Promise<Json>;submit(task:Task):Promise<string>;cancel(threadId:string,turnId:string):Promise<void>;respond(id:string|number,result:unknown):void;onEvent(listener:(event:AgentEvent)=>void):()=>void;turn(threadId:string,turnId:string):Promise<Json|undefined>;close():Promise<void>}
export interface Receipt {id:string}
export interface Channel {online:boolean;sendText(target:ReplyTarget,text:string):Promise<Receipt>;sendMedia(target:ReplyTarget,kind:MediaKind,path:string,name?:string):Promise<Receipt>;typing(target:ReplyTarget):Promise<void>;approval(target:ReplyTarget,approval:Approval):Promise<Receipt>;stream(target:ReplyTarget):{update(text:string):Promise<void>;complete():Promise<Receipt|undefined>;cancel():void}|undefined}
export function object(value:unknown):Json{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Json:{};}
export function string(value:unknown):string{return typeof value==='string'?value:'';}
export function errorMessage(error:unknown):string{return (error instanceof Error?error.message:String(error)).replace(/https?:\/\/\S+/g,'[URL]').replace(/(Bearer|QQBot)\s+\S+/gi,'$1 [redacted]').slice(0,400);}
