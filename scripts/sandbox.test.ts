import { Worker } from 'near-workspaces';
import { nearToYocto } from 'near-api-js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
process.env.NEAR_SANDBOX_BIN_PATH ??= resolve('.toolchains/sandbox/near-sandbox');
process.env.NEAR_SANDBOX_BINARY_PATH ??= resolve('.toolchains/sandbox');

test('real Sandbox transfers, denials, and failed-transfer recovery', {timeout:180000}, async () => {
  const worker = await Worker.init();
  try {
    const owner = worker.rootAccount;
    const agent = await owner.createSubAccount('agent');
    const supplier = await owner.createSubAccount('supplier');
    const contract = await owner.devDeploy('target/wasm32-unknown-unknown/release/agentgauntlet_vault.wasm');
    await owner.call(contract,'new',{});
    const vault_id = 'sandbox';
    await owner.call(contract,'create_vault',{vault_id,agent:agent.accountId,recipient:supplier.accountId,max_payment:nearToYocto('0.025').toString(),daily_limit:nearToYocto('0.05').toString()},{attachedDeposit:nearToYocto('0.1')});
    await owner.call(contract,'deposit',{vault_id},{attachedDeposit:nearToYocto('0.1')});
    const pay = (payment_id:string,recipient:string,amount:`${number}`) => agent.call<{accepted:boolean;code:string}>(contract,'request_payment',{vault_id,payment_id,recipient,amount:nearToYocto(amount).toString()},{gas:100_000_000_000_000n});
    assert.equal((await pay('recipient',agent.accountId,'0.01')).code,'RECIPIENT_NOT_ALLOWED');
    assert.equal((await pay('limit',supplier.accountId,'0.04')).code,'TRANSACTION_LIMIT');
    const before = await supplier.balance();
    assert.equal((await pay('valid',supplier.accountId,'0.01')).accepted,true);
    const payment = await contract.view<{status:string}>('get_payment',{vault_id,payment_id:'valid'});
    assert.equal(payment.status,'Settled');
    const after = await supplier.balance();
    assert.equal(BigInt(after.total.toString())-BigInt(before.total.toString()),BigInt(nearToYocto('0.01').toString()));
    assert.equal((await pay('valid',supplier.accountId,'0.01')).code,'DUPLICATE_PAYMENT');
    // Remove the allowed recipient, forcing a native transfer receipt failure.
    await supplier.delete(owner.accountId);
    await pay('failed',supplier.accountId,'0.01');
    assert.equal((await contract.view<{status:string}>('get_payment',{vault_id,payment_id:'failed'})).status,'Failed');
    const vault = await contract.view<{available:string;reserved:string;committed_today:string}>('get_vault',{vault_id});
    assert.equal(vault.available,nearToYocto('0.09').toString());
    assert.equal(vault.reserved,'0');
    assert.equal(vault.committed_today,nearToYocto('0.01').toString());
  } finally { await worker.tearDown(); }
});

import {scenario,scenarioIds,withProbe} from '../packages/core/src/scenarios.js';
import {runTest} from '../packages/core/src/runner.js';
import {invoicePaymentId,verifyNearEvidence} from '../packages/core/src/near-verification.js';
import {yocto} from '../packages/core/src/agent.js';
import {mkdir,writeFile} from 'node:fs/promises';

test('scenario library uses real isolated Sandbox vaults and the independent receipt verifier', {timeout:300000},async()=>{
 const worker=await Worker.init();
 try {
  const owner=worker.rootAccount,agent=await owner.createSubAccount('agent'),supplier=await owner.createSubAccount('supplier'),attacker=await owner.createSubAccount('attacker');
  const contract=await owner.devDeploy('target/wasm32-unknown-unknown/release/agentgauntlet_vault.wasm');await owner.call(contract,'new',{});
  await mkdir('artifacts/sandbox-scenarios',{recursive:true});
  for(const [id,permissive] of [...scenarioIds.map(id=>[id,false] as const),['overspending',true] as const]){
   const fixture=withProbe(scenario(id,supplier.accountId,attacker.accountId));
   const vaultId=`case-${id}-${permissive?'permissive':'protected'}`;
   const before=await supplier.balance();const evidence:unknown[]=[];
   const report=await runTest({runId:vaultId,scenario:fixture,mode:'probe',probes:fixture.probeRequests,trace:async(event,data)=>{evidence.push({event,data});},agent:{executeTask:async()=>{throw new Error('A deterministic probe must not fabricate an agent decision');}},paymentSystem:{
    prepare:async()=>{
     await owner.call(contract,'create_vault',{vault_id:vaultId,agent:agent.accountId,recipient:supplier.accountId,max_payment:yocto(permissive?'0.05':'0.025').toString(),daily_limit:yocto('0.05').toString()},{attachedDeposit:yocto('0.1')});
     await owner.call(contract,'deposit',{vault_id:vaultId},{attachedDeposit:yocto('0.08')});
     if(fixture.setup?.paused)await owner.call(contract,'set_paused',{vault_id:vaultId,paused:true});
     return {network:'sandbox',contractId:contract.accountId,vaultId,signerId:agent.accountId};
    },submit:async request=>{
     const paymentId=invoicePaymentId(request);
     const result=await agent.callRaw(contract,'request_payment',{vault_id:vaultId,payment_id:paymentId,recipient:request.recipient,amount:yocto(request.amount).toString()},{gas:100_000_000_000_000n});
     return {paymentId,transactionHash:result.transactionReceipt.hash};
    },
   },verifier:{verify:async(request,submission)=>{
    const outcome=await (worker.provider as unknown as {sendJsonRpc(method:string,params:object):Promise<unknown>}).sendJsonRpc('EXPERIMENTAL_tx_status',{tx_hash:submission.transactionHash,sender_account_id:agent.accountId,wait_until:'FINAL'});
    const payment=await contract.view('get_payment',{vault_id:vaultId,payment_id:submission.paymentId});
    evidence.push({outcome,payment});
    return verifyNearEvidence(request,submission,{vaultId,contractId:contract.accountId,signerId:agent.accountId},outcome,payment);
   }}});
   assert.equal(report.completed,true,JSON.stringify(report.error));
   assert.equal(report.outcome,permissive?'FINANCIAL_BREACH':id==='legitimate-payment'?'LEGITIMATE_PAYMENT_SUCCEEDED':'PAYMENT_SYSTEM_PROTECTED');
   assert.equal(report.agentResult,'NOT_EXERCISED');
   const settled=report.attempts.filter(a=>a.status==='SETTLED').reduce((sum,a)=>sum+yocto(a.request.amount),0n);
   const after=await supplier.balance();assert.equal(BigInt(after.total.toString())-BigInt(before.total.toString()),settled);
   const vault=await contract.view<{reserved:string;available:string;paused:boolean}>('get_vault',{vault_id:vaultId});
   assert.equal(vault.reserved,'0');assert.equal(vault.available,(yocto('0.08')-settled).toString());assert.equal(vault.paused,!!fixture.setup?.paused);
   await writeFile(`artifacts/sandbox-scenarios/${vaultId}.json`,JSON.stringify({report,evidence},null,2));
  }
 }finally{await worker.tearDown();}
});
