import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString, nearToYocto } from 'near-api-js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

process.loadEnvFile('.env');
const provider = new JsonRpcProvider({url:'https://test.rpc.fastnear.com'});
assert.equal(await provider.getNetworkId(), 'testnet');
function account(role: string) {
  const id = process.env[`NEAR_${role}_ID`], key = process.env[`NEAR_${role}_KEY`];
  if (!id?.endsWith('.testnet') || !key) throw new Error(`Missing ${role} testnet credentials`);
  return new Account(id, provider, KeyPairSigner.fromSecretKey(key as KeyPairString));
}
const owner = account('OWNER'), agent = account('AGENT');
const supplier = process.env.NEAR_SUPPLIER_ID!;
assert(supplier?.endsWith('.testnet'));
const contractId = owner.accountId;
const call = (actor: Account, methodName: string, args: Record<string,unknown>, deposit = 0n) =>
  actor.callFunctionRaw({contractId,methodName,args,deposit,gas:100_000_000_000_000n,waitUntil:'FINAL'});

if (process.argv.includes('--deploy')) {
  await owner.deployContract(await readFile('target/wasm32-unknown-unknown/release/agentgauntlet_vault.wasm'));
  await call(owner,'new',{});
  console.log(`Deployed ${contractId}`);
}
const vault_id = `probe-${Date.now()}`;
await call(owner,'create_vault',{vault_id,agent:agent.accountId,recipient:supplier,max_payment:nearToYocto('0.025').toString(),daily_limit:nearToYocto('0.05').toString()},nearToYocto('0.1'));
await call(owner,'deposit',{vault_id},nearToYocto('0.1'));
await mkdir('artifacts',{recursive:true});
const evidence: unknown[] = [];
for (const [payment_id,recipient,amount,expected] of [
  ['denied-recipient',agent.accountId,'0.01','RECIPIENT_NOT_ALLOWED'],
  ['denied-limit',supplier,'0.04','TRANSACTION_LIMIT'],
  ['allowed',supplier,'0.01','ACCEPTED'],
] as const) {
  const args = {vault_id,payment_id,recipient,amount:nearToYocto(amount).toString()};
  const submitted = await call(agent,'request_payment',args);
  const outcome = await provider.viewTransactionStatusWithReceipts({txHash:submitted.transaction.hash,accountId:agent.accountId,waitUntil:'FINAL'});
  assert.equal(outcome.final_execution_status,'FINAL');
  assert(typeof outcome.status === 'object' && 'SuccessValue' in outcome.status,'Transaction failed');
  const events = outcome.receipts_outcome.filter(r => r.outcome.executor_id === contractId).flatMap(r => r.outcome.logs)
    .filter(log => log.startsWith('EVENT_JSON:')).map(log => JSON.parse(log.slice(11)));
  const decision = events.find(e => e.event === 'payment_decision' && e.data[0].payment_id === payment_id);
  assert.equal(decision?.data[0].code,expected);
  const payment = await provider.callFunction({contractId,method:'get_payment',args:{vault_id,payment_id},blockQuery:{finality:'final'}});
  if (expected === 'ACCEPTED') {
    assert.equal((payment as {status:string})?.status,'Settled');
    assert(outcome.receipts_outcome.some(r => r.outcome.executor_id === recipient &&
      typeof r.outcome.status === 'object' && 'SuccessValue' in r.outcome.status), 'Missing successful recipient receipt');
  }
  else assert.equal(payment,null);
  evidence.push({kind:'DIRECT_CONTRACT_PROBE',args,expected,outcome,payment,verifiedAt:new Date().toISOString()});
  await writeFile(`artifacts/${vault_id}.json`,JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?v.toString():v,2));
  console.log(`${payment_id}: ${expected} — ${submitted.transaction.hash}`);
}
console.log(`Verified evidence: artifacts/${vault_id}.json`);
