import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';
import { buildDashboardReadModel } from '../../slice-b/src/read-model.mjs';
import { executeRevisionClaimWrite, FinancialWriteValidationError, StaleFinancialWriterError } from '../../slice-c/src/write-protocol.mjs';
import { buildOneOffPaymentPreview, planFinancialWrite } from '../../slice-c/src/write-actions.mjs';
import { previewCorrection } from '../../slice-c/src/correction.mjs';
import { buildCorrectionCatalog } from '../../slice-c/src/correction-catalog.mjs';
import {
  authenticateRequest,
  clearSessionCookie,
  createSessionCookie,
  signSession,
  verifyGoogleCredential,
} from './auth.mjs';
import { runWeeklySnapshotJob } from './weekly-job.mjs';
import { runPortableBackup } from './backup.mjs';

const MAX_REQUEST_BYTES = 64 * 1024;
const WEEKLY_CRON = '0 21 * * SUN';
const BACKUP_CRON = '0 20 * * *';

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
      ...securityHeaders(),
      ...extraHeaders,
    },
  });
}

async function readBoundedJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) throw new ResponseError(415, 'Content-Type must be application/json.');
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) throw new ResponseError(413, 'Request body is too large.');
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value?.byteLength) {
        total += value.byteLength;
        if (total > MAX_REQUEST_BYTES) {
          await reader.cancel('Request body is too large.');
          throw new ResponseError(413, 'Request body is too large.');
        }
        chunks.push(value);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new ResponseError(400, 'Request body must contain valid JSON.');
  }
}

class ResponseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireSameOrigin(request) {
  const origin = request.headers.get('origin');
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) throw new ResponseError(403, 'Same-origin request required.');
}

async function requireIdentity(request, env) {
  const identity = await authenticateRequest(request, env);
  if (!identity) throw new ResponseError(401, 'Authentication required.');
  return identity;
}

function financialErrorBody(error) {
  const body = { ok: false, error: String(error?.message || 'Financial action failed.') };
  for (const key of ['staleWriter', 'requiresEFWithdrawal', 'requiresKTBTransfer', 'split', 'preview']) {
    if (error && error[key] !== undefined) body[key] = error[key];
  }
  return body;
}

async function handleFinancialAction(payload, identity, env) {
  try {
    if (payload.apiAction === 'dashboard') {
      const snapshot = await loadFinancialSnapshot(env.DB, 'family');
      const model = buildDashboardReadModel(snapshot);
      return jsonResponse({ ...model, authenticatedUser: identity.email });
    }
    if (payload.apiAction === 'previewPayment') {
      const snapshot = await loadFinancialSnapshot(env.DB, 'family');
      return jsonResponse(buildOneOffPaymentPreview(snapshot, payload.payload || {}));
    }
    if (payload.apiAction === 'correctionCatalog') {
      const snapshot = await loadFinancialSnapshot(env.DB, 'family');
      return jsonResponse(buildCorrectionCatalog(snapshot));
    }
    if (payload.apiAction === 'correctionPreview') {
      const snapshot = await loadFinancialSnapshot(env.DB, 'family');
      return jsonResponse(previewCorrection(snapshot, payload.payload || {}));
    }
    if (payload.apiAction === 'write') {
      const writePayload = payload.payload || {};
      const action = String(writePayload.action || '').trim();
      const result = await executeRevisionClaimWrite(env.DB, {
        householdId: 'family',
        actorEmail: identity.email,
        action,
        payload: writePayload,
        planWrite: planFinancialWrite,
      });
      return jsonResponse(result);
    }
    throw new ResponseError(404, 'Unknown API action.');
  } catch (error) {
    if (error instanceof ResponseError) throw error;
    if (error instanceof FinancialWriteValidationError || error instanceof StaleFinancialWriterError || error?.validation || error?.staleWriter) {
      return jsonResponse(financialErrorBody(error));
    }
    console.error(JSON.stringify({ event: 'd1_financial_action_failure', apiAction: String(payload?.apiAction || ''), message: String(error?.message || error) }));
    return jsonResponse({ ok: false, error: 'Cloudflare financial service is unavailable.' }, 503);
  }
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const identity = await requireIdentity(request, env);
    return jsonResponse({ ok: true, identity: { email: identity.email }, expiresAt: identity.expiresAt });
  }

  if (request.method !== 'POST') throw new ResponseError(405, 'Method not allowed.');
  requireSameOrigin(request);

  if (url.pathname === '/api/auth/google') {
    const payload = await readBoundedJson(request);
    try {
      const identity = await verifyGoogleCredential(payload.credential, env);
      const token = await signSession(identity, env);
      return jsonResponse(
        { ok: true, identity: { email: identity.email } },
        200,
        { 'set-cookie': createSessionCookie(token) }
      );
    } catch (error) {
      const message = /not authorized/i.test(String(error?.message || ''))
        ? 'This Google account is not authorized for Family Cash Flow.'
        : 'Google sign-in could not be verified.';
      console.warn(JSON.stringify({ event: 'google_identity_rejected', reason: String(error?.message || error) }));
      return jsonResponse({ ok: false, error: message }, 401);
    }
  }

  if (url.pathname === '/api/auth/logout') {
    return jsonResponse({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }

  if (url.pathname === '/api/action') {
    const identity = await requireIdentity(request, env);
    const payload = await readBoundedJson(request);
    return handleFinancialAction(payload, identity, env);
  }

  throw new ResponseError(404, 'Not found.');
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health') {
    return jsonResponse({ ok: true, service: 'family-cash-flow', runtime: 'slice-d', appsScriptDependency: false });
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof ResponseError) return jsonResponse({ ok: false, error: error.message }, error.status);
      console.error(JSON.stringify({ event: 'api_failure', path: url.pathname, message: String(error?.message || error) }));
      return jsonResponse({ ok: false, error: 'Service unavailable.' }, 503);
    }
  }
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders())) headers.set(name, value);
  if (response.headers.get('content-type')?.includes('text/html')) headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleScheduled(controller, env) {
  if (controller.cron === WEEKLY_CRON) {
    const result = await runWeeklySnapshotJob(env.DB, { scheduledTime: controller.scheduledTime });
    console.log(JSON.stringify({ event: 'weekly_snapshot_completed', ...result }));
    return;
  }
  if (controller.cron === BACKUP_CRON) {
    const result = await runPortableBackup(env.DB, env.BACKUPS, {
      environment: env.BACKUP_ENVIRONMENT,
      retentionDays: Number(env.BACKUP_RETENTION_DAYS),
      scheduledTime: controller.scheduledTime,
    });
    console.log(JSON.stringify({ event: 'portable_backup_completed', ...result }));
    return;
  }
  console.warn(JSON.stringify({ event: 'unknown_scheduled_trigger', cron: controller.cron }));
}

export default {
  async fetch(request, env) {
    return handleFetch(request, env);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env));
  },
};

export { handleFetch, handleScheduled, WEEKLY_CRON, BACKUP_CRON };
