import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const app1 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app1.js', import.meta.url), 'utf8');
const app2 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app2.js', import.meta.url), 'utf8');
const app4 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app4.js', import.meta.url), 'utf8');
const responsive = fs.readFileSync(new URL('../../../assets/v24/v24_1_tabs.css', import.meta.url), 'utf8');
const coreResponsive = fs.readFileSync(new URL('../../../assets/v24/v24_1_responsive.css', import.meta.url), 'utf8');
const positionPaceCss = fs.readFileSync(new URL('../../../assets/v24/v24_1_position_pace.css', import.meta.url), 'utf8');
const correction = fs.readFileSync(new URL('../../../assets/v24/v24_1_correction.js', import.meta.url), 'utf8');

test('phone navigation is four true panels rather than scroll anchors', () => {
  for (const tab of ['position', 'pace', 'commitments', 'savings']) {
    assert.match(html, new RegExp(`data-tab="${tab}"`));
    assert.match(html, new RegExp(`data-tab-panel="${tab}"`));
  }
  assert.doesNotMatch(html, /class="mobile-tabs"[^>]*>[\s\S]*?data-scroll=/);
  assert.match(app2, /function selectPrimaryTab\(tabName/);
  assert.match(app2, /panel\.hidden=panel\.dataset\.tabPanel!==tabName/);
});

test('approved information-led action placement is present', () => {
  assert.match(html, /data-tab-panel="position"[\s\S]*data-open-drawer="payment"[\s\S]*Preview payment/);
  assert.match(html, /data-tab-panel="position"[\s\S]*data-open-drawer="balance"[\s\S]*Update balances/);
  assert.match(html, /data-tab-panel="pace"[\s\S]*<h2>Available pace<\/h2>/);
  assert.doesNotMatch(html, /data-open-drawer="variablesTarget"/);
  assert.match(html, /data-tab-panel="commitments"[\s\S]*data-open-drawer="efCommitment"/);
  assert.match(html, /data-tab-panel="commitments"[\s\S]*data-open-drawer="goalCommitment"/);
  assert.match(html, /data-tab-panel="savings"[\s\S]*data-open-drawer="efWithdrawal"/);
  assert.doesNotMatch(html, /What would you like to do\?/);
  assert.doesNotMatch(html, /class="action-center"/);
});

test('phone landing panels hide inactive content while compact Pace remains scroll-safe', () => {
  assert.match(responsive, /\.primary-tab-panel\[hidden\]\{display:none!important\}/);
  assert.match(responsive, /\.primary-tab-panel\{[^}]*overflow:hidden/);
  assert.match(responsive, /\.detail-view[^}]*overflow-y:auto/);
  assert.match(positionPaceCss, /#weekly\{overflow-y:auto/);
  assert.match(html, /data-tab-panel="pace"[\s\S]*pace-week-list[^>]*id="weeklyVarCards"/);
  assert.doesNotMatch(html, /id="weeklyDetails"|View weekly detail/);
});

test('Position shows the explicit next salary date', () => {
  assert.match(html, /data-tab-panel="position"[\s\S]*<span>Next salary<\/span><b id="heroNextSalary">/);
  assert.doesNotMatch(html, /class="sr-only" id="heroNextSalary"/);
});

test('Position Pace card is directly below Available, responsive, labelled and navigates to Pace', () => {
  assert.match(html, /position-hero[\s\S]*id="positionPaceCard"[\s\S]*Available pace through Sunday[\s\S]*Available pace today[\s\S]*data-open-drawer="payment"/);
  assert.match(html, /id="positionPaceCard"[^>]*data-tab="pace"/);
  assert.match(positionPaceCss, /position-pace-card/);
  assert.match(positionPaceCss, /grid-template-columns:1fr 1fr/);
});

test('Available pace is phone-first, compact, and bounded on laptop', () => {
  const pacePanel = html.match(/data-tab-panel="pace"[\s\S]*?<\/section>/)[0];
  assert.match(pacePanel, /pace-guidance-compact/);
  assert.match(pacePanel, /pace-guidance-stats[\s\S]*pace-current-fact/);
  assert.match(positionPaceCss, /#weekly\{max-width:760px\}/);
  assert.match(positionPaceCss, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(positionPaceCss, /\.pace-week-row\{[^}]*min-height:58px/);
  assert.match(positionPaceCss, /@media\(max-width:760px\)[\s\S]*\.pace-week-row\{min-height:52px/);
  assert.match(app1, /card\.className='pace-week-row '/);
  assert.match(app1, /c\.isClosed\?'Closed':'Upcoming'/);
  assert.match(app1, /c\.isCurrent&&hasSpent\?fmtMoney\(c\.spent,currency\)\+' factual spending to date'/);
});

test('secondary account actions live in a focused detail view', () => {
  assert.match(html, /id="accountsDetails"[\s\S]*data-open-drawer="income"[\s\S]*data-open-drawer="ktbTransfer"[\s\S]*id="recordsCorrectionBtn"/);
  assert.match(html, /id="accountsSection"[\s\S]*data-open-detail="accountsDetails"/);
  assert.match(html, /<button class="btn position-secondary-action"[^>]*data-open-detail="accountsDetails">[\s\S]*?<span class="two-line-label">Move money<\/span><\/button>/);
});

test('compact header actions remain accessible with no target warning', () => {
  assert.match(html, /id="notificationsBtn" aria-label="Notifications"/);
  assert.match(html, /id="logoutBtn" aria-label="Sign out and close"/);
  assert.doesNotMatch(html, /guidanceTargetBtn|Set target|variablesTarget/i);
  assert.doesNotMatch(app1, /target_not_set|Variables target not set/i);
});

test('KTB transfer uses explicit direction choices and close signs out before requesting close', () => {
  assert.match(html, /data-kt-direction="Alex"[\s\S]*Alex → Olga/);
  assert.match(html, /data-kt-direction="Olga"[\s\S]*Olga → Alex/);
  assert.doesNotMatch(html, /<select id="kt-source"/);
  assert.match(app2, /async function logoutAndClose\(\)\{await logout\(\);window\.close\(\)\}/);
});

test('remaining detail navigation is labelled Back while Pace has no separate detail view', () => {
  const detailButtons = html.match(/<button type="button" data-close-detail>← Back<\/button>/g) || [];
  assert.equal(detailButtons.length, 4);
  assert.doesNotMatch(html, /id="weeklyDetails"|View weekly detail/);
  assert.doesNotMatch(html, /data-close-detail>Close<\/button>/);
  assert.match(html, /id="actionDrawerClose">← Back<\/button>/);
  assert.match(html, /id="movementCancel">← Back<\/button>/);
  assert.match(correction, /id="correctionCancel">← Back<\/button>/);
  assert.doesNotMatch(html, /aria-label="Close">×<\/button>/);
});

test('obligation payment keeps one request identity across ambiguous retries',()=>{
  assert.match(html,/v24_1_app4\.js\?v=20260918-obligation-payment-retry/);
  assert.match(app4,/function obligationPaymentRequestId\(payload\)/);
  assert.match(app4,/payload\.requestId=obligationPaymentRequestId\(payload\)/);
  assert.match(app4,/if\(movementContext\.type==='obligation'\)clearObligationPaymentRequest\(\)/);
  assert.match(app4,/Network error — retry the same payment\./);
});

test('correction entry is contextual rather than injected into the action directory', () => {
  assert.doesNotMatch(correction, /action-center/);
  assert.match(correction, /recordsCorrectionBtn/);
  assert.doesNotMatch(html, /class="action-tile"[^>]*>Correct record/);
  assert.match(html, /id="recordsCorrectionBtn">Salary-cycle correction<\/button>/);
  assert.match(correction, /Other corrections are safely unavailable here/);
  assert.doesNotMatch(correction, /\n\s+(balance|obligationPayment|ledgerMovement|goal):\[/);
  assert.match(responsive, /html,body\{min-height:100%;overflow-x:hidden\}/);
  assert.match(coreResponsive, /\.correction-safety,\.correction-safety li\{max-width:100%;overflow-wrap:anywhere\}/);
});

test('commitments total is a typographic summary rather than another card', () => {
  assert.match(responsive, /\.commitment-total\{[^}]*border-bottom:2px solid var\(--ink\)[^}]*border-radius:0[^}]*background:transparent/);
});
