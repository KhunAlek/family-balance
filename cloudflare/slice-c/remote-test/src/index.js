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

async function stateEvidence(db) {
  const results = await db.batch([
    db.prepare("SELECT current_revision,last_write_token FROM household_revisions WHERE household_id='family'"),
    db.prepare('SELECT COUNT(*) AS n FROM financial_write_claims'),
    db.prepare('SELECT COUNT(*) AS n FROM correction_audit'),
    db.prepare('SELECT COUNT(*) AS n FROM balance_history'),
    db.prepare('SELECT COUNT(*) AS n FROM ledger_movements'),
    db.prepare('SELECT COUNT(*) AS n FROM obligation_payments'),
    db.prepare("SELECT business_date,alex_balance_satang,olga_balance_satang,one_off_payment_name,source_sheet FROM balance_history WHERE household_id='family' ORDER BY business_date DESC,sheet_order DESC LIMIT 1"),
    db.prepare("SELECT account,direction,amount_satang,business_date,source_sheet FROM ledger_movements WHERE household_id='family' ORDER BY business_date DESC,sheet_order DESC LIMIT 1"),
    db.prepare("SELECT payment_id,payment_date,occurrence_due_date,actual_amount_satang FROM obligation_payments WHERE household_id='family' ORDER BY rowid DESC LIMIT 1"),
    db.prepare('SELECT COUNT(*) AS n FROM weekly_snapshots'),
    db.prepare("SELECT current_cycle_start,next_salary_date FROM salary_cycle_state WHERE household_id='family'"),
    db.prepare("SELECT cycle_start,source FROM salary_cycle_sources WHERE household_id='family' ORDER BY cycle_start,source"),
    db.prepare("SELECT name,target_amount_satang,priority_rank,status,target_date FROM goals WHERE household_id='family' ORDER BY priority_rank,name")
  ]);
  const rows = index => results[index]?.results || [];
  return {
    revision: Number(rows(0)[0]?.current_revision || 0),
    lastWriteToken: rows(0)[0]?.last_write_token || null,
    claims: Number(rows(1)[0]?.n || 0),
    corrections: Number(rows(2)[0]?.n || 0),
    balanceRows: Number(rows(3)[0]?.n || 0),
    ledgerRows: Number(rows(4)[0]?.n || 0),
    paymentRows: Number(rows(5)[0]?.n || 0),
    latestBalance: rows(6)[0] || null,
    latestLedger: rows(7)[0] || null,
    latestPayment: rows(8)[0] || null,
    weeklyRows: Number(rows(9)[0]?.n || 0),
    salaryCycle: rows(10)[0] || null,
    salaryCycleSources: rows(11),
    goals: rows(12)
  };
}

export default {
  async fetch(request, env) {
    if (!authorized(request, env)) return response({ ok: false, error: 'Forbidden.' }, 403);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return response({ ok: true, service: 'slice-c-remote-test' });
    if (request.method === 'GET' && url.pathname === '/state') return response({ ok: true, ...(await stateEvidence(env.DB)) });
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
