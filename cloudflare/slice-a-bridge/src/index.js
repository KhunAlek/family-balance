import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';
import { buildDashboardReadModel } from '../../slice-b/src/read-model.mjs';
import { executeRevisionClaimWrite, FinancialWriteValidationError, StaleFinancialWriterError } from '../../slice-c/src/write-protocol.mjs';
import { buildOneOffPaymentPreview, planFinancialWrite } from '../../slice-c/src/write-actions.mjs';
import { previewCorrection } from '../../slice-c/src/correction.mjs';
import { buildCorrectionCatalog } from '../../slice-c/src/correction-catalog.mjs';

const MAX_REQUEST_BYTES = 64 * 1024;

function jsonResponse(value, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=UTF-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(value), { status, headers });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGIN || '').trim();
  if (!allowed) return { ok: false, origin: '', error: 'ALLOWED_ORIGIN is not configured.' };
  if (!origin) return { ok: false, origin: '', error: 'Origin header is required.' };
  if (origin !== allowed) return { ok: false, origin, error: 'Origin is not allowed.' };
  return { ok: true, origin };
}

async function readBoundedRequestBody(request, maxBytes) {
  if (!request.body) return { ok: true, body: new Uint8Array(0) };

  let reader;
  try {
    reader = request.body.getReader({ mode: 'byob' });
  } catch (error) {
    return { ok: false, error: 'Request body stream is not byte-readable.' };
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const remaining = maxBytes + 1 - total;
      if (remaining <= 0) {
        await reader.cancel('Request body is too large.');
        return { ok: false };
      }
      const view = new Uint8Array(Math.min(16 * 1024, remaining));
      const { value, done } = await reader.read(view);
      if (value && value.byteLength) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel('Request body is too large.');
          return { ok: false };
        }
        chunks.push(new Uint8Array(value));
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

function upstreamUrl(env) {
  const value = String(env.UPSTREAM_URL || '').trim();
  return /^https:\/\/script\.google\.com\/macros\/s\//.test(value) ? value : '';
}

async function fetchAppsScript(env, body) {
  const url = upstreamUrl(env);
  if (!url) throw new Error('UPSTREAM_URL is not configured correctly.');
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body,
    redirect: 'follow',
  });
}

