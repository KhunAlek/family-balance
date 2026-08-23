export const BACKUP_FORMAT = 'family-cash-flow-d1-portable-v3';
export const SCHEMA_MANIFEST_VERSION = 'gate1-v1';

const V2_TABLES = Object.freeze([
  'households','configuration','balance_history','income_definitions','income_receipts','salary_cycle_state',
  'obligations','obligation_occurrences','obligation_payments','goals','ledger_movements','weekly_snapshots',
  'financial_write_claims','correction_audit','household_revisions','salary_cycle_sources',
]);

export const BACKUP_TABLES = Object.freeze([
  ...V2_TABLES,
  'cycle_plans','cycle_plan_events','cycle_commitments','commitment_events',
  'goal_withdrawal_classifications','goal_withdrawal_effect_events','weekly_snapshot_model_versions',
]);

const tableRequirement = name => ({ name, type: 'table', table: name });
const objectRequirement = (name, type, table, sqlIncludes = []) => ({ name, type, table, sqlIncludes });

const V2_REQUIRED_SCHEMA = Object.freeze([
  ...V2_TABLES.map(tableRequirement),
  objectRequirement('idx_balance_history_date','index','balance_history'),
  objectRequirement('idx_obligation_payments_occurrence','index','obligation_payments'),
  objectRequirement('idx_ledger_account_date','index','ledger_movements'),
  objectRequirement('household_revision_increment_only','trigger','household_revisions'),
]);

const GATE1_REQUIRED_SCHEMA = Object.freeze([
  ...V2_REQUIRED_SCHEMA,
  tableRequirement('cycle_plans'),
  tableRequirement('cycle_plan_events'),
  tableRequirement('cycle_commitments'),
  tableRequirement('commitment_events'),
  tableRequirement('goal_withdrawal_classifications'),
  tableRequirement('goal_withdrawal_effect_events'),
  tableRequirement('weekly_snapshot_model_versions'),
  objectRequirement('uq_cycle_commitment_identity','index','cycle_commitments'),
  objectRequirement('uq_cycle_commitment_household_id','index','cycle_commitments'),
  objectRequirement('uq_goal_withdrawal_classification_ledger','index','goal_withdrawal_classifications'),
  objectRequirement('uq_goal_withdrawal_classification_household_ledger','index','goal_withdrawal_classifications'),
  objectRequirement('uq_goal_withdrawal_effect_superseded','index','goal_withdrawal_effect_events'),
  objectRequirement('uq_goal_withdrawal_effect_authoritative','index','goal_withdrawal_effect_events'),
  objectRequirement('uq_goal_withdrawal_effect_correction','index','goal_withdrawal_effect_events'),
  objectRequirement('uq_goal_withdrawal_effect_write_token','index','goal_withdrawal_effect_events'),
  objectRequirement('cycle_plan_events_append_only_update','trigger','cycle_plan_events'),
  objectRequirement('cycle_plan_events_append_only_delete','trigger','cycle_plan_events'),
  objectRequirement('commitment_events_append_only_update','trigger','commitment_events'),
  objectRequirement('commitment_events_append_only_delete','trigger','commitment_events'),
  objectRequirement('goal_withdrawal_classification_validate_insert','trigger','goal_withdrawal_classifications',[
    "typeof(l.amount_satang) = 'integer'",'l.amount_satang > 0'
  ]),
  objectRequirement('goal_withdrawal_classification_append_only_update','trigger','goal_withdrawal_classifications'),
  objectRequirement('goal_withdrawal_classification_append_only_delete','trigger','goal_withdrawal_classifications'),
  objectRequirement('goal_withdrawal_effect_validate_insert','trigger','goal_withdrawal_effect_events'),
  objectRequirement('goal_withdrawal_effect_append_only_update','trigger','goal_withdrawal_effect_events'),
  objectRequirement('goal_withdrawal_effect_append_only_delete','trigger','goal_withdrawal_effect_events'),
  objectRequirement('classified_goal_withdrawal_ledger_protect_update','trigger','ledger_movements'),
  objectRequirement('classified_goal_withdrawal_ledger_protect_delete','trigger','ledger_movements'),
  objectRequirement('classified_goal_withdrawal_correction_effect_required','trigger','correction_audit'),
  objectRequirement('goal_withdrawal_effect_correction_audit_validate_insert','trigger','correction_audit'),
]);

