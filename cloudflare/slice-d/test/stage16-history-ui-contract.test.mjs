import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root=new URL('../../../',import.meta.url);
const html=fs.readFileSync(new URL('index.html',root),'utf8');
const js=fs.readFileSync(new URL('assets/v24/v24_1_history.js',root),'utf8');
const css=fs.readFileSync(new URL('assets/v24/v24_1_history.css',root),'utf8');
const i18n=fs.readFileSync(new URL('assets/v24/v24_1_i18n.js',root),'utf8');

test('owner-approved unified Account history replaces both screens without horizontal scrolling',()=>{
  assert.match(html,/id="accountHistoryBtn">Account history/);
  assert.doesNotMatch(html,/id="transactionHistoryBtn"|id="balanceHistoryBtn"|class="history-mode"/);
  assert.match(html,/id="historyAccount"[\s\S]*value="Both"[\s\S]*value="Alex"[\s\S]*value="Olga"/);
  assert.match(html,/id="historyDetails"[^>]*hidden/);
  assert.match(css,/\.history-view\{overflow-x:hidden\}/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.history-management-fields\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(css,/@media\(max-width:760px\)[\s\S]*min-width:\s*[4-9]\d\dpx/);
});

test('history uses authoritative read routes and revision-bound management protocol',()=>{
  assert.match(js,/apiCall\('accountHistory'/);
  assert.match(js,/apiCall\('transactionHistory',[\s\S]*detailLogicalTransactionId/);
  assert.match(js,/apiCall\('transactionManagementPreview'/);
  assert.match(js,/apiCall\('transactionManagementCommit'/);
  assert.match(js,/baseRevision:preview\.baseRevision,terminalVersionId:preview\.terminalVersionId/);
  assert.match(js,/requestId=requestId\|\|crypto\.randomUUID\(\)/);
  assert.match(js,/The change was not confirmed/);
});

test('recorded balance updates explain their meaning and expose no mutation controls',()=>{
  assert.match(js,/Recorded balances/);
  assert.match(js,/This is a recorded balance update, not an expense or income/);
  assert.match(js,/Record a new balance update if it is wrong/);
  const balanceDetail=js.slice(js.indexOf('selected=null;const balances='),js.indexOf('function refusalMessage'));
  assert.doesNotMatch(balanceDetail,/data-management|transactionManagementCommit/);
});

test('management preview shows the signed server impact without exposing raw JSON',()=>{
  assert.match(js,/impactConsequences\(preview\.impact\)/);
  assert.match(js,/amount>0\?'enters ':'leaves '/);
  assert.doesNotMatch(js,/eligible\?esc\(consequence\(selected\)\)/);
  assert.doesNotMatch(js,/JSON\.stringify\(preview\.impact/);
});

test('one timeline opens linked current transaction details with the complete audit',()=>{
  assert.match(js,/detailLogicalTransactionId:item.logicalTransactionId/);
  assert.match(js,/showAudit:true/);
  assert.match(js,/renderTransactionDetail\(\)/);
  assert.match(js,/Complete audit history/);
  assert.match(js,/auditHistory\(t\)/);
  assert.doesNotMatch(html,/id="historyAudit"/);
});

test('transaction detail clearly describes the recorded fact and exposes no internal JSON',()=>{
  assert.match(js,/Recorded transaction/);
  assert.match(js,/recordedConsequence\(t\)/);
  assert.match(js,/paid from /);
  assert.doesNotMatch(js,/JSON\.stringify\(\{logicalTransactionId:t\.logicalTransactionId/);
});

test('guided correction exposes one selected detail or the complete same-type form without internal labels',()=>{
  for(const phrase of ['What needs correcting?','Date','Amount','Account','Category','Description','More than one detail','Transaction type stays unchanged.']) assert.match(js,new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(js,/const t=selected,all=choice==='more',show=name=>all\|\|choice===name/);
  assert.doesNotMatch(js,/Category ID|Source ID|Occurrence ID|Component ID/);
  assert.match(js,/classList\.add\('management-active'\)/);
  assert.match(js,/historyManagementHeading[\s\S]*\.focus\(\)/);
  assert.match(js,/querySelector\('\[data-management=/);
});

test('view-only reasons and complete audit are localized presentation data, never raw refusal output',()=>{
  for(const phrase of ['This historical transaction is view-only','This historical item is view-only','This transaction is safely view-only','Complete audit history','Bangkok time','Reason:','Before','After','Revision ']) assert.match(js,new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(js,/refusalCodes\|\|\[\]\)\.join/);
  assert.match(i18n,/Эта историческая транзакция доступна только для просмотра/);
  assert.match(i18n,/Эта историческая запись доступна только для просмотра/);
});

test('Pace is one unified screen with weekly cards immediately below current guidance',()=>{
  assert.match(html,/id="paceWeeklyValue"[\s\S]*id="paceAvailable"[\s\S]*id="weeklyVarCards"/);
  assert.doesNotMatch(html,/View weekly detail|id="weeklyDetails"/);
  assert.match(css,/management-active/);
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
  for(const phrase of ['Account history','Both','Alex change','Alex balance','Olga change','Olga balance','Combined balance','Current salary cycle','Previous salary cycle','Custom date range','Apply filters','Clear all','Load more']) assert.match(i18n,new RegExp("'"+phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"':'"));
  assert.doesNotMatch(i18n,/transactionManagementPreview|transactionManagementCommit|logicalTransactionId|terminalVersionId/);
});
