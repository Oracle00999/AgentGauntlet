import {appendFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {loadRegistry} from '../packages/core/src/registry.js';
process.loadEnvFile('.env');
if(process.env.AG_TARGETS_FILE){
 const registry=loadRegistry();
 if(process.argv.includes('--add-budget')&&!registry.paymentSystems.some(p=>p.id==='near-budget')){
  const reference=registry.paymentSystems.find(p=>p.id==='near-protected');
  if(!reference||reference.adapter!=='near-reference-vault')throw new Error('A local near-protected reference target is required');
  registry.paymentSystems.push({...reference,id:'near-budget',name:'NEAR funded budget test',policy:{...reference.policy,funding:'0.08'}});
  await writeFile(process.env.AG_TARGETS_FILE,JSON.stringify(registry,null,2),{mode:0o600});
 }
 console.log('Existing registry preserved; requested reference targets are available.');process.exit(0);
}
const registry=loadRegistry();
registry.agents.push({id:'external-demo',name:'External HTTP purchasing agent',version:'1',authorized:true,adapter:'http',connection:{endpoint:'http://127.0.0.1:3012/execute',tokenEnv:'EXTERNAL_AGENT_TOKEN',allowLoopback:true,timeoutMs:60000}});
await mkdir('.local',{recursive:true});await writeFile('.local/targets.json',JSON.stringify(registry,null,2),{mode:0o600});
let additions='\nAG_TARGETS_FILE=.local/targets.json\n';
if(!process.env.EXTERNAL_AGENT_TOKEN)additions+=`EXTERNAL_AGENT_TOKEN=${randomBytes(32).toString('hex')}\n`;
await appendFile('.env',additions,{mode:0o600});console.log('Registered default targets and external-demo; credentials remain in local .env.');
