import assert from 'node:assert/strict';
import {account,call,view,provider,verifyRestrictedKey,readOnly,RPC_URL} from './near.js';
import {yocto,type Trace,type PaymentRequest} from './agent.js';
import type {PaymentSystemAdapter,OutcomeVerifier,Submission,PaymentEnvironment} from './runner.js';
import {invoicePaymentId,verifyNearEvidence} from './near-verification.js';
export type NearPolicy={funding:string;maxPayment:string;dailyLimit:string;storageDeposit:string};
export class NearVaultTarget implements PaymentSystemAdapter {
 constructor(readonly runId:string,readonly supplier:string,readonly policy:NearPolicy,readonly trace:Trace,readonly contractId=process.env.NEAR_OWNER_ID!,readonly setup:{paused?:boolean}={}){ }
 async prepare(){
  const owner=account('OWNER'),agent=account('AGENT','NEAR_AGENT_PAYMENT_KEY'),vaultId=`ai-${this.runId}`;
  await verifyRestrictedKey(this.contractId);
  const state=await readOnly(()=>provider.viewAccount({accountId:this.contractId,blockQuery:{finality:'final'}}));
  await this.trace('environment_preparation',{phase:'create_vault',vaultId,contractId:this.contractId});
  await call(owner,this.contractId,'create_vault',{vault_id:vaultId,agent:agent.accountId,recipient:this.supplier,max_payment:yocto(this.policy.maxPayment).toString(),daily_limit:yocto(this.policy.dailyLimit).toString()},yocto(this.policy.storageDeposit));
  await this.trace('environment_preparation',{phase:'deposit',vaultId,contractId:this.contractId});
  await call(owner,this.contractId,'deposit',{vault_id:vaultId},yocto(this.policy.funding));
  if(this.setup.paused)await call(owner,this.contractId,'set_paused',{vault_id:vaultId,paused:true});
  const policySnapshot=await view(this.contractId,'get_vault',{vault_id:vaultId});
  await this.trace('policy_snapshot',policySnapshot);
  return {policySnapshot,rpcUrl:RPC_URL,network:'testnet',contractId:this.contractId,vaultId,signerId:agent.accountId,codeHash:state.code_hash};
 }
 async submit(request:PaymentRequest,attemptId:string):Promise<Submission>{
  const agent=account('AGENT','NEAR_AGENT_PAYMENT_KEY'),paymentId=invoicePaymentId(request);
  const args={vault_id:`ai-${this.runId}`,payment_id:paymentId,recipient:request.recipient,amount:yocto(request.amount).toString()};
  await this.trace('payment_submission',{attemptId,contractId:this.contractId,agent:agent.accountId,args});
  const submitted=await call(agent,this.contractId,'request_payment',args);
  await this.trace('transaction_submitted',{hash:submitted.transaction.hash,attemptId,network:'testnet'});
  return {paymentId,transactionHash:submitted.transaction.hash};
 }
}
export class NearVaultVerifier implements OutcomeVerifier {
 constructor(readonly trace:Trace){}
 async verify(request:PaymentRequest,submission:Submission,environment:PaymentEnvironment){
  assert.equal(environment.network,'testnet');assert.equal(await readOnly(()=>provider.getNetworkId()),'testnet');
  const {contractId,vaultId,signerId,codeHash}=environment;
  assert(typeof contractId==='string'&&typeof vaultId==='string'&&typeof signerId==='string');
  assert(submission.transactionHash,'Missing transaction hash');
  const outcome=await readOnly(()=>provider.viewTransactionStatusWithReceipts({txHash:submission.transactionHash!,accountId:signerId,waitUntil:'FINAL'}));
  const payment=await view(contractId,'get_payment',{vault_id:vaultId,payment_id:submission.paymentId});
  const state=await readOnly(()=>provider.viewAccount({accountId:contractId,blockQuery:{finality:'final'}}));
  await this.trace('chain_evidence',{outcome,payment,codeHash:state.code_hash,verifier:'near-reference-vault-v2',rpcUrl:RPC_URL,observedAt:new Date().toISOString()});
  assert.equal(state.code_hash,codeHash,'Contract changed during execution');
  return verifyNearEvidence(request,submission,{contractId,vaultId,signerId},outcome,payment);
 }
}
