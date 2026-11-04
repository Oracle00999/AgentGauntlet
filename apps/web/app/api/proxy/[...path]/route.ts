import { signedIn,validOrigin } from '../../../../lib/session';
const uuid='[0-9a-f-]{36}';
const allowedGet=new RegExp(`^(targets|stats|scenarios|agents|test-runs|test-runs/${uuid}(/events|/report)?)$`);
const allowedPost=new RegExp(`^(test-runs|test-runs/${uuid}/replay)$`);
async function proxy(request:Request,context:{params:Promise<{path:string[]}>}) {
  if(!(await signedIn()))return Response.json({error:'Sign in to your workspace.'},{status:401});
  const path=(await context.params).path.join('/');
  const post=request.method==='POST';
  if(!(post?allowedPost:allowedGet).test(path))return Response.json({error:'Not found'},{status:404});
  if(post && !validOrigin(request))return Response.json({error:'Origin not allowed'},{status:403});
  const query=new URLSearchParams();
  const after=new URL(request.url).searchParams.get('after');
  if(after!==null)query.set('after',after);
  const body=post?await request.text():undefined;
  if(body && body.length>16384)return Response.json({error:'Request too large'},{status:413});
  try {
    const response=await fetch(`${process.env.EXPRESS_API_ORIGIN||'http://127.0.0.1:3001'}/api/${path}${query.size?'?'+query:''}`,{
      method:request.method,headers:{authorization:`Bearer ${process.env.API_TOKEN}`,'content-type':'application/json',
        'idempotency-key':request.headers.get('idempotency-key')??''},body,cache:'no-store',signal:AbortSignal.timeout(15000),
    });
    return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  } catch {return Response.json({error:'The API is unavailable. Check that the backend is running.'},{status:502});}
}
export const GET=proxy;export const POST=proxy;
