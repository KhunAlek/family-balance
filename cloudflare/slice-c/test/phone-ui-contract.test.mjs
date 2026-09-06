import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const app1 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app1.js', import.meta.url), 'utf8');
const app2 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app2.js', import.meta.url), 'utf8');
const responsive = fs.readFileSync(new URL('../../../assets/v24/v24_1_tabs.css', import.meta.url), 'utf8');
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
  assert.match(html, /data-tab-panel="pace"[\s\S]*data-open-drawer="variablesTarget"/);
  assert.match(html, /data-tab-panel="commitments"[\s\S]*data-open-drawer="efCommitment"/);
  assert.match(html, /data-tab-panel="commitments"[\s\S]*data-open-drawer="goalCommitment"/);
  assert.match(html, /data-tab-panel="savings"[\s\S]*data-open-drawer="efWithdrawal"/);
  assert.doesNotMatch(html, /What would you like to do\?/);
  assert.doesNotMatch(html, /class="action-center"/);
});

test('phone landing panels hide inactive content and reserve scrolling for details', () => {
  assert.match(responsive, /\.primary-tab-panel\[hidden\]\{display:none!important\}/);
  assert.match(responsive, /\.primary-tab-panel\{[^}]*overflow:hidden/);
  assert.match(responsive, /\.detail-view[^}]*overflow-y:auto/);
  assert.match(responsive, /\.detail-view \.week-grid\{display:grid;grid-template-columns:1fr;overflow:visible/);
});

test('Position shows the explicit next salary date', () => {
  assert.match(html, /data-tab-panel="position"[\s\S]*<span>Next salary<\/span><b id="heroNextSalary">/);
  assert.doesNotMatch(html, /class="sr-only" id="heroNextSalary"/);
});

test('Position Pace card is directly below Available, responsive, labelled and navigates to Pace', () => {
  assert.match(html, /position-hero[\s\S]*id="positionPaceCard"[\s\S]*Free to spend this week[\s\S]*Free to spend today[\s\S]*data-open-drawer="payment"/);
  assert.match(html, /id="positionPaceCard"[^>]*data-tab="pace"/);
  assert.match(positionPaceCss, /position-pace-card/);
  assert.match(positionPaceCss, /grid-template-columns:1fr 1fr/);
});

test('secondary account actions live in a focused detail view', () => {
  assert.match(html, /id="accountsDetails"[\s\S]*data-open-drawer="income"[\s\S]*data-open-drawer="ktbTransfer"[\s\S]*id="recordsCorrectionBtn"/);
  assert.match(html, /id="accountsSection"[\s\S]*data-open-detail="accountsDetails"/);
  assert.match(html, /data-open-detail="accountsDetails">Move money<\/button>/);
});

test('compact header actions remain accessible and target warning is concise', () => {
  assert.match(html, /id="notificationsBtn" aria-label="Notifications"/);
  assert.match(html, /id="logoutBtn" aria-label="Sign out and close"/);
  assert.match(html, /id="guidanceTargetBtn"[\s\S]*>Set target<\/button>/);
  assert.match(app1, /target_not_set:''/);
  assert.match(app1, /text\.textContent='Variables target not set\.'/);
});

test('KTB transfer uses explicit direction choices and close signs out before requesting close', () => {
  assert.match(html, /data-kt-direction="Alex"[\s\S]*Alex → Olga/);
  assert.match(html, /data-kt-direction="Olga"[\s\S]*Olga → Alex/);
  assert.doesNotMatch(html, /<select id="kt-source"/);
  assert.match(app2, /async function logoutAndClose\(\)\{await logout\(\);window\.close\(\)\}/);
});

test('detail navigation is labelled Back rather than Close', () => {
  const detailButtons = html.match(/<button type="button" data-close-detail>← Back<\/button>/g) || [];
  assert.equal(detailButtons.length, 5);
  assert.doesNotMatch(html, /data-close-detail>Close<\/button>/);
  assert.match(html, /id="actionDrawerClose">← Back<\/button>/);
  assert.match(html, /id="movementCancel">← Back<\/button>/);
  assert.match(correction, /id="correctionCancel">← Back<\/button>/);
  assert.doesNotMatch(html, /aria-label="Close">×<\/button>/);
});

test('correction entry is contextual rather than injected into the action directory', () => {
  assert.doesNotMatch(correction, /action-center/);
  assert.match(correction, /recordsCorrectionBtn/);
  assert.doesNotMatch(html, /class="action-tile"[^>]*>Correct record/);
});

test('commitments total is a typographic summary rather than another card', () => {
  assert.match(responsive, /\.commitment-total\{[^}]*border-bottom:2px solid var\(--ink\)[^}]*border-radius:0[^}]*background:transparent/);
});
