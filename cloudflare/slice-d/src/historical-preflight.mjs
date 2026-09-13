import { BACKUP_TABLES } from './backup.mjs';

export const HISTORICAL_PREFLIGHT_FORMAT = 'family-cash-flow-historical-preflight-v1';

const PRIMARY_KEYS = Object.freeze({
  households: ['household_id'], configuration: ['household_id', 'config_key'],
  one_off_categories: ['category_id'], new_function_request_receipts: ['household_id', 'request_id'],
  reporting_salary_cycles: ['household_id', 'cycle_start'], one_off_payments: ['one_off_payment_id'],
  one_off_payment_allocations: ['one_off_payment_id', 'account'], balance_history: ['balance_row_id'],
  income_definitions: ['household_id', 'source'], other_income_sources: ['other_income_source_id'],
  other_income_source_versions: ['version_id'], income_receipts: ['receipt_id'],
  other_income_receipt_parents: ['other_income_receipt_id'], other_income_receipt_allocations: ['other_income_receipt_id','account'],
  salary_cycle_state: ['household_id'], obligations: ['household_id', 'name'],
  obligation_occurrences: ['occurrence_id'], obligation_payments: ['payment_id'], goals: ['household_id', 'name'],
  obligation_payment_allocations:['payment_id','account'],
  ktb_transfers:['transfer_id'],
  ledger_movements: ['ledger_id'], weekly_snapshots: ['household_id', 'week_start'],
  financial_write_claims: ['household_id', 'base_revision'], correction_audit: ['correction_id'],
  household_revisions: ['household_id'], salary_cycle_sources: ['household_id', 'cycle_start', 'source'],
  logical_transactions: ['logical_transaction_id'], logical_transaction_versions: ['version_id'],
  logical_transaction_components: ['version_id', 'component_kind', 'component_id', 'component_role'],
  transaction_management_audit: ['operation_id'],
});

const NON_TRANSACTION_REASONS = Object.freeze({
  households: 'HOUSEHOLD_CONFIGURATION', configuration: 'HOUSEHOLD_CONFIGURATION',
  one_off_categories: 'TRANSACTION_CONFIGURATION', new_function_request_receipts: 'REQUEST_RECEIPT_AUDIT',
  reporting_salary_cycles: 'REPORTING_BOUNDARY', income_definitions: 'INCOME_CONFIGURATION',
  other_income_sources: 'INCOME_CONFIGURATION', other_income_source_versions: 'INCOME_CONFIGURATION',
  other_income_receipt_parents: 'TYPED_RECEIPT_RELATIONSHIP', other_income_receipt_allocations: 'TYPED_RECEIPT_RELATIONSHIP',
  salary_cycle_state: 'PLANNING_STATE', obligations: 'OBLIGATION_CONFIGURATION',
  obligation_occurrences: 'OBLIGATION_CONFIGURATION', goals: 'GOAL_CONFIGURATION',
  obligation_payment_allocations:'TYPED_OBLIGATION_PAYMENT_RELATIONSHIP',
  ktb_transfers:'TYPED_KTB_TRANSFER_RELATIONSHIP',
  weekly_snapshots: 'IMMUTABLE_REPORTING_SNAPSHOT', financial_write_claims: 'REVISION_CLAIM_AUDIT',
  correction_audit: 'LEGACY_CORRECTION_AUDIT', household_revisions: 'REVISION_STATE',
  salary_cycle_sources: 'SALARY_CYCLE_CONFIGURATION', logical_transactions: 'EXISTING_IDENTITY_MATERIAL',
  logical_transaction_versions: 'EXISTING_IDENTITY_MATERIAL',
  logical_transaction_components: 'EXISTING_IDENTITY_MATERIAL',
  transaction_management_audit: 'TRANSACTION_MANAGEMENT_AUDIT',
});

const text = value => String(value ?? '');
const part = value => encodeURIComponent(text(value));

function itemId(table, row) {
  const keys = PRIMARY_KEYS[table];
  if (!keys || keys.some(key => row[key] === null || row[key] === undefined || text(row[key]) === '')) {
    throw new Error(`Historical preflight cannot form a durable identity for ${table}.`);
  }
  return `${table}:${keys.map(key => `${key}=${part(row[key])}`).join('&')}`;
}

function component(table, row, componentKind, componentId, componentRole) {
  return { itemId: itemId(table, row), componentKind, componentId: text(componentId), componentRole };
}

function evidence(type, fields) {
  return { type, ...Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))) };
}

function sortById(items, key = 'itemId') {
  return items.sort((a, b) => text(a[key]).localeCompare(text(b[key])));
}

