import { randomUUID } from 'node:crypto';
process.loadEnvFile('.env');
const base=`http://127.0.0.1:${process.env.PORT||3001}`;
const replay=process.argv[2]==='--replay';
const watch=process.argv[2]==='--watch';
const parent=process.argv[3];
if((replay||watch) && !/^[0-9a-f-]{36}$/i.test(parent??''))throw new Error('Provide a run UUID');
const headers={authorization:`Bearer ${process.env.API_TOKEN}`,'content-type':'application/json','idempotency-key':randomUUID()};
const option=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]!;};
let run:{id:string};
if(watch) run={id:parent!};
else {
const response=await fetch(`${base}/api/test-runs${replay?`/${parent}/replay`:''}`,{
  method:'POST',headers,body:JSON.stringify(replay?{}:{scenarioId:process.argv[2]||'malicious-invoice',agentId:option('--agent','shoppingbot'),paymentSystemId:option('--payment-system','near-protected'),mode:process.argv.includes('--probe')?'probe':'agent'}),
});
if(!response.ok)throw new Error(`API returned ${response.status}`);
run=await response.json() as {id:string};
}
console.log(`Run: ${run.id}`);
let cursor=0;
for(;;) {
  const eventsResponse=await fetch(`${base}/api/test-runs/${run.id}/events?after=${cursor}`,{headers});
  if(!eventsResponse.ok)throw new Error(`Event query failed: ${eventsResponse.status}. Run remains saved as ${run.id}`);
  const events=await eventsResponse.json() as {seq:number;event:string}[];
  for(const event of events){cursor=event.seq;console.log(`${event.seq}: ${event.event}`);}
  const currentResponse=await fetch(`${base}/api/test-runs/${run.id}`,{headers});
  if(!currentResponse.ok)throw new Error(`Run query failed: ${currentResponse.status}`);
  const current=await currentResponse.json() as {status:string};
  if(['COMPLETED','FAILED'].includes(current.status)) {
    const reportResponse=await fetch(`${base}/api/test-runs/${run.id}/report`,{headers});
    if(!reportResponse.ok)throw new Error(`Report query failed: ${reportResponse.status}`);
    const report=await reportResponse.json() as {outcome:string};
    console.log(`${current.status}: ${report.outcome}`);
    console.log(`Report endpoint: /api/test-runs/${run.id}/report`);
    if(current.status==='FAILED')process.exitCode=1;
    break;
  }
  await new Promise(resolve=>setTimeout(resolve,1000));
}
