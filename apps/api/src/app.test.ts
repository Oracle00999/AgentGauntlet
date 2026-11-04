import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { Store } from './store.js';
import { createApp } from './app.js';
import { finalize } from './worker.js';

process.loadEnvFile('.env');
test('Express + real PostgreSQL: auth, idempotency, replay, persistence, recovery and event streaming',async()=>{
  const schema=`test_${randomUUID().replaceAll('-','')}`;
  const admin=new Pool({connectionString:process.env.DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const config={connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`};
  let pool=new Pool(config);let store=new Store(pool);
  const apiConfig={token:'unit-test-token-not-a-live-credential-123',supplier:'supplier.testnet',agent:'agent.testnet',model:'unit-model'};
  const auth={Authorization:`Bearer ${apiConfig.token}`};
  try {
    await store.migrate();await store.migrate();
    let app=createApp(store,apiConfig);
    await request(app).get('/api/agents').expect(401);
    await request(app).get('/api/targets').expect(401);
    const registry=(await request(app).get('/api/targets').set(auth).expect(200)).body;
    assert(registry.paymentSystems.some((p:any)=>p.id==='near-protected'));
    const catalog=(await request(app).get('/api/scenarios').set(auth).expect(200)).body;assert.equal(catalog.length,7);assert(catalog.every((s:any)=>s.objective&&s.expectedBehavior));
    await request(app).post('/api/test-runs').set(auth).set('Idempotency-Key','underfunded-budget').send({scenarioId:'split-budget',mode:'probe'}).expect(400);
    await request(app).post('/api/test-runs').set(auth).set('Idempotency-Key','unknown-target').send({scenarioId:'malicious-invoice',agentId:'unregistered'}).expect(400);
    await request(app).post('/api/test-runs').send({scenarioId:'malicious-invoice'}).expect(401);
    await request(app).post('/api/test-runs').set(auth).send({scenarioId:'malicious-invoice'}).expect(400);
    await request(app).post('/api/test-runs').set(auth).set('Idempotency-Key','unknown-scenario').send({scenarioId:'unknown'}).expect(400);
    await request(app).post('/api/test-runs').set(auth).set('Idempotency-Key','unsafe-config').send({scenarioId:'malicious-invoice',recipient:'other.testnet'}).expect(400);
    const post=()=>request(app).post('/api/test-runs').set(auth).set('Idempotency-Key','concurrent-request').send({scenarioId:'malicious-invoice'});
    const [first,second]=await Promise.all([post(),post()]);
    assert.equal(first.status,202);assert.equal(second.status,202);assert.equal(first.body.id,second.body.id);
    const id=first.body.id;
    assert.equal(first.body.target_snapshot.agent.id,'shoppingbot');
    assert.equal(first.body.target_snapshot.paymentSystem.id,'near-protected');
    assert.equal(first.body.snapshot_digest.length,64);
    await request(app).post('/api/test-runs').set(auth).set('Idempotency-Key','concurrent-request').send({scenarioId:'malicious-invoice',paymentSystemId:'near-permissive'}).expect(409);
    await assert.rejects(pool.query("UPDATE test_runs SET target_snapshot='{}' WHERE id=$1",[id]),/immutable/);
    await request(app).post('/api/test-runs').set(auth).set('Idempotency-Key','concurrent-request').send({scenarioId:'legitimate-payment'}).expect(409);
    await request(app).get('/api/test-runs/not-a-uuid').set(auth).expect(400);
    await request(app).get(`/api/test-runs/${randomUUID()}`).set(auth).expect(404);
    await request(app).get(`/api/test-runs/${id}/report`).set(auth).expect(409);
    await store.event(id,1,{at:new Date().toISOString(),event:'unit_event',data:{testOnly:true}});
    await store.event(id,1,{at:new Date().toISOString(),event:'unit_event',data:{testOnly:true}});
    assert.equal((await store.events(id)).length,1);
    // Deliberate unit fixture in an isolated schema, never live chain evidence.
    await store.finish(id,{runId:id,completed:false,outcome:'INCONCLUSIVE',testOnly:true});
    await pool.end();pool=new Pool(config);store=new Store(pool);app=createApp(store,apiConfig);
    const persisted=await request(app).get(`/api/test-runs/${id}/report`).set(auth).expect(200);
    assert.equal(persisted.body.outcome,'INCONCLUSIVE');
    const streamed=await request(app).get(`/api/test-runs/${id}/events`).set(auth).set('Accept','text/event-stream').expect(200);
    assert(streamed.text.includes('id: 1'));assert(streamed.text.includes('event: end'));
    const resumed=await request(app).get(`/api/test-runs/${id}/events`).set(auth).set('Accept','text/event-stream').set('Last-Event-ID','1').expect(200);
    assert(!resumed.text.includes('id: 1'));
    const replay=await request(app).post(`/api/test-runs/${id}/replay`).set(auth).set('Idempotency-Key','replay-request').send({}).expect(202);
    assert.equal(replay.body.replay_of,id);assert.deepEqual(replay.body.target_snapshot,first.body.target_snapshot);assert.deepEqual(replay.body.scenario,first.body.scenario);
    const c=await pool.connect();let claimed;
    try {claimed=await store.claim(c);} finally {c.release();}
    assert.equal(claimed.id,replay.body.id);
    await finalize(store,claimed);
    assert.equal((await store.get(claimed.id))?.status,'FAILED');
    assert.equal((await store.report(claimed.id)).error.code,'RUN_INTERRUPTED');
    const c2=await pool.connect();try {assert.equal(await store.claim(c2),undefined);}finally {c2.release();}
    // Historical records remain unchanged; their new replay gets a complete snapshot.
    const legacy=await store.enqueue(first.body.scenario,first.body.model,'legacy-fixture');
    await store.finish(legacy.id,{runId:legacy.id,completed:false,outcome:'INCONCLUSIVE',testOnly:true});
    const legacyReplay=await request(app).post(`/api/test-runs/${legacy.id}/replay`).set(auth).set('Idempotency-Key','legacy-replay').send({}).expect(202);
    assert.equal(legacyReplay.body.target_snapshot.agent.id,'shoppingbot');
    assert.equal((await store.get(legacy.id))?.target_snapshot,null);
    const revoked=structuredClone(registry);revoked.agents.find((a:any)=>a.id==='shoppingbot').version='revoked-version';
    const revokedApp=createApp(store,{...apiConfig,registry:revoked});
    await request(revokedApp).post(`/api/test-runs/${id}/replay`).set(auth).set('Idempotency-Key','revoked-replay').send({}).expect(409);
    const budget=await request(app).post('/api/test-runs').set(auth).set('Idempotency-Key','funded-budget').send({scenarioId:'split-budget',mode:'probe',paymentSystemId:'near-budget'}).expect(202);
    assert.equal(budget.body.scenario.probeRequests.length,3);assert.equal(budget.body.scenario.probeExpectations[2].code,'DAILY_LIMIT');
    assert.equal(budget.body.evidence_origin,'live');
    // Sensitive backend errors stay out of HTTP responses.
    await pool.end();
    const failed=await request(app).get('/api/test-runs').set(auth).expect(500);
    assert.deepEqual(failed.body,{error:'Internal server error'});
  } finally {
    if(!pool.ended)await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
