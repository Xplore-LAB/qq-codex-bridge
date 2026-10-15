#!/usr/bin/env node
import {readFileSync} from 'node:fs';
const command=process.argv[2];
if(command==='--version'||command==='-v'){
 console.log(JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
}else if(!command||['--help','-h','help'].includes(command)){
 console.log(`qq-codex-bridge — QQ private messages ↔ an existing Codex session

Usage:
  qq-codex-bridge init --thread THREAD_ID [--app-id APP_ID] [--owner OPENID]
  qq-codex-bridge init --legacy /path/to/legacy/config.json
  qq-codex-bridge check         Offline configuration and environment check
  qq-codex-bridge probe         Read-only check of the existing Codex session
  qq-codex-bridge bind          Create a QR binding flow (does not start the bot)
  qq-codex-bridge auth-check    Verify QQ credentials without sending messages
  qq-codex-bridge start         Start receiving messages

Init options: --state-dir PATH, --media-dir PATH, --socket PATH
Environment: QQ_BRIDGE_CONFIG_DIR, CODEX_HOME, LOG_LEVEL

Requires Node.js 24 and a signed-in, running Codex app server.
FFmpeg is required for audio conversion and video frame extraction.
Configuration and credentials are stored outside the installed tool.
`);
}else{
 try{await import('../dist/src/main.js');}
 catch(error){console.error(error?.code==='ERR_MODULE_NOT_FOUND'?'Build the tool first: npm ci && npm run build':String(error));process.exitCode=1;}
}
