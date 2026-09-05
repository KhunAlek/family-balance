import { handleFetch } from '../src/index.js';
import { signSession } from '../src/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createSeededSqliteD1, SqliteD1Adapter } from '../../slice-c/test/sqlite-d1.mjs';
import { executeCategoryWrite, loadOneOffCategories, previewCategoryAction } from '../../slice-c/src/new-function-categories.mjs';
import { buildPortableBackup, verifyPortableBackup } from '../src/backup.mjs';
import { buildRestoreSql } from '../tools/portable-restore.mjs';
import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';
import { buildDashboardReadModel } from '../../slice-b/src/read-model.mjs';

const migration = fs.readFileSync(new URL('../migrations/0006_new_functionality.sql', import.meta.url), 'utf8');
const nowIso = '2026-09-05T12:00:00.000Z';
function fixture(t) {
  const state = createSeededSqliteD1();
  state.raw.exec(migration);
  t.after(() => state.raw.close());
  return state;
}
function write(db, action, payload, overrides = {}) {
  return executeCategoryWrite(db, { action, payload, nowIso, actorEmail: 'test@example.invalid', ...overrides });
}
const add = (db, name, requestId, overrides) => write(db, 'addOneOffCategory', { name, requestId }, overrides);
const rows = (raw, table) => raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const moneyTables = ['balance_history','income_receipts','obligation_payments','ledger_movements','weekly_snapshots','salary_cycle_state','goals'];
const accounting = raw => Object.fromEntries(moneyTables.map(name => [name, rows(raw,name)]));

