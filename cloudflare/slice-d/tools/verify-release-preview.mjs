import crypto from 'node:crypto';
import fs from 'node:fs';

const origin=String(process.env.CANDIDATE_ORIGIN||'').replace(/\/$/,'');
if(!/^https:\/\//.test(origin))throw new Error('CANDIDATE_ORIGIN must be an HTTPS preview origin.');
const lock=JSON.parse(fs.readFileSync('production-assets.lock.json','utf8'));
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
for(const asset of lock.files){
  const response=await fetch(`${origin}/${asset.path}?release_gate=${Date.now()}`,{headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  const data=Buffer.from(await response.arrayBuffer()),type=response.headers.get('content-type')||'';
  if(response.status!==200)throw new Error(`${asset.path} returned HTTP ${response.status}.`);
  if(!type.toLowerCase().startsWith(asset.mime.toLowerCase()))throw new Error(`${asset.path} returned ${type||'no content type'}, expected ${asset.mime}.`);
  const exact=data.length===asset.bytes&&sha256(data)===asset.sha256;
  const legacyFreshHash=data.length===asset.bytes+1&&data.at(-1)===10&&sha256(data.subarray(0,-1))===asset.sha256;
  if(!exact&&!legacyFreshHash)throw new Error(`${asset.path} does not match the reviewed release asset lock.`);
}
const health=await fetch(`${origin}/health`,{headers:{accept:'application/json'}}),body=await health.json();
if(health.status!==200||body.ok!==true||body.runtime!=='slice-d'||body.appsScriptDependency!==false)throw new Error('Candidate health contract failed.');
console.log(`PASS: immutable candidate matches all ${lock.files.length} reviewed assets and the health contract.`);
