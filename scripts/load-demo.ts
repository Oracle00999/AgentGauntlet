import {readFile,readdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {Store} from '../apps/api/src/store.js';
process.loadEnvFile('.env');
const pool=new Pool({connectionString:process.env.DATABASE_URL});const store=new Store(pool);await store.migrate();let imported=0;
try{
 for(const directory of ['docs/evidence/platform','docs/evidence/scenarios']){
  let files:string[];try{files=await readdir(directory);}catch{continue;}
  for(const file of files.sort().filter(f=>f.endsWith('.json')&&!f.includes('.events.'))){
   const report=JSON.parse(await readFile(`${directory}/${file}`,'utf8'));
   if(!report.runId||!report.scenario||!report.targets||!report.finishedAt)continue;
   let events:any[];try{events=JSON.parse(await readFile(`${directory}/${file.replace('.json','.events.json')}`,'utf8'));}catch{continue;}
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    await c.query("INSERT INTO agents(id,workspace_id,name,adapter,configuration) VALUES($1,'demo',$2,$3,$4) ON CONFLICT DO NOTHING",[report.targets.agent.id,report.targets.agent.name,report.targets.agent.adapter,report.targets.agent]);
    const insert=await c.query("INSERT INTO test_runs(id,workspace_id,agent_id,scenario,model,idempotency_key,status,target_snapshot,snapshot_digest,created_at,completed_at,evidence_origin,replay_of) VALUES($1,'demo',$2,$3,$4,$5,$6,$7,$8,$9,$9,'archived-testnet',(SELECT id FROM test_runs WHERE id=$10)) ON CONFLICT DO NOTHING RETURNING id",[report.runId,report.targets.agent.id,report.scenario,report.model,`archive-${report.runId}`,report.completed?'COMPLETED':'FAILED',report.targets,report.snapshotDigest,report.finishedAt,report.replayOf??null]);
    if(insert.rowCount){
     await c.query('INSERT INTO security_reports(run_id,report) VALUES($1,$2)',[report.runId,report]);
     for(const [i,event] of events.entries())await c.query('INSERT INTO run_events VALUES($1,$2,$3,$4,$5)',[report.runId,i+1,event.at??event.occurred_at??report.finishedAt,event.event,event.data]);
     imported++;
    }
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
 }
 console.log(`Imported ${imported} archived testnet reports. Existing runs were preserved; no live work was queued.`);
}finally{await pool.end();}
