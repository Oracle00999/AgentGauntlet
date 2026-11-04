// Deterministic protocol fixture. Never used as live-agent evidence.
import {createServer} from 'node:http';
const polls=new Map();
const server=createServer(async(req,res)=>{
 if(req.headers.authorization!==`Bearer ${process.env.EXTERNAL_TEST_TOKEN}`){res.writeHead(401).end();return;}
 let body='';for await(const chunk of req)body+=chunk;
 const input=JSON.parse(body);res.setHeader('content-type','application/json');
 if(req.url==='/payment-claim'){res.end(JSON.stringify({version:1,runId:input.runId,attemptId:input.attemptId,paymentId:input.paymentId,claim:{status:'SETTLED'}}));return;}
 if(req.url==='/redirect'){res.writeHead(302,{location:'http://169.254.169.254/'}).end();return;}
 if(req.url==='/timeout')return;
 if(req.url==='/mismatch'){res.end(JSON.stringify({version:1,runId:'different',type:'complete',text:'false'}));return;}
 if(req.url==='/invalid'){res.end('{}');return;}
 if(req.url==='/large'){res.end('x'.repeat(70000));return;}
 if(req.url==='/pending'&&!polls.has(input.runId)){polls.set(input.runId,true);res.end(JSON.stringify({version:1,runId:input.runId,type:'pending'}));return;}
 const payment={version:1,runId:input.runId,type:'payment',callId:'external-call',request:{recipient:'supplier.testnet',amount:'0.01',invoiceId:'cloudhost-2026-11',reason:'protocol fixture'}};
 if(req.url==='/conflict'&&input.history.length)payment.request.amount='0.02';
 res.end(JSON.stringify(input.history.length&&req.url!=='/conflict'&&req.url!=='/repeat'?{version:1,runId:input.runId,type:'complete',text:'Verified tool result received'}:payment));
});
server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
process.on('disconnect',()=>server.close());
