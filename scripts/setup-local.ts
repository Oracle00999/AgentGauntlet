import {access,copyFile,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
try{await access('.env');}catch{await copyFile('.env.example','.env');await chmod('.env',0o600);}
for(const script of ['setup:db','db:migrate','setup:web'])execFileSync('npm',['run',script],{stdio:'inherit'});
console.log('Local database and login ready. Load archived evidence with npm run demo:load; no testnet/OpenAI keys are required to inspect it.');
