import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app1 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app1.js', import.meta.url), 'utf8');
const functionStart = app1.indexOf('function displayLocale');
const functionEnd = app1.indexOf('function renderOverview');

function renderRows(cards) {
  const rows = [];
  const list = { innerHTML: '', appendChild: row => rows.push(row) };
  const context = {
    Date,
    Intl,
    Math,
    Number,
    String,
    document: {
      createElement: () => ({ className: '', innerHTML: '' }),
      getElementById: id => id === 'weeklyVarCards' ? list : null
    },
    window: {}
  };
  vm.runInNewContext(app1.slice(functionStart, functionEnd), context);
  context.renderWeeklyVarCards({ config: { currency: 'THB' }, weeklyVariablesCards: cards });
  return rows;
}

test('all five weekly periods render with factual closed, current pace plus spend, and quiet future guidance', () => {
  const rows = renderRows([
    { cardStart:'2026-08-31', cardEnd:'2026-09-06', isClosed:true, spent:15166, planned:null },
    { cardStart:'2026-09-07', cardEnd:'2026-09-13', isClosed:true, spent:4504, planned:null },
    { cardStart:'2026-09-15', cardEnd:'2026-09-20', isCurrent:true, isClosed:false, spent:400, planned:2106 },
    { cardStart:'2026-09-21', cardEnd:'2026-09-27', isClosed:false, spent:'no data', planned:2457 },
    { cardStart:'2026-09-28', cardEnd:'2026-09-29', isClosed:false, spent:'no data', planned:702 }
  ]);

  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.className), [
    'pace-week-row closed', 'pace-week-row closed', 'pace-week-row current',
    'pace-week-row upcoming', 'pace-week-row upcoming'
  ]);
  assert.match(rows[0].innerHTML, /31 Aug–6 Sept[\s\S]*Closed[\s\S]*Recorded factual history[\s\S]*15,166 THB/);
  assert.doesNotMatch(rows[0].innerHTML, /Available pace/);
  assert.match(rows[2].innerHTML, /15 Sept–20 Sept[\s\S]*This week[\s\S]*Available pace[\s\S]*400 THB factual spending to date[\s\S]*2,106 THB/);
  assert.match(rows[3].innerHTML, /Upcoming[\s\S]*Available pace[\s\S]*Future guidance[\s\S]*2,457 THB/);
});
