import { loadRegistry,selectTargets,requireAuthorizedSnapshot,executionIssue,type Registry } from '../../../packages/core/src/registry.js';
import express,{type ErrorRequestHandler} from 'express';
import { createHash,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store,Conflict } from './store.js';
import { scenario,scenarioIds,compatibility,withProbe } from '../../../packages/core/src/scenarios.js';
import { demoPolicy } from '../../../packages/core/src/config.js';

export function createApp(store:Store,config:{token:string;supplier:string;agent:string;model:string;registry?:Registry;enforceReadiness?:boolean}) {
  if(config.token.length<32) throw new Error('API_TOKEN must have at least 32 characters');
  const registry=config.registry??loadRegistry(config.model,config.agent);
  const app=express();app.disable('x-powered-by');
  app.get('/health',async(_req,res)=>{await store.pool.query('SELECT 1');res.json({status:'ok'});});
  app.use('/api',(req,res,next)=>{
    const header=req.get('authorization')??'';
    const expected=createHash('sha256').update(`Bearer ${config.token}`).digest();
    if(!timingSafeEqual(expected,createHash('sha256').update(header).digest())) {res.status(401).json({error:'Unauthorized'});return;}
    next();
  });
  app.use(express.json({limit:'16kb'}));
  const fixtures=()=>scenarioIds.map(id=>scenario(id,config.supplier,config.agent));
  app.get('/api/scenarios',(_req,res)=>res.json(fixtures()));
  app.get('/api/stats',async(_req,res)=>res.json({...await store.stats(),policy:demoPolicy}));
  app.get('/api/targets',(_req,res)=>res.json({...registry,executionIssues:Object.fromEntries(registry.agents.flatMap(a=>registry.paymentSystems.flatMap(p=>(['agent','probe'] as const).map(mode=>[`${a.id}:${p.id}:${mode}`,config.enforceReadiness?executionIssue(selectTargets(registry,a.id,p.id,mode))??null:null]))))}));
  app.get('/api/agents',async(_req,res)=>res.json((await store.pool.query("SELECT * FROM agents WHERE workspace_id='demo'")).rows));
  app.get('/api/test-runs',async(_req,res)=>res.json(await store.list()));
  const key=(req:express.Request)=>z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/).parse(req.get('idempotency-key'));
  app.post('/api/test-runs',async(req,res)=>{
    const body=z.object({scenarioId:z.enum(scenarioIds),agentId:z.string().default('shoppingbot'),paymentSystemId:z.string().default('near-protected'),mode:z.enum(['agent','probe']).default('agent')}).strict().parse(req.body);
    const selectedFixture=fixtures().find(f=>f.id===body.scenarioId)!;
    const fixture=body.mode==='probe'?withProbe(selectedFixture):selectedFixture;
    if(!registry.agents.some(a=>a.id===body.agentId)||!registry.paymentSystems.some(p=>p.id===body.paymentSystemId)){res.status(400).json({error:'Target not registered'});return;}
    const targets=selectTargets(registry,body.agentId,body.paymentSystemId,body.mode);
    const readiness=config.enforceReadiness&&executionIssue(targets);if(readiness){res.status(503).json({error:readiness});return;}
    const incompatible=compatibility(fixture,targets.paymentSystem);if(incompatible){res.status(400).json({error:incompatible});return;}
    await store.registerTargets(registry);
    const model=targets.agent.adapter==='shoppingbot'?targets.agent.model:'external-agent';
    const run=await store.enqueue(fixture,model,key(req),null,targets);
    res.status(202).location(`/api/test-runs/${run.id}`).json(run);
  });
  app.param('id',async(req,res,next,id)=>{
    const parsed=z.uuid().safeParse(id);
    if(!parsed.success) {res.status(400).json({error:'Invalid run ID'});return;}
    const run=await store.get(id);
    if(!run) {res.status(404).json({error:'Run not found'});return;}
    res.locals.run=run;next();
  });
  app.get('/api/test-runs/:id',(_req,res)=>res.json(res.locals.run));
  app.get('/api/test-runs/:id/report',async(_req,res)=>{
    const report=await store.report(res.locals.run.id);
    if(!report) {res.status(409).json({error:'Report not ready'});return;}
    res.json(report);
  });
  app.post('/api/test-runs/:id/replay',async(req,res)=>{
    z.object({}).strict().parse(req.body??{});
    const parent=res.locals.run;
    const targets=parent.target_snapshot??selectTargets(registry);
    if(!parent.target_snapshot&&(targets.agent.adapter!=='shoppingbot'||targets.agent.model!==parent.model)){res.status(409).json({error:'Legacy model configuration must be registered before replay'});return;}
    try{requireAuthorizedSnapshot(targets,registry);}catch{res.status(409).json({error:'Original target configuration is no longer authorized'});return;}
    const readiness=config.enforceReadiness&&executionIssue(targets);if(readiness){res.status(503).json({error:readiness});return;}
    res.status(202).json(await store.enqueue(parent.scenario,parent.model,key(req),parent.id,targets));
  });
  app.get('/api/test-runs/:id/events',async(req,res)=>{
    const id=res.locals.run.id;
    let cursor=z.coerce.number().int().min(0).max(2147483647).parse(req.query.after??req.get('last-event-id')??0);
    if(!req.get('accept')?.includes('text/event-stream')) {res.json(await store.events(id,cursor));return;}
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});res.flushHeaders();
    let closed=false;res.on('close',()=>{closed=true;});
    try {
      while(!closed) {
        const events=await store.events(id,cursor);
        for(const event of events) {
          cursor=event.seq;
          if(!res.write(`id: ${cursor}\ndata: ${JSON.stringify(event)}\n\n`)) {res.end();return;}
        }
        const run=await store.get(id);
        if(events.length<200 && ['COMPLETED','FAILED'].includes(run?.status??'')) {res.write('event: end\ndata: {}\n\n');break;}
        res.write(': heartbeat\n\n');
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
    } catch {if(!closed) res.write('event: error\ndata: {"error":"Stream unavailable; reconnect with Last-Event-ID"}\n\n');}
    res.end();
  });
  app.use((_req,res)=>res.status(404).json({error:'Not found'}));
  const errors:ErrorRequestHandler=(err,_req,res,_next)=>{
    if(err instanceof z.ZodError || err instanceof SyntaxError) {res.status(400).json({error:'Invalid request'});return;}
    if(err instanceof Conflict) {res.status(409).json({error:err.message});return;}
    if(err?.type==='entity.too.large') {res.status(413).json({error:'Request too large'});return;}
    res.status(500).json({error:'Internal server error'});
  };
  app.use(errors);return app;
}
