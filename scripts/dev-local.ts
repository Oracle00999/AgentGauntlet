import {spawn,type ChildProcess} from 'node:child_process';
process.loadEnvFile('.env');
const children:ChildProcess[]=[];let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;for(const child of children)try{process.kill(-child.pid!,'SIGTERM');}catch{}};
for(const [name,args] of [
 ['api',['--import','tsx','apps/api/src/main.ts']],['worker',['--import','tsx','apps/api/src/main.ts','--worker']],
 ...(process.env.OPENAI_API_KEY&&process.env.EXTERNAL_AGENT_TOKEN?[['external-agent',['--import','tsx','examples/external-agent/server.ts']]]:[]),
 ['web',['node_modules/next/dist/bin/next','dev','apps/web','--hostname','127.0.0.1','--port','3000']],
] as [string,string[]][]){
 const child=spawn(process.execPath,args,{stdio:'inherit',detached:true});children.push(child);
 child.on('error',()=>{console.error(`${name} failed to start`);stop();process.exitCode=1;});
 child.on('exit',code=>{if(!stopping){console.error(`${name} exited (${code}); stopping local services`);stop();process.exitCode=code||1;}});
}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
