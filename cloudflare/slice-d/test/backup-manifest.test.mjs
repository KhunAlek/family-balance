import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { BACKUP_FORMAT, BACKUP_TABLES, SCHEMA_MANIFEST_VERSION, buildPortableBackup, verifyPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';

const V2_TABLES = [
  'households','configuration','balance_history','income_definitions','income_receipts','salary_cycle_state',
  'obligations','obligation_occurrences','obligation_payments','goals','ledger_movements','weekly_snapshots',
  'financial_write_claims','correction_audit','household_revisions','salary_cycle_sources'
];

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function rehashGate1(backup) {
  backup.integrity.schemaObjectCount = backup.schema.length;
  backup.integrity.tablesSha256 = sha256(JSON.stringify(backup.tables));
  backup.integrity.payloadSha256 = sha256(JSON.stringify({
    schemaManifestVersion: backup.schemaManifestVersion,
    schema: backup.schema,
    tables: backup.tables,
  }));
  return backup;
}

async function validGate1Backup(createdAt = '2026-08-23T10:30:00Z') {
  const { db } = createSeededSqliteD1();
  const { backup } = await buildPortableBackup(db, { environment:'staging', createdAt });
  assert.equal(await verifyPortableBackup(backup), true);
  return backup;
}

async function assertVerifierAndRestoreReject(backup) {
  assert.equal(await verifyPortableBackup(backup), false);
  await assert.rejects(
    () => buildRestoreSql(backup, { includeSchema:true }),
    /Portable backup integrity verification failed/i,
  );
}

function buildLegacyV2Fixture(raw) {
  const quoted = V2_TABLES.map(x => `'${x}'`).join(',');
  const schema = raw.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index','trigger') AND tbl_name IN (${quoted}) AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END,name`).all();
  const tables = Object.fromEntries(V2_TABLES.map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const backup = {
    format: 'family-cash-flow-d1-portable-v2',
    environment: 'production',
    createdAt: '2026-08-15T00:19:02.456Z',
    householdId: 'family',
    schema,
    tables,
    integrity: {
      algorithm: 'SHA-256',
      rowCounts: Object.fromEntries(V2_TABLES.map(table => [table,tables[table].length])),
      tablesSha256: sha256(JSON.stringify(tables)),
      payloadSha256: sha256(JSON.stringify({schema,tables})),
    },
  };
  return backup;
}

test('B004 Gate-1 backup declares the versioned manifest and exact table set', async () => {
  const backup = await validGate1Backup();
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.schemaManifestVersion, SCHEMA_MANIFEST_VERSION);
  assert.equal(backup.integrity.schemaManifestVersion, SCHEMA_MANIFEST_VERSION);
  assert.deepEqual(Object.keys(backup.tables), [...BACKUP_TABLES]);
  assert.equal(backup.integrity.schemaObjectCount, backup.schema.length);
  assert.ok(backup.integrity.requiredSchemaObjectCount > BACKUP_TABLES.length);
});

test('B004 omission matrix rejects every mandatory Gate-1 schema object even after integrity hashes are recomputed', async () => {
  const backup = await validGate1Backup('2026-08-23T10:31:00Z');
  assert.equal(backup.schema.length, backup.integrity.requiredSchemaObjectCount, 'fixture must contain exactly the mandatory schema-object set');
  for (const object of backup.schema) {
    const missing = structuredClone(backup);
    missing.schema = missing.schema.filter(item => item.name !== object.name);
    rehashGate1(missing);
    assert.equal(await verifyPortableBackup(missing), false, `missing ${object.type}:${object.name} must fail`);
  }
});

test('B004 rejects duplicate and materially incompatible mandatory schema objects with valid recomputed hashes', async () => {
  const backup = await validGate1Backup('2026-08-23T10:32:00Z');

  const duplicate = structuredClone(backup);
  duplicate.schema.push(structuredClone(duplicate.schema.find(item => item.name === 'uq_cycle_commitment_identity')));
  rehashGate1(duplicate);
  assert.equal(await verifyPortableBackup(duplicate), false);

  const incompatible = structuredClone(backup);
  const trigger = incompatible.schema.find(item => item.name === 'goal_withdrawal_classification_validate_insert');
  trigger.sql = trigger.sql.replace("typeof(l.amount_satang) = 'integer'", '1 = 1');
  rehashGate1(incompatible);
  assert.equal(await verifyPortableBackup(incompatible), false);
});

test('B004 canonical schema fingerprint rejects a same-name inert required trigger', async () => {
  const backup = await validGate1Backup('2026-08-23T10:32:10Z');
  const hostile = structuredClone(backup);
  const trigger = hostile.schema.find(item => item.name === 'goal_withdrawal_effect_correction_audit_append_only_update');
  assert.ok(trigger);
  trigger.sql = `CREATE TRIGGER goal_withdrawal_effect_correction_audit_append_only_update
BEFORE UPDATE ON correction_audit
FOR EACH ROW
WHEN 0
BEGIN
  SELECT RAISE(ABORT, 'goal withdrawal effect correction audits are immutable');
END`;
  rehashGate1(hostile);
  await assertVerifierAndRestoreReject(hostile);
});

test('B004 canonical schema fingerprint rejects weakened same-name table constraints and FKs', async () => {
  const backup = await validGate1Backup('2026-08-23T10:32:20Z');
  const hostile = structuredClone(backup);
  const goals = hostile.schema.find(item => item.name === 'goals');
  assert.ok(goals);
  assert.match(goals.sql, /target_amount_satang INTEGER NOT NULL/);
  goals.sql = goals.sql
    .replace('target_amount_satang INTEGER NOT NULL', 'target_amount_satang INTEGER')
    .replace(/,\s*FOREIGN KEY \(household_id\) REFERENCES households\(household_id\)/, '');
  rehashGate1(hostile);
  await assertVerifierAndRestoreReject(hostile);
});

test('B004 schema metadata must agree with the canonical SQL owning table', async () => {
  const backup = await validGate1Backup('2026-08-23T10:32:30Z');
  const hostile = structuredClone(backup);
  const trigger = hostile.schema.find(item => item.name === 'goal_withdrawal_effect_correction_audit_append_only_update');
  assert.ok(trigger);
  trigger.tbl_name = 'ledger_movements';
  rehashGate1(hostile);
  await assertVerifierAndRestoreReject(hostile);
});

test('B004 canonical schema comparison is whitespace/case normalized only', async () => {
  const backup = await validGate1Backup('2026-08-23T10:32:40Z');
  const reformatted = structuredClone(backup);
  const index = reformatted.schema.find(item => item.name === 'idx_ledger_account_date');
  assert.ok(index);
  index.sql = `  ${index.sql.toUpperCase().replace(/\s+/g,'   ')}  `;
  rehashGate1(reformatted);
  assert.equal(await verifyPortableBackup(reformatted), true);
});

test('B004 gate1-v1 rejects coercible and unsafe satang representations in legacy Ledger and Goals', async () => {
  const backup = await validGate1Backup('2026-08-23T10:32:50Z');
  assert.ok(backup.tables.ledger_movements.length > 0);
  assert.ok(backup.tables.goals.length > 0);
  const mutations = [
    ['ledger_movements','amount_satang','5000'],
    ['ledger_movements','amount_satang','5e3'],
    ['ledger_movements','amount_satang',1.5],
    ['ledger_movements','amount_satang',true],
    ['ledger_movements','amount_satang',Number.MAX_SAFE_INTEGER + 1],
    ['goals','target_amount_satang','9007199254740993'],
    ['goals','target_amount_satang',1.5],
    ['goals','target_amount_satang',false],
    ['goals','target_amount_satang',null],
  ];
  for (const [table,column,value] of mutations) {
    const hostile=structuredClone(backup);
    hostile.tables[table][0][column]=value;
    rehashGate1(hostile);
    await assertVerifierAndRestoreReject(hostile);
  }
});

test('B004 gate1-v1 applies the same exact satang type rule to nullable legacy fields', async () => {
  const backup = await validGate1Backup('2026-08-23T10:32:55Z');
  assert.ok(backup.tables.balance_history.length > 0);
  for (const value of ['5e3',5000.5,true,Number.MAX_SAFE_INTEGER + 1]) {
    const hostile=structuredClone(backup);
    hostile.tables.balance_history[0].alex_balance_satang=value;
    rehashGate1(hostile);
    await assertVerifierAndRestoreReject(hostile);
  }
  const nullable=structuredClone(backup);
  nullable.tables.balance_history[0].alex_balance_satang=null;
  rehashGate1(nullable);
  assert.equal(await verifyPortableBackup(nullable), true);
});

test('B004 gate1-v1 requires every declared satang field to be present in each row', async () => {
  const backup = await validGate1Backup('2026-08-23T10:32:58Z');
  assert.ok(backup.tables.goals.length > 0);
  const hostile=structuredClone(backup);
  delete hostile.tables.goals[0].target_amount_satang;
  rehashGate1(hostile);
  await assertVerifierAndRestoreReject(hostile);
});

test('B004 unknown/future manifest versions fail explicitly', async () => {
  const backup = await validGate1Backup('2026-08-23T10:33:00Z');
  const future = structuredClone(backup);
  future.schemaManifestVersion = 'gate99-future';
  future.integrity.schemaManifestVersion = 'gate99-future';
  rehashGate1(future);
  assert.equal(await verifyPortableBackup(future), false);
});

test('B004 newest verifier accepts a structurally sound historical portable-v2 backup and can restore it FK-safely', async () => {
  const { raw } = createSeededSqliteD1({ includeV3:false });
  const legacy = buildLegacyV2Fixture(raw);
  assert.equal(legacy.schema.length, 20);
  assert.equal(await verifyPortableBackup(legacy), true);
  const sql = await buildRestoreSql(legacy, { includeSchema:true });
  assert.match(sql, /CREATE TABLE households/);
  assert.doesNotMatch(sql, /CREATE TABLE cycle_plans/);
  assert.doesNotMatch(sql, /PRAGMA\s+(?:defer_)?foreign_keys\s*=/i);
});
