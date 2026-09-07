import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app1 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app1.js', import.meta.url), 'utf8');
const app3 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app3.js', import.meta.url), 'utf8');
const app4 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app4.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

test('awaiting salary receipt frontend copy preserves the canonical V3-M25 contract', () => {
  assert.match(app1, /Salary boundary reached\. Available and commitments remain live; only forward pacing is unavailable until the qualifying salary receipt is recorded\./);
  assert.doesNotMatch(app1, /Available and transaction safety are unavailable until the qualifying salary receipt is recorded/);
});

test('salary boundary not set is rendered from its explicit state with a date prompt', () => {
  assert.match(app1, /salary_boundary_not_set:'Enter the next salary date\. Available, commitments, and pacing are unavailable until the boundary is recorded\.'/);
  assert.match(app1, /data\.planningState==='salary_boundary_not_set'/);
  assert.match(app1, /Enter the next salary date to restore Available, commitments, and pacing\./);
});

test('one-off payment preview uses its distinct payment-safety availability field', () => {
  assert.match(app3, /p\.paymentSafetyAvailable/);
  assert.doesNotMatch(app3, /p\.guidanceAvailable/);
});

test('Position and Pace consume the same canonical Available pace without client finance calculations', () => {
  assert.match(app1, /pace=data\.availablePace/);
  assert.match(app1, /positionPaceWeek'\)\.textContent=fmtMoney\(pace\.throughSunday/);
  assert.match(app1, /paceWeeklyValue'\)\.textContent=fmtMoney\(pace\.throughSunday/);
  assert.match(app1, /positionPaceToday'\)\.textContent=fmtMoney\(pace\.today/);
  assert.match(app1, /paceValue'\)\.textContent=fmtMoney\(pace\.today/);
  assert.doesNotMatch(app1, /remainingRunwayDays\s*[\/*+-]/);
  assert.doesNotMatch(app1, /availableToSpend\s*[\/*+-]/);
  assert.doesNotMatch(app1, /data\.positionPace/);
});

test('active frontend exposes Available pace and no Variables-target behavior', () => {
  assert.match(html, /<h2>Available pace<\/h2>/);
  assert.match(html, /Available pace through Sunday/);
  assert.match(html, /Available pace today/);
  assert.match(html, /A subdivision of Available until the next salary—not additional money or a separate limit\./);
  assert.match(html, /Pace divides today’s Available across the remaining days until salary\. Spending changes future pace because it changes the real account balance\./);
  for (const source of [html, app1, app3, app4]) {
    assert.doesNotMatch(source, /Variables target|variablesTargetRequired|variablesTarget|setVariablesTarget|Target not set|target pace|recommended pace|target remaining|target exceeded|Variables pace/i);
  }
});
