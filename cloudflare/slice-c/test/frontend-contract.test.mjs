import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app1 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app1.js', import.meta.url), 'utf8');
const app3 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app3.js', import.meta.url), 'utf8');

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
