import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
try { loadEnvFile(resolve(import.meta.dirname,'../../.env')); } catch(e) { if(e.code!=='ENOENT')throw e; }
export default {poweredByHeader:false,devIndicators:false,turbopack:{root:resolve(import.meta.dirname,'../..')}};