const MANIFESTS = Object.freeze({
  'family-cash-flow-d1-portable-v2|v2-legacy': Object.freeze({
    format: 'family-cash-flow-d1-portable-v2',
    version: 'v2-legacy',
    tables: V2_TABLES,
    requiredSchema: V2_REQUIRED_SCHEMA,
    legacyPayloadHash: true,
  }),
  [`${BACKUP_FORMAT}|${SCHEMA_MANIFEST_VERSION}`]: Object.freeze({
    format: BACKUP_FORMAT,
    version: SCHEMA_MANIFEST_VERSION,
    tables: BACKUP_TABLES,
    requiredSchema: GATE1_REQUIRED_SCHEMA,
    legacyPayloadHash: false,
  }),
});

const encoder = new TextEncoder();
const schemaTableList = BACKUP_TABLES.map(table => `'${table}'`).join(',');

function manifestForBackup(backup) {
  const format = String(backup?.format || '');
  const version = backup?.schemaManifestVersion == null && format === 'family-cash-flow-d1-portable-v2'
    ? 'v2-legacy'
    : String(backup?.schemaManifestVersion || '');
  return MANIFESTS[`${format}|${version}`] || null;
}

export function backupTablesFor(backup) {
  const manifest = manifestForBackup(backup);
  if (!manifest) throw new Error('Unsupported portable backup format or schema manifest version.');
  return [...manifest.tables];
}

function validSchemaItem(item, tables) {
  const type = String(item?.type || '').toLowerCase();
  const name = String(item?.name || '');
  const table = String(item?.tbl_name || '');
  const sql = String(item?.sql || '').trim();
  if (!['table','index','trigger'].includes(type) || !tables.includes(table) || !sql) return false;
  if (/^(?:sqlite_|_cf_)/i.test(name)) return false;
  return type !== 'table' || name === table;
}

function normalizeSql(value) {
  return String(value || '').replace(/\s+/g,' ').trim().toLowerCase();
}

function hasCompleteSchemaManifest(schema, manifest) {
  if (!Array.isArray(schema)) return false;
  const byName = new Map();
  for (const item of schema) {
    if (!validSchemaItem(item, manifest.tables)) return false;
    const name = String(item.name);
    if (byName.has(name)) return false;
    byName.set(name, item);
  }
  for (const requirement of manifest.requiredSchema) {
    const item = byName.get(requirement.name);
    if (!item) return false;
    if (String(item.type).toLowerCase() !== requirement.type || String(item.tbl_name) !== requirement.table) return false;
    const normalized = normalizeSql(item.sql);
    for (const fragment of requirement.sqlIncludes || []) {
      if (!normalized.includes(normalizeSql(fragment))) return false;
    }
  }
  return true;
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
  const day = iso.slice(0,10).replace(/-/g,'/');
  const filename = iso.replace(/:/g,'-').replace(/\.\d{3}Z$/,'Z');
  return `${environment}/${day}/${filename}.json`;
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2,'0')).join('');
}

function rows(result) { return result?.results || []; }
function tableKey(row, columns) { return columns.map(column => String(row?.[column] ?? '')).join('\u0000'); }

function hasExactTables(tables, expectedTables) {
  const actual = Object.keys(tables || {}).sort();
  const expected = [...expectedTables].sort();
  return actual.length === expected.length && actual.every((value,index) => value === expected[index]);
}