function assertInventory(tables) {
  const expected = [...BACKUP_TABLES].sort();
  const actual = Object.keys(tables || {}).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Historical preflight requires the complete reviewed table inventory.');
  for (const table of BACKUP_TABLES) if (!Array.isArray(tables[table])) throw new Error(`Historical preflight input for ${table} must be an array.`);
}

export function classifyHistoricalRows(tables) {
  assertInventory(tables);
  const sourceIds = new Set();
  for (const table of BACKUP_TABLES) for (const row of tables[table]) {
    const id = itemId(table, row);
    if (sourceIds.has(id)) throw new Error(`Duplicate durable source identity: ${id}`);
    sourceIds.add(id);
  }

  const owned = new Set();
  const logicalTransactions = [];
  const balanceObservations = [];
  const nonTransactionItems = [];
  const ambiguousLegacyItems = [];
  const take = id => {
    if (!sourceIds.has(id)) throw new Error(`Proposed component is absent from the inventory: ${id}`);
    if (owned.has(id)) throw new Error(`Duplicate component ownership: ${id}`);
    owned.add(id);
  };

  const allocationsByPayment = new Map();
  for (const row of tables.one_off_payment_allocations) {
    const list = allocationsByPayment.get(row.one_off_payment_id) || [];
    list.push(row); allocationsByPayment.set(row.one_off_payment_id, list);
  }
  const effectsByPayment = new Map();
  for (const row of tables.balance_history) if (row.one_off_payment_id !== null && row.one_off_payment_id !== undefined) {
    const list = effectsByPayment.get(row.one_off_payment_id) || [];
    list.push(row); effectsByPayment.set(row.one_off_payment_id, list);
  }
  const requests = new Map(tables.new_function_request_receipts.map(row => [`${row.household_id}\0${row.request_id}`, row]));
  for (const payment of [...tables.one_off_payments].sort((a, b) => text(a.one_off_payment_id).localeCompare(text(b.one_off_payment_id)))) {
    const allocations = allocationsByPayment.get(payment.one_off_payment_id) || [];
    const effects = effectsByPayment.get(payment.one_off_payment_id) || [];
    const allocationTotal = allocations.reduce((sum, row) => sum + Number(row.amount_satang), 0);
    const valid = allocations.length > 0 && allocationTotal === Number(payment.amount_satang) && effects.length <= 1;
    const rows = [component('one_off_payments', payment, 'one_off_payment', payment.one_off_payment_id, 'primary')];
    for (const row of allocations) rows.push(component('one_off_payment_allocations', row, 'one_off_payment_allocation', `${row.one_off_payment_id}:${row.account}`, 'allocation'));
    for (const row of effects) rows.push(component('balance_history', row, 'balance_effect', row.balance_row_id, 'cash_effect'));
    if (valid) {
      const proof = payment.legacy_origin
        ? [evidence('authoritative_mapping', { legacyOrigin: payment.legacy_origin })]
        : [evidence('typed_parent_id', { oneOffPaymentId: payment.one_off_payment_id }), evidence('request_id', { requestId: payment.request_id })];
      if (requests.has(`${payment.household_id}\0${payment.request_id}`)) proof.push(evidence('request_receipt', { requestId: payment.request_id }));
      for (const row of rows) take(row.itemId);
      logicalTransactions.push({ logicalTransactionId: `historical:one-off-payment:${part(payment.one_off_payment_id)}`, kind: 'one_off_payment', reasonCode: payment.legacy_origin ? 'AUTHORITATIVE_LEGACY_MAPPING' : 'TYPED_PARENT_AND_FOREIGN_KEYS', evidence: proof, proposedComponents: sortById(rows) });
    } else {
      const relatedItemIds = sortById(rows).map(row => row.itemId);
      for (const row of rows) {
        take(row.itemId);
        ambiguousLegacyItems.push({ itemId: row.itemId, relatedItemIds: relatedItemIds.filter(id => id !== row.itemId), reasonCode: 'INCOMPLETE_TYPED_PAYMENT_COMPONENTS', missingDurableEvidence: 'A complete allocation set and at most one typed balance effect are required.' });
      }
    }
  }

  const claims = new Map(tables.financial_write_claims.map(row => [`${row.household_id}\0${row.write_token}`, row]));
  const receiptsByToken = new Map();
  for (const row of tables.income_receipts) {
    const match = /^(.*):income:(alex|olga)$/.exec(text(row.receipt_id));
    const token = match?.[1];
    if (!token || !claims.has(`${row.household_id}\0${token}`)) continue;
    const key = `${row.household_id}\0${token}`;
    const list = receiptsByToken.get(key) || [];
    list.push(row); receiptsByToken.set(key, list);
  }
  for (const [key, receipts] of [...receiptsByToken].sort(([a], [b]) => a.localeCompare(b))) {
    const [householdId, token] = key.split('\0');
    const sameAction = new Set(receipts.map(row => `${row.source}\0${row.business_date}`)).size === 1;
    const uniqueAccounts = new Set(receipts.map(row => row.lands_in)).size === receipts.length;
    if (!sameAction || !uniqueAccounts) continue;
    const rows = receipts.map(row => component('income_receipts', row, 'income_receipt', row.receipt_id, 'receipt'));
    for (const row of rows) take(row.itemId);
    const claim = claims.get(key);
    logicalTransactions.push({ logicalTransactionId: `historical:income-receipt:${part(householdId)}:${part(token)}`, kind: receipts[0].other_income_source_id ? 'other_income_receipt' : 'salary_receipt', reasonCode: 'WRITE_TOKEN_AND_REVISION_CLAIM', evidence: [evidence('write_token', { writeToken: token }), evidence('committed_revision', { committedRevision: Number(claim.base_revision) + 1 })], proposedComponents: sortById(rows) });
  }

  for (const row of tables.balance_history) {
    const id = itemId('balance_history', row);
    if (owned.has(id)) continue;
    take(id);
    balanceObservations.push({ itemId: id, reasonCode: 'IMMUTABLE_BALANCE_OBSERVATION', evidence: [evidence('typed_primary_key', { balanceRowId: row.balance_row_id })] });
  }
  for (const row of tables.income_receipts) {
    const id = itemId('income_receipts', row); if (owned.has(id)) continue; take(id);
    ambiguousLegacyItems.push({ itemId: id, relatedItemIds: [], reasonCode: 'MISSING_DURABLE_RECEIPT_PARENT', missingDurableEvidence: 'No verified write token and revision claim identify the complete receipt action.' });
  }
  for (const row of tables.obligation_payments) {
    const id = itemId('obligation_payments', row); take(id);
    ambiguousLegacyItems.push({ itemId: id, relatedItemIds: [], reasonCode: 'MISSING_DURABLE_CASH_EFFECT_RELATIONSHIP', missingDurableEvidence: 'The payment has no typed relationship to its cash effect.' });
  }
  for (const row of tables.ledger_movements) {
    const id = itemId('ledger_movements', row); take(id);
    ambiguousLegacyItems.push({ itemId: id, relatedItemIds: [], reasonCode: 'MISSING_DURABLE_COUNTERPART_RELATIONSHIP', missingDurableEvidence: 'The movement has no typed relationship to its KTB counterpart.' });
  }
  for (const [table, reasonCode] of Object.entries(NON_TRANSACTION_REASONS)) for (const row of tables[table]) {
    const id = itemId(table, row); take(id);
    nonTransactionItems.push({ itemId: id, reasonCode });
  }
  for (const table of BACKUP_TABLES) for (const row of tables[table]) {
    const id = itemId(table, row);
    if (!owned.has(id)) throw new Error(`Historical preflight omitted source item: ${id}`);
  }
  if (owned.size !== sourceIds.size) throw new Error('Historical preflight inventory coverage is inconsistent.');

  sortById(logicalTransactions, 'logicalTransactionId'); sortById(balanceObservations);
  sortById(nonTransactionItems); sortById(ambiguousLegacyItems);
  const logicalComponentCount = logicalTransactions.reduce((sum, item) => sum + item.proposedComponents.length, 0);
  return {
    format: HISTORICAL_PREFLIGHT_FORMAT,
    schemaVersion: 1,
    counts: { sourceItems: sourceIds.size, logicalTransactions: logicalTransactions.length, logicalComponents: logicalComponentCount, balanceObservations: balanceObservations.length, nonTransactionItems: nonTransactionItems.length, ambiguousLegacyItems: ambiguousLegacyItems.length },
    logicalTransactions, balanceObservations, nonTransactionItems, ambiguousLegacyItems,
  };
}

export function serializeHistoricalPreflight(report) {
  return `${JSON.stringify(report)}\n`;
}

export async function runHistoricalPreflight(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw new Error('D1 binding is unavailable.');
  const target = typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
  const statements = BACKUP_TABLES.map(table => target.prepare(`SELECT * FROM "${table}"`));
  const results = await target.batch(statements);
  if (!Array.isArray(results) || results.length !== BACKUP_TABLES.length) throw new Error('Historical preflight received an incomplete database inventory.');
  const tables = Object.fromEntries(BACKUP_TABLES.map((table, index) => [table, results[index]?.results || []]));
  const report = classifyHistoricalRows(tables);
  return { report, serialization: serializeHistoricalPreflight(report) };
}
