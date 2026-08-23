export const BACKUP_FORMAT = 'family-cash-flow-d1-portable-v3';

export const BACKUP_TABLES = Object.freeze([
  'households',
  'configuration',
  'balance_history',
  'income_definitions',
  'income_receipts',
  'salary_cycle_state',
  'obligations',
  'obligation_occurrences',
  'obligation_payments',
  'goals',
  'ledger_movements',
  'weekly_snapshots',
  'financial_write_claims',
  'correction_audit',
  'household_revisions',
  'salary_cycle_sources',
  'cycle_plans',
  'cycle_plan_events',
  'cycle_commitments',
  'commitment_events',
  'goal_withdrawal_classifications',
  'weekly_snapshot_model_versions',
]);

const encoder = new TextEncoder();
const schemaTableList = BACKUP_TABLES.map(table => `'${table}'`).join(',');

function validSchemaItem(item) {
  const type = String(item?.type || '').toLowerCase();
  const name = String(item?.name || '');
  const table = String(item?.tbl_name || '');
  const sql = String(item?.sql || '').trim();
  if (!['table', 'index', 'trigger'].includes(type) || !BACKUP_TABLES.includes(table) || !sql) return false;
  if (/^(?:sqlite_|_cf_)/i.test(name)) return false;
  return type !== 'table' || name === table;
}

function validEnvironment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) throw new Error('BACKUP_ENVIRONMENT is invalid.');
  return normalized;
}

