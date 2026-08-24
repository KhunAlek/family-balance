import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app1 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app1.js', import.meta.url), 'utf8');

test('frontend degraded warning reports affected accounts before ordinary state copy', () => {
  assert.match(app1, /if\(data\.planningState==='degraded_correction_data'\)\{text\.textContent='Available is conservative because correction data is unresolved for: '\+\(data\.affectedPlanningAccounts\|\|\[\]\)\.join\(', '\)/);
  const degraded = app1.indexOf("if(data.planningState==='degraded_correction_data')");
  const awaiting = app1.indexOf("if(data.planningState==='awaiting_salary_receipt')");
  assert.ok(degraded >= 0 && awaiting > degraded);
});

test('frontend summary preserves unavailable Goal commitment total instead of rendering zero', () => {
  assert.match(app1, /goalOut=goals\?goals\.reduce/);
  assert.match(app1, /availableGoals'\)\.textContent=valueOrDash\(goalOut,c\)/);
  assert.doesNotMatch(app1, /goals=data\.commitments&&data\.commitments\.goals\|\|\[\]/);
});

test('frontend Goals render unavailable cycle commitment data explicitly', () => {
  assert.match(app1, /Current-cycle commitment unavailable\./);
  assert.match(app1, /safeAvailable=g\.safeTransferAmount!==null&&g\.safeTransferAmount!==undefined/);
  assert.match(app1, /safeAvailable\?\(safe>0\?'Transfer':'Waiting'\):'Unavailable'/);
  assert.doesNotMatch(app1, /out=Number\(g\.cycleOutstanding\)\|\|0/);
  assert.doesNotMatch(app1, /fmtMoney\(g\.cycleCommitment\|\|0,currency\)/);
});

test('frontend distinguishes unavailable required obligations from a factual empty obligation list', () => {
  assert.match(app1, /Current-cycle obligations are unavailable\./);
  assert.match(app1, /No obligations in the active salary cycle\./);
  const unavailable = app1.indexOf('Current-cycle obligations are unavailable.');
  const none = app1.indexOf('No obligations in the active salary cycle.');
  assert.ok(unavailable >= 0 && none > unavailable);
});
