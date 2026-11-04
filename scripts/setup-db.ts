import { execFileSync } from 'node:child_process';
import { mkdir,readFile,writeFile,appendFile,chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
process.loadEnvFile('.env');
await mkdir('.local',{recursive:true});
const configured=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):undefined;
if(!configured || (configured.hostname==='127.0.0.1' && configured.port==='55432' && configured.username==='agentgauntlet' && configured.pathname==='/agentgauntlet')) {
  const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim();
  const dir=resolve('.local/postgres');
  let password:string;
  try {password=await readFile('.local/db-password','utf8');}
  catch(e) {
    if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
    password=randomBytes(24).toString('hex');await writeFile('.local/db-password',password,{mode:0o600});
  }
  try {await readFile(`${dir}/PG_VERSION`);}
  catch(e) {
    if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
    execFileSync(`${bin}/initdb`,['-D',dir,'-U','agentgauntlet','--auth-local=trust','--auth-host=scram-sha-256',`--pwfile=${resolve('.local/db-password')}`],{stdio:'ignore'});
  }
  try {execFileSync(`${bin}/pg_ctl`,['-D',dir,'status'],{stdio:'ignore'});}
  catch {execFileSync(`${bin}/pg_ctl`,['-D',dir,'-l',resolve('.local/postgres.log'),'-o','-h 127.0.0.1 -p 55432','start'],{stdio:'ignore'});}
  const base=`postgresql://agentgauntlet:${password}@127.0.0.1:55432/`;
  const admin=new Pool({connectionString:base+'postgres'});
  try {if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='agentgauntlet'")).rowCount) await admin.query('CREATE DATABASE agentgauntlet');}
  finally {await admin.end();}
  if(!configured) await appendFile('.env',`\nDATABASE_URL=${base}agentgauntlet\n`);
}
if(!process.env.API_TOKEN) await appendFile('.env',`\nAPI_TOKEN=${randomBytes(32).toString('hex')}\n`);
await chmod('.env',0o600);
console.log('Database configuration and API token saved locally. No secrets printed.');
