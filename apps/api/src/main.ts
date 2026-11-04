import {loadRegistry} from '../../../packages/core/src/registry.js';
import { Pool } from 'pg';
import { z } from 'zod';
import { Store } from './store.js';
import { createApp } from './app.js';
import { startWorker } from './worker.js';
process.loadEnvFile('.env');
const env=z.object({DATABASE_URL:z.string().url(),API_TOKEN:z.string().min(32),
  NEAR_SUPPLIER_ID:z.preprocess(v=>v||'supplier.testnet',z.string().endsWith('.testnet')),NEAR_AGENT_ID:z.preprocess(v=>v||'agent.testnet',z.string().endsWith('.testnet')),
  OPENAI_MODEL:z.string().optional(),PORT:z.coerce.number().int().min(1024).max(65535).default(3001)}).parse(process.env);
const pool=new Pool({connectionString:env.DATABASE_URL,max:6,connectionTimeoutMillis:5000});
pool.on('error',()=>{console.error('Database connection failed');});
const store=new Store(pool);
await store.migrate();
await store.registerTargets(loadRegistry());
if(process.argv.includes('--migrate')) {await pool.end();console.log('Database migrations applied');}
else if(process.argv.includes('--worker')) {
  const worker=await startWorker(store);
  process.once('SIGTERM',worker.stop);process.once('SIGINT',worker.stop);
  console.log('Worker ready');
  try {await worker.done;} finally {await pool.end();}
} else {
  const app=createApp(store,{enforceReadiness:true,token:env.API_TOKEN,supplier:env.NEAR_SUPPLIER_ID,agent:env.NEAR_AGENT_ID,model:env.OPENAI_MODEL||'gpt-4.1-mini-2025-04-14'});
  const server=app.listen(env.PORT,'127.0.0.1',()=>console.log(`API listening on http://127.0.0.1:${env.PORT}`));
  const stop=()=>{server.close(()=>void pool.end());server.closeAllConnections();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
