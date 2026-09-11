import { historyRowOrder } from '../../slice-b/src/balances.mjs';
import { BACKUP_TABLES } from './backup.mjs';
import { buildTerminalTransactionReadModel } from './terminal-transaction-read-model.mjs';

export const BALANCE_HISTORY_FORMAT = 'family-cash-flow-balance-history-v1';

export class BalanceHistoryError extends Error {
  constructor(code, detail, { restartRequired = false } = {}) {
    super(`${code}: ${detail}`);
    this.name = 'BalanceHistoryError';
    this.code = code;
    this.restartRequired = restartRequired;
  }
}

const fail = (code, detail, options) => { throw new BalanceHistoryError(code, detail, options); };
const text = value => String(value ?? '');
const compare = (a, b) => text(a).localeCompare(text(b));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_PAGE_SIZE = 100;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonicalize(value[key])]));
  return value;
}

export function serializeBalanceHistory(value) { return `${JSON.stringify(canonicalize(value))}\n`; }

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
    return decoder.decode(Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), character => character.charCodeAt(0)));
  } catch { fail('INVALID_CURSOR', 'Balance history cursor is invalid.', { restartRequired: true }); }
}

function revision(tables, householdId) {
  const rows = tables.household_revisions.filter(row => text(row.household_id) === householdId);
  if (rows.length !== 1 || !Number.isSafeInteger(Number(rows[0].current_revision)) || Number(rows[0].current_revision) < 0) fail('REVISION_UNAVAILABLE', 'One authoritative household revision is required.');
  return Number(rows[0].current_revision);
}

function normalizeQuery(payload = {}) {
  const pageSize = payload.pageSize === undefined ? 50 : Number(payload.pageSize);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) fail('INVALID_QUERY', `pageSize must be between 1 and ${MAX_PAGE_SIZE}.`);
  return { pageSize };
}

function authority(row) {
  const alex = row.alex_balance_satang !== null && row.alex_balance_satang !== undefined;
  const olga = row.olga_balance_satang !== null && row.olga_balance_satang !== undefined;
  if (!alex && !olga) fail('EMPTY_BALANCE_ROW', `Balance row ${row.balance_row_id} has no authoritative account value.`);
  return { alex, olga, combined: alex && olga };
}

function orderKey(row) { return [text(row.business_date), historyRowOrder(row), Number(row.balance_row_id)]; }
function compareRows(a, b) {
  const date = compare(b.business_date, a.business_date);
  if (date) return date;
  const order = historyRowOrder(b) - historyRowOrder(a);
  return order || Number(b.balance_row_id) - Number(a.balance_row_id);
}
function after(row, anchor) {
  if (row.business_date !== anchor.business_date) return row.business_date > anchor.business_date;
  if (historyRowOrder(row) !== historyRowOrder(anchor)) return historyRowOrder(row) > historyRowOrder(anchor);
  return Number(row.balance_row_id) > Number(anchor.balance_row_id);
}

function observationDto(row) {
  const observed = authority(row);
  const alex = observed.alex ? Number(row.alex_balance_satang) : null;
  const olga = observed.olga ? Number(row.olga_balance_satang) : null;
  return {
    entryType: 'balance_observation', balanceRowId: Number(row.balance_row_id), businessDate: text(row.business_date),
    orderingKey: orderKey(row), immutable: true, observedAccounts: observed,
    balancesSatang: { alex, olga, combined: observed.combined ? alex + olga : null },
    permittedActions: { correct: false, delete: false, restore: false, undo: false, refusalCodes: ['IMMUTABLE_BALANCE_OBSERVATION'] },
  };
}

