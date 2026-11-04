import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, type KeyPairString } from 'near-api-js';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Agent, fetch, setGlobalDispatcher } from 'undici';
import { yocto, type PaymentRequest, type PaymentResult, type Trace } from './agent.js';

// NEAR's client uses Node fetch. The network here sometimes needs more than
// Node's default 10 seconds to establish a connection.
export const rpcTransport = new Agent({connect:{timeout:30_000,family:4},headersTimeout:60_000,bodyTimeout:60_000});
setGlobalDispatcher(rpcTransport);
// near-api-js calls global fetch and offers no per-client fetch injection.
// Use the matching implementation, as with the OpenAI client's transport.
globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
export const RPC_URL='https://test.rpc.fastnear.com';
export const provider = new JsonRpcProvider({url:RPC_URL});
export function account(role: string, keyName = `NEAR_${role}_KEY`) {
  const id=process.env[`NEAR_${role}_ID`],key=process.env[keyName];
  if (!id?.endsWith('.testnet') || !key) throw new Error(`Missing testnet ${role} configuration`);
  return new Account(id,provider,KeyPairSigner.fromSecretKey(key as KeyPairString));
}
export async function readOnly<T>(operation:()=>Promise<T>):Promise<T> {
  for(let attempt=0;;attempt++)try{return await operation();}catch(error){
    const e=error as {cause?:{code?:string};code?:string};
    if(attempt>=2||!['UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(e.cause?.code??e.code??''))throw error;
    await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
  }
}
export async function verifyRestrictedKey(contractId: string) {
  assert.equal(await readOnly(()=>provider.getNetworkId()),'testnet');
  const key = KeyPair.fromString(process.env.NEAR_AGENT_PAYMENT_KEY as KeyPairString);
  const access = await readOnly(()=>provider.viewAccessKey({accountId:process.env.NEAR_AGENT_ID!,publicKey:key.getPublicKey(),finalityQuery:{finality:'final'}}));
  assert(typeof access.permission === 'object' && 'FunctionCall' in access.permission,'Payment key must be restricted');
  assert.equal(access.permission.FunctionCall.receiver_id,contractId);
  assert.deepEqual(access.permission.FunctionCall.method_names,['request_payment']);
}
export async function call(actor:Account,contractId:string,methodName:string,args:Record<string,unknown>,deposit=0n) {
  return actor.callFunctionRaw({contractId,methodName,args,deposit,gas:100_000_000_000_000n,waitUntil:'FINAL'});
}
export async function view(contractId:string,method:string,args:Record<string,unknown>) {
  return readOnly(()=>provider.callFunction({contractId,method,args,blockQuery:{finality:'final'}}));
}
export function paymentAdapter(agent:Account,contractId:string,vaultId:string,trace:Trace) {
  return async (request:PaymentRequest):Promise<PaymentResult> => {
    // Invoice identity, not the model's tool-call ID, prevents duplicate payouts.
    const paymentId=createHash('sha256').update(request.invoiceId).digest('hex');
    const args={vault_id:vaultId,payment_id:paymentId,recipient:request.recipient,amount:yocto(request.amount).toString()};
    await trace('payment_submission',{contractId,agent:agent.accountId,args});
    // No application retry after ambiguous submission. Inspect saved state/hash.
    const submitted=await call(agent,contractId,'request_payment',args);
    await trace('transaction_submitted',{hash:submitted.transaction.hash});
    const outcome=await provider.viewTransactionStatusWithReceipts({txHash:submitted.transaction.hash,accountId:agent.accountId,waitUntil:'FINAL'});
    const payment=await view(contractId,'get_payment',{vault_id:vaultId,payment_id:paymentId});
    await trace('chain_evidence',{outcome,payment});
    assert.equal(outcome.final_execution_status,'FINAL');
    assert(typeof outcome.status==='object' && 'SuccessValue' in outcome.status,'Contract transaction failed');
    const events=outcome.receipts_outcome.filter(r=>r.outcome.executor_id===contractId).flatMap(r=>r.outcome.logs)
      .filter(log=>log.startsWith('EVENT_JSON:')).map(log=>JSON.parse(log.slice(11)));
    const decision=events.find(e=>e.event==='payment_decision' && e.data[0]?.payment_id===paymentId)?.data[0]?.code;
    assert(typeof decision==='string','Missing contract decision');
    if(decision!=='ACCEPTED') return {code:decision,status:'DENIED',paymentId,transactionHash:submitted.transaction.hash};
    const status=(payment as {status?:string}|null)?.status;
    assert(status==='Settled' || status==='Failed','Transfer remains unresolved');
    if(status==='Settled') assert(outcome.receipts_outcome.some(r=>r.outcome.executor_id===request.recipient && typeof r.outcome.status==='object' && 'SuccessValue' in r.outcome.status),'Missing transfer receipt');
    return {code:decision,status:status==='Settled'?'SETTLED':'FAILED',paymentId,transactionHash:submitted.transaction.hash};
  };
}
