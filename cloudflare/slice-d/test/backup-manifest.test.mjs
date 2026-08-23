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
  const { db } = createSeededSqliteD1();
  const { backup } = await buildPortableBackup(db, { environment:'staging', createdAt:'2026-08-23T10:30:00Z' });
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.schemaManifestVersion, SCHEMA_MANIFEST_VERSION);
  assert.equal(backup.integrity.schemaManifestVersion, SCHEMA_MANIFEST_VERSION);
  assert.deepEqual(Object.keys(backup.tables), [...BACKUP_TABLES]);
  assert.equal(backup.integrity.schemaObjectCount, backup.schema.length);
  assert.ok(backup.integrity.requiredSchemaObjectCount > BACKUP_TABLES.length);
  assert.equal(await verifyPortableBackup(backup), true);
});

test('B004 omission matrix rejects every mandatory Gate-1 schema object even after integrity hashes are recomputed', async () => {
  const { db } = createSeededSqliteD1();
  const { backup } = await buildPortableBackup(db, { environment:'staging', createdAt:'2026-08-23T10:31:00Z' });
  assert.equal(backup.schema.length, backup.integrity.requiredSchemaObjectCount, 'fixture must contain exactly the mandatory schema-object set');
  for (const object of backup.schema) {
    const missing = structuredClone(backup);
    missing.schema = missing.schema.filter(item => item.name !== object.name);
    rehashGate1(missing);
    assert.equal(await verifyPortableBackup(missing), false, `missing ${object.type}:${object.name} must fail`);
  }
});

test('B004 rejects duplicate and materially incompatible mandatory schema objects with valid recomputed hashes', async () => {
  const { db } = createSeededSqliteD1();
  const { backup } = await buildPortableBackup(db, { environment:'staging', createdAt:'2026-08-23T10:32:00Z' });

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

test('B004 unknown/future manifest versions fail explicitly', async () => {
  const { db } = createSeededSqliteD1();
  const { backup } = await buildPortableBackup(db, { environment:'staging', createdAt:'2026-08-23T10:33:00Z' });
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
