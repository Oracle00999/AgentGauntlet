import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {Agent,fetch} from 'undici';
import {z} from 'zod';
export const HttpConnection=z.object({endpoint:z.string().url().refine(value=>{const u=new URL(value);return !u.username&&!u.password&&!u.search&&!u.hash;},'Endpoint credentials, query strings and fragments are not allowed'),tokenEnv:z.string().regex(/^[A-Z][A-Z0-9_]*_TOKEN$/).refine(name=>name!=='API_TOKEN','Use a dedicated integration token'),allowLoopback:z.boolean().default(false),timeoutMs:z.number().int().min(100).max(120000).default(60000)}).strict();
export type HttpConnection=z.infer<typeof HttpConnection>;
export function publicAddress(address:string){
 if(isIP(address)!==4)return false;
 const [a,b]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);
}
export async function authorizedHttp(connection:HttpConnection){
 const config=HttpConnection.parse(connection),url=new URL(config.endpoint);
 if(url.username||url.password||url.hash||url.search)throw new Error('Invalid endpoint');
 const local=config.allowLoopback&&url.hostname==='127.0.0.1';
 if(!local&&url.protocol!=='https:'||local&&!['http:','https:'].includes(url.protocol))throw new Error('HTTPS required except explicitly authorized loopback');
 let timer:NodeJS.Timeout|undefined;
 const addresses=await Promise.race([lookup(url.hostname,{all:true,family:4}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),config.timeoutMs);})]).finally(()=>clearTimeout(timer));
 if(!addresses.length||!local&&addresses.some(a=>!publicAddress(a.address)))throw new Error('Endpoint address not allowed');
 const token=process.env[config.tokenEnv];if(!token||token.length<32)throw new Error('HTTP integration token missing');
 const address=addresses[0].address;
 const transport=new Agent({connect:{lookup:(_host,options,callback)=>{
  const done=callback as (...args:any[])=>void;
  if((options as {all?:boolean}).all)done(null,[{address,family:4}]);else done(null,address,4);
 }}});
 return {
  async post(payload:unknown,remainingMs=config.timeoutMs):Promise<unknown>{
   const response=await fetch(url,{method:'POST',redirect:'error',dispatcher:transport,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(Math.max(1,Math.min(config.timeoutMs,remainingMs)))});
   if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error(`Invalid integration response (${response.status})`);
   let size=0;const chunks:Uint8Array[]=[];
   for await(const chunk of response.body!){size+=chunk.length;if(size>65536)throw new Error('Integration response too large');chunks.push(chunk);}
   return JSON.parse(Buffer.concat(chunks).toString());
  },
  close:()=>transport.destroy(),
 };
}
