import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../migrations/0013_transaction_identity.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
const preIdentityTables = [
  'households','configuration','balance_history','income_definitions','income_receipts',
  'salary_cycle_state','obligations','obligation_occurrences','obligation_payments','goals',
  'ledger_movements','weekly_snapshots','financial_write_claims','correction_audit',
  'household_revisions','salary_cycle_sources',
];
const identityTables = [
  'logical_transactions','logical_transaction_versions',
  'logical_transaction_components','transaction_management_audit',
];

function snapshotTables(raw, tables) {
  return Object.fromEntries(tables.map(table => [
    table,
    raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
  ]));
}

function insertCreated(raw, suffix = '1') {
  raw.exec('BEGIN TRANSACTION');
  try {
    raw.prepare(`INSERT INTO logical_transactions(
      logical_transaction_id,household_id,lifecycle_status,terminal_version_id,
      created_actor_email,created_at_utc,creation_request_id,creation_write_token,creation_committed_revision
    ) VALUES(?,?,?,NULL,?,?,?,?,?)`).run(
      `tx-${suffix}`,'family','active','alex@example.com','2026-09-11T10:00:00.000Z',
      `create-${suffix}`,`write-${suffix}`,1
    );
    raw.prepare(`INSERT INTO logical_transaction_versions(
      version_id,logical_transaction_id,version_number,kind,business_date,
      committed_revision,operation_type,management_operation_id
    ) VALUES(?,?,?,?,?,?,?,NULL)`).run(
      `version-${suffix}-1`,`tx-${suffix}`,1,'one_off_payment','2026-09-11',1,'created'
    );
    raw.prepare('INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role) VALUES(?,?,?,?)')
      .run(`version-${suffix}-1`,'one_off_payment',`payment-${suffix}`,'primary');
    raw.prepare('UPDATE logical_transactions SET terminal_version_id=? WHERE logical_transaction_id=?')
      .run(`version-${suffix}-1`,`tx-${suffix}`);
    raw.exec('COMMIT');
  } catch (error) {
    raw.exec('ROLLBACK');
    throw error;
  }
}

test('0013 is an additive empty upgrade that preserves every Stage 1 row byte-for-byte', () => {
  const { raw } = createSeededSqliteD1();
  const before = snapshotTables(raw, preIdentityTables);
  raw.exec(migrationSql);
  assert.deepEqual(snapshotTables(raw, preIdentityTables), before);
  for (const table of identityTables) {
    assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n, 0);
  }
  assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.doesNotMatch(migrationSql, /^(?:INSERT|UPDATE|DELETE|ALTER)\b/im);
});

