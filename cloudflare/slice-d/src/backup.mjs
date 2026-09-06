export const BACKUP_FORMAT = 'family-cash-flow-d1-portable-v2';

export const BACKUP_TABLES = Object.freeze([
  'households',
  'configuration',
  'one_off_categories',
  'new_function_request_receipts',
  'reporting_salary_cycles',
  'one_off_payments',
  'one_off_payment_allocations',
  'balance_history',
  'income_definitions',
  'other_income_sources',
  'other_income_source_versions',
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
]);

const CATEGORY_TABLES = ['one_off_categories', 'new_function_request_receipts'];
const REPORTING_TABLES = ['reporting_salary_cycles','one_off_payments','one_off_payment_allocations'];
const OTHER_INCOME_TABLES=['other_income_sources','other_income_source_versions'];
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

export async function buildPortableBackup(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('D1 binding is unavailable.');
  const createdAt = new Date(options.createdAt ?? Date.now()).toISOString();
  const environment = validEnvironment(options.environment);
  // Both category tables are absent in pre-0006 backups. Preserve that
  // supported restore path, but reject a partially applied increment.
  const [inventory] = await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('one_off_categories','new_function_request_receipts')")]);
  const categoryTableCount = rows(inventory).length;
  if (categoryTableCount !== 0 && categoryTableCount !== CATEGORY_TABLES.length) throw new Error('Category schema is incomplete.');
  const [reportingInventory] = await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('reporting_salary_cycles','one_off_payments','one_off_payment_allocations')")]);
  const reportingTableCount=rows(reportingInventory).length;
  if (reportingTableCount!==0 && (reportingTableCount!==REPORTING_TABLES.length || !categoryTableCount)) throw new Error('Reporting schema is incomplete.');
  const [incomeInventory]=await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('other_income_sources','other_income_source_versions')")]);
  const incomeTableCount=rows(incomeInventory).length;
  if(incomeTableCount!==0 && (incomeTableCount!==OTHER_INCOME_TABLES.length || !categoryTableCount))throw new Error('Other-income schema is incomplete.');
  const includedTables = BACKUP_TABLES.filter(table => (categoryTableCount || !CATEGORY_TABLES.includes(table)) && (reportingTableCount || !REPORTING_TABLES.includes(table)) && (incomeTableCount || !OTHER_INCOME_TABLES.includes(table)));
  const statements = [
    db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index','trigger') AND tbl_name IN (${schemaTableList}) AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END,name`),
    ...includedTables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`)),
  ];
  const results = await db.batch(statements);
  const tables = Object.fromEntries(BACKUP_TABLES.map(table => [table, []]));
  includedTables.forEach((table, index) => { tables[table] = rows(results[index + 1]); });
  const schema = rows(results[0]);
  if (!schema.every(validSchemaItem)) throw new Error('Database schema contains an unsupported object.');
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
  if (!backup.schema.every(validSchemaItem)) return false;
  const categorySchemaCount = backup.schema.filter(item => item.type === 'table' && CATEGORY_TABLES.includes(item.name)).length;
  if (categorySchemaCount !== 0 && categorySchemaCount !== CATEGORY_TABLES.length) return false;
  const reportingSchemaCount=backup.schema.filter(item=>item.type==='table' && REPORTING_TABLES.includes(item.name)).length;
  if (reportingSchemaCount!==0 && (reportingSchemaCount!==REPORTING_TABLES.length || !categorySchemaCount)) return false;
  const incomeSchemaCount=backup.schema.filter(item=>item.type==='table' && OTHER_INCOME_TABLES.includes(item.name)).length;
  if(incomeSchemaCount!==0 && (incomeSchemaCount!==OTHER_INCOME_TABLES.length || !categorySchemaCount))return false;
  for (const table of BACKUP_TABLES) {
    if ((!categorySchemaCount && CATEGORY_TABLES.includes(table)) || (!reportingSchemaCount && REPORTING_TABLES.includes(table)) || (!incomeSchemaCount && OTHER_INCOME_TABLES.includes(table))) {
      if (backup.tables[table] !== undefined && (!Array.isArray(backup.tables[table]) || backup.tables[table].length)) return false;
    } else if (!Array.isArray(backup.tables[table])) return false;
  }
  const expectedTables = await sha256Hex(JSON.stringify(backup.tables));
  const expectedPayload = await sha256Hex(JSON.stringify({ schema: backup.schema, tables: backup.tables }));
  return expectedTables === backup.integrity.tablesSha256 && expectedPayload === backup.integrity.payloadSha256;
}
