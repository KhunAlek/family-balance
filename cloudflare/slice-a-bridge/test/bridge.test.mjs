import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';

const baseEnv = {
  UPSTREAM_URL: 'https://script.google.com/macros/s/test-deployment/exec',
  ALLOWED_ORIGIN: 'https://khunalek.github.io',
};

async function call(path, init = {}, customEnv = baseEnv) {
  return worker.fetch(new Request('https://bridge.example' + path, init), customEnv);
}

function apiRequest(body) {
  return {
    method: 'POST',
    headers: { origin: 'https://khunalek.github.io', 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
  };
}

async function withAuthMock(fn, email = 'abystrov66@gmail.com') {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url: String(url), body });
    if (body.apiAction === 'authStatus') {
      return new Response(JSON.stringify({ ok: true, identity: { email } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected upstream request: ${JSON.stringify(body)}`);
  };
  try { return await fn(seen); }
  finally { globalThis.fetch = originalFetch; }
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

// Legacy auth bootstrap still proxies unchanged to Apps Script.
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
    const response = await call('/api/apps-script', apiRequest(JSON.parse(payload)));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://khunalek.github.io');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: false, error: 'Google sign-in could not be verified.' });
    assert.equal(captured.url, baseEnv.UPSTREAM_URL);
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
      headers: { origin: 'https://khunalek.github.io', 'content-type': 'text/plain;charset=UTF-8' },
      body: 'x'.repeat(64 * 1024 + 1),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { ok: false, error: 'Request body is too large.' });
    assert.equal(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Missing session is settled as a domain auth result and cannot touch D1.
{
  const { db, raw } = createSeededSqliteD1();
  const response = await call('/api/apps-script', apiRequest({
    apiAction: 'write', payload: { action: 'balanceCheck', date: '2026-08-14', alexBalance: 3000 },
  }), { ...baseEnv, DB: db });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: false, error: 'Authentication required.' });
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n, 0);
}

// Authenticated dashboard is fully D1-computed.
await withAuthMock(async seen => {
  const { db } = createSeededSqliteD1();
  const response = await call('/api/apps-script', apiRequest({ apiAction: 'dashboard', sessionToken: 'signed-session-test' }), { ...baseEnv, DB: db });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(seen.map(x => x.body), [{ apiAction: 'authStatus', sessionToken: 'signed-session-test' }]);
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
});

// Preview is D1-computed and makes zero write claims/mutations.
await withAuthMock(async () => {
  const { db, raw } = createSeededSqliteD1();
  const before = {
    claims: raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n,
    balances: raw.prepare('SELECT COUNT(*) AS n FROM balance_history').get().n,
  };
  const response = await call('/api/apps-script', apiRequest({
    apiAction: 'previewPayment', sessionToken: 'signed', payload: {
      date: '2026-08-14', oneOffName: 'Preview', oneOffAlexAmount: 1000, oneOffOlgaAmount: 0,
    },
  }), { ...baseEnv, DB: db });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.safeDiscretionaryKTB, 1661.48);
  assert.equal(data.safeKTBPortion, 1000);
  assert.equal(data.efRequired, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n, before.claims);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM balance_history').get().n, before.balances);
});

// Authenticated write uses the revision claim and commits D1, not Apps Script.
await withAuthMock(async seen => {
  const { db, raw } = createSeededSqliteD1();
  const response = await call('/api/apps-script', apiRequest({
    apiAction: 'write', sessionToken: 'signed', payload: {
      action: 'balanceCheck', date: '2026-08-14', alexBalance: 3000, olgaBalance: '', oneOffName: '', oneOffAmount: '', oneOffAccount: '',
    },
  }), { ...baseEnv, DB: db });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.baseRevision, 0);
  assert.equal(data.revision, 1);
  assert.deepEqual(data.balances, { alex: 3000, olga: 11455, asOf: '2026-08-14' });
  assert.equal(raw.prepare('SELECT current_revision AS n FROM household_revisions').get().n, 1);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n, 1);
  assert.equal(raw.prepare("SELECT alex_balance_satang FROM balance_history WHERE source_sheet='Cloudflare' ORDER BY sheet_order DESC LIMIT 1").get().alex_balance_satang, 300000);
  assert.equal(seen.length, 1, 'write must call Apps Script only for authStatus');
});

// Validation failures settle as HTTP 200 and produce no claim.
await withAuthMock(async () => {
  const { db, raw } = createSeededSqliteD1();
  const response = await call('/api/apps-script', apiRequest({
    apiAction: 'write', sessionToken: 'signed', payload: {
      action: 'ktbTransfer', date: '2026-08-14', sourceAccount: 'Alex', destinationAccount: 'Olga', amount: 999999,
    },
  }), { ...baseEnv, DB: db });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /exceeds Alex KTB balance/);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n, 0);
});

// A hard duplicate base-revision claim maps to settled stale-writer UI shape.
await withAuthMock(async () => {
  const { db, raw } = createSeededSqliteD1();
  raw.prepare("INSERT INTO financial_write_claims(household_id,base_revision,write_token,committed_at) VALUES('family',0,'preexisting','2026-08-14T00:00:00Z')").run();
  const response = await call('/api/apps-script', apiRequest({
    apiAction: 'write', sessionToken: 'signed', payload: {
      action: 'balanceCheck', date: '2026-08-14', alexBalance: 3000, olgaBalance: '',
    },
  }), { ...baseEnv, DB: db });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.staleWriter, true);
  assert.match(data.error, /Financial state changed/);
  assert.equal(raw.prepare('SELECT current_revision AS n FROM household_revisions').get().n, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM balance_history').get().n, 69);
});

// Correction catalog and preview are authenticated read-only D1 operations.
await withAuthMock(async () => {
  const { db, raw } = createSeededSqliteD1();
  const catalogResponse = await call('/api/apps-script', apiRequest({ apiAction: 'correctionCatalog', sessionToken: 'signed', payload: {} }), { ...baseEnv, DB: db });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.ok, true);
  assert.ok(catalog.records.balance.length >= 1);
  assert.ok(catalog.records.obligationPayment.length >= 1);
  assert.ok(catalog.records.ledgerMovement.length >= 1);
  assert.equal(catalog.records.goal.length, 1);
  const entityId = catalog.records.balance[0].entityId;

  const previewResponse = await call('/api/apps-script', apiRequest({
    apiAction: 'correctionPreview', sessionToken: 'signed', payload: { entityType: 'balance', entityId },
  }), { ...baseEnv, DB: db });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.ok, true);
  assert.equal(preview.entityType, 'balance');
  assert.equal(preview.entityId, entityId);
  assert.deepEqual(preview.allowedFields, ['businessDate','alexBalance','olgaBalance']);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM financial_write_claims').get().n, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM correction_audit').get().n, 0);
});

console.log('PASS: slice-a/slice-c Worker API contract tests');
