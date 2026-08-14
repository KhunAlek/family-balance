import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';

export class StaleFinancialWriterError extends Error {
  constructor(message = 'Financial state changed before this action could be committed. Refresh and try again.') {
    super(message);
    this.name = 'StaleFinancialWriterError';
    this.staleWriter = true;
  }
}

export class FinancialWriteValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FinancialWriteValidationError';
    this.validation = true;
  }
}

export const statement = (sql, ...params) => ({ sql, params });

function targetForWrite(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('D1 binding is unavailable.');
  return typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
}

async function firstRow(target, sql, ...params) {
  const prepared = target.prepare(sql).bind(...params);
  if (typeof prepared.first === 'function') return prepared.first();
  const result = await prepared.run();
  return result?.results?.[0] || null;
}

function prepareSpec(target, spec) {
  if (!spec || typeof spec.sql !== 'string' || !spec.sql.trim()) throw new Error('Invalid write statement specification.');
  return target.prepare(spec.sql).bind(...(spec.params || []));
}

function isClaimConflict(error) {
  const text = String(error?.message || error || '');
  return /financial_write_claims/i.test(text) && /(UNIQUE|PRIMARY KEY|constraint)/i.test(text);
}

function defaultWriteToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `write-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function loadAuthoritativeFinancialState(db, householdId = 'family') {
  const target = targetForWrite(db);

  // Revision is deliberately read first. If another writer commits after this
  // read, it consumes the same (household_id, base_revision) claim and our
  // later atomic batch must lose on the hard uniqueness constraint.
  const revisionRow = await firstRow(
    target,
    'SELECT current_revision,last_write_token,updated_at FROM household_revisions WHERE household_id=?',
    householdId
  );
  if (!revisionRow) throw new Error(`Revision state is missing for household ${householdId}.`);

  const snapshot = await loadFinancialSnapshot(target, householdId);
  return {
    target,
    snapshot,
    baseRevision: Number(revisionRow.current_revision),
    revisionRow
  };
}

export async function executeRevisionClaimWrite(db, options) {
  const {
    householdId = 'family',
    actorEmail = '',
    action,
    payload = {},
    planWrite,
    nowIso = new Date().toISOString(),
    writeToken = defaultWriteToken(),
    testOnlyForcedFailure = false,
    testOnlyBeforeBatch = null
  } = options || {};

  if (typeof planWrite !== 'function') throw new Error('A write planner is required.');
  if (!action) throw new FinancialWriteValidationError('Write action is required.');

  const state = await loadAuthoritativeFinancialState(db, householdId);
  const { target, snapshot, baseRevision } = state;
  if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new Error('Invalid household revision state.');

  const plan = await planWrite({
    snapshot,
    householdId,
    baseRevision,
    nextRevision: baseRevision + 1,
    actorEmail,
    action,
    payload,
    nowIso,
    writeToken
  });
  if (!plan || !Array.isArray(plan.statements) || !plan.statements.length) {
    throw new Error('Write planner produced no business mutations.');
  }

  const claim = statement(
    'INSERT INTO financial_write_claims(household_id,base_revision,write_token,committed_at) VALUES(?,?,?,?)',
    householdId,
    baseRevision,
    writeToken,
    nowIso
  );
  const revisionCommit = statement(
    'UPDATE household_revisions SET current_revision=?,last_write_token=?,updated_at=? WHERE household_id=? AND current_revision=?',
    baseRevision + 1,
    writeToken,
    nowIso,
    householdId,
    baseRevision
  );

  const specs = [claim, ...plan.statements];
  if (testOnlyForcedFailure) {
    // This table intentionally does not exist. D1 batch transaction semantics
    // must roll back the claim and every preceding mutation.
    specs.push(statement('INSERT INTO __slice_c_forced_failure__(x) VALUES(1)'));
  }
  specs.push(revisionCommit);

  // Test hook only: it allows two requests to pause after both have read the
  // same authoritative revision, making the stale-writer race deterministic.
  if (typeof testOnlyBeforeBatch === 'function') await testOnlyBeforeBatch({ baseRevision, writeToken, action });

  try {
    const results = await target.batch(specs.map(spec => prepareSpec(target, spec)));
    const revisionResult = results[results.length - 1];
    const changes = Number(revisionResult?.meta?.changes ?? revisionResult?.meta?.changed_db ?? 1);
    if (Number.isFinite(changes) && changes === 0) {
      throw new StaleFinancialWriterError();
    }
    return {
      ok: true,
      action,
      baseRevision,
      revision: baseRevision + 1,
      writeToken,
      ...(plan.response || {})
    };
  } catch (error) {
    if (isClaimConflict(error) || error instanceof StaleFinancialWriterError) throw new StaleFinancialWriterError();
    throw error;
  }
}
