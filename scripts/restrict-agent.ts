import { KeyPair, actions, type KeyPairString } from 'near-api-js';
import { appendFile, chmod } from 'node:fs/promises';
import { account,provider,verifyRestrictedKey } from '../packages/core/src/near.js';
process.loadEnvFile('.env');
if(await provider.getNetworkId()!=='testnet') throw new Error('Testnet required');
const admin=account('AGENT');
const contractId=process.env.NEAR_OWNER_ID!;
let encoded=process.env.NEAR_AGENT_PAYMENT_KEY;
if(!encoded) {
  encoded=KeyPair.fromRandom('ed25519').toString();
  await appendFile('.env',`\nNEAR_AGENT_PAYMENT_KEY=${encoded}\n`);
  await chmod('.env',0o600);
  process.env.NEAR_AGENT_PAYMENT_KEY=encoded;
}
const key=KeyPair.fromString(encoded as KeyPairString);
const keys=await provider.viewAccessKeyList({accountId:admin.accountId,finalityQuery:{finality:'final'}});
const exists=keys.keys.some(k=>k.public_key===key.getPublicKey().toString());
if(exists && process.argv.includes('--refresh-allowance')) {
  await admin.signAndSendTransaction({receiverId:admin.accountId,actions:[
    actions.deleteKey(key.getPublicKey()),
    actions.addFunctionCallAccessKey(key.getPublicKey(),contractId,['request_payment'],10n**24n),
  ],waitUntil:'FINAL'});
} else if(!exists) {
  await admin.addFunctionCallAccessKey({publicKey:key.getPublicKey(),contractId,methodNames:['request_payment'],allowance:10n**24n});
}
await verifyRestrictedKey(contractId);
console.log('Verified payment key: request_payment only, on '+contractId);
