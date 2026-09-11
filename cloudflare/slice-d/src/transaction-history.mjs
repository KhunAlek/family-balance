import { BACKUP_TABLES } from './backup.mjs';
import { buildTerminalTransactionReadModel } from './terminal-transaction-read-model.mjs';

export const TRANSACTION_HISTORY_FORMAT = 'family-cash-flow-transaction-history-v1';

export class TransactionHistoryError extends Error {
  constructor(code, detail, { restartRequired = false } = {}) {
    super(`${code}: ${detail}`);
    this.name = 'TransactionHistoryError';
    this.code = code;
    this.restartRequired = restartRequired;
  }
}

const fail = (code, detail, options) => { throw new TransactionHistoryError(code, detail, options); };
const text = value => String(value ?? '');
const compare = (a, b) => text(a).localeCompare(text(b));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGE_SIZE = 100;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonicalize(value[key])]));
  return value;
}

export function serializeTransactionHistory(value) { return `${JSON.stringify(canonicalize(value))}\n`; }

function validDate(value) {
  if (!DATE.test(text(value))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function stringList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => !text(item).trim())) fail('INVALID_QUERY', `${label} must be a list of non-empty values.`);
  return [...new Set(value.map(item => text(item).trim()))].sort(compare);
}

function amount(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail('INVALID_QUERY', `${label} must be positive integer satang.`);
  return parsed;
}

function normalizeQuery(payload = {}) {
  const period = text(payload.period || 'current_cycle');
  if (!['current_cycle', 'previous_cycle', 'custom', 'all'].includes(period)) fail('INVALID_QUERY', 'Unsupported history period.');
  const query = {
    period,
    customFrom: payload.customFrom === undefined ? null : text(payload.customFrom),
    customThrough: payload.customThrough === undefined ? null : text(payload.customThrough),
    text: text(payload.text).trim().toLocaleLowerCase('en-US'),
    categoryIds: stringList(payload.categoryIds, 'categoryIds'),
    kinds: stringList(payload.kinds, 'kinds'),
    accounts: stringList(payload.accounts, 'accounts'),
    exactAmountSatang: amount(payload.exactAmountSatang, 'exactAmountSatang'),
    minAmountSatang: amount(payload.minAmountSatang, 'minAmountSatang'),
    maxAmountSatang: amount(payload.maxAmountSatang, 'maxAmountSatang'),
    showAudit: payload.showAudit === true,
    actorEmails: stringList(payload.actorEmails, 'actorEmails').map(item => item.toLocaleLowerCase('en-US')),
    operationTypes: stringList(payload.operationTypes, 'operationTypes'),
    detailLogicalTransactionId: payload.detailLogicalTransactionId === undefined ? null : text(payload.detailLogicalTransactionId).trim(),
    pageSize: payload.pageSize === undefined ? 50 : Number(payload.pageSize),
  };
  if (!Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > MAX_PAGE_SIZE) fail('INVALID_QUERY', `pageSize must be between 1 and ${MAX_PAGE_SIZE}.`);
  if (period === 'custom') {
    if (!validDate(query.customFrom) || !validDate(query.customThrough) || query.customFrom > query.customThrough) fail('INVALID_QUERY', 'Custom history dates must be valid inclusive Bangkok dates in ascending order.');
  } else if (query.customFrom !== null || query.customThrough !== null) fail('INVALID_QUERY', 'Custom dates are only valid for the custom period.');
  if (query.minAmountSatang !== null && query.maxAmountSatang !== null && query.minAmountSatang > query.maxAmountSatang) fail('INVALID_QUERY', 'Minimum amount cannot exceed maximum amount.');
  if (!query.showAudit && (query.actorEmails.length || query.operationTypes.length)) fail('INVALID_QUERY', 'Audit filters require showAudit.');
  if (query.detailLogicalTransactionId === '') fail('INVALID_QUERY', 'detailLogicalTransactionId cannot be blank.');
  return query;
}

