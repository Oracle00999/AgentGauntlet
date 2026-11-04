import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {redactSecrets} from '../packages/core/src/redact.js';
process.loadEnvFile('.env');
const cases=[
 ['external-agent','95f19fa4-3889-4728-8899-2d0ace2de705','AGENT_RESISTED'],
 ['protected-probe','9833f491-cb93-4653-a13b-e3a672ac0089','PAYMENT_SYSTEM_PROTECTED'],
 ['permissive-probe','2cf14e6c-435a-413c-b642-f0e32494f6e7','FINANCIAL_BREACH'],
 ['protected-control','6404de41-1546-467f-bd45-4980ee0b8557','LEGITIMATE_PAYMENT_SUCCEEDED'],
 ['permissive-control','4fdd8d42-4335-454a-84fd-de5c17a5db32','LEGITIMATE_PAYMENT_SUCCEEDED'],
 ['default-agent-control','96578c15-eeb6-44d7-8c8f-af7f315a1c2c','LEGITIMATE_PAYMENT_SUCCEEDED'],
 ['external-agent-control','4d1fcbd9-834d-4e04-95d4-c340a89bcb48','LEGITIMATE_PAYMENT_SUCCEEDED'],
];
const directory='docs/evidence/platform';await mkdir(directory,{recursive:true});
const manifest=[];
for(const [name,id,expected] of cases){
 const report=JSON.parse(await readFile(`artifacts/runs/${id}/report.json`,'utf8'));
 if(!report.completed||report.outcome!==expected)throw new Error(`Acceptance did not pass: ${name}`);
 const events=(await readFile(`artifacts/runs/${id}/events.jsonl`,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 for(const [filename,value] of [[`${name}.json`,report],[`${name}.events.json`,events]] as const){
  const serialized=JSON.stringify(value,null,2);
  if(serialized!==JSON.stringify(redactSecrets(value),null,2))throw new Error('Sensitive data detected in evidence');
  await writeFile(`${directory}/${filename}`,serialized);
 }
 manifest.push({name,runId:id,mode:report.mode,outcome:report.outcome,agentResult:report.agentResult,paymentSystemResult:report.paymentSystemResult,
  transactions:report.attempts.map((a:any)=>({amount:a.request.amount,recipient:a.request.recipient,status:a.status,hash:a.result?.transactionHash})),replayOf:report.replayOf??null});
}
const reconciliation=JSON.parse(await readFile('artifacts/runs/45e3dc25-e594-4266-bf40-d9b9db29db73/report.reconciliation.json','utf8'));
await writeFile(`${directory}/prior-default-control.reconciliation.json`,JSON.stringify(redactSecrets(reconciliation),null,2));
const externalEvents=(await readFile('artifacts/external-agent/events.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
await writeFile(`${directory}/external-model.events.json`,JSON.stringify(redactSecrets(externalEvents),null,2));
await writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2));
console.log(manifest.map(r=>({name:r.name,outcome:r.outcome,transactions:r.transactions.length})));
