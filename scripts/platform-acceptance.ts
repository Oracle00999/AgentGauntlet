import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
process.loadEnvFile('.env');
const base=`http://127.0.0.1:${process.env.PORT||3001}`;
const headers={authorization:`Bearer ${process.env.API_TOKEN}`,'content-type':'application/json'};
const cases=[
 {name:'external-agent',agentId:'external-demo',paymentSystemId:'near-protected',mode:'agent',scenarioId:'malicious-invoice'},
 {name:'protected-probe',agentId:'shoppingbot',paymentSystemId:'near-protected',mode:'probe',scenarioId:'malicious-invoice'},
 {name:'permissive-probe',agentId:'shoppingbot',paymentSystemId:'near-permissive',mode:'probe',scenarioId:'malicious-invoice'},
 {name:'protected-control',agentId:'shoppingbot',paymentSystemId:'near-protected',mode:'probe',scenarioId:'legitimate-payment'},
 {name:'permissive-control',agentId:'shoppingbot',paymentSystemId:'near-permissive',mode:'probe',scenarioId:'legitimate-payment'},
 {name:'external-agent-control',agentId:'external-demo',paymentSystemId:'near-protected',mode:'agent',scenarioId:'legitimate-payment'},
 {name:'default-agent-control',agentId:'shoppingbot',paymentSystemId:'near-protected',mode:'agent',scenarioId:'legitimate-payment'},
];
await mkdir('artifacts/platform',{recursive:true});
const runs:{name:string;id:string}[]=[];
const retry=process.argv.includes('--replay-failed');
const previous:typeof runs=retry?JSON.parse(await readFile('artifacts/platform/runs.json','utf8')):[];
for(const {name,...body} of cases){
 const prior=previous.find(r=>r.name===name);
 if(prior){const report:any=await(await fetch(`${base}/api/test-runs/${prior.id}/report`,{headers})).json();if(report.outcome!=='INCONCLUSIVE'){runs.push(prior);continue;}}
 const endpoint=prior?`/api/test-runs/${prior.id}/replay`:'/api/test-runs';
 const response=await fetch(`${base}${endpoint}`,{method:'POST',headers:{...headers,'idempotency-key':prior?`platform-replay-${prior.id}`:`platform-acceptance-v1-${name}`},body:JSON.stringify(prior?{}:body)});
 if(!response.ok)throw new Error(`Enqueue failed ${response.status}`);
 const run:any=await response.json();runs.push({name,id:run.id});console.log(`${name}: ${run.id}`);
}
await writeFile('artifacts/platform/runs.json',JSON.stringify(runs,null,2));
const results:any[]=[];
for(const run of runs){
 const deadline=Date.now()+15*60000;
 for(;;){
  if(Date.now()>deadline)throw new Error('Acceptance watch timed out; use saved IDs to reconcile');
  const response=await fetch(`${base}/api/test-runs/${run.id}/report`,{headers});
  if(response.status===409){await new Promise(resolve=>setTimeout(resolve,2000));continue;}
  if(!response.ok)throw new Error(`Report query failed ${response.status}`);
  const report:any=await response.json();
  await writeFile(`artifacts/platform/${run.name}.json`,JSON.stringify(report,null,2));
  const events=await(await fetch(`${base}/api/test-runs/${run.id}/events`,{headers})).json();
  await writeFile(`artifacts/platform/${run.name}.events.json`,JSON.stringify(events,null,2));
  results.push({name:run.name,report});
  console.log(`${run.name}: ${report.outcome} (${report.attempts?.map((a:any)=>a.status??'UNRESOLVED').join(', ')||'no captured requests'})`);
  break;
 }
}

for(const {name,report} of results){
 assert.equal(report.completed,true,`${name}: execution incomplete`);
 assert.notEqual(report.outcome,'INCONCLUSIVE',`${name}: evidence missing`);
 if(name==='protected-probe')assert.equal(report.outcome,'PAYMENT_SYSTEM_PROTECTED');
 if(name==='permissive-probe')assert.equal(report.outcome,'FINANCIAL_BREACH');
 if(name.endsWith('control'))assert.equal(report.outcome,'LEGITIMATE_PAYMENT_SUCCEEDED');
}
console.log('All platform acceptance checks passed.');
