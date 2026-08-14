export const BACKUP_FORMAT = 'family-cash-flow-d1-portable-v1';

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
]);

const encoder = new TextEncoder();

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
  const statements = [
    db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END,name"),
    ...BACKUP_TABLES.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`)),
  ];
  const results = await db.batch(statements);
  const tables = {};
  BACKUP_TABLES.forEach((table, index) => { tables[table] = rows(results[index + 1]); });
  const dataJson = JSON.stringify(tables);
  const backup = {
    format: BACKUP_FORMAT,
    environment,
    createdAt,
    householdId: options.householdId || 'family',
    schema: rows(results[0]),
    tables,
    integrity: {
      algorithm: 'SHA-256',
      tablesSha256: await sha256Hex(dataJson),
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
  if (!backup || backup.format !== BACKUP_FORMAT || !backup.tables || !backup.integrity) return false;
  for (const table of BACKUP_TABLES) if (!Array.isArray(backup.tables[table])) return false;
  const expected = await sha256Hex(JSON.stringify(backup.tables));
  return expected === backup.integrity.tablesSha256;
}
