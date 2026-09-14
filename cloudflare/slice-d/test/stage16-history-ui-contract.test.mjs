import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root=new URL('../../../',import.meta.url);
const html=fs.readFileSync(new URL('index.html',root),'utf8');
const js=fs.readFileSync(new URL('assets/v24/v24_1_history.js',root),'utf8');
const css=fs.readFileSync(new URL('assets/v24/v24_1_history.css',root),'utf8');
const i18n=fs.readFileSync(new URL('assets/v24/v24_1_i18n.js',root),'utf8');

test('phone and desktop expose Transaction and Balance history without horizontal scrolling',()=>{
  assert.match(html,/id="transactionHistoryBtn">Transaction history/);
  assert.match(html,/id="balanceHistoryBtn">Balance history/);
  assert.match(html,/id="historyDetails"[^>]*hidden/);
  assert.match(css,/\.history-view\{overflow-x:hidden\}/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.history-management-fields\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(css,/@media\(max-width:760px\)[\s\S]*min-width:\s*[4-9]\d\dpx/);
});

test('history uses authoritative read routes and revision-bound management protocol',()=>{
  assert.match(js,/apiCall\(mode==='balances'\?'balanceHistory':'transactionHistory'/);
  assert.match(js,/apiCall\('transactionManagementPreview'/);
  assert.match(js,/apiCall\('transactionManagementCommit'/);
  assert.match(js,/baseRevision:preview\.baseRevision,terminalVersionId:preview\.terminalVersionId/);
  assert.match(js,/requestId=requestId\|\|crypto\.randomUUID\(\)/);
  assert.match(js,/The change was not confirmed/);
});

test('financial consequences precede technical details and immutable observations have no mutation controls',()=>{
  assert.match(js,/Financial consequences[\s\S]*Technical details/);
  assert.match(js,/This immutable observation anchors the recorded account position/);
  assert.match(js,/manage the linked transaction rather than changing this row/);
});

test('management preview shows the signed server impact without exposing raw JSON',()=>{
  assert.match(js,/impactConsequences\(preview\.impact\)/);
  assert.match(js,/amount>0\?'enters ':'leaves '/);
  assert.doesNotMatch(js,/eligible\?esc\(consequence\(selected\)\)/);
  assert.doesNotMatch(js,/JSON\.stringify\(preview\.impact/);
});

test('all enabled families receive contextual correction semantics and salary replacement is absent',()=>{
  for(const kind of ['one_off_payment','other_income_receipt','salary_receipt','obligation_payment','ktb_transfer','ef_movement','goal_movement']) assert.match(js,new RegExp(kind));
  for(const operation of ['corrected','deleted','restored','undone']) assert.match(js,new RegExp(operation));
  assert.doesNotMatch(js,/data-management="replaced"/);
  assert.match(js,/otherIncomeSourceId/);
  assert.match(js,/occurrenceId/);
  assert.match(js,/sourceAccount/);
  assert.match(js,/withdrawalPurpose/);
});

test('English and Russian cover the new static history surface while localization remains display-only',()=>{
  for(const phrase of ['Transaction history','Balance history','Current salary cycle','Previous salary cycle','Custom date range','Show corrections and deleted records','Apply filters','Clear all','Load more']) assert.match(i18n,new RegExp("'"+phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"':'"));
  assert.doesNotMatch(i18n,/transactionManagementPreview|transactionManagementCommit|logicalTransactionId|terminalVersionId/);
});
