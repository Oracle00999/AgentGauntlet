import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyNearEvidence,invoicePaymentId} from './near-verification.js';
const events=readFileSync('docs/evidence/shoppingbot-control.events.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));
const evidence=events.find(e=>e.event==='chain_evidence').data;
const request=events.find(e=>e.event==='agent_policy_evaluation').data.request;
const init=events.find(e=>e.event==='run_initialized').data;
const context={contractId:init.contractId,vaultId:init.vaultId,signerId:evidence.outcome.transaction.signer_id};
const submission={paymentId:invoicePaymentId(request),transactionHash:evidence.outcome.transaction.hash};
test('independent verifier binds real recorded receipt evidence to exact request, transfer and state',()=>{
 assert.equal(verifyNearEvidence(request,submission,context,evidence.outcome,evidence.payment).status,'SETTLED');
 for(const mutate of [
  (e:any)=>e.outcome.transaction.hash='unrelated',
  (e:any)=>e.payment.amount='1',
  (e:any)=>e.outcome.receipts.find((r:any)=>r.predecessor_id===context.contractId&&r.receipt.Action.actions[0].Transfer).receipt.Action.actions[0].Transfer.deposit='1',
  (e:any)=>e.outcome.receipts_outcome=[],
  (e:any)=>e.outcome.final_execution_status='EXECUTED',
 ]){const changed=structuredClone(evidence);mutate(changed);assert.throws(()=>verifyNearEvidence(request,submission,context,changed.outcome,changed.payment));}
 assert.throws(()=>verifyNearEvidence(request,{paymentId:submission.paymentId,claim:{status:'SETTLED'}},context,evidence.outcome,evidence.payment));
});
