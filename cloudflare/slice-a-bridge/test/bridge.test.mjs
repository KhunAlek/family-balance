import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  UPSTREAM_URL: 'https://script.google.com/macros/s/test-deployment/exec',
  ALLOWED_ORIGIN: 'https://khunalek.github.io',
};

async function call(path, init = {}) {
  return worker.fetch(new Request('https://bridge.example' + path, init), env);
}

{
  const response = await call('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'family-cash-flow-staging-bridge' });
}

{
  const response = await call('/api/apps-script', {
    method: 'OPTIONS',
    headers: { origin: 'https://khunalek.github.io' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://khunalek.github.io');
}

{
  const response = await call('/api/apps-script', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(response.status, 403);
}

{
  let captured;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: false, error: 'Google sign-in could not be verified.' }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  };
  try {
    const payload = JSON.stringify({ apiAction: 'authBootstrap', googleAccessToken: 'invalid-test-token' });
    const response = await call('/api/apps-script', {
      method: 'POST',
      headers: {
        origin: 'https://khunalek.github.io',
        'content-type': 'text/plain;charset=UTF-8',
      },
      body: payload,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://khunalek.github.io');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: false, error: 'Google sign-in could not be verified.' });
    assert.equal(captured.url, env.UPSTREAM_URL);
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.redirect, 'follow');
    assert.equal(new TextDecoder().decode(captured.init.body), payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  let upstreamCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    return new Response('{}');
  };
  try {
    const response = await call('/api/apps-script', {
      method: 'POST',
      headers: {
        origin: 'https://khunalek.github.io',
        'content-type': 'text/plain;charset=UTF-8',
      },
      body: 'x'.repeat(64 * 1024 + 1),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { ok: false, error: 'Request body is too large.' });
    assert.equal(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('PASS: slice-a bridge tests');
