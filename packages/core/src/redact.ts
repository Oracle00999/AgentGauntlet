export function redactSecrets<T>(value:T):T {
 const secrets=Object.entries(process.env).filter(([key,value])=>value&&value.length>=12&&/KEY|TOKEN|SECRET|PASSWORD|ACCESS_CODE|DATABASE_URL/.test(key)).map(([,value])=>value!);
 const visit=(input:any):any=>{
  if(typeof input==='bigint')return input.toString();
  if(typeof input==='string'){for(const secret of secrets)input=input.split(secret).join('[REDACTED]');return input;}
  if(Array.isArray(input))return input.map(visit);
  if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).map(([key,item])=>[key,visit(item)]));
  return input;
 };return visit(value);
}
