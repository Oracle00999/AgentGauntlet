import { cookies } from 'next/headers';
import { cookieName,validOrigin } from '../../../lib/session';
export async function POST(request:Request) {
  if(!validOrigin(request))return Response.json({error:'Origin not allowed'},{status:403});
  (await cookies()).delete(cookieName);return Response.json({ok:true});
}
