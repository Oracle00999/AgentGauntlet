import {createServer,type ServerResponse} from 'node:http';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {PaymentRequest,type AgentAdapter,type PaymentResult,type Trace} from './agent.js';
const Result=z.object({code:z.string(),status:z.enum(['SETTLED','DENIED','FAILED']),paymentId:z.string(),transactionHash:z.string()}).strict();
const Input=z.object({version:z.literal(1),runId:z.uuid(),task:z.string().max(16000),untrustedContent:z.string().max(16000),history:z.array(z.object({callId:z.string(),request:PaymentRequest,result:Result}).strict()).max(4)}).strict();
type Input=z.infer<typeof Input>;
type Reply={version:1;runId:string;type:'pending'}|{version:1;runId:string;type:'complete';text:string}|{version:1;runId:string;type:'payment';callId:string;request:PaymentRequest};
type Session={task:string;content:string;history:Input['history'];current?:Reply;pending?:{resolve:(r:PaymentResult)=>void;reject:(e:Error)=>void};waiters:((r:Reply)=>void)[];expires:NodeJS.Timeout;failed:boolean};
// Optional SDK for external developers. The protocol itself requires no SDK.
export function createAgentServer(options:{token:string;createAgent:()=>AgentAdapter;instructions:string;trace?:Trace}) {
 if(options.token.length<32)throw new Error('Agent token must contain at least 32 characters');
 const sessions=new Map<string,Session>();
 const hash=(s:string)=>createHash('sha256').update(s).digest();
 const send=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{
  if(!timingSafeEqual(hash(req.headers.authorization??''),hash(`Bearer ${options.token}`))){send(res,401,{error:'Unauthorized'});return;}
  if(req.method!=='POST'||req.url!=='/execute'){send(res,404,{error:'Not found'});return;}
  if(!req.headers['content-type']?.startsWith('application/json')){send(res,415,{error:'JSON required'});return;}
  try {
   let size=0,raw='';for await(const chunk of req){size+=chunk.length;if(size>65536){send(res,413,{error:'Request too large'});return;}raw+=chunk;}
   const input=Input.parse(JSON.parse(raw));
   let session=sessions.get(input.runId);
   if(!session){
    if(input.history.length)throw new Error('Unknown session');
    if(sessions.size>=20){send(res,429,{error:'Agent capacity reached'});return;}
    session={task:input.task,content:input.untrustedContent,history:[],waiters:[],failed:false,expires:setTimeout(()=>{
      const s=sessions.get(input.runId);if(s){s.failed=true;s.pending?.reject(new Error('Expired'));sessions.delete(input.runId);}
    },600000)};
    sessions.set(input.runId,session);const owned=session;
    const publish=(reply:Reply)=>{owned.current=reply;owned.waiters.splice(0).forEach(resolve=>resolve(reply));};
    void options.createAgent().executeTask({task:input.task,untrustedContent:input.untrustedContent,instructions:options.instructions,trace:options.trace??(async()=>{}),paymentTool:request=>new Promise((resolve,reject)=>{
      owned.pending={resolve,reject};publish({version:1,runId:input.runId,type:'payment',callId:randomUUID(),request});
    })}).then(result=>publish({version:1,runId:input.runId,type:'complete',text:result.text})).catch(async(e)=>{owned.failed=true;await options.trace?.('external_agent_error',{name:e?.name,status:e?.status,code:e?.code});});
   }
   if(session.failed)throw new Error('Agent execution failed');
   if(session.task!==input.task||session.content!==input.untrustedContent)throw new Error('Changed session input');
   if(input.history.length<session.history.length||input.history.length>session.history.length+1)throw new Error('Invalid continuation');
   if(JSON.stringify(input.history.slice(0,session.history.length))!==JSON.stringify(session.history))throw new Error('Changed prior result');
   if(input.history.length>session.history.length){
    const item=input.history.at(-1)!;
    if(session.current?.type!=='payment'||session.current.callId!==item.callId||JSON.stringify(session.current.request)!==JSON.stringify(item.request)||!session.pending)throw new Error('Invalid tool result');
    const pending=session.pending;session.history=input.history;session.current=undefined;session.pending=undefined;pending.resolve(item.result);
   }
   const reply=session.current??await new Promise<Reply>((resolve,reject)=>{
    const timer=setTimeout(()=>{session!.waiters=session!.waiters.filter(w=>w!==ready);resolve({version:1,runId:input.runId,type:'pending'});},1000);
    const ready=(value:Reply)=>{clearTimeout(timer);resolve(value);};session!.waiters.push(ready);
   });
   send(res,200,reply);
  }catch{send(res,400,{error:'Agent request failed or expired'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 server.on('close',()=>{for(const session of sessions.values()){clearTimeout(session.expires);session.pending?.reject(new Error('Server closed'));}});
 return server;
}
