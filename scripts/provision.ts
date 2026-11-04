import { KeyPair } from 'near-api-js';
import { readFile, writeFile } from 'node:fs/promises';

// Persist keys BEFORE requesting account creation so interrupted requests do not
// leave a funded account without its recovery key. Never print secret material.
let entries: Record<string, string> = {};
try { entries = Object.fromEntries((await readFile('.env', 'utf8')).split('\n').filter(x => x.includes('=')).map(x => { const i=x.indexOf('='); return [x.slice(0,i),x.slice(i+1)]; })); }
catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const suffix = Date.now().toString(36);
for (const role of ['OWNER', 'AGENT', 'SUPPLIER'] as const) {
  const idName = `NEAR_${role}_ID`, keyName = `NEAR_${role}_KEY`;
  if (entries[idName]) { console.log(`${role}: already configured (${entries[idName]})`); continue; }
  const key = KeyPair.fromRandom('ed25519');
  const id = `ag-${role.toLowerCase()}-${suffix}.testnet`;
  entries[idName] = id; entries[keyName] = key.toString();
  await writeFile('.env', Object.entries(entries).map(([k,v]) => `${k}=${v}`).join('\n')+'\n', {mode:0o600});
  const response = await fetch('https://helper.testnet.near.org/account', {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({newAccountId:id,newAccountPublicKey:key.getPublicKey().toString()}),
    signal:AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Faucet returned ${response.status} for ${id}; saved key retained. Verify account before retrying.`);
  console.log(`Created ${role}: ${id}`);
}
