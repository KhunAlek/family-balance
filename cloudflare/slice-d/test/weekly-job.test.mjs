import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededSqliteD1 } from '../../slice-c/test/sqlite-d1.mjs';
import { bangkokBusinessDate, runWeeklySnapshotJob } from '../src/weekly-job.mjs';

test('Bangkok business date crosses UTC midnight correctly', () => {
  assert.equal(bangkokBusinessDate(Date.parse('2026-08-16T21:00:00.000Z')), '2026-08-17');
});

test('Monday job freezes missing closed card atomically through the Slice C revision claim', async () => {
  const { db, raw } = createSeededSqliteD1();
  const result = await runWeeklySnapshotJob(db, {
    businessDate: '2026-08-17',
    nowIso: '2026-08-16T21:00:00.000Z',
    writeToken: 'weekly-2026-08-17',
  });
  assert.equal(result.ok, true);
  assert.equal(result.written, 1);
  assert.deepEqual(result.weekStarts, ['2026-08-10']);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM weekly_snapshots WHERE week_start='2026-08-10'").get().n, 1);
  assert.equal(raw.prepare('SELECT current_revision AS n FROM household_revisions').get().n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM financial_write_claims WHERE write_token='weekly-2026-08-17'").get().n, 1);

  const second = await runWeeklySnapshotJob(db, { businessDate: '2026-08-17', nowIso: '2026-08-16T21:01:00.000Z' });
  assert.equal(second.written, 0);
  assert.equal(raw.prepare('SELECT current_revision AS n FROM household_revisions').get().n, 1);
});
