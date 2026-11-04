import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'AgentGauntlet — Attack Lab',description:'Break your AI agent before it breaks your wallet.'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
