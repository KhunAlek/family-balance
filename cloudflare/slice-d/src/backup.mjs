export const BACKUP_FORMAT = 'family-cash-flow-d1-portable-v2';

export const BACKUP_TABLES = Object.freeze([
  'households',
  'configuration',
  'one_off_categories',
  'new_function_request_receipts',
  'reporting_salary_cycles',
  'one_off_payments',
  'one_off_payment_allocations',
  'obligations',
  'obligation_occurrences',
  'obligation_payments',
  'obligation_payment_allocations',
  'balance_history',
  'ktb_transfers',
  'income_definitions',
  'other_income_sources',
  'other_income_source_versions',
  'other_income_receipt_parents',
  'income_receipts',
  'other_income_receipt_allocations',
  'salary_cycle_state',
  'goals',
  'ledger_movements',
  'fund_movements',
  'salary_receipt_parents',
  'weekly_snapshots',
  'financial_write_claims',
  'correction_audit',
  'household_revisions',
  'salary_cycle_sources',
  'logical_transactions',
  'logical_transaction_versions',
  'logical_transaction_components',
  'transaction_management_audit',
]);

const CATEGORY_TABLES = ['one_off_categories', 'new_function_request_receipts'];
const REPORTING_TABLES = ['reporting_salary_cycles','one_off_payments','one_off_payment_allocations'];
const OTHER_INCOME_TABLES=['other_income_sources','other_income_source_versions'];
const OTHER_INCOME_RECEIPT_TABLES=['other_income_receipt_parents','other_income_receipt_allocations'];
const OBLIGATION_PAYMENT_TABLES=['obligation_payment_allocations'];
const KTB_TRANSFER_TABLES=['ktb_transfers'];
const FUND_MOVEMENT_TABLES=['fund_movements'];
const SALARY_RECEIPT_TABLES=['salary_receipt_parents'];
const TRANSACTION_IDENTITY_TABLES = [
  'logical_transactions',
  'logical_transaction_versions',
  'logical_transaction_components',
  'transaction_management_audit',
];
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

function hasExactTableInventory(tables) {
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return false;
  const names = Object.keys(tables).sort();
  return names.length === BACKUP_TABLES.length
    && names.every((name, index) => name === [...BACKUP_TABLES].sort()[index]);
}

function hasExactRowCounts(tables, rowCounts) {
  if (!rowCounts || typeof rowCounts !== 'object' || Array.isArray(rowCounts)) return false;
  const names = Object.keys(rowCounts).sort();
  const expected = [...BACKUP_TABLES].sort();
  return names.length === expected.length
    && names.every((name, index) => name === expected[index])
    && BACKUP_TABLES.every(table => Number.isSafeInteger(rowCounts[table])
      && rowCounts[table] >= 0
      && rowCounts[table] === tables[table].length);
}

