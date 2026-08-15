import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '../src/auth.mjs';
import { handleFetch } from '../src/index.js';

const origin = 'https://family-cash-flow-staging-bridge.example';
const env = {
  GOOGLE_CLIENT_ID: 'client.example.apps.googleusercontent.com',
  APPROVED_GOOGLE_EMAILS: 'approved@example.com,second@example.com',
  SESSION_SIGNING_KEY: 'slice-d-test-signing-key-that-is-longer-than-thirty-two-bytes',
  ASSETS: { fetch: async request => new Response(`asset:${new URL(request.url).pathname}`, { headers: { 'content-type': 'text/plain' } }) },
};

test('health proves final runtime has no Apps Script dependency', async () => {
  const response = await handleFetch(new Request(`${origin}/health`), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'family-cash-flow', runtime: 'slice-d', appsScriptDependency: false });
});

test('static requests are served through the same Worker asset binding', async () => {
  const response = await handleFetch(new Request(`${origin}/assets/v24/logo.svg`), env);
  assert.equal(await response.text(), 'asset:/assets/v24/logo.svg');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('session endpoint accepts only the signed HttpOnly-cookie value', async () => {
  const token = await signSession({ sub: 'subject', email: 'approved@example.com' }, env);
  const response = await handleFetch(new Request(`${origin}/api/auth/session`, { headers: { cookie: `fcf_session=${token}` } }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).identity.email, 'approved@example.com');
  const denied = await handleFetch(new Request(`${origin}/api/auth/session`), env);
  assert.equal(denied.status, 401);
});

test('mutating API rejects cross-origin requests before body processing', async () => {
  const response = await handleFetch(new Request(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /same-origin/i);
});