function transactionByEffect(canonical, tables) {
  const result = new Map();
  const transactionByReceipt = new Map();
  for (const transaction of [...canonical.activeTransactions, ...canonical.deletedTransactions]) {
    for (const component of transaction.components.filter(item => item.kind === 'income_receipt')) transactionByReceipt.set(text(component.id), transaction);
    for (const component of transaction.components.filter(item => item.kind === 'balance_effect')) {
      const id = text(component.id);
      if (!id || result.has(id)) fail('AMBIGUOUS_EFFECT_LINK', `Balance effect ${id || '(blank)'} does not have one canonical transaction.`);
      result.set(id, { transaction, accounts: transaction.allocations.map(item => text(item.account).replace(/ KTB$/, '')) });
    }
  }
  for (const receipt of tables.income_receipts) {
    if (receipt.source_balance_row_id === null || receipt.source_balance_row_id === undefined) continue;
    const transaction = transactionByReceipt.get(text(receipt.receipt_id));
    if (!transaction) continue;
    const id = text(receipt.source_balance_row_id), existing = result.get(id);
    if (existing && existing.transaction.logicalTransactionId !== transaction.logicalTransactionId) fail('AMBIGUOUS_EFFECT_LINK', `Balance effect ${id} links to conflicting canonical transactions.`);
    const account = text(receipt.lands_in).replace(/ KTB$/, '');
    result.set(id, { transaction, accounts: [...new Set([...(existing?.accounts || []), account])].sort(compare) });
  }
  return result;
}

function effectDto(row, linked, receiptsByBalanceRow) {
  const link = linked.get(text(row.balance_row_id));
  const transaction = link?.transaction;
  const receiptIds = receiptsByBalanceRow.get(text(row.balance_row_id)) || [];
  const valid = !!transaction;
  return {
    entryType: 'transaction_balance_effect', balanceRowId: Number(row.balance_row_id), businessDate: text(row.business_date), orderingKey: orderKey(row),
    immutable: true, typedEvidence: row.one_off_payment_id !== null && row.one_off_payment_id !== undefined
      ? { kind: 'one_off_payment_id', ids: [text(row.one_off_payment_id)] }
      : { kind: 'income_receipt_source_balance_row_id', ids: [...receiptIds].sort(compare) },
    transactionLink: valid ? { status: 'linked', logicalTransactionId: transaction.logicalTransactionId, lifecycle: transaction.lifecycle, terminalVersionId: transaction.terminalVersion.id } : { status: 'unlinked', logicalTransactionId: null, reasonCode: 'NO_CANONICAL_TYPED_COMPONENT' },
    permittedActions: { correct: false, delete: false, restore: false, undo: false, refusalCodes: ['BALANCE_HISTORY_MUTATION_NOT_ENABLED'] },
  };
}

function currentPosition(observations, effects, linked) {
  const result = {};
  for (const account of ['Alex', 'Olga']) {
    const column = `${account.toLowerCase()}_balance_satang`;
    const anchor = observations.find(row => row[column] !== null && row[column] !== undefined) || null;
    if (!anchor) { result[account.toLowerCase()] = { authoritative: false, anchorBalanceRowId: null, balanceSatang: null, appliedLogicalTransactionIds: [] }; continue; }
    let balance = Number(anchor[column]);
    const applied = [];
    for (const effect of [...effects].reverse()) {
      if (!after(effect, anchor)) continue;
      const link = linked.get(text(effect.balance_row_id));
      const transaction = link?.transaction;
      if (!transaction || transaction.lifecycle !== 'active') continue;
      if (!link.accounts.includes(account)) continue;
      const allocation = transaction.allocations.find(item => text(item.account).replace(/ KTB$/, '') === account);
      if (!allocation) continue;
      balance += transaction.direction === 'money_out' ? -Number(allocation.amountSatang) : transaction.direction === 'money_in' ? Number(allocation.amountSatang) : 0;
      applied.push(transaction.logicalTransactionId);
    }
    result[account.toLowerCase()] = { authoritative: true, anchorBalanceRowId: Number(anchor.balance_row_id), balanceSatang: balance, appliedLogicalTransactionIds: applied };
  }
  const combined = result.alex.authoritative && result.olga.authoritative ? result.alex.balanceSatang + result.olga.balanceSatang : null;
  return { accounts: result, combined: { authoritative: combined !== null, balanceSatang: combined }, rule: 'latest_account_observation_plus_strictly_subsequent_linked_terminal_effects' };
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(value));
    if (parsed?.v !== 1 || !Number.isSafeInteger(parsed.revision) || !/^[a-f0-9]{64}$/.test(text(parsed.queryHash)) || !Array.isArray(parsed.after) || parsed.after.length !== 3) throw new Error('shape');
    return parsed;
  } catch (error) {
    if (error instanceof BalanceHistoryError) throw error;
    fail('INVALID_CURSOR', 'Balance history cursor is invalid.', { restartRequired: true });
  }
}

