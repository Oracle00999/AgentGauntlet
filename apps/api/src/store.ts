import { snapshotDigest,type TargetSnapshot,type Registry } from '../../../packages/core/src/registry.js';
import { Pool, type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Scenario } from '../../../packages/core/src/scenarios.js';

export type Run = {id:string;workspace_id:string;agent_id:string;replay_of:string|null;scenario:Scenario;model:string;target_snapshot:TargetSnapshot|null;snapshot_digest:string|null;status:string};
export type Event = {at:string;event:string;data:Record<string,unknown>};
export class Conflict extends Error {}
export class Store {
  constructor(readonly pool:Pool) {}
  async migrate() {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(728310)');
      await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)');
      for(const [version,file] of [[1,'001_initial.sql'],[2,'002_targets.sql'],[3,'003_evidence_origin.sql']] as const) {
        if(!(await c.query('SELECT 1 FROM schema_migrations WHERE version=$1',[version])).rowCount) {
          await c.query(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
          await c.query('INSERT INTO schema_migrations VALUES ($1)',[version]);
        }
      }
      await c.query('COMMIT');
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  async registerTargets(registry:Registry) {
    for(const agent of registry.agents)await this.pool.query("INSERT INTO agents(id,workspace_id,name,adapter,configuration) VALUES($1,'demo',$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,adapter=EXCLUDED.adapter,configuration=EXCLUDED.configuration",[agent.id,agent.name,agent.adapter,agent]);
    for(const target of registry.paymentSystems)await this.pool.query("INSERT INTO payment_systems VALUES($1,'demo',$2) ON CONFLICT(id) DO UPDATE SET configuration=EXCLUDED.configuration",[target.id,target]);
  }
  async enqueue(fixture:Scenario,model:string,key:string,replayOf:string|null=null,targets:TargetSnapshot|null=null) {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      // Serialize enqueue/idempotency checks and cap queued work in this workspace.
      await c.query("SELECT id FROM workspaces WHERE id='demo' FOR UPDATE");
      const prior=(await c.query<Run>("SELECT * FROM test_runs WHERE workspace_id='demo' AND idempotency_key=$1",[key])).rows[0];
      if(prior) {
        if(!(await c.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.scenario,fixture])).rows[0].same) throw new Conflict('Idempotency key belongs to a different request');
        if(prior.model!==model || prior.replay_of!==replayOf || (prior.target_snapshot?snapshotDigest(prior.target_snapshot):null)!==(targets?snapshotDigest(targets):null)) throw new Conflict('Idempotency key belongs to a different request');
        await c.query('COMMIT');return prior;
      }
      const count=(await c.query("SELECT count(*)::int AS n FROM test_runs WHERE status IN ('QUEUED','RUNNING','WAITING_FOR_CHAIN')")).rows[0].n;
      if(count>=10) throw new Conflict('Queue is full');
      const result=await c.query<Run>("INSERT INTO test_runs(id,workspace_id,agent_id,replay_of,scenario,model,idempotency_key,status,target_snapshot,snapshot_digest) VALUES($1,'demo',$6,$2,$3,$4,$5,'QUEUED',$7,$8) RETURNING *",[randomUUID(),replayOf,fixture,model,key,targets?.agent.id??'shoppingbot',targets,targets?snapshotDigest(targets):null]);
      await c.query('COMMIT');return result.rows[0];
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  async get(id:string) {return (await this.pool.query<Run>("SELECT * FROM test_runs WHERE id=$1 AND workspace_id='demo'",[id])).rows[0];}
  async list() {return (await this.pool.query("SELECT r.id,r.evidence_origin,r.agent_id,r.target_snapshot,r.status,r.scenario->>'id' AS scenario_id,r.created_at,r.completed_at,s.report->>'outcome' AS outcome FROM test_runs r LEFT JOIN security_reports s ON s.run_id=r.id WHERE workspace_id='demo' ORDER BY created_at DESC LIMIT 100")).rows;}
  async stats() {
    const runs=(await this.pool.query("SELECT count(*)::int AS total FROM test_runs WHERE workspace_id='demo'")).rows[0].total;
    const reports=(await this.pool.query("SELECT report FROM security_reports s JOIN test_runs r ON r.id=s.run_id WHERE r.workspace_id='demo'")).rows;
    let resisted=0,blocked=0,settled=0;
    for(const {report} of reports){if(report.outcome==='AGENT_RESISTED')resisted++;for(const a of report.attempts??[]){if(a.status==='SETTLED')settled++;if(a.status==='DENIED'&&a.violations?.length)blocked++;}}
    return {runs,resisted,blocked,settled};
  }
  async events(id:string,after=0) {return (await this.pool.query('SELECT seq,occurred_at,event,data FROM run_events WHERE run_id=$1 AND seq>$2 ORDER BY seq LIMIT 200',[id,after])).rows;}
  async report(id:string) {return (await this.pool.query('SELECT report FROM security_reports WHERE run_id=$1',[id])).rows[0]?.report;}
  async claim(c:PoolClient) {
    return (await c.query<Run>("UPDATE test_runs SET status='RUNNING',started_at=now() WHERE id=(SELECT id FROM test_runs WHERE status='QUEUED' ORDER BY created_at,id LIMIT 1) RETURNING *")).rows[0];
  }
  async event(id:string,seq:number,e:Event) {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO run_events VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,seq,e.at,e.event,JSON.stringify(e.data??null)]);
      if(e.event==='run_initialized' && e.data.contractId && e.data.vaultId) await c.query("INSERT INTO vaults VALUES($1,$2,$3,'testnet') ON CONFLICT DO NOTHING",[id,e.data.contractId,e.data.vaultId]);
      if(e.event==='payment_submission') await c.query("UPDATE test_runs SET status='WAITING_FOR_CHAIN' WHERE id=$1 AND status='RUNNING'",[id]);
      if(e.event==='tool_result'||e.event==='outcome_verified') await c.query("UPDATE test_runs SET status='RUNNING' WHERE id=$1 AND status='WAITING_FOR_CHAIN'",[id]);
      if(e.event==='transaction_submitted') await c.query("INSERT INTO blockchain_transactions VALUES($1,$2,'testnet',NULL) ON CONFLICT DO NOTHING",[e.data.hash,id]);
      if(e.event==='chain_evidence') {
        const outcome=e.data.outcome as {transaction?:{hash?:string}};
        if(outcome?.transaction?.hash) await c.query('UPDATE blockchain_transactions SET evidence=$1 WHERE hash=$2 AND run_id=$3',[e.data,outcome.transaction.hash,id]);
      }
      await c.query('COMMIT');
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  async finish(id:string,report:Record<string,unknown>) {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO security_reports(run_id,report) VALUES($1,$2) ON CONFLICT(run_id) DO UPDATE SET report=EXCLUDED.report',[id,report]);
      await c.query('UPDATE test_runs SET status=$2,completed_at=now() WHERE id=$1',[id,report.completed===true?'COMPLETED':'FAILED']);
      await c.query('COMMIT');
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
}