async function sha256(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(value) {
  let binary = '';
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  try {
    const normalized = text(value).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    return decoder.decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
  } catch { fail('INVALID_CURSOR', 'History cursor is invalid.', { restartRequired: true }); }
}

function householdRevision(tables, householdId) {
  const rows = tables.household_revisions.filter(row => text(row.household_id) === householdId);
  if (rows.length !== 1 || !Number.isSafeInteger(Number(rows[0].current_revision)) || Number(rows[0].current_revision) < 0) fail('REVISION_UNAVAILABLE', 'One authoritative household revision is required.');
  return Number(rows[0].current_revision);
}

function resolvePeriod(tables, householdId, query) {
  if (query.period === 'all') return { type: 'all', from: null, throughExclusive: null, throughInclusive: null };
  if (query.period === 'custom') return { type: 'custom', from: query.customFrom, throughExclusive: null, throughInclusive: query.customThrough, timezone: 'Asia/Bangkok' };
  const states = tables.salary_cycle_state.filter(row => text(row.household_id) === householdId);
  if (states.length !== 1 || !validDate(states[0].current_cycle_start)) fail('PERIOD_UNAVAILABLE', 'Recorded current salary-cycle start is unavailable.');
  const currentStart = text(states[0].current_cycle_start);
  if (query.period === 'current_cycle') {
    if (!validDate(states[0].next_salary_date) || text(states[0].next_salary_date) <= currentStart) fail('PERIOD_UNAVAILABLE', 'Recorded next salary boundary is unavailable.');
    return { type: 'current_cycle', from: currentStart, throughExclusive: text(states[0].next_salary_date), throughInclusive: null, timezone: 'Asia/Bangkok' };
  }
  const starts = [...new Set(tables.reporting_salary_cycles.filter(row => text(row.household_id) === householdId).map(row => text(row.cycle_start)).filter(validDate))].sort(compare);
  const currentIndex = starts.indexOf(currentStart);
  if (currentIndex < 1) fail('PERIOD_UNAVAILABLE', 'Adjacent factual reporting boundaries for the previous salary cycle are unavailable.');
  return { type: 'previous_cycle', from: starts[currentIndex - 1], throughExclusive: currentStart, throughInclusive: null, timezone: 'Asia/Bangkok' };
}

function inPeriod(item, period) {
  if (period.from && item.businessDate < period.from) return false;
  if (period.throughExclusive && item.businessDate >= period.throughExclusive) return false;
  if (period.throughInclusive && item.businessDate > period.throughInclusive) return false;
  return true;
}

function auditMatches(item, query) {
  if (!query.actorEmails.length && !query.operationTypes.length) return true;
  return item.auditSummary.operations.some(operation =>
    (!query.actorEmails.length || query.actorEmails.includes(text(operation.actorEmail).toLocaleLowerCase('en-US'))) &&
    (!query.operationTypes.length || query.operationTypes.includes(text(operation.operationType)))
  );
}

function matches(item, period, query) {
  if (!inPeriod(item, period)) return false;
  if (query.categoryIds.length && !query.categoryIds.includes(text(item.category?.id))) return false;
  if (query.kinds.length && !query.kinds.includes(text(item.kind))) return false;
  if (query.accounts.length && !item.allocations.some(row => query.accounts.includes(text(row.account)))) return false;
  if (query.exactAmountSatang !== null && item.totalSatang !== query.exactAmountSatang) return false;
  if (query.minAmountSatang !== null && item.totalSatang < query.minAmountSatang) return false;
  if (query.maxAmountSatang !== null && item.totalSatang > query.maxAmountSatang) return false;
  if (query.text) {
    const haystack = [item.description, item.payee, item.source, item.category?.name, ...item.allocations.map(row => row.account)].map(text).join('\n').toLocaleLowerCase('en-US');
    if (!haystack.includes(query.text)) return false;
  }
  return auditMatches(item, query);
}

function orderTransactions(a, b) {
  const date = compare(b.businessDate, a.businessDate);
  if (date) return date;
  const ar = a.committedRevision === null ? null : Number(a.committedRevision);
  const br = b.committedRevision === null ? null : Number(b.committedRevision);
  if (ar !== br) {
    if (ar === null) return 1;
    if (br === null) return -1;
    return br - ar;
  }
  return compare(b.logicalTransactionId, a.logicalTransactionId);
}

function cursorKey(item) { return [item.businessDate, item.committedRevision, item.logicalTransactionId]; }

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(cursor));
    if (parsed?.v !== 1 || !Number.isSafeInteger(parsed.revision) || !/^[a-f0-9]{64}$/.test(text(parsed.queryHash)) || !Array.isArray(parsed.after) || parsed.after.length !== 3) throw new Error('shape');
    return parsed;
  } catch (error) {
    if (error instanceof TransactionHistoryError) throw error;
    fail('INVALID_CURSOR', 'History cursor is invalid.', { restartRequired: true });
  }
}

