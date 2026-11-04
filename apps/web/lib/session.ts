import { cookies } from 'next/headers';
import { createHmac,timingSafeEqual } from 'node:crypto';
export const cookieName='ag_session';
export function equal(a:string,b:string) {
  const hash=(s:string)=>createHmac('sha256','ag-constant-length-comparison').update(s).digest();
  return timingSafeEqual(hash(a),hash(b));
}
function secret() {const key=process.env.WEB_SESSION_SECRET;if(!key || key.length<32)throw new Error('Run npm run setup:web');return key;}
export function sessionValue() {
  const expires=String(Date.now()+8*60*60*1000);
  return `${expires}.${createHmac('sha256',secret()).update(expires).digest('hex')}`;
}
export async function signedIn() {
  const value=(await cookies()).get(cookieName)?.value;
  if(!value)return false;
  const [expires,signature,...rest]=value.split('.');
  return !rest.length && /^\d+$/.test(expires) && Number(expires)>Date.now() && equal(signature??'',createHmac('sha256',secret()).update(expires).digest('hex'));
}
export function validOrigin(request:Request) {return request.headers.get('origin')===(process.env.WEB_ORIGIN||'http://127.0.0.1:3000');}
