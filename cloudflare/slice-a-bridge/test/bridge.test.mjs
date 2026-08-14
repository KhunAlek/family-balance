import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { loadLockedSourceSnapshot } from '../../slice-b/test/source-snapshot.mjs';

const env = {
  UPSTREAM_URL: 'https://script.google.com/macros/s/test-deployment/exec',
  ALLOWED_ORIGIN: 'https://khunalek.github.io',
};

async function call(path, init = {}, customEnv = env) {
  return worker.fetch(new Request('https://bridge.example' + path, init), customEnv);
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

{
  const snapshot = loadLockedSourceSnapshot();
  const configRows = Object.entries(snapshot.config).map(([key, value]) => {
    if (key.endsWith('_satang')) return { config_key: key.slice(0, -7), value_text: null, value_integer: null, value_satang: value };
    return { config_key: key, value_text: value, value_integer: null, value_satang: null };
  });
  const resultSets = [
    configRows,
    [snapshot.salaryCycle],
    snapshot.balanceHistory,
    snapshot.incomeDefinitions,
    snapshot.incomeReceipts,
    snapshot.obligations,
    snapshot.obligationPayments,
    snapshot.goals,
    snapshot.ledger,
    snapshot.weeklySnapshots,
  ];
  const fakeDb = {
    prepare(sql) {
      return { bind() { return { sql }; } };
    },
    async batch(statements) {
      assert.equal(statements.length, 10);
      return resultSets.map(results => ({ results }));
    },
  };
  let authPayload;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    authPayload = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ ok: true, identity: { email: 'abystrov66@gmail.com' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const response = await call('/api/apps-script', {
      method: 'POST',
      headers: { origin: 'https://khunalek.github.io', 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ apiAction: 'dashboard', sessionToken: 'signed-session-test' }),
    }, { ...env, DB: fakeDb });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(authPayload, { apiAction: 'authStatus', sessionToken: 'signed-session-test' });
    assert.equal(data.cloudflareReadModel, true);
    assert.equal(data.readAuthority, 'cloudflare-d1');
    assert.equal(data.authenticatedUser, 'abystrov66@gmail.com');
    assert.deepEqual(data.currentBalances, { alex: 2285, olga: 11455, asOf: '2026-08-12' });
    assert.equal(data.variablesState.activeVariablesPlan, 28000);
    assert.equal(data.variablesState.spentCycleToDate, 19008);
    assert.equal(data.variablesState.remainingBudget, 8992);
    assert.equal(data.paymentSafety.safeDiscretionaryKTB, 1661.48);
    assert.equal(data.transferLimits.emergencyFund, 242.13);
    assert.equal(data.transferLimits.goalsTotal, 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://khunalek.github.io');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('PASS: slice-a bridge tests');