function publicQuery(query) { return query; }

export async function buildTransactionHistory(tables, payload = {}, householdId = 'family') {
  const query = normalizeQuery(payload);
  const queryHash = await sha256(JSON.stringify(canonicalize(publicQuery(query))));
  const revision = householdRevision(tables, householdId);
  const cursor = decodeCursor(payload.cursor);
  if (cursor && cursor.queryHash !== queryHash) fail('INVALID_CURSOR', 'History cursor does not match this query.', { restartRequired: true });
  if (cursor && cursor.revision !== revision) fail('STALE_HISTORY_QUERY', 'Household revision changed; restart history from the first page.', { restartRequired: true });
  const period = resolvePeriod(tables, householdId, query);
  const canonical = buildTerminalTransactionReadModel(tables);
  const active = canonical.activeTransactions.filter(item => matches(item, period, query)).sort(orderTransactions);
  const deleted = query.showAudit ? canonical.deletedTransactions.filter(item => matches(item, period, query)).sort(orderTransactions) : [];
  let offset = 0;
  if (cursor) {
    const index = active.findIndex(item => JSON.stringify(cursorKey(item)) === JSON.stringify(cursor.after));
    if (index < 0) fail('INVALID_CURSOR', 'History cursor position is no longer valid.', { restartRequired: true });
    offset = index + 1;
  }
  const transactions = active.slice(offset, offset + query.pageSize);
  const hasMore = offset + transactions.length < active.length;
  const nextCursor = hasMore ? base64UrlEncode(JSON.stringify({ v: 1, revision, queryHash, after: cursorKey(transactions.at(-1)) })) : null;
  const totals = { resultCount: active.length, moneyInSatang: 0, moneyOutSatang: 0 };
  for (const item of active) {
    if (item.direction === 'money_in') totals.moneyInSatang += item.totalSatang;
    if (item.direction === 'money_out') totals.moneyOutSatang += item.totalSatang;
    if (!Number.isSafeInteger(totals.moneyInSatang) || !Number.isSafeInteger(totals.moneyOutSatang)) fail('TOTAL_OVERFLOW', 'History total exceeds supported exact satang.');
  }
  const detailPool = query.showAudit ? [...active, ...deleted] : active;
  const detail = query.detailLogicalTransactionId === null ? null : detailPool.find(item => item.logicalTransactionId === query.detailLogicalTransactionId) || null;
  if (query.detailLogicalTransactionId !== null && !detail) fail('TRANSACTION_NOT_FOUND', 'Transaction is not visible in this query.');
  const response = { ok: true, format: TRANSACTION_HISTORY_FORMAT, householdRevision: revision, queryHash, period, ordering: { businessDate: 'desc', committedRevision: 'desc_nulls_last', logicalTransactionId: 'desc' }, totals, transactions, pagination: { pageSize: query.pageSize, hasMore, nextCursor }, detail };
  if (query.showAudit) response.audit = { deletedTransactions: deleted, ambiguousLegacyItems: canonical.ambiguousLegacyItems };
  return response;
}

export async function runTransactionHistory(db, payload = {}, householdId = 'family') {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') fail('DATABASE_UNAVAILABLE', 'D1 binding is unavailable.');
  const target = typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
  const results = await target.batch(BACKUP_TABLES.map(table => target.prepare(`SELECT * FROM "${table}"`)));
  if (!Array.isArray(results) || results.length !== BACKUP_TABLES.length) fail('INCOMPLETE_INVENTORY', 'Database returned an incomplete inventory.');
  const tables = Object.fromEntries(BACKUP_TABLES.map((table, index) => [table, results[index]?.results || []]));
  const response = await buildTransactionHistory(tables, payload, householdId);
  return { response, serialization: serializeTransactionHistory(response) };
}
