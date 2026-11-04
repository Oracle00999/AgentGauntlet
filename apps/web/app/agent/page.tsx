import { redirect } from 'next/navigation';
import { signedIn } from '../../lib/session';
import { Console } from '../../components/console';
export default async function Page(){if(!await signedIn())redirect('/login');return <Console view="agent"/>;}
