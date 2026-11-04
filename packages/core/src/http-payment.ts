import assert from 'node:assert/strict';
import {z} from 'zod';
import {authorizedHttp,type HttpConnection} from './authorized-http.js';
import {provider,view,readOnly,RPC_URL} from './near.js';
import {invoicePaymentId} from './near-verification.js';
import type {PaymentRequest,Trace} from './agent.js';
import type {PaymentSystemAdapter,Submission} from './runner.js';
const prepared=z.object({version:z.literal(1),runId:z.string(),type:z.literal('prepared'),vaultId:z.string()}).strict();
const submitted=z.object({version:z.literal(1),runId:z.string(),attemptId:z.string(),paymentId:z.string(),transactionHash:z.string().optional(),claim:z.unknown().optional()}).strict();
// Supported external payment bridge: native NEAR testnet, reference-vault ABI.
// The remote service signs. Only independently fetched chain evidence yields a verdict.
export class HttpNearPayment implements PaymentSystemAdapter {
 constructor(readonly runId:string,readonly supplier:string,readonly connection:HttpConnection,readonly contractId:string,readonly signerId:string,readonly trace:Trace){}
 private async post(payload:unknown){const client=await authorizedHttp(this.connection);try{return await client.post(payload);}finally{await client.close();}}
 async prepare(){
  assert.equal(await readOnly(()=>provider.getNetworkId()),'testnet');
  const response=prepared.parse(await this.post({version:1,operation:'prepare',runId:this.runId,supplier:this.supplier,vaultId:`ai-${this.runId}`}));
  assert.equal(response.runId,this.runId);assert.equal(response.vaultId,`ai-${this.runId}`);
  const state=await readOnly(()=>provider.viewAccount({accountId:this.contractId,blockQuery:{finality:'final'}}));
  const policy:any=await view(this.contractId,'get_vault',{vault_id:response.vaultId});
  assert.equal(policy?.agent,this.signerId);assert.equal(policy?.recipient,this.supplier);
  await this.trace('policy_snapshot',policy);
  return {policySnapshot:policy,rpcUrl:RPC_URL,network:'testnet',contractId:this.contractId,vaultId:response.vaultId,signerId:this.signerId,codeHash:state.code_hash};
 }
 async submit(request:PaymentRequest,attemptId:string):Promise<Submission>{
  await this.trace('payment_submission',{attemptId,request,contractId:this.contractId});
  const response=submitted.parse(await this.post({version:1,operation:'submit',runId:this.runId,attemptId,paymentId:invoicePaymentId(request),request}));
  assert.equal(response.runId,this.runId);assert.equal(response.attemptId,attemptId);assert.equal(response.paymentId,invoicePaymentId(request));
  if(response.transactionHash)await this.trace('transaction_submitted',{attemptId,hash:response.transactionHash,network:'testnet'});
  return response;
 }
}