function validateV3Relations(tables) {
  if (!tables.goal_withdrawal_effect_events) return true;
  const households = new Set(tables.households.map(row => String(row.household_id)));
  const goals = new Set(tables.goals.map(row => tableKey(row,['household_id','name'])));
  const ledger = new Map(tables.ledger_movements.map(row => [Number(row.ledger_id),row]));
  const corrections = new Map(tables.correction_audit.map(row => [String(row.correction_id),row]));
  const weekly = new Set(tables.weekly_snapshots.map(row => tableKey(row,['household_id','week_start'])));
  const plans = new Set(tables.cycle_plans.map(row => tableKey(row,['household_id','cycle_start'])));
  const commitments = new Map(tables.cycle_commitments.map(row => [String(row.commitment_id),row]));
  const classifications = new Map();

  const commitmentIdentities = new Set();
  for (const row of tables.cycle_commitments) {
    if (!households.has(String(row.household_id))) return false;
    if (!plans.has(tableKey(row,['household_id','cycle_start']))) return false;
    if (!Number.isInteger(Number(row.committed_amount_satang)) || Number(row.committed_amount_satang) < 0) return false;
    const identity=[row.household_id,row.cycle_start,row.commitment_type,row.destination_name ?? ''].join('\u0000');
    if (commitmentIdentities.has(identity)) return false;
    commitmentIdentities.add(identity);
  }
  for (const row of tables.cycle_plans) {
    if (row.variables_target_satang !== null && row.variables_target_satang !== undefined &&
        (!Number.isInteger(Number(row.variables_target_satang)) || Number(row.variables_target_satang) < 0)) return false;
  }
  for (const row of tables.cycle_plan_events) {
    if (!plans.has(tableKey(row,['household_id','cycle_start']))) return false;
    for (const value of [row.old_target_satang,row.new_target_satang]) {
      if (value !== null && value !== undefined && (!Number.isInteger(Number(value)) || Number(value) < 0)) return false;
    }
  }
  for (const row of tables.commitment_events) {
    const parent=commitments.get(String(row.commitment_id));
    if (!parent || String(parent.household_id)!==String(row.household_id)) return false;
    for (const value of [row.old_amount_satang,row.new_amount_satang]) {
      if (value !== null && value !== undefined && (!Number.isInteger(Number(value)) || Number(value) < 0)) return false;
    }
  }

  for (const row of tables.goal_withdrawal_classifications) {
    const ledgerId=Number(row.ledger_id);
    if (classifications.has(ledgerId)) return false;
    classifications.set(ledgerId,row);
    const movement=ledger.get(ledgerId);
    if (!movement || String(movement.household_id)!==String(row.household_id)) return false;
    if (String(movement.account)!==String(row.goal_name) || String(movement.direction)!=='Withdrawal') return false;
    if (!Number.isInteger(Number(movement.amount_satang)) || Number(movement.amount_satang)<=0) return false;
    if (!goals.has(tableKey(row,['household_id','goal_name']))) return false;
    if (!['goal_purpose','non_purpose'].includes(String(row.use_classification))) return false;
  }

  const superseded=new Set(), authoritative=new Set(), correctionIds=new Set(), effectTokens=new Set();
  for (const row of tables.goal_withdrawal_effect_events) {
    const hh=String(row.household_id), oldId=Number(row.superseded_ledger_id);
    const oldClass=classifications.get(oldId);
    if (!oldClass || String(oldClass.household_id)!==hh || superseded.has(`${hh}\u0000${oldId}`)) return false;
    superseded.add(`${hh}\u0000${oldId}`);
    const correction=corrections.get(String(row.correction_id));
    if (!correction || String(correction.household_id)!==hh || correctionIds.has(`${hh}\u0000${row.correction_id}`)) return false;
    if (!['ledger_movement','ledgerMovement'].includes(String(correction.entity_type))) return false;
    if (Number(correction.entity_id)!==oldId) return false;
    if (String(correction.write_token)!==String(row.write_token)) return false;
    correctionIds.add(`${hh}\u0000${row.correction_id}`);
    if (effectTokens.has(`${hh}\u0000${row.write_token}`)) return false;
    effectTokens.add(`${hh}\u0000${row.write_token}`);
    const auth=row.authoritative_ledger_id;
    if (String(row.effect_kind)==='reversal') {
      if (auth !== null && auth !== undefined) return false;
    } else if (String(row.effect_kind)==='replacement') {
      if (auth === null || auth === undefined) return false;
      const key=`${hh}\u0000${Number(auth)}`;
      if (authoritative.has(key)) return false;
      authoritative.add(key);
      const movement=ledger.get(Number(auth));
      if (!movement || String(movement.household_id)!==hh) return false;
      const isGoalDomain=String(movement.direction)==='Withdrawal' && (
        goals.has(tableKey(movement,['household_id','account'])) ||
        (String(movement.source_sheet)==='Ledger' && String(movement.account)!=='EF' && String(movement.account).trim())
      );
      if (isGoalDomain) {
        const replacementClass=classifications.get(Number(auth));
        if (!replacementClass || String(replacementClass.household_id)!==hh || String(replacementClass.goal_name)!==String(movement.account)) return false;
      }
    } else return false;
  }

  for (const row of tables.weekly_snapshot_model_versions) {
    if (String(row.planning_model_version)!=='v3') return false;
    if (!weekly.has(tableKey(row,['household_id','week_start']))) return false;
  }
  return true;
}