export async function buildBalanceHistory(tables, payload = {}, householdId = 'family') {
  if (!tables || BACKUP_TABLES.some(table => !Array.isArray(tables[table]))) fail('INCOMPLETE_INVENTORY', 'Balance history requires the complete reviewed table inventory.');
  const query = normalizeQuery(payload);
  const queryHash = await sha256(JSON.stringify(query));
  const householdRevision = revision(tables, householdId);
  const cursor = decodeCursor(payload.cursor);
  if (cursor && cursor.queryHash !== queryHash) fail('INVALID_CURSOR', 'Balance history cursor does not match this query.', { restartRequired: true });
  if (cursor && cursor.revision !== householdRevision) fail('STALE_BALANCE_HISTORY_QUERY', 'Household revision changed; restart Balance history.', { restartRequired: true });
  const canonical = buildTerminalTransactionReadModel(tables);
  const linked = transactionByEffect(canonical, tables);
  const rows = tables.balance_history.filter(row => text(row.household_id) === householdId).sort(compareRows);
  const receiptsByBalanceRow = new Map();
  for (const receipt of tables.income_receipts.filter(row => text(row.household_id) === householdId && row.source_balance_row_id !== null && row.source_balance_row_id !== undefined)) {
    const key = text(receipt.source_balance_row_id), list = receiptsByBalanceRow.get(key) || [];
    list.push(text(receipt.receipt_id)); receiptsByBalanceRow.set(key, list);
  }
  const isEffect = row => row.one_off_payment_id !== null && row.one_off_payment_id !== undefined || receiptsByBalanceRow.has(text(row.balance_row_id));
  const observations = rows.filter(row => !isEffect(row));
  const effects = rows.filter(isEffect);
  const timeline = rows.map(row => isEffect(row) ? effectDto(row, linked, receiptsByBalanceRow) : observationDto(row));
  let offset = 0;
  if (cursor) {
    const index = timeline.findIndex(item => JSON.stringify(item.orderingKey) === JSON.stringify(cursor.after));
    if (index < 0) fail('INVALID_CURSOR', 'Balance history cursor position is no longer valid.', { restartRequired: true });
    offset = index + 1;
  }
  const entries = timeline.slice(offset, offset + query.pageSize);
  const hasMore = offset + entries.length < timeline.length;
  const nextCursor = hasMore ? base64UrlEncode(JSON.stringify({ v: 1, revision: householdRevision, queryHash, after: entries.at(-1).orderingKey })) : null;
  return { ok: true, format: BALANCE_HISTORY_FORMAT, householdRevision, queryHash,
    counts: { entries: timeline.length, observations: observations.length, transactionEffects: effects.length },
    ordering: { businessDate: 'desc', committedSourceOrder: 'desc', balanceRowId: 'desc' }, entries,
    pagination: { pageSize: query.pageSize, hasMore, nextCursor }, currentPosition: currentPosition(observations, effects, linked) };
}

export async function runBalanceHistory(db, payload = {}, householdId = 'family') {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') fail('DATABASE_UNAVAILABLE', 'D1 binding is unavailable.');
  const target = typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
  const results = await target.batch(BACKUP_TABLES.map(table => target.prepare(`SELECT * FROM "${table}"`)));
  if (!Array.isArray(results) || results.length !== BACKUP_TABLES.length) fail('INCOMPLETE_INVENTORY', 'Database returned an incomplete inventory.');
  const tables = Object.fromEntries(BACKUP_TABLES.map((table, index) => [table, results[index]?.results || []]));
  const response = await buildBalanceHistory(tables, payload, householdId);
  return { response, serialization: serializeBalanceHistory(response) };
}
