import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceOnDate, historyRowOrder, latestUsableBalance, nearestPriorBalance } from '../src/balances.mjs';

const row = (source_sheet, source_row, sheet_order, alex, olga, business_date = '2026-08-15') => ({
  business_date,
  source_sheet,
  source_row,
  sheet_order,
  alex_balance_satang: alex * 100,
  olga_balance_satang: olga * 100
});

const acceptanceCorrection = row('Correction', 201, 2_000_000_201, 2285, 11455);
const laterBalanceUpdate = row('Cloudflare', 301, 1_000_000_301, 2285, 10581);

test('revision chronology supersedes incompatible correction and write namespaces', () => {
  assert.ok(historyRowOrder(laterBalanceUpdate) > historyRowOrder(acceptanceCorrection));
  const latest = latestUsableBalance([laterBalanceUpdate, acceptanceCorrection]);
  assert.equal(latest.olga, 10581);
  assert.equal(latest.row, laterBalanceUpdate);
});

test('same-date and nearest-prior selectors use revision chronology', () => {
  const rows = [laterBalanceUpdate, acceptanceCorrection];
  assert.equal(balanceOnDate(rows, '2026-08-15'), 12866);
  assert.equal(nearestPriorBalance(rows, '2026-08-15', 14).row, laterBalanceUpdate);
});

test('later correction still supersedes an earlier normal write', () => {
  const futureCorrection = row('Correction', 401, 2_000_000_401, 2285, 10400);
  const latest = latestUsableBalance([futureCorrection, laterBalanceUpdate]);
  assert.equal(latest.olga, 10400);
  assert.equal(latest.row, futureCorrection);
});
