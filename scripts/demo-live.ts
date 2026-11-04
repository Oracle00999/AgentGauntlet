import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
process.loadEnvFile('.env');
const base=`http://127.0.0.1:${process.env.PORT||3001}`;
const headers={authorization:`Bearer ${process.env.API_TOKEN}`,'content-type':'application/json'};
type Case={name:string;scenarioId:string;agentId:string;paymentSystemId:string;mode:'agent'|'probe';expected?:string;id?:string};
const baseCases:Case[]=[
 {name:'external-attack',scenarioId:'malicious-invoice',agentId:'external-demo',paymentSystemId:'near-protected',mode:'agent'},
 {name:'permissive-overspending',scenarioId:'overspending',agentId:'shoppingbot',paymentSystemId:'near-permissive',mode:'probe',expected:'FINANCIAL_BREACH'},
 {name:'protected-overspending',scenarioId:'overspending',agentId:'shoppingbot',paymentSystemId:'near-protected',mode:'probe',expected:'PAYMENT_SYSTEM_PROTECTED'},
 {name:'external-control',scenarioId:'legitimate-payment',agentId:'external-demo',paymentSystemId:'near-protected',mode:'agent',expected:'LEGITIMATE_PAYMENT_SUCCEEDED'},
];
if(process.argv.includes('--all-attacks')){
 for(const id of ['split-budget','duplicate-payment','unauthorized-recipient','paused-vault'])baseCases.push({name:id,scenarioId:id,agentId:'shoppingbot',paymentSystemId:id==='split-budget'?'near-budget':'near-protected',mode:'probe',expected:'PAYMENT_SYSTEM_PROTECTED'});
 baseCases.push({name:'external-split-budget',scenarioId:'split-budget',agentId:'external-demo',paymentSystemId:'near-budget',mode:'agent'});
}
const resume=process.argv.indexOf('--resume');
const path=resume>=0?process.argv[resume+1]:`artifacts/demo/${randomUUID()}/manifest.json`;
let manifest:{batch:string;cases:Case[];replayId?:string}=resume>=0?JSON.parse(await readFile(path,'utf8')):{batch:randomUUID(),cases:baseCases};
await mkdir(dirname(path),{recursive:true});
const save=()=>writeFile(path,JSON.stringify(manifest,null,2));await save();console.log(`Demo manifest: ${path}`);
for(const item of manifest.cases){if(item.id)continue;
 const {name,expected,...body}=item;
 const response=await fetch(`${base}/api/test-runs`,{method:'POST',headers:{...headers,'idempotency-key':`demo-${manifest.batch}-${name}`},body:JSON.stringify(body)});
 if(!response.ok)throw new Error(`Queue rejected ${name}: ${response.status}. Resume with the saved manifest; do not create duplicate runs.`);
 item.id=(await response.json() as {id:string}).id;await save();console.log(`${name}: ${item.id}`);
}
const watch=async(id:string,name:string)=>{
 const deadline=Date.now()+20*60000;
 for(;;){
  if(Date.now()>deadline)throw new Error('Watch timed out; execution state remains persisted. Resume with the manifest.');
  const response=await fetch(`${base}/api/test-runs/${id}/report`,{headers});
  if(response.status===409){await new Promise(resolve=>setTimeout(resolve,2000));continue;}
  if(!response.ok)throw new Error(`Report query failed (${response.status}); resume using the manifest.`);
  const report:any=await response.json();
  await writeFile(`${dirname(path)}/${name}.json`,JSON.stringify(report,null,2));
  const eventsResponse=await fetch(`${base}/api/test-runs/${id}/events`,{headers});if(!eventsResponse.ok)throw new Error('Event query failed');
  await writeFile(`${dirname(path)}/${name}.events.json`,JSON.stringify(await eventsResponse.json(),null,2));
  console.log(`${name}: ${report.outcome}; ${report.attempts.map((a:any)=>a.status??'UNVERIFIED').join(', ')||'no payment requested'}`);return report;
 }
};
const failures:string[]=[];
for(const item of manifest.cases){const report=await watch(item.id!,item.name);if(!report.completed||report.outcome==='INCONCLUSIVE'||item.expected&&report.outcome!==item.expected)failures.push(item.name);}
// A new real execution, explicitly linked to the first agent test. No response is fabricated.
if(!manifest.replayId){const response=await fetch(`${base}/api/test-runs/${manifest.cases[0].id}/replay`,{method:'POST',headers:{...headers,'idempotency-key':`demo-${manifest.batch}-replay`},body:'{}'});assert.equal(response.status,202);manifest.replayId=(await response.json() as {id:string}).id;await save();}
const replay=await watch(manifest.replayId!,'external-replay');if(!replay.completed||replay.outcome==='INCONCLUSIVE')failures.push('external-replay');
assert.equal(failures.length,0,`Unresolved cases: ${failures.join(', ')}. Inspect evidence and reconcile before manually replaying.`);
console.log('Demo evidence complete. Use /compare for the protected/permissive pair.');
