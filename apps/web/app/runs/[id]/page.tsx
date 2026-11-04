import { notFound,redirect } from 'next/navigation';
import { signedIn } from '../../../lib/session';
import { Console } from '../../../components/console';
export default async function Page({params}:{params:Promise<{id:string}>}){if(!await signedIn())redirect('/login');const {id}=await params;if(!/^[0-9a-f-]{36}$/.test(id))notFound();return <Console view="detail" runId={id}/>;}