test('fresh 0013 schema exposes reviewed keys, indexes, checks, and immutability triggers', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE households(household_id TEXT PRIMARY KEY); INSERT INTO households VALUES(\'family\');');
  raw.exec(migrationSql);
  for (const table of identityTables) {
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n, 1);
  }
  const triggerNames = raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(triggerNames, [
    'logical_transaction_component_delete_forbidden',
    'logical_transaction_component_update_forbidden',
    'logical_transaction_delete_forbidden',
    'logical_transaction_identity_immutable',
    'logical_transaction_lifecycle_requires_new_version',
    'logical_transaction_terminal_advances_one',
    'logical_transaction_terminal_lifecycle_matches',
    'logical_transaction_terminal_not_cleared',
    'logical_transaction_version_delete_forbidden',
    'logical_transaction_version_sequence',
    'logical_transaction_version_update_forbidden',
    'transaction_management_audit_delete_forbidden',
    'transaction_management_audit_update_forbidden',
    'transaction_management_audit_version_consistency',
  ]);
  assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('valid creation and management append complete immutable versions and audit in one transaction', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE households(household_id TEXT PRIMARY KEY); INSERT INTO households VALUES(\'family\');');
  raw.exec(migrationSql);
  insertCreated(raw);

  raw.exec('BEGIN TRANSACTION');
  raw.prepare(`INSERT INTO logical_transaction_versions VALUES(?,?,?,?,?,?,?,?)`)
    .run('version-1-2','tx-1',2,'one_off_payment','2026-09-10',2,'corrected','operation-1');
  raw.prepare(`INSERT INTO logical_transaction_components VALUES(?,?,?,?)`)
    .run('version-1-2','one_off_payment','payment-2','primary');
  raw.prepare(`INSERT INTO transaction_management_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'operation-1','corrected','tx-1','version-1-1','version-1-2','olga@example.com',
    '2026-09-11T10:05:00.000Z','owner_correction',null,'request-2','a'.repeat(64),1,2,'write-2','{"changed":["business_date"]}'
  );
  raw.prepare('UPDATE logical_transactions SET lifecycle_status=?,terminal_version_id=? WHERE logical_transaction_id=?')
    .run('active','version-1-2','tx-1');
  raw.exec('COMMIT');

  assert.equal(raw.prepare("SELECT terminal_version_id FROM logical_transactions WHERE logical_transaction_id='tx-1'").get().terminal_version_id, 'version-1-2');
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM logical_transaction_versions WHERE logical_transaction_id='tx-1'").get().n, 2);
  assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.throws(() => raw.prepare("UPDATE logical_transaction_versions SET business_date='2026-09-09' WHERE version_id='version-1-2'").run(), /immutable/i);
  assert.throws(() => raw.prepare("DELETE FROM logical_transaction_components WHERE version_id='version-1-2'").run(), /cannot be deleted/i);
  assert.throws(() => raw.prepare("UPDATE transaction_management_audit SET reason_code='changed' WHERE operation_id='operation-1'").run(), /immutable/i);
  assert.throws(() => raw.prepare("DELETE FROM transaction_management_audit WHERE operation_id='operation-1'").run(), /cannot be deleted/i);
});

test('invalid identity, version, component, lifecycle, and audit writes fail without partial effects', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE households(household_id TEXT PRIMARY KEY); INSERT INTO households VALUES(\'family\');');
  raw.exec(migrationSql);
  assert.throws(() => raw.prepare("INSERT INTO logical_transactions(logical_transaction_id,household_id,lifecycle_status) VALUES('bad-house','missing','active')").run(), /FOREIGN KEY/i);
  assert.throws(() => raw.prepare("INSERT INTO logical_transactions(logical_transaction_id,household_id,lifecycle_status) VALUES('bad-life','family','closed')").run(), /CHECK/i);
  assert.throws(() => raw.prepare("INSERT INTO logical_transactions(logical_transaction_id,household_id,lifecycle_status,created_actor_email) VALUES('partial','family','active','a@example.com')").run(), /CHECK/i);
  insertCreated(raw);
  assert.throws(() => raw.prepare("INSERT INTO logical_transaction_versions VALUES('v3','tx-1',3,'one_off_payment','2026-09-11',3,'created',NULL)").run(), /not next/i);
  assert.throws(() => raw.prepare("INSERT INTO logical_transaction_versions VALUES('bad-kind','tx-1',2,'mystery','2026-09-11',2,'created',NULL)").run(), /CHECK/i);
  assert.throws(() => raw.prepare("INSERT INTO logical_transaction_components VALUES('version-1-1','one_off_payment','x','mystery')").run(), /CHECK/i);
  assert.throws(() => raw.prepare("UPDATE logical_transactions SET lifecycle_status='deleted' WHERE logical_transaction_id='tx-1'").run(), /(?:new terminal version|terminal version operation)/i);

  assert.throws(() => raw.exec(`BEGIN TRANSACTION;
    INSERT INTO logical_transaction_versions VALUES('version-1-2','tx-1',2,'one_off_payment','2026-09-11',2,'deleted','bad-operation');
    INSERT INTO transaction_management_audit VALUES('bad-operation','corrected','tx-1','version-1-1','version-1-2','a@example.com','2026-09-11T10:00:00.000Z','reason',NULL,'bad-request','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'bad-write','{}');
    COMMIT;`), /does not match/i);
  try { raw.exec('ROLLBACK'); } catch {}
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM logical_transaction_versions WHERE version_id='version-1-2'").get().n, 0);

  assert.throws(() => raw.exec(`BEGIN TRANSACTION;
    INSERT INTO logical_transactions(logical_transaction_id,household_id,lifecycle_status) VALUES('tx-2','family','active');
    INSERT INTO logical_transaction_versions VALUES('version-2-1','tx-2',1,'one_off_payment','2026-09-11',1,'created',NULL);
    UPDATE logical_transactions SET terminal_version_id='version-1-1' WHERE logical_transaction_id='tx-2';
    COMMIT;`), /FOREIGN KEY/i);
  try { raw.exec('ROLLBACK'); } catch {}
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM logical_transactions WHERE logical_transaction_id='tx-2'").get().n, 0);

  assert.throws(() => raw.exec(`BEGIN TRANSACTION;
    INSERT INTO logical_transaction_versions VALUES('version-1-2','tx-1',2,'one_off_payment','2026-09-11',2,'corrected','missing-operation');
    COMMIT;`), /FOREIGN KEY/i);
  try { raw.exec('ROLLBACK'); } catch {}
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM logical_transaction_versions WHERE version_id='version-1-2'").get().n, 0);
});
