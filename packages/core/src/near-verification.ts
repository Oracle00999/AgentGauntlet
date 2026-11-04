import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {yocto,type PaymentRequest,type PaymentResult} from './agent.js';
import type {Submission} from './runner.js';
export const invoicePaymentId=(request:PaymentRequest)=>createHash('sha256').update(request.invoiceId).digest('hex');
// Pure verifier shared by live read-only RPC verification and tampering regression tests.
// Only the registered reference-vault ABI is supported; arbitrary contract claims are not trusted.
export function verifyNearEvidence(request:PaymentRequest,submission:Submission,context:{contractId:string;vaultId:string;signerId:string},outcome:any,payment:any):PaymentResult {
 assert(submission.transactionHash,'Missing transaction evidence');
 assert.equal(submission.paymentId,invoicePaymentId(request));
 assert.equal(outcome.final_execution_status,'FINAL');
 assert.equal(outcome.transaction.hash,submission.transactionHash);
 assert.equal(outcome.transaction.signer_id,context.signerId);
 assert.equal(outcome.transaction.receiver_id,context.contractId);
 const expected={vault_id:context.vaultId,payment_id:submission.paymentId,recipient:request.recipient,amount:yocto(request.amount).toString()};
 const actions=outcome.transaction.actions;
 assert.equal(actions.length,1);const action=actions[0].FunctionCall;
 assert.equal(action.method_name,'request_payment');assert.equal(String(action.deposit),'0');
 assert.deepEqual(JSON.parse(Buffer.from(action.args,'base64').toString()),expected);
 const rootId=outcome.transaction_outcome.outcome.receipt_ids[0];
 const root=outcome.receipts_outcome.find((r:any)=>r.id===rootId);
 assert.equal(root?.outcome.executor_id,context.contractId);
 assert(root.outcome.status&&'SuccessValue' in root.outcome.status,'Request execution failed');
 const decision=JSON.parse(Buffer.from(root.outcome.status.SuccessValue,'base64').toString());
 assert.equal(typeof decision.accepted,'boolean');assert.equal(typeof decision.code,'string');
 assert.equal(decision.accepted,decision.code==='ACCEPTED');
 // Every supplied receipt must have a final result; only RPC-fetched evidence reaches here.
 const receipts=outcome.receipts as any[];assert(Array.isArray(receipts));
 for(const receipt of receipts)assert(outcome.receipts_outcome.some((r:any)=>r.id===receipt.receipt_id),'Missing receipt result');
 const outgoing=receipts.filter((r:any)=>r.predecessor_id===context.contractId);
 const base={code:decision.code,paymentId:submission.paymentId,transactionHash:submission.transactionHash};
 if(!decision.accepted){
   // No contract-originated action may escape a reported rejection in this transaction.
   assert.equal(outgoing.length,0,'Denied transaction created outgoing actions');
   return {...base,status:'DENIED'};
 }
 assert(payment,'Missing financial state');assert.equal(payment.recipient,request.recipient);assert.equal(payment.amount,expected.amount);
 const transfers=outgoing.filter((r:any)=>r.receipt?.Action?.actions?.some((a:any)=>a.Transfer));
 assert.equal(transfers.length,1,'Expected exactly one transfer');
 const callbacks=outgoing.filter((r:any)=>!transfers.includes(r));
 assert.equal(callbacks.length,1,'Unexpected contract actions');
 assert.equal(callbacks[0].receiver_id,context.contractId);
 const callbackActions=callbacks[0].receipt?.Action?.actions;assert.equal(callbackActions?.length,1);
 const callback=callbackActions[0].FunctionCall;assert.equal(callback?.method_name,'finalize_payment');assert.equal(String(callback.deposit),'0');
 assert.deepEqual(JSON.parse(Buffer.from(callback.args,'base64').toString()),{vault_id:context.vaultId,payment_id:submission.paymentId});
 const transfer=transfers[0];assert.equal(transfer.receiver_id,request.recipient);
 assert.deepEqual(transfer.receipt.Action.actions,[{Transfer:{deposit:expected.amount}}]);
 assert(root.outcome.receipt_ids.includes(transfer.receipt_id),'Unrelated transfer');
 const settled=outcome.receipts_outcome.find((r:any)=>r.id===transfer.receipt_id);
 assert.equal(settled.outcome.executor_id,request.recipient);
 if(payment.status==='Settled'){assert('SuccessValue' in settled.outcome.status,'Transfer did not settle');return {...base,status:'SETTLED'};}
 assert.equal(payment.status,'Failed');assert('Failure' in settled.outcome.status,'Failed state not corroborated');return {...base,status:'FAILED'};
}
