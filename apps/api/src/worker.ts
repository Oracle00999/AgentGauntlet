import { spawn,type ChildProcess } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store,type Run,type Event } from './store.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
export const runDirectory=(id:string)=>`${root}artifacts/runs/${id}`;
export async function importEvents(store:Store,id:string) {
  let content:string;
  try {content=await readFile(`${runDirectory(id)}/events.jsonl`,'utf8');}
  catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  // Ignore an unfinished final line while the child is appending.
  const lines=content.slice(0,content.lastIndexOf('\n')).split('\n').filter(Boolean);
  const count=(await store.pool.query('SELECT coalesce(max(seq),0)::int AS n FROM run_events WHERE run_id=$1',[id])).rows[0].n;
  for(let i=count;i<lines.length;i++) await store.event(id,i+1,JSON.parse(lines[i]) as Event);
}
export async function finalize(store:Store,run:Run) {
  await importEvents(store,run.id);
  let report:Record<string,unknown>|undefined;
  try {
    const parsed=JSON.parse(await readFile(`${runDirectory(run.id)}/report.json`,'utf8'));
    if(parsed.runId===run.id && typeof parsed.completed==='boolean' && typeof parsed.outcome==='string') report=parsed;
  } catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT' && !(e instanceof SyntaxError))throw e;}
  await store.finish(run.id,report??{schemaVersion:2,runId:run.id,scenario:run.scenario,model:run.model,targets:run.target_snapshot,snapshotDigest:run.snapshot_digest,mode:run.target_snapshot?.mode??'agent',completed:false,outcome:'INCONCLUSIVE',agentResult:'UNKNOWN',contractResult:'REQUIRES_RECONCILIATION',
    error:{code:'RUN_INTERRUPTED',message:'Execution stopped without a complete report. Inspect saved events and onchain payment IDs before replaying.'}});
}
export async function startWorker(store:Store) {
  const lease=await store.pool.connect();
  const locked=(await lease.query('SELECT pg_try_advisory_lock(728311) AS locked')).rows[0].locked;
  if(!locked) {lease.release();throw new Error('Another worker already owns the signing queue');}
  let stopped=false,child:ChildProcess|undefined;
  const stop=()=>{stopped=true;child?.kill('SIGTERM');};
  lease.on('error',stop);
  const done=(async()=>{
    try {
      // Never resume an interrupted financial job automatically.
      const stale=(await store.pool.query<Run>("SELECT * FROM test_runs WHERE status IN ('RUNNING','WAITING_FOR_CHAIN')")).rows;
      for(const run of stale) await finalize(store,run);
      while(!stopped) {
        const run=await store.claim(lease);
        if(!run) {await new Promise(resolve=>setTimeout(resolve,500));continue;}
        const dir=runDirectory(run.id);await mkdir(dir,{recursive:true});
        const input=`${dir}/input.json`;
        await writeFile(input,JSON.stringify({runId:run.replay_of??undefined,scenario:run.scenario,model:run.model,targets:run.target_snapshot}));
        child=spawn(process.execPath,['--import','tsx','scripts/shoppingbot.ts','--replay',input],{
          cwd:root,env:{...process.env,AG_RUN_ID:run.id},stdio:['ignore','ignore','ignore','ipc'],
        });
        let exited=false;
        const exit=new Promise<void>(resolve=>{child!.once('exit',()=>{exited=true;resolve();});child!.once('error',()=>{exited=true;resolve();});});
        const timeout=setTimeout(()=>child?.kill('SIGTERM'),10*60_000);
        // If the DB connection holding the queue lock disappears, stop signing.
        try {
          while(!exited) {
            await importEvents(store,run.id);
            await lease.query('SELECT 1');
            await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,1000))]);
          }
          await finalize(store,run);
        } catch(e) {stop();await exit;throw e;}
        finally {clearTimeout(timeout);child=undefined;}
      }
    } finally {
      await lease.query('SELECT pg_advisory_unlock(728311)').catch(()=>{});lease.release();
    }
  })();
  return {stop,done};
}
