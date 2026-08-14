import { executeRevisionClaimWrite, StaleFinancialWriterError, FinancialWriteValidationError } from '../../src/write-protocol.mjs';
import { buildOneOffPaymentPreview, planFinancialWrite } from '../../src/write-actions.mjs';
import { loadFinancialSnapshot } from '../../../slice-b/src/d1-repository.mjs';

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' }
  });
}

function authorized(request, env) {
  const supplied = request.headers.get('x-slice-c-test-secret') || '';
  return supplied && supplied === String(env.TEST_SECRET || '');
}

const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(Number(ms) || 0, 0)));

export default {
  async fetch(request, env) {
    if (!authorized(request, env)) return response({ ok: false, error: 'Forbidden.' }, 403);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return response({ ok: true, service: 'slice-c-remote-test' });
    if (request.method !== 'POST') return response({ ok: false, error: 'Not found.' }, 404);

    let body;
    try { body = await request.json(); } catch { return response({ ok: false, error: 'Invalid JSON.' }, 400); }

    try {
      if (url.pathname === '/preview') {
        const snapshot = await loadFinancialSnapshot(env.DB, 'family');
        return response(buildOneOffPaymentPreview(snapshot, body.payload || {}, body.nowIso));
      }
      if (url.pathname !== '/write') return response({ ok: false, error: 'Not found.' }, 404);
      const result = await executeRevisionClaimWrite(env.DB, {
        householdId: 'family',
        actorEmail: 'slice-c-test@example.invalid',
        action: body.action,
        payload: body.payload || {},
        planWrite: planFinancialWrite,
        nowIso: body.nowIso,
        writeToken: body.writeToken,
        testOnlyForcedFailure: body.forcedFailure === true,
        testOnlyBeforeBatch: body.delayBeforeBatchMs ? async () => delay(body.delayBeforeBatchMs) : null
      });
      return response(result);
    } catch (error) {
      const extra = {};
      for (const key of ['requiresEFWithdrawal','requiresKTBTransfer','split','preview']) {
        if (error && error[key] !== undefined) extra[key] = error[key];
      }
      if (error instanceof StaleFinancialWriterError || error?.staleWriter) {
        return response({ ok: false, error: error.message, staleWriter: true, ...extra }, 409);
      }
      if (error instanceof FinancialWriteValidationError || error?.validation) {
        return response({ ok: false, error: error.message, validation: true, ...extra }, 400);
      }
      return response({ ok: false, error: String(error?.message || error) }, 500);
    }
  }
};