function hasValidIdentityRelationships(tables) {
  const transactions = new Map(tables.logical_transactions.map(row => [String(row.logical_transaction_id), row]));
  const versions = new Map(tables.logical_transaction_versions.map(row => [String(row.version_id), row]));
  const audits = new Map(tables.transaction_management_audit.map(row => [String(row.operation_id), row]));
  if (transactions.size !== tables.logical_transactions.length
    || versions.size !== tables.logical_transaction_versions.length
    || audits.size !== tables.transaction_management_audit.length) return false;

  const versionNumbers = new Set();
  for (const version of versions.values()) {
    const transactionId = String(version.logical_transaction_id);
    if (!transactions.has(transactionId)) return false;
    const sequenceKey = `${transactionId}\u0000${version.version_number}`;
    if (versionNumbers.has(sequenceKey)) return false;
    versionNumbers.add(sequenceKey);
    if (version.operation_type === 'created') {
      if (version.management_operation_id !== null && version.management_operation_id !== undefined) return false;
    } else {
      const audit = audits.get(String(version.management_operation_id));
      if (!audit || String(audit.logical_transaction_id) !== transactionId
        || String(audit.resulting_version_id) !== String(version.version_id)
        || String(audit.operation_type) !== String(version.operation_type)) return false;
    }
  }
  for (const transaction of transactions.values()) {
    const terminal = versions.get(String(transaction.terminal_version_id));
    if (!terminal || String(terminal.logical_transaction_id) !== String(transaction.logical_transaction_id)) return false;
    if (terminal.operation_type === 'deleted' && transaction.lifecycle_status !== 'deleted') return false;
    if (['created','corrected','restored','replaced'].includes(terminal.operation_type) && transaction.lifecycle_status !== 'active') return false;
    const familyVersions = [...versions.values()].filter(row => String(row.logical_transaction_id) === String(transaction.logical_transaction_id));
    if (!familyVersions.length || Math.max(...familyVersions.map(row => Number(row.version_number))) !== Number(terminal.version_number)) return false;
  }
  for (const component of tables.logical_transaction_components) {
    if (!versions.has(String(component.version_id))) return false;
  }
  for (const audit of audits.values()) {
    const transactionId = String(audit.logical_transaction_id);
    const prior = versions.get(String(audit.prior_version_id));
    const resulting = versions.get(String(audit.resulting_version_id));
    if (!transactions.has(transactionId) || !prior || !resulting
      || String(prior.logical_transaction_id) !== transactionId
      || String(resulting.logical_transaction_id) !== transactionId
      || Number(resulting.version_number) !== Number(prior.version_number) + 1
      || String(resulting.management_operation_id) !== String(audit.operation_id)
      || String(resulting.operation_type) !== String(audit.operation_type)
      || Number(resulting.committed_revision) !== Number(audit.committed_revision)) return false;
  }
  return true;
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
  const [identityInventory] = await db.batch([db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${TRANSACTION_IDENTITY_TABLES.map(() => '?').join(',')})`).bind(...TRANSACTION_IDENTITY_TABLES)]);
  const identityTableCount = rows(identityInventory).length;
  if (identityTableCount !== 0 && identityTableCount !== TRANSACTION_IDENTITY_TABLES.length) throw new Error('Transaction identity schema is incomplete.');
  const [incomeReceiptInventory]=await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('other_income_receipt_parents','other_income_receipt_allocations')")]);
  const incomeReceiptTableCount=rows(incomeReceiptInventory).length;
  if(incomeReceiptTableCount!==0 && (incomeReceiptTableCount!==OTHER_INCOME_RECEIPT_TABLES.length || incomeTableCount!==OTHER_INCOME_TABLES.length || identityTableCount!==TRANSACTION_IDENTITY_TABLES.length))throw new Error('Other-income receipt schema is incomplete.');
  const [obligationPaymentInventory]=await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='obligation_payment_allocations'")]);
  const obligationPaymentTableCount=rows(obligationPaymentInventory).length;
  if(obligationPaymentTableCount!==0 && (obligationPaymentTableCount!==OBLIGATION_PAYMENT_TABLES.length || identityTableCount!==TRANSACTION_IDENTITY_TABLES.length))throw new Error('Obligation-payment management schema is incomplete.');
  const [ktbInventory]=await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ktb_transfers'")]);const ktbTableCount=rows(ktbInventory).length;if(ktbTableCount&&identityTableCount!==TRANSACTION_IDENTITY_TABLES.length)throw new Error('KTB-transfer management schema is incomplete.');
  const [fundInventory]=await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fund_movements'")]);const fundTableCount=rows(fundInventory).length;if(fundTableCount&&identityTableCount!==TRANSACTION_IDENTITY_TABLES.length)throw new Error('Fund-movement management schema is incomplete.');
  const [salaryInventory]=await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE (type='table' AND name='salary_receipt_parents') OR (type='trigger' AND name IN ('salary_receipt_parent_validate','salary_receipt_parent_immutable','salary_receipt_parent_delete_forbidden','salary_income_definition_update_forbidden','salary_income_definition_delete_forbidden'))")]);const salaryNames=new Set(rows(salaryInventory).map(row=>row.name)),salaryTableCount=salaryNames.has('salary_receipt_parents')?1:0;if(salaryTableCount&&identityTableCount!==TRANSACTION_IDENTITY_TABLES.length)throw new Error('Salary-receipt management schema is incomplete.');if(salaryTableCount&&salaryNames.size!==6)throw new Error('Salary-receipt management schema is incomplete.');
  const includedTables = BACKUP_TABLES.filter(table => (categoryTableCount || !CATEGORY_TABLES.includes(table)) && (reportingTableCount || !REPORTING_TABLES.includes(table)) && (incomeTableCount || !OTHER_INCOME_TABLES.includes(table)) && (incomeReceiptTableCount || !OTHER_INCOME_RECEIPT_TABLES.includes(table)) && (obligationPaymentTableCount || !OBLIGATION_PAYMENT_TABLES.includes(table)) && (ktbTableCount || !KTB_TRANSFER_TABLES.includes(table)) && (fundTableCount || !FUND_MOVEMENT_TABLES.includes(table)) && (salaryTableCount || !SALARY_RECEIPT_TABLES.includes(table)) && (identityTableCount || !TRANSACTION_IDENTITY_TABLES.includes(table)));
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
  if (backup.integrity.algorithm !== 'SHA-256') return false;
  if (!backup.schema.every(validSchemaItem)) return false;
  const schemaKeys = backup.schema.map(item => `${item.type}\u0000${item.name}`);
  if (new Set(schemaKeys).size !== schemaKeys.length) return false;
  if (!hasExactTableInventory(backup.tables) || !BACKUP_TABLES.every(table => Array.isArray(backup.tables[table]))) return false;
  if (!hasExactRowCounts(backup.tables, backup.integrity.rowCounts)) return false;
  const categorySchemaCount = backup.schema.filter(item => item.type === 'table' && CATEGORY_TABLES.includes(item.name)).length;
  if (categorySchemaCount !== 0 && categorySchemaCount !== CATEGORY_TABLES.length) return false;
  const reportingSchemaCount=backup.schema.filter(item=>item.type==='table' && REPORTING_TABLES.includes(item.name)).length;
  if (reportingSchemaCount!==0 && (reportingSchemaCount!==REPORTING_TABLES.length || !categorySchemaCount)) return false;
  const incomeSchemaCount=backup.schema.filter(item=>item.type==='table' && OTHER_INCOME_TABLES.includes(item.name)).length;
  if(incomeSchemaCount!==0 && (incomeSchemaCount!==OTHER_INCOME_TABLES.length || !categorySchemaCount))return false;
  const identitySchemaCount = backup.schema.filter(item => item.type === 'table' && TRANSACTION_IDENTITY_TABLES.includes(item.name)).length;
  if (identitySchemaCount !== 0 && identitySchemaCount !== TRANSACTION_IDENTITY_TABLES.length) return false;
  const incomeReceiptSchemaCount=backup.schema.filter(item=>item.type==='table' && OTHER_INCOME_RECEIPT_TABLES.includes(item.name)).length;
  if(incomeReceiptSchemaCount!==0 && (incomeReceiptSchemaCount!==OTHER_INCOME_RECEIPT_TABLES.length || incomeSchemaCount!==OTHER_INCOME_TABLES.length || identitySchemaCount!==TRANSACTION_IDENTITY_TABLES.length))return false;
  const obligationPaymentSchemaCount=backup.schema.filter(item=>item.type==='table'&&OBLIGATION_PAYMENT_TABLES.includes(item.name)).length;
  if(obligationPaymentSchemaCount!==0&&(obligationPaymentSchemaCount!==OBLIGATION_PAYMENT_TABLES.length||identitySchemaCount!==TRANSACTION_IDENTITY_TABLES.length))return false;
  const ktbSchemaCount=backup.schema.filter(item=>item.type==='table'&&KTB_TRANSFER_TABLES.includes(item.name)).length;if(ktbSchemaCount&&(ktbSchemaCount!==1||identitySchemaCount!==TRANSACTION_IDENTITY_TABLES.length))return false;
  const fundSchemaCount=backup.schema.filter(item=>item.type==='table'&&FUND_MOVEMENT_TABLES.includes(item.name)).length;if(fundSchemaCount&&(fundSchemaCount!==1||identitySchemaCount!==TRANSACTION_IDENTITY_TABLES.length))return false;
  const salarySchemaNames=new Set(backup.schema.filter(item=>item.tbl_name==='salary_receipt_parents'||['salary_income_definition_update_forbidden','salary_income_definition_delete_forbidden'].includes(item.name)).map(item=>item.name));
  const salarySchemaCount=salarySchemaNames.has('salary_receipt_parents')?1:0;
  if(salarySchemaCount&&(identitySchemaCount!==TRANSACTION_IDENTITY_TABLES.length||salarySchemaNames.size!==6||!['salary_receipt_parent_validate','salary_receipt_parent_immutable','salary_receipt_parent_delete_forbidden','salary_income_definition_update_forbidden','salary_income_definition_delete_forbidden'].every(name=>salarySchemaNames.has(name))))return false;
  for (const table of BACKUP_TABLES) {
    if ((!categorySchemaCount && CATEGORY_TABLES.includes(table)) || (!reportingSchemaCount && REPORTING_TABLES.includes(table)) || (!incomeSchemaCount && OTHER_INCOME_TABLES.includes(table)) || (!incomeReceiptSchemaCount && OTHER_INCOME_RECEIPT_TABLES.includes(table)) || (!obligationPaymentSchemaCount&&OBLIGATION_PAYMENT_TABLES.includes(table)) || (!ktbSchemaCount&&KTB_TRANSFER_TABLES.includes(table)) || (!fundSchemaCount&&FUND_MOVEMENT_TABLES.includes(table)) || (!salarySchemaCount&&SALARY_RECEIPT_TABLES.includes(table)) || (!identitySchemaCount && TRANSACTION_IDENTITY_TABLES.includes(table))) {
      if (backup.tables[table] !== undefined && (!Array.isArray(backup.tables[table]) || backup.tables[table].length)) return false;
    } else if (!Array.isArray(backup.tables[table])) return false;
  }
  const expectedTables = await sha256Hex(JSON.stringify(backup.tables));
  const expectedPayload = await sha256Hex(JSON.stringify({ schema: backup.schema, tables: backup.tables }));
  if (expectedTables !== backup.integrity.tablesSha256 || expectedPayload !== backup.integrity.payloadSha256) return false;
  return !identitySchemaCount || hasValidIdentityRelationships(backup.tables);
}
