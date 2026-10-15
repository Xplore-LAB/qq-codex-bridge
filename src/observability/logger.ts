import pino from 'pino';
export const log=pino({level:process.env.LOG_LEVEL||'info',redact:{paths:['appSecret','token','authorization','attachments','prompt','content','text','url','credentials','*.appSecret','*.token'],censor:'[redacted]'}});