test('NF-C01/02: five active seeds, idempotent seed, fresh schema and upgrade preserve Accounting', t => {
  const { raw } = createSeededSqliteD1(); t.after(() => raw.close());
  const before = accounting(raw);
  raw.exec(migration);
  const seeded = rows(raw, 'one_off_categories');
  assert.equal(seeded.length, 5);
  assert.deepEqual(seeded.map(row => row.name).sort(), ['Eating Out','Health','Car Repair and Insurance','Documents','Entertainment'].sort());
  assert.ok(seeded.every(row => row.active === 1));
  raw.exec(migration.slice(migration.indexOf('INSERT OR IGNORE')));
  assert.deepEqual(rows(raw, 'one_off_categories'), seeded);
  assert.deepEqual(accounting(raw), before);
  const fresh = new DatabaseSync(':memory:'); t.after(() => fresh.close());
  fresh.exec(fs.readFileSync(new URL('../../slice-b/migrations/0001_initial.sql', import.meta.url), 'utf8'));
  fresh.exec(migration);
  assert.equal(rows(fresh, 'one_off_categories').length, 0);
  assert.equal(fresh.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('NF-C03: preview normalizes whitespace and makes zero writes', async t => {
  const { db,raw } = fixture(t);
  const before = raw.prepare('SELECT total_changes() n').get().n;
  const preview = await previewCategoryAction(db, 'addOneOffCategory', { name: '  School   supplies  ' });
  assert.equal(preview.category.name, 'School supplies');
  assert.equal(preview.categoryId, null);
  assert.equal(raw.prepare('SELECT total_changes() n').get().n, before);
  assert.equal(rows(raw,'new_function_request_receipts').length,0);
});

test('NF-C04/05: deactivate/reactivate keeps identity and reconstructs Active/Inactive lists', async t => {
  const { db,raw } = fixture(t); const before = accounting(raw);
  const created = await add(db,'Books','create-books');
  const categoryId = created.category.category_id;
  await write(db,'deactivateOneOffCategory',{categoryId,requestId:'deactivate-books'});
  assert.equal((await loadOneOffCategories(db)).find(row => row.category_id===categoryId).active,0);
  await write(db,'reactivateOneOffCategory',{categoryId,requestId:'reactivate-books'});
  assert.deepEqual((await loadOneOffCategories(db)).find(row => row.category_id===categoryId),created.category);
  assert.deepEqual(accounting(raw), before);
});

for (const name of ['', '  ', 'UNCATEGORIZED', '  Uncategorized ', 42, 'x'.repeat(121)]) {
  test(`NF-C06: invalid/reserved name ${JSON.stringify(name)} is rejected before any claim`, async t => {
    const { db,raw } = fixture(t);
    await assert.rejects(add(db,name,'invalid'),error=>error.validation===true);
    assert.equal(rows(raw,'financial_write_claims').length,0);
    assert.equal(rows(raw,'new_function_request_receipts').length,0);
  });
}

test('NF-C06: normalized namespace includes inactive categories; names cannot be edited', async t => {
  const { db,raw } = fixture(t);
  const category = (await loadOneOffCategories(db)).find(row=>row.name==='Eating Out');
  await write(db,'deactivateOneOffCategory',{categoryId:category.category_id,requestId:'deactivate'});
  await assert.rejects(add(db,'  EATING    OUT ','duplicate'),/already exists/);
  await assert.rejects(write(db,'reactivateOneOffCategory',{categoryId:category.category_id,name:'Renamed',requestId:'rename'}),/Unexpected/);
  assert.equal(rows(raw,'new_function_request_receipts').length,1);
});

test('request receipts: lost-response retry returns the original response after later lifecycle mutation', async t => {
  const { db,raw } = fixture(t);
  const first = await add(db,'Books','same-request');
  await write(db,'deactivateOneOffCategory',{categoryId:first.category.category_id,requestId:'later'});
  const before = raw.prepare('SELECT total_changes() n').get().n;
  const replay = await add(db,'  Books  ','same-request');
  assert.deepEqual(replay, first);
  assert.equal(raw.prepare('SELECT total_changes() n').get().n,before);
  assert.equal((await loadOneOffCategories(db)).find(row=>row.category_id===first.category.category_id).active,0);
  await assert.rejects(add(db,'Different','same-request'),/different details/);
  await assert.rejects(write(db,'reactivateOneOffCategory',{categoryId:first.category.category_id,requestId:'same-request'}),/different details/);
});

test('request receipts: missing request ID and cross-household category are rejected', async t => {
  const { db,raw } = fixture(t);
  await assert.rejects(add(db,'Books',undefined),/stable request ID/);
  await assert.rejects(write(db,'deactivateOneOffCategory',{categoryId:'foreign:category',requestId:'foreign'}),/not found/);
  assert.equal(rows(raw,'financial_write_claims').length,0);
});

test('request receipts: forced failure rolls back category, receipt, claim and revision together', async t => {
  const { db,raw } = fixture(t);
  const before = rows(raw,'one_off_categories');
  await assert.rejects(add(db,'Books','rollback',{testOnlyForcedFailure:true}),/__slice_c_forced_failure__/);
  assert.deepEqual(rows(raw,'one_off_categories'),before);
  assert.equal(rows(raw,'new_function_request_receipts').length,0);
  assert.equal(rows(raw,'financial_write_claims').length,0);
  assert.equal(rows(raw,'household_revisions')[0].current_revision,0);
  assert.equal((await add(db,'Books','rollback')).revision,1);
});

function rendezvous() {
  let arrivals=0, release;
  const gate = new Promise(resolve=>{release=resolve;});
  return async () => { if (++arrivals===2) release(); await gate; };
}

test('request receipts: concurrent identical requests commit once and return identical success', async t => {
  const { db,raw } = fixture(t); const testOnlyBeforeBatch = rendezvous();
  const results = await Promise.all([add(db,'Books','race',{testOnlyBeforeBatch}),add(db,'Books','race',{testOnlyBeforeBatch})]);
  assert.deepEqual(results[0],results[1]);
  assert.equal(rows(raw,'one_off_categories').length,6);
  assert.equal(rows(raw,'new_function_request_receipts').length,1);
  assert.equal(rows(raw,'financial_write_claims').length,1);
});

test('request receipts: concurrent changed payload does not replay another success', async t => {
  const { db,raw } = fixture(t); const testOnlyBeforeBatch = rendezvous();
  const results = await Promise.allSettled([add(db,'Books','race',{testOnlyBeforeBatch}),add(db,'Toys','race',{testOnlyBeforeBatch})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/different details/);
  assert.equal(rows(raw,'one_off_categories').length,6);
});

test('request receipts: unrelated concurrent writes preserve stale-writer behavior', async t => {
  const { db,raw } = fixture(t); const testOnlyBeforeBatch = rendezvous();
  const results = await Promise.allSettled([add(db,'Books','one',{testOnlyBeforeBatch}),add(db,'Toys','two',{testOnlyBeforeBatch})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.staleWriter,true);
  assert.equal(rows(raw,'new_function_request_receipts').length,1);
});

test('NF-B: category lifecycle, replay result and Accounting/planning survive isolated portable restore', async t => {
  const { db,raw } = fixture(t);
  const created = await add(db,'Books','restorable');
  await write(db,'deactivateOneOffCategory',{categoryId:created.category.category_id,requestId:'deactivate'});
  const { backup } = await buildPortableBackup(db,{environment:'isolated',createdAt:nowIso});
  assert.equal(await verifyPortableBackup(backup),true);
  const restored = new DatabaseSync(':memory:'); t.after(()=>restored.close());
  restored.exec('PRAGMA foreign_keys=ON;');
  restored.exec(await buildRestoreSql(backup,{includeSchema:true}));
  const restoredDb = new SqliteD1Adapter(restored);
  assert.deepEqual(rows(restored,'one_off_categories'),rows(raw,'one_off_categories'));
  assert.deepEqual(rows(restored,'new_function_request_receipts'),rows(raw,'new_function_request_receipts'));
  assert.deepEqual(accounting(restored),accounting(raw));
  assert.deepEqual(await add(restoredDb,'Books','restorable'),created);
  assert.deepEqual(buildDashboardReadModel(await loadFinancialSnapshot(restoredDb),'2026-09-05'),buildDashboardReadModel(await loadFinancialSnapshot(db),'2026-09-05'));
  assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('NF-C02: rerunning the seed preserves an inactive category', async t => {
  const { db,raw } = fixture(t);
  const category = (await loadOneOffCategories(db))[0];
  await write(db,'deactivateOneOffCategory',{categoryId:category.category_id,requestId:'inactive-seed'});
  const before = rows(raw,'one_off_categories');
  raw.exec(migration.slice(migration.indexOf('INSERT OR IGNORE')));
  assert.deepEqual(rows(raw,'one_off_categories'),before);
});

test('portable backup refuses a partially applied category schema', async t => {
  const { db,raw } = createSeededSqliteD1(); t.after(()=>raw.close());
  raw.exec(migration.slice(0,migration.indexOf('CREATE TABLE new_function_request_receipts')));
  await assert.rejects(buildPortableBackup(db,{environment:'isolated',createdAt:nowIso}),/schema is incomplete/);
});

test('category API: authentication, same-origin, preview, lifecycle and JSON replay use the Worker route', async t => {
  const { db,raw } = fixture(t);
  const origin = 'https://isolated.example';
  const env = { DB:db, APPROVED_GOOGLE_EMAILS:'test@example.invalid', SESSION_SIGNING_KEY:'isolated-test-key-with-more-than-thirty-two-bytes' };
  const token = await signSession({sub:'test',email:'test@example.invalid'},env);
  async function api(apiAction,payload={},headers={}) {
    return handleFetch(new Request(origin+'/api/action',{
      method:'POST',headers:{origin,'content-type':'application/json',cookie:`fcf_session=${token}`,...headers},
      body:JSON.stringify({apiAction,payload})
    }),env);
  }
  assert.equal((await api('getOneOffCategories',{}, {cookie:''})).status,401);
  assert.equal((await api('write',{action:'addOneOffCategory',name:'Books',requestId:'api'}, {origin:'https://foreign.example'})).status,403);
  const preview = await api('previewCategory',{action:'addOneOffCategory',name:'Books'});
  assert.equal((await preview.json()).category.name,'Books');
  assert.equal(rows(raw,'financial_write_claims').length,0);
  const payload = {action:'addOneOffCategory',name:'Books',requestId:'api'};
  const saved = await (await api('write',payload)).json();
  assert.equal(saved.ok,true);
  assert.deepEqual(await (await api('write',payload)).json(),saved);
  const result = await api('write',{action:'deactivateOneOffCategory',categoryId:saved.category.category_id,requestId:'api-deactivate'});
  assert.equal((await result.json()).category.active,0);
  const list = await api('getOneOffCategories');
  assert.equal(list.headers.get('cache-control'),'no-store');
  assert.equal((await list.json()).categories.filter(c=>c.active===0).length,1);
  const invalid = await api('write',{action:'addOneOffCategory',name:'Uncategorized',requestId:'api-invalid'});
  assert.equal(invalid.status,200);
  assert.equal((await invalid.json()).ok,false);
  assert.equal(rows(raw,'financial_write_claims').length,2);
});
