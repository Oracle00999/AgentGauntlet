import { cookies } from 'next/headers';
import { cookieName,equal,sessionValue,validOrigin } from '../../../lib/session';
let failures=0,windowStart=Date.now();
export async function POST(request:Request) {
  if(!validOrigin(request))return Response.json({error:'Origin not allowed'},{status:403});
  if(Date.now()-windowStart>60000){failures=0;windowStart=Date.now();}
  if(failures>=10)return Response.json({error:'Too many attempts. Try again in a minute.'},{status:429});
  const text=await request.text();
  if(text.length>1024)return Response.json({error:'Invalid request'},{status:400});
  let body;try {body=JSON.parse(text);} catch {return Response.json({error:'Invalid request'},{status:400});}
  const expected=process.env.WEB_ACCESS_CODE;
  if(!expected)return Response.json({error:'Workspace login is not configured.'},{status:503});
  if(!body || typeof body.code!=='string' || !equal(body.code,expected)){failures++;return Response.json({error:'Incorrect access code.'},{status:401});}
  failures=0;
  (await cookies()).set(cookieName,sessionValue(),{httpOnly:true,sameSite:'strict',secure:(process.env.WEB_ORIGIN??'').startsWith('https:'),maxAge:8*60*60,path:'/'});
  return Response.json({ok:true});
}