function timestampKey(environment, createdAt) {
  const instant = new Date(createdAt);
  if (!Number.isFinite(instant.getTime())) throw new Error('Backup timestamp is invalid.');
  const iso = instant.toISOString();
  const day = iso.slice(0, 10).replace(/-/g, '/');
  const filename = iso.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return `${environment}/${day}/${filename}.json`;
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function rows(result) {
  return result?.results || [];
}

function tableKey(row, columns) {
  return columns.map(column => String(row?.[column] ?? '')).join('\u0000');
}

function hasExactBackupTables(tables) {
  const actual = Object.keys(tables || {}).sort();
  const expected = [...BACKUP_TABLES].sort();
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function validateV3Relations(tables) {
  const households = new Set(tables.households.map(row => String(row.household_id)));
  const goals = new Set(tables.goals.map(row => tableKey(row, ['household_id', 'name'])));
  const ledger = new Map(tables.ledger_movements.map(row => [Number(row.ledger_id), row]));
  const weekly = new Set(tables.weekly_snapshots.map(row => tableKey(row, ['household_id', 'week_start'])));
  const plans = new Set(tables.cycle_plans.map(row => tableKey(row, ['household_id', 'cycle_start'])));
  const commitments = new Map(tables.cycle_commitments.map(row => [String(row.commitment_id), row]));

  const commitmentIdentities = new Set();
  for (const row of tables.cycle_commitments) {
    if (!households.has(String(row.household_id))) return false;
    if (!plans.has(tableKey(row, ['household_id', 'cycle_start']))) return false;
    const identity = [row.household_id, row.cycle_start, row.commitment_type, row.destination_name ?? ''].join('\u0000');
    if (commitmentIdentities.has(identity)) return false;
    commitmentIdentities.add(identity);
  }
  for (const row of tables.cycle_plan_events) {
    if (!plans.has(tableKey(row, ['household_id', 'cycle_start']))) return false;
  }
  for (const row of tables.commitment_events) {
    const parent = commitments.get(String(row.commitment_id));
    if (!parent || String(parent.household_id) !== String(row.household_id)) return false;
  }

  const classifiedLedger = new Set();
  for (const row of tables.goal_withdrawal_classifications) {
    const ledgerId = Number(row.ledger_id);
    if (classifiedLedger.has(ledgerId)) return false;
    classifiedLedger.add(ledgerId);
    const movement = ledger.get(ledgerId);
    if (!movement) return false;
    if (String(movement.household_id) !== String(row.household_id)) return false;
    if (String(movement.account) !== String(row.goal_name)) return false;
    if (String(movement.direction) !== 'Withdrawal') return false;
    if (!Number.isInteger(Number(movement.amount_satang)) || Number(movement.amount_satang) <= 0) return false;
    if (!goals.has(tableKey(row, ['household_id', 'goal_name']))) return false;
    if (!['goal_purpose', 'non_purpose'].includes(String(row.use_classification))) return false;
  }

  for (const row of tables.weekly_snapshot_model_versions) {
    if (String(row.planning_model_version) !== 'v3') return false;
    if (!weekly.has(tableKey(row, ['household_id', 'week_start']))) return false;
  }
  return true;
}

export async function buildPortableBackup(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('D1 binding is unavailable.');
  const createdAt = new Date(options.createdAt ?? Date.now()).toISOString();
  const environment = validEnvironment(options.environment);
  const statements = [
    db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index','trigger') AND tbl_name IN (${schemaTableList}) AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END,name`),
    ...BACKUP_TABLES.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`)),
  ];
  const results = await db.batch(statements);
  const tables = {};
  BACKUP_TABLES.forEach((table, index) => { tables[table] = rows(results[index + 1]); });
  const schema = rows(results[0]);
  if (!schema.every(validSchemaItem)) throw new Error('Database schema contains an unsupported object.');
  if (!validateV3Relations(tables)) throw new Error('Database contains invalid v3 backup relations.');
  const dataJson = JSON.stringify(tables);
  const payloadJson = JSON.stringify({ schema, tables });
  const backup = {
    format: BACKUP_FORMAT,
    environment,
    createdAt,
    householdId: options.householdId || 'family',
    schema,
    tables,
    integrity: {
      algorithm: 'SHA-256',
      tablesSha256: await sha256Hex(dataJson),
      payloadSha256: await sha256Hex(payloadJson),
      rowCounts: Object.fromEntries(BACKUP_TABLES.map(table => [table, tables[table].length])),
    },
  };
  return { key: timestampKey(environment, createdAt), backup, json: JSON.stringify(backup) };
}

export async function prunePortableBackups(bucket, options = {}) {
  if (!bucket || typeof bucket.list !== 'function' || typeof bucket.delete !== 'function') throw new Error('R2 backup binding is unavailable.');
  const environment = validEnvironment(options.environment);
  const retentionDays = Number(options.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('Backup retention must be between 1 and 3650 days.');
  const cutoff = new Date((options.now ?? Date.now()) - retentionDays * 86400000);
  let cursor;
  let deleted = 0;
  do {
    const page = await bucket.list({ prefix: `${environment}/`, cursor, limit: 1000 });
    const keys = (page.objects || [])
      .filter(object => object.uploaded instanceof Date && object.uploaded < cutoff)
      .map(object => object.key);
    if (keys.length) {
      await bucket.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

export async function runPortableBackup(db, bucket, options = {}) {
  if (!bucket || typeof bucket.put !== 'function') throw new Error('R2 backup binding is unavailable.');
  const environment = validEnvironment(options.environment);
  const createdAt = options.createdAt ?? options.scheduledTime ?? Date.now();
  const output = await buildPortableBackup(db, { ...options, environment, createdAt });
  await bucket.put(output.key, output.json, {
    httpMetadata: { contentType: 'application/json; charset=UTF-8' },
    customMetadata: {
      format: BACKUP_FORMAT,
      environment,
      tablesSha256: output.backup.integrity.tablesSha256,
    },
  });
  const deleted = await prunePortableBackups(bucket, {
    environment,
    retentionDays: options.retentionDays,
    now: new Date(createdAt).getTime(),
  });
  return {
    ok: true,
    action: 'portableBackup',
    key: output.key,
    createdAt: output.backup.createdAt,
    rowCounts: output.backup.integrity.rowCounts,
    tablesSha256: output.backup.integrity.tablesSha256,
    pruned: deleted,
  };
}

export async function verifyPortableBackup(backup) {
  if (!backup || backup.format !== BACKUP_FORMAT || !Array.isArray(backup.schema) || !backup.tables || !backup.integrity) return false;
  if (!backup.schema.every(validSchemaItem) || !hasExactBackupTables(backup.tables)) return false;
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(backup.tables[table])) return false;
    if (Number(backup.integrity.rowCounts?.[table]) !== backup.tables[table].length) return false;
  }
  if (!validateV3Relations(backup.tables)) return false;
  const expectedTables = await sha256Hex(JSON.stringify(backup.tables));
  const expectedPayload = await sha256Hex(JSON.stringify({ schema: backup.schema, tables: backup.tables }));
  return expectedTables === backup.integrity.tablesSha256 && expectedPayload === backup.integrity.payloadSha256;
}
