import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../../../',import.meta.url);
const workflow=fs.readFileSync(new URL('.github/workflows/cloudflare-production-deploy.yml',root),'utf8');
const lock=JSON.parse(fs.readFileSync(new URL('production-assets.lock.json',root),'utf8'));
const preview=fs.readFileSync(new URL('cloudflare/slice-d/tools/verify-release-preview.mjs',root),'utf8');
const browser=fs.readFileSync(new URL('cloudflare/slice-d/tools/verify-release-browser.mjs',root),'utf8');

test('production release uploads and verifies an immutable candidate before one traffic switch',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/\bpush:/);
  const upload=workflow.indexOf('versions upload'),assetGate=workflow.indexOf('verify-release-preview.mjs'),browserGate=workflow.indexOf('verify-release-browser.mjs'),deploy=workflow.indexOf("versions deploy '${{ steps.upload.outputs.version }}@100%'");
  assert.ok(upload>0&&assetGate>upload&&browserGate>assetGate&&deploy>browserGate);
  assert.doesNotMatch(workflow,/secret put|d1 execute|Bootstrap Worker/);
  assert.match(workflow,/Roll back automatically if post-deployment verification fails/);
});

test('reviewed release inventory includes every recovered mobile design asset',()=>{
  const files=new Set(lock.files.map(row=>row.path));
  for(const name of ['assets/v25/mobile-position.css','assets/v25/app-icon-32.png','assets/v25/app-icon-180.png','assets/v25/app-icon-192.png','assets/v25/app-icon-512.png','assets/v25/app-icon-maskable-512.png'])assert.ok(files.has(name),name);
  assert.ok(lock.references.includes('assets/v25/mobile-position.css'));
});

test('candidate gate rejects missing, wrong-MIME, changed, or visually unstyled assets',()=>{
  assert.match(preview,/response\.status!==200/);
  assert.match(preview,/expectedMime==='application\/javascript'&&actualMime==='text\/javascript'/);
  assert.match(preview,/if\(!validMime\)throw new Error/);
  assert.match(preview,/sha256\(data\)/);
  assert.match(browser,/loadedStyleCount!==result\.localStyleCount/);
  assert.match(browser,/unstyled serif font/);
  assert.match(browser,/production-candidate-phone\.png/);
});