async function fetchAppsScriptJson(env, payload) {
  const response = await fetchAppsScript(env, JSON.stringify(payload));
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Apps Script returned invalid JSON (HTTP ${response.status}).`);
  }
  return { response, data };
}

async function authenticateSession(payload, env) {
  const sessionToken = String(payload?.sessionToken || '').trim();
  if (!sessionToken) return { ok: false, status: 200, body: { ok: false, error: 'Authentication required.' } };

  let auth;
  try {
    auth = await fetchAppsScriptJson(env, { apiAction: 'authStatus', sessionToken });
  } catch (error) {
    console.error(JSON.stringify({ event: 'apps_script_auth_status_failure', message: String(error?.message || error) }));
    return { ok: false, status: 502, body: { ok: false, error: 'Authentication service is unavailable.' } };
  }

  if (!auth.response.ok || !auth.data || auth.data.ok === false) {
    return {
      ok: false,
      status: auth.response.ok ? 200 : auth.response.status,
      body: auth.data || { ok: false, error: 'Authentication required.' },
    };
  }

  return {
    ok: true,
    sessionToken,
    identity: auth.data.identity || {},
    email: String(auth.data.identity?.email || '').trim(),
  };
}

function financialErrorBody(error) {
  const body = { ok: false, error: String(error?.message || 'Financial action failed.') };
  for (const key of ['staleWriter','requiresEFWithdrawal','requiresKTBTransfer','split','preview']) {
    if (error && error[key] !== undefined) body[key] = error[key];
  }
  return body;
}

async function handleCloudflareFinancialAction(payload, env, cors) {
  const auth = await authenticateSession(payload, env);
  if (!auth.ok) return jsonResponse(auth.body, auth.status, cors);

  try {
    if (payload.apiAction === 'dashboard') {
      const snapshot = await loadFinancialSnapshot(env.DB, 'family');
      const model = buildDashboardReadModel(snapshot);
      return jsonResponse({ ...model, authenticatedUser: auth.email }, 200, cors);
    }

    if (payload.apiAction === 'previewPayment') {
      const snapshot = await loadFinancialSnapshot(env.DB, 'family');
      const preview = buildOneOffPaymentPreview(snapshot, payload.payload || {});
      return jsonResponse(preview, 200, cors);
    }

    if (payload.apiAction === 'correctionCatalog') {
      const snapshot = await loadFinancialSnapshot(env.DB, 'family');
      return jsonResponse(buildCorrectionCatalog(snapshot), 200, cors);
    }

    if (payload.apiAction === 'correctionPreview') {
      const snapshot = await loadFinancialSnapshot(env.DB, 'family');
      return jsonResponse(previewCorrection(snapshot, payload.payload || {}), 200, cors);
    }

    if (payload.apiAction === 'write') {
      const writePayload = payload.payload || {};
      const action = String(writePayload.action || '').trim();
      const result = await executeRevisionClaimWrite(env.DB, {
        householdId: 'family',
        actorEmail: auth.email,
        action,
        payload: writePayload,
        planWrite: planFinancialWrite,
      });
      return jsonResponse(result, 200, cors);
    }
  } catch (error) {
    if (error instanceof FinancialWriteValidationError || error instanceof StaleFinancialWriterError || error?.validation || error?.staleWriter) {
      // Current frontend intentionally treats domain conflicts as settled API
      // results. Non-2xx would be collapsed into a generic network error.
      return jsonResponse(financialErrorBody(error), 200, cors);
    }
    console.error(JSON.stringify({ event: 'd1_financial_action_failure', apiAction: String(payload?.apiAction || ''), message: String(error?.message || error) }));
    return jsonResponse({ ok: false, error: 'Cloudflare financial service is unavailable.' }, 503, cors);
  }

  return null;
}

async function handleProxy(request, env) {
  const originCheck = getAllowedOrigin(request, env);
  if (!originCheck.ok) return jsonResponse({ ok: false, error: originCheck.error }, 403);
  const cors = corsHeaders(originCheck.origin);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405, cors);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return jsonResponse({ ok: false, error: 'Request body is too large.' }, 413, cors);
  if (!upstreamUrl(env)) return jsonResponse({ ok: false, error: 'UPSTREAM_URL is not configured correctly.' }, 500, cors);

  const bodyResult = await readBoundedRequestBody(request, MAX_REQUEST_BYTES);
  if (!bodyResult.ok) return jsonResponse({ ok: false, error: 'Request body is too large.' }, 413, cors);

  if (env.DB) {
    let payload = null;
    try {
      payload = JSON.parse(new TextDecoder().decode(bodyResult.body));
    } catch (error) {
      // Requests we do not understand retain exact Slice A proxy behavior.
    }
    if (payload && ['dashboard','previewPayment','write','correctionCatalog','correctionPreview'].includes(payload.apiAction)) {
      const response = await handleCloudflareFinancialAction(payload, env, cors);
      if (response) return response;
    }
  }

  let upstream;
  try {
    upstream = await fetchAppsScript(env, bodyResult.body);
  } catch (error) {
    console.error(JSON.stringify({ event: 'apps_script_proxy_failure', message: String(error?.message || error) }));
    return jsonResponse({ ok: false, error: 'Backend transport failed.' }, 502, cors);
  }

  const headers = new Headers(upstream.headers);
  headers.set('access-control-allow-origin', originCheck.origin);
  headers.set('access-control-allow-methods', 'POST,OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type');
  headers.set('cache-control', 'no-store');
  headers.set('vary', 'Origin');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=UTF-8');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return jsonResponse({ ok: true, service: 'family-cash-flow-staging-bridge' });
    if (url.pathname === '/api/apps-script') return handleProxy(request, env);
    return jsonResponse({ ok: false, error: 'Not found.' }, 404);
  },
};
