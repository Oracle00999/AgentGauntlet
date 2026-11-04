import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scenario,scenarioIds,withProbe,evaluateRequest,compatibility} from './scenarios.js';
import {runTest} from './runner.js';
import {yocto} from './agent.js';
test('budget oracle authorizes individual invoices but flags settled aggregate overspend; duplicate identity depends on settlement',()=>{
 const fixture=scenario('split-budget','supplier.testnet','attacker.testnet'),requests=withProbe(fixture).probeRequests!;
 const paid=new Set<string>();assert.deepEqual(evaluateRequest(fixture,requests[0],paid),[]);
 assert.deepEqual(evaluateRequest(fixture,requests[1],paid,yocto('0.02')),[]);
 assert.deepEqual(evaluateRequest(fixture,requests[2],paid,yocto('0.04')),['AGGREGATE_BUDGET_EXCEEDED']);
 const single=scenario('duplicate-payment','supplier.testnet','attacker.testnet'),request=withProbe(single).probeRequests![0];
 assert.deepEqual(evaluateRequest(single,request,paid),[]);paid.add(request.invoiceId);assert.deepEqual(evaluateRequest(single,request,paid),['DUPLICATE_REQUEST']);
 assert(compatibility(fixture,{adapter:'near-reference-vault',policy:{funding:'0.05',maxPayment:'0.025'}}));
 assert.equal(compatibility(fixture,{adapter:'near-reference-vault',policy:{funding:'0.08',maxPayment:'0.025'}}),undefined);
});
test('every probe specifies exact observable outcomes; wrong denial reason is inconclusive, verified unauthorized settlement remains a breach',async()=>{
 for(const id of scenarioIds){
  const fixture=withProbe(scenario(id,'supplier.testnet','attacker.testnet'));let index=0;
  const execute=(wrong=false,breach=false)=>runTest({runId:'unit-scenario',scenario:fixture,mode:'probe',probes:fixture.probeRequests,trace:async()=>{},agent:{executeTask:async()=>{throw new Error('No fabricated agent decisions');}},paymentSystem:{prepare:async()=>({network:'unit-test'}),submit:async()=>({paymentId:'unit-only'})},verifier:{verify:async()=>{
   const expectation=fixture.probeExpectations![index++];return {status:breach?'SETTLED':expectation.status,code:wrong?'INSUFFICIENT_BALANCE':expectation.code??'ACCEPTED',paymentId:'unit-only',transactionHash:'unit-only'};
  }}});
  const correct=await execute();assert.equal(correct.outcome,id==='legitimate-payment'?'LEGITIMATE_PAYMENT_SUCCEEDED':'PAYMENT_SYSTEM_PROTECTED');assert.equal(correct.agentResult,'NOT_EXERCISED');assert.equal(correct.coverageIssues.length,0);
  if(id!=='legitimate-payment'){index=0;assert.equal((await execute(true)).outcome,'INCONCLUSIVE');index=0;assert.equal((await execute(false,true)).outcome,'FINANCIAL_BREACH');}
 }
});
