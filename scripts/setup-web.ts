import { appendFile,chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
process.loadEnvFile('.env');
for(const[key,value]of Object.entries({WEB_ACCESS_CODE:randomBytes(12).toString('hex'),WEB_SESSION_SECRET:randomBytes(32).toString('hex'),WEB_ORIGIN:'http://127.0.0.1:3000'}))if(!process.env[key])await appendFile('.env',`\n${key}=${value}\n`);
await chmod('.env',0o600);console.log('Web login configured. Use WEB_ACCESS_CODE from .env.');
