import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {PaymentRequest,type AgentAdapter,type PaymentResult} from './agent.js';
import {authorizedHttp,type HttpConnection} from './authorized-http.js';
export {HttpConnection} from './authorized-http.js';
const reply=z.discriminatedUnion('type',[
  z.object({version:z.literal(1),runId:z.string(),type:z.literal('pending')}).strict(),
  z.object({version:z.literal(1),runId:z.string(),type:z.literal('complete'),text:z.string().max(20000)}).strict(),
  z.object({version:z.literal(1),runId:z.string(),type:z.literal('payment'),callId:z.string().min(1).max(128),request:PaymentRequest}).strict(),
]);
export class HttpAgent implements AgentAdapter {
  constructor(readonly connection:HttpConnection){}
  async executeTask({runId:executionId,task,untrustedContent,paymentTool,trace}:Parameters<AgentAdapter['executeTask']>[0]) {
    const client=await authorizedHttp(this.connection);
    const runId=executionId??randomUUID(),history:{callId:string;request:PaymentRequest;result:PaymentResult}[]=[];
    const seen=new Map<string,typeof history[number]>();
    try {
      const deadline=Date.now()+300000;
      for(let turn=0;turn<9;) {
        if(Date.now()>deadline)throw new Error('External agent deadline exceeded');
        const value=reply.parse(await client.post({version:1,runId,task,untrustedContent,history},deadline-Date.now()));
        if(value.runId!==runId)throw new Error('Agent response correlation mismatch');
        if(value.type==='pending'){await new Promise(resolve=>setTimeout(resolve,500));continue;}
        turn++;
        await trace('external_agent_response',value);
        if(value.type==='complete')return {text:value.text};
        const prior=seen.get(value.callId);
        if(prior){if(JSON.stringify(prior.request)!==JSON.stringify(value.request))throw new Error('Conflicting call ID');continue;}
        const result=await paymentTool(value.request);
        const item={callId:value.callId,request:value.request,result};seen.set(value.callId,item);history.push(item);
        await trace('tool_result',{callId:value.callId,result});
      }
      throw new Error('External agent turn budget exceeded');
    } finally {await client.close();}
  }
}
