import {publicAddress,HttpConnection} from './authorized-http.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRegistry,selectTargets} from './registry.js';
import {HttpNearPayment} from './http-payment.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {HttpAgent} from './http-agent.js';
import {runTest} from './runner.js';
import {scenario} from './scenarios.js';
test('separate-process HTTP agent executes through unchanged generic runner; unsafe endpoints and protocol failures fail closed',async()=>{
 for(const address of ['10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','::1'])assert.equal(publicAddress(address),false);
 assert.equal(publicAddress('8.8.8.8'),true);
 assert.throws(()=>HttpConnection.parse({endpoint:'https://user:password@example.com',tokenEnv:'EXAMPLE_TOKEN'}));
 assert.throws(()=>HttpConnection.parse({endpoint:'https://example.com?token=secret',tokenEnv:'EXAMPLE_TOKEN'}));
 assert.throws(()=>HttpConnection.parse({endpoint:'https://example.com',tokenEnv:'API_TOKEN'}));
 assert.throws(()=>HttpConnection.parse({endpoint:'https://example.com',tokenEnv:'OPENAI_API_KEY'}));
 process.env.EXTERNAL_TEST_TOKEN='unit-only-token-'.repeat(4);
 const directory=await mkdtemp(join(tmpdir(),'agentgauntlet-http-'));const priorRegistry=process.env.AG_TARGETS_FILE;
 const child=fork('tests/fixtures/http-agent.mjs',{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
 try {
  const port=await new Promise<number>((resolve,reject)=>{child.once('message',(m:any)=>resolve(m.port));child.once('error',reject);child.once('exit',()=>reject(new Error('Fixture exited before ready')));});
  const registry=loadRegistry();
  registry.agents.push({id:'independent-fixture',name:'Independent fixture',version:'1',authorized:true,adapter:'http',connection:{endpoint:`http://127.0.0.1:${port}/`,tokenEnv:'EXTERNAL_TEST_TOKEN',allowLoopback:true,timeoutMs:1500}});
  const registryFile=join(directory,'targets.json');await writeFile(registryFile,JSON.stringify(registry));process.env.AG_TARGETS_FILE=registryFile;
  const selected=selectTargets(loadRegistry(),'independent-fixture');assert.equal(selected.agent.adapter,'http');
  let submissions=0;
  const run=async(path:string,endpoint=`http://127.0.0.1:${port}${path}`)=>runTest({runId:'unit-http-run',scenario:scenario('legitimate-payment','supplier.testnet','attacker.testnet'),trace:async()=>{},
   agent:new HttpAgent({...('connection' in selected.agent?selected.agent.connection:undefined)!,endpoint}),
   paymentSystem:{prepare:async()=>({network:'unit-test'}),submit:async()=>{submissions++;return {paymentId:'unit-only'};}},
   verifier:{verify:async()=>({code:'UNIT_ONLY',status:'SETTLED',transactionHash:'unit-only',paymentId:'unit-only'})}});
  assert.equal((await run('/')).outcome,'LEGITIMATE_PAYMENT_SUCCEEDED');assert.equal(submissions,1);
  for(const path of ['/redirect','/invalid','/large','/timeout','/mismatch']){assert.equal((await run(path)).outcome,'INCONCLUSIVE');assert.equal(submissions,1);}
  assert.equal((await run('/conflict')).outcome,'INCONCLUSIVE');assert.equal(submissions,2);
  assert.equal((await run('/repeat')).outcome,'INCONCLUSIVE');assert.equal(submissions,3);
  assert.equal((await run('/','http://169.254.169.254/')).outcome,'INCONCLUSIVE');assert.equal(submissions,3);
  assert.equal((await run('/pending')).outcome,'LEGITIMATE_PAYMENT_SUCCEEDED');assert.equal(submissions,4);
  const payment=new HttpNearPayment('unit-http-run','supplier.testnet',{endpoint:`http://127.0.0.1:${port}/payment-claim`,tokenEnv:'EXTERNAL_TEST_TOKEN',allowLoopback:true,timeoutMs:1500},'contract.testnet','agent.testnet',async()=>{});
  const claim=await payment.submit({recipient:'supplier.testnet',amount:'0.01',invoiceId:'invoice',reason:'unit-only'},'unit-attempt');
  assert.equal(claim.transactionHash,undefined);assert.deepEqual(claim.claim,{status:'SETTLED'});
  const unauthorized=await fetch(`http://127.0.0.1:${port}/`,{method:'POST',body:'{}'});assert.equal(unauthorized.status,401);
 } finally {child.kill();if(priorRegistry===undefined)delete process.env.AG_TARGETS_FILE;else process.env.AG_TARGETS_FILE=priorRegistry;await rm(directory,{recursive:true,force:true});}
});
