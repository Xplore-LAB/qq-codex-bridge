import {existsSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {object} from '../../domain/types.js';
/** Prevent two agents from independently executing the same QQ user's message. */
export function conflictingOpenClawAccount(appId:string,path=join(homedir(),'.openclaw/openclaw.json')):string|undefined{
 if(!existsSync(path))return undefined;const data=object(JSON.parse(readFileSync(path,'utf8'))),channel=object(object(data.channels).qqbot);
 if(channel.enabled===false||Object.keys(channel).length===0)return undefined;
 if(channel.appId===appId)return 'default';
 for(const [name,value] of Object.entries(object(channel.accounts))){const account=object(value);if(account.enabled!==false&&account.appId===appId)return name;}
 return undefined;
}
