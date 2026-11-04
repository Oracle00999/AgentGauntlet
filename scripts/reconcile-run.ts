import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {provider,view,rpcTransport,RPC_URL,readOnly} from '../packages/core/src/near.js';
import {NearVaultVerifier} from '../packages/core/src/near-target.js';
import {invoicePaymentId} from '../packages/core/src/near-verification.js';
process.loadEnvFile('.env');
const path=process.argv[2];if(!path)throw new Error('Provide a local report.json path');
const report=JSON.parse(await readFile(path,'utf8'));
const evidence:unknown[]=[];
try {
 assert.equal(await readOnly(()=>provider.getNetworkId()),'testnet');
 const verifier=new NearVaultVerifier(async(event,data)=>{evidence.push({event,data});});
 const attempts=[];
 for(const attempt of report.attempts??[]){
  const paymentId=invoicePaymentId(attempt.request);
  const contractId=report.environment?.contractId??report.targets?.paymentSystem.contractId;
  const vaultId=report.environment?.vaultId??report.vaultId;
  assert(typeof contractId==='string'&&typeof vaultId==='string');
  const state=await view(contractId,'get_payment',{vault_id:vaultId,payment_id:paymentId});
  let verification:unknown;
  if(attempt.submission?.transactionHash&&report.environment)try{verification=await verifier.verify(attempt.request,attempt.submission,report.environment);}catch{verification={status:'INCONCLUSIVE',reason:'Independent verification failed'};}
  attempts.push({attemptId:attempt.attemptId,paymentId,state,verification:verification??{status:'INCONCLUSIVE',reason:'No transaction reference; this state observation alone cannot prove settlement or permanent absence'}});
 }
 const output={runId:report.runId,observedAt:new Date().toISOString(),network:'testnet',rpcUrl:RPC_URL,attempts,evidence,limitations:'Read-only reconciliation. Original report is retained. No transactions were resubmitted.'};
 const destination=path.replace(/\.json$/,'.reconciliation.json');await writeFile(destination,JSON.stringify(output,null,2));console.log(destination);
}finally{await rpcTransport.close();}
