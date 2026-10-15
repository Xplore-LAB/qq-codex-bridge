import {z} from 'zod';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {existsSync,readFileSync,mkdirSync,writeFileSync,chmodSync,renameSync} from 'node:fs';
export const home=homedir();
export const root=resolve(import.meta.dirname,'../../..');
export const codexHome=process.env.CODEX_HOME||join(home,'.codex');
export function atomicJson(path:string,data:unknown){mkdirSync(resolve(path,'..'),{recursive:true,mode:0o700});writeFileSync(path+'.tmp',JSON.stringify(data,null,2)+'\n',{mode:0o600});chmodSync(path+'.tmp',0o600);renameSync(path+'.tmp',path);}
const provider=z.object({baseUrl:z.string().url(),model:z.string().min(1),keyEnv:z.string().regex(/^[A-Z][A-Z0-9_]*$/),voice:z.string().default('alloy')});
export const configSchema=z.object({version:z.literal(2).default(2),accountId:z.string().min(1),threadId:z.string().min(1),owner:z.string().optional(),pairCode:z.string().optional(),backend:z.enum(['app-server','queue']).default('app-server'),socket:z.string().default(join(codexHome,'app-server-control/app-server-control.sock')),stateDir:z.string().default(join(home,'.local/state/qq-codex-bridge')),mediaDir:z.string().default(join(home,'.local/share/qq-codex-bridge/media')),sendRoots:z.array(z.string()).default([join(home,'Documents'),join(home,'docs'),'/tmp']),limits:z.object({attachments:z.number().int().min(1).max(8).default(8),fileBytes:z.number().int().positive().max(100*1024*1024).default(50*1024*1024),queue:z.number().int().min(1).max(100).default(20),taskTimeoutMs:z.number().int().min(1000).default(3600000)}).default({attachments:8,fileBytes:52428800,queue:20,taskTimeoutMs:3600000}),streaming:z.object({enabled:z.boolean().default(true),native:z.boolean().default(false),intervalMs:z.number().int().min(1000).default(3000)}).default({enabled:true,native:false,intervalMs:3000}),markdown:z.boolean().default(false),voice:z.object({enabled:z.boolean().default(false),stt:provider.optional(),tts:provider.optional()}).default({enabled:false}),video:z.object({extractFrames:z.boolean().default(true),maxDurationSec:z.number().positive().default(600),frames:z.number().int().min(1).max(8).default(4)}).default({extractFrames:true,maxDurationSec:600,frames:4}),approvals:z.object({enabled:z.boolean().default(true),ttlMs:z.number().int().min(30000).default(300000)}).default({enabled:true,ttlMs:300000})});
export type Config=z.infer<typeof configSchema>;
export const credentialSchema=z.object({appId:z.string().min(1),appSecret:z.string().min(1)});
export type Credentials=z.infer<typeof credentialSchema>;
export const configDir=process.env.QQ_BRIDGE_CONFIG_DIR||join(home,'.config/qq-codex-bridge');
export const configPath=join(configDir,'config.json');
export const credentialsPath=join(configDir,'credentials.json');
export function loadConfig():Config{return configSchema.parse(JSON.parse(readFileSync(configPath,'utf8')));}
export function loadCredentials():Credentials{return credentialSchema.parse(JSON.parse(readFileSync(credentialsPath,'utf8')));}
export function migrateConfig(legacyPath=join(root,'config.json')):Config{
 if(existsSync(configPath))return loadConfig();
 const legacy=JSON.parse(readFileSync(legacyPath,'utf8')) as Record<string,unknown>;
 const cfg=configSchema.parse({accountId:legacy.appId,threadId:legacy.threadId,owner:legacy.owner,pairCode:legacy.pairCode,sendRoots:legacy.sendRoots});
 const creds=credentialSchema.parse({appId:legacy.appId,appSecret:legacy.appSecret});
 atomicJson(credentialsPath,creds);atomicJson(configPath,cfg);return cfg;
}

export function initializeConfig(options:{threadId?:string;accountId?:string;owner?:string;stateDir?:string;mediaDir?:string;socket?:string}):Config{
 if(existsSync(configPath)){const current=loadConfig();if(options.threadId&&options.threadId!==current.threadId)throw new Error('Configuration already exists for a different thread; edit it explicitly or use QQ_BRIDGE_CONFIG_DIR.');return current;}
 if(!options.threadId)throw new Error('Specify an existing Codex thread with init --thread THREAD_ID, or use init --legacy PATH.');
 const config=configSchema.parse({threadId:options.threadId,accountId:options.accountId||'unbound',owner:options.owner,stateDir:options.stateDir,mediaDir:options.mediaDir,socket:options.socket});
 atomicJson(configPath,config);return config;
}
