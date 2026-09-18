import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const lockPath=path.join(root,'production-assets.lock.json');
const text=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
const normalize=value=>String(value||'').split(/[?#]/,1)[0].replace(/^\//,'');
const mime=relative=>({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain'})[path.extname(relative).toLowerCase()]||'application/octet-stream';

function walk(dir,base=''){
  const rows=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const relative=path.posix.join(base,entry.name),absolute=path.join(dir,entry.name);
    if(entry.isDirectory())rows.push(...walk(absolute,relative));else if(entry.isFile())rows.push(relative);
  }
  return rows;
}

function localReferences(){
  const refs=new Set(['index.html','manifest.webmanifest','sw.js']);
  for(const match of text('index.html').matchAll(/(?:src|href)="([^"]+)"/g))if(!/^https?:/i.test(match[1]))refs.add(normalize(match[1]));
  const manifest=JSON.parse(text('manifest.webmanifest'));for(const icon of manifest.icons||[])refs.add(normalize(icon.src));
  for(const match of text('sw.js').matchAll(/['"](\/assets\/[^'"]+)['"]/g))refs.add(normalize(match[1]));
  return [...refs].filter(Boolean).sort();
}

export function buildReleaseAssetLock(){
  const files=['index.html','manifest.webmanifest','sw.js',...walk(path.join(root,'assets'),'assets')].sort();
  const references=localReferences();
  for(const relative of references)if(!fs.existsSync(path.join(root,relative)))throw new Error(`Referenced release asset is missing: ${relative}`);
  return{format:'family-cash-flow-production-assets-v1',files:files.map(relative=>{const data=fs.readFileSync(path.join(root,relative));return{path:relative,bytes:data.length,sha256:sha256(data),mime:mime(relative)}}),references};
}

export function verifyReleaseAssetLock(){
  if(!fs.existsSync(lockPath))throw new Error('production-assets.lock.json is missing.');
  const expected=JSON.parse(text('production-assets.lock.json')),actual=buildReleaseAssetLock();
  if(expected.format!==actual.format)throw new Error('Production asset lock format is unsupported.');
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('Release assets differ from production-assets.lock.json. Review the design changes and regenerate the lock deliberately.');
  return actual;
}

const command=process.argv[2]||'verify';
if(command==='write'){
  fs.writeFileSync(lockPath,JSON.stringify(buildReleaseAssetLock(),null,2)+'\n');
  console.log(`Wrote ${path.relative(root,lockPath)}.`);
}else if(command==='verify'){
  const lock=verifyReleaseAssetLock();console.log(`PASS: ${lock.files.length} release assets are complete and locked.`);
}else throw new Error(`Unknown command: ${command}`);
