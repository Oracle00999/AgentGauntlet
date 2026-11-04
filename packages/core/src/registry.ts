import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {HttpConnection} from './http-agent.js';
import {demoPolicy} from './config.js';
const id=z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const base={id,name:z.string().min(1).max(100),version:z.string().min(1).max(64),authorized:z.literal(true)};
const AgentConfig=z.discriminatedUnion('adapter',[
 z.object({...base,adapter:z.literal('shoppingbot'),model:z.string().min(1).max(100)}).strict(),
 z.object({...base,adapter:z.literal('http'),connection:HttpConnection}).strict(),
]);
const amount=z.string().regex(/^(0|[1-9]\d*)(\.\d{1,24})?$/);
const account=z.string().endsWith('.testnet');
const NearConfiguration={...base,network:z.literal('testnet'),contractId:account,signerId:account,
 verifier:z.literal('near-reference-vault-v2'),policy:z.object({funding:amount,maxPayment:amount,dailyLimit:amount,storageDeposit:amount}).strict()};
const PaymentConfig=z.discriminatedUnion('adapter',[
 z.object({...NearConfiguration,adapter:z.literal('near-reference-vault')}).strict(),
 z.object({...NearConfiguration,adapter:z.literal('http-near-vault'),connection:HttpConnection}).strict(),
]);
export const RegistrySchema=z.object({version:z.literal(1),agents:z.array(AgentConfig).min(1),paymentSystems:z.array(PaymentConfig).min(1)}).strict();
export type Registry=z.infer<typeof RegistrySchema>;
export const SnapshotSchema=z.object({version:z.literal(1),agent:AgentConfig,paymentSystem:PaymentConfig,mode:z.enum(['agent','probe'])}).strict();
export type TargetSnapshot=z.infer<typeof SnapshotSchema>;
export function loadRegistry(model=process.env.OPENAI_MODEL||'gpt-4.1-mini-2025-04-14',signerId=process.env.NEAR_AGENT_ID||'agent.testnet'):Registry {
 const reference={name:'NEAR reference vault',version:'1',authorized:true,adapter:'near-reference-vault',network:'testnet',contractId:process.env.NEAR_OWNER_ID||'owner.testnet',signerId,verifier:'near-reference-vault-v2',policy:demoPolicy};
 const defaults={version:1,agents:[{id:'shoppingbot',name:'ShoppingBot',version:'1',authorized:true,adapter:'shoppingbot',model}],paymentSystems:[{...reference,id:'near-protected'},{...reference,id:'near-permissive',name:'NEAR permissive reference',policy:{...demoPolicy,maxPayment:'0.05'}},{...reference,id:'near-budget',name:'NEAR funded budget test',policy:{...demoPolicy,funding:'0.08'}}]};
 const registry=RegistrySchema.parse(process.env.AG_TARGETS_FILE?JSON.parse(readFileSync(process.env.AG_TARGETS_FILE,'utf8')):defaults);
 for(const list of [registry.agents,registry.paymentSystems])if(new Set(list.map(t=>t.id)).size!==list.length)throw new Error('Duplicate target IDs');
 return registry;
}
export function selectTargets(registry:Registry,agentId='shoppingbot',paymentSystemId='near-protected',mode:'agent'|'probe'='agent'):TargetSnapshot {
 const agent=registry.agents.find(a=>a.id===agentId),paymentSystem=registry.paymentSystems.find(p=>p.id===paymentSystemId);
 if(!agent||!paymentSystem)throw new Error('Target not registered');
 return structuredClone(SnapshotSchema.parse({version:1,agent,paymentSystem,mode}));
}
export function snapshotDigest(snapshot:TargetSnapshot){
 const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 return createHash('sha256').update(JSON.stringify(canonical(SnapshotSchema.parse(snapshot)))).digest('hex');
}
export function requireAuthorizedSnapshot(snapshot:TargetSnapshot,registry:Registry){
 const current=selectTargets(registry,snapshot.agent.id,snapshot.paymentSystem.id,snapshot.mode);
 if(snapshotDigest(snapshot)!==snapshotDigest(current))throw new Error('Snapshot no longer authorized; register the original configuration before replay');
}
export function executionIssue(snapshot:TargetSnapshot):string|undefined {
 const required:string[]=[];
 if(snapshot.paymentSystem.adapter==='near-reference-vault')required.push('NEAR_OWNER_ID','NEAR_OWNER_KEY','NEAR_AGENT_ID','NEAR_AGENT_PAYMENT_KEY');
 else required.push(snapshot.paymentSystem.connection.tokenEnv);
 if(snapshot.mode==='agent')required.push(snapshot.agent.adapter==='shoppingbot'?'OPENAI_API_KEY':snapshot.agent.connection.tokenEnv);
 const missing=required.filter(key=>!process.env[key]);
 return missing.length?`Live execution is not configured (${missing.join(', ')}). Archived reports remain available; follow the local setup guide.`:undefined;
}