function payloadJsonFor(backup, manifest) {
  return JSON.stringify(manifest.legacyPayloadHash
    ? { schema: backup.schema, tables: backup.tables }
    : { schemaManifestVersion: backup.schemaManifestVersion, schema: backup.schema, tables: backup.tables });
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
  const tables={};
  BACKUP_TABLES.forEach((table,index)=>{ tables[table]=rows(results[index+1]); });
  const schema=rows(results[0]);
  const manifest=MANIFESTS[`${BACKUP_FORMAT}|${SCHEMA_MANIFEST_VERSION}`];
  if (!hasCompleteSchemaManifest(schema,manifest)) throw new Error('Database schema does not satisfy the Gate-1 backup manifest.');
  if (!validateV3Relations(tables)) throw new Error('Database contains invalid v3 backup relations.');
  const backup={
    format: BACKUP_FORMAT,
    schemaManifestVersion: SCHEMA_MANIFEST_VERSION,
    environment,
    createdAt,
    householdId: options.householdId || 'family',
    schema,
    tables,
    integrity: {
      algorithm:'SHA-256',
      schemaManifestVersion:SCHEMA_MANIFEST_VERSION,
      schemaObjectCount:schema.length,
      requiredSchemaObjectCount:manifest.requiredSchema.length,
      rowCounts:Object.fromEntries(BACKUP_TABLES.map(table=>[table,tables[table].length])),
    },
  };
  backup.integrity.tablesSha256=await sha256Hex(JSON.stringify(tables));
  backup.integrity.payloadSha256=await sha256Hex(payloadJsonFor(backup,manifest));
  return { key:timestampKey(environment,createdAt), backup, json:JSON.stringify(backup) };
}

export async function prunePortableBackups(bucket, options = {}) {
  if (!bucket || typeof bucket.list !== 'function' || typeof bucket.delete !== 'function') throw new Error('R2 backup binding is unavailable.');
  const environment=validEnvironment(options.environment);
  const retentionDays=Number(options.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays<1 || retentionDays>3650) throw new Error('Backup retention must be between 1 and 3650 days.');
  const cutoff=new Date((options.now ?? Date.now())-retentionDays*86400000);
  let cursor; let deleted=0;
  do {
    const page=await bucket.list({prefix:`${environment}/`,cursor,limit:1000});
    const keys=(page.objects||[]).filter(object=>object.uploaded instanceof Date && object.uploaded<cutoff).map(object=>object.key);
    if (keys.length) { await bucket.delete(keys); deleted+=keys.length; }
    cursor=page.truncated?page.cursor:undefined;
  } while(cursor);
  return deleted;
}

export async function runPortableBackup(db,bucket,options={}) {
  if (!bucket || typeof bucket.put !== 'function') throw new Error('R2 backup binding is unavailable.');
  const environment=validEnvironment(options.environment);
  const createdAt=options.createdAt ?? options.scheduledTime ?? Date.now();
  const output=await buildPortableBackup(db,{...options,environment,createdAt});
  await bucket.put(output.key,output.json,{
    httpMetadata:{contentType:'application/json; charset=UTF-8'},
    customMetadata:{format:BACKUP_FORMAT,schemaManifestVersion:SCHEMA_MANIFEST_VERSION,environment,tablesSha256:output.backup.integrity.tablesSha256},
  });
  const deleted=await prunePortableBackups(bucket,{environment,retentionDays:options.retentionDays,now:new Date(createdAt).getTime()});
  return {ok:true,action:'portableBackup',key:output.key,createdAt:output.backup.createdAt,rowCounts:output.backup.integrity.rowCounts,tablesSha256:output.backup.integrity.tablesSha256,pruned:deleted};
}

export async function verifyPortableBackup(backup) {
  const manifest=manifestForBackup(backup);
  if (!manifest || !Array.isArray(backup?.schema) || !backup?.tables || !backup?.integrity) return false;
  if (!hasExactTables(backup.tables,manifest.tables) || !hasCompleteSchemaManifest(backup.schema,manifest)) return false;
  for (const table of manifest.tables) {
    if (!Array.isArray(backup.tables[table])) return false;
    if (Number(backup.integrity.rowCounts?.[table])!==backup.tables[table].length) return false;
  }
  if (!manifest.legacyPayloadHash) {
    if (backup.integrity.schemaManifestVersion!==manifest.version) return false;
    if (Number(backup.integrity.schemaObjectCount)!==backup.schema.length) return false;
    if (Number(backup.integrity.requiredSchemaObjectCount)!==manifest.requiredSchema.length) return false;
    if (!validateV3Relations(backup.tables)) return false;
  }
  const expectedTables=await sha256Hex(JSON.stringify(backup.tables));
  const expectedPayload=await sha256Hex(payloadJsonFor(backup,manifest));
  return expectedTables===backup.integrity.tablesSha256 && expectedPayload===backup.integrity.payloadSha256;
}
