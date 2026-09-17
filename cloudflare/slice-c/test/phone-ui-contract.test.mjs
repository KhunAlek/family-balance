import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const app1 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app1.js', import.meta.url), 'utf8');
const app2 = fs.readFileSync(new URL('../../../assets/v24/v24_1_app2.js', import.meta.url), 'utf8');
const responsive = fs.readFileSync(new URL('../../../assets/v24/v24_1_tabs.css', import.meta.url), 'utf8');
const coreResponsive = fs.readFileSync(new URL('../../../assets/v24/v24_1_responsive.css', import.meta.url), 'utf8');
const positionPaceCss = fs.readFileSync(new URL('../../../assets/v24/v24_1_position_pace.css', import.meta.url), 'utf8');
const mobilePositionCss = fs.readFileSync(new URL('../../../assets/v25/mobile-position.css', import.meta.url), 'utf8');
const reports = fs.readFileSync(new URL('../../../assets/v24/v24_1_reports.js', import.meta.url), 'utf8');
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
  assert.match(html, /id="accountsSection"[\s\S]*class="position-action-row"[\s\S]*data-open-drawer="payment"[\s\S]*>Make payment<\/span>/);
  assert.match(html, /data-drawer="payment"[\s\S]*id="previewPaymentBtn">Preview payment<\/button>[\s\S]*id="paymentBtn" disabled>Record payment<\/button>/);
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
  assert.match(mobilePositionCss, /--position-card-size:/);
  assert.match(mobilePositionCss, /#overview \.position-hero,#overview \.position-pace-card\{[\s\S]*height:var\(--position-card-size\)[\s\S]*min-height:var\(--position-card-size\)[\s\S]*max-height:var\(--position-card-size\)/);
  assert.match(app1, /positionPaceWeek'\)\.textContent=fmtMoney\(pace\.throughSunday,c\)/);
  assert.match(app1, /positionPaceToday'\)\.textContent=fmtMoney\(pace\.today,c\)/);
  assert.doesNotMatch(app1, /positionPaceWeek'\)\.textContent=fmtMoney\(pace\.throughSunday,c,true\)/);
  assert.match(mobilePositionCss, /position-pace-card b\{[^}]*font-size:clamp\(25px,7\.2vw,32px\)/);
  assert.match(mobilePositionCss, /position-pace-card small\{min-height:2\.5em/);
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
  assert.match(html, /class="position-action-row"[\s\S]*data-open-detail="accountsDetails"[\s\S]*?<span class="two-line-label">Move money<\/span><\/button>/);
  assert.doesNotMatch(html, /id="accountsSection"[\s\S]*?panel-actions/);
});

test('Account balances is the third major card followed by one equal action row', () => {
  assert.match(html, /position-hero[\s\S]*position-pace-card[\s\S]*id="accountsSection"[\s\S]*class="position-action-row"/);
  assert.match(mobilePositionCss, /#accountsSection\{[\s\S]*linear-gradient\(135deg,#8a8078 0%,#6b625d 38%,#565761 72%,#36485f 100%\)/);
  assert.match(mobilePositionCss, /#accountsSection\{[\s\S]*height:var\(--position-card-size\)[\s\S]*min-height:var\(--position-card-size\)[\s\S]*max-height:var\(--position-card-size\)/);
  assert.match(mobilePositionCss, /#accountsSection \.panel-head h3\{[^}]*font-size:12px/);
  assert.match(mobilePositionCss, /#accountsSection \.account\{[^}]*padding:5px 2px/);
  assert.match(mobilePositionCss, /#accountsSection \.salary-row\{[^}]*padding:5px 0 6px/);
  assert.match(mobilePositionCss, /#accountsSection:after\{border-color:rgba\(255,255,255,\.07\)\}/);
  assert.match(mobilePositionCss, /#accountsSection:before\{[^}]*border:24px solid rgba\(255,255,255,\.04\)/);
  assert.match(mobilePositionCss, /radial-gradient\(circle at 24% 24%,rgba\(255,245,235,\.1\),transparent 42%\)/);
  assert.match(mobilePositionCss, /border:1px solid rgba\(185,174,161,\.22\)/);
  assert.match(mobilePositionCss, /box-shadow:[^}]*0 7px 18px rgba\(26,32,42,\.16\)/);
  assert.match(mobilePositionCss, /account span\{color:#f1ece4/);
  assert.match(mobilePositionCss, /salary-row span\{color:#ddd5cc/);
  assert.match(mobilePositionCss, /salary-row small\{[^}]*color:#d0c7be/);
  assert.match(mobilePositionCss, /text-action\{[^}]*rgba\(217,209,199,\.55\)[^}]*color:#f6f2ec!important/);
  assert.match(mobilePositionCss, /position-action-row\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(mobilePositionCss, /position-action-row \.btn\{[\s\S]*height:44px;min-height:44px/);
  assert.match(mobilePositionCss, /two-line-label\{[^}]*max-width:54px/);
});

test('all three feature cards share one gradient and curved-highlight treatment', () => {
  assert.match(mobilePositionCss, /position-hero,#overview \.position-pace-card,#accountsSection\{box-shadow:inset 0 1px/);
  assert.match(mobilePositionCss, /position-hero:after,#overview \.position-pace-card:after,#accountsSection:after\{/);
  assert.match(mobilePositionCss, /right:-72px;top:-88px;width:235px;height:235px;border:30px solid rgba\(255,255,255,\.085\);border-radius:50%/);
  assert.match(mobilePositionCss, /position-hero[\s\S]*background:linear-gradient\(145deg,#819bbc 0%,var\(--position-slate\) 48%,#344d69 100%\)/);
  assert.match(mobilePositionCss, /position-pace-card[\s\S]*background:linear-gradient\(145deg,#e7cd82 0%,var\(--position-gold\) 48%,#8c6929 100%\)/);
});

test('the complete Position hierarchy fits a 360 by 800 viewport above navigation', () => {
  assert.match(mobilePositionCss, /--position-card-size:154px/);
  assert.match(mobilePositionCss, /primary-tab-shell\{height:calc\(100dvh - 84px\);padding:10px 12px calc\(90px/);
  const usableHeight = 800 - 84 - 10 - 90;
  const hierarchyHeight = (154 * 3) + (10 * 3) + 44;
  assert.ok(hierarchyHeight <= usableHeight, `${hierarchyHeight}px hierarchy exceeds ${usableHeight}px usable height`);
});

test('compact header actions remain accessible with no target warning', () => {
  assert.match(html, /id="notificationsBtn" aria-label="Notifications"/);
  assert.match(html, /id="logoutBtn" aria-label="Sign out and close"/);
  assert.doesNotMatch(html, /guidanceTargetBtn|Set target|variablesTarget/i);
  assert.doesNotMatch(app1, /target_not_set|Variables target not set/i);
  assert.match(html, /Great\+Vibes/);
  assert.match(mobilePositionCss, /font-family:"Great Vibes",cursive/);
  assert.match(mobilePositionCss, /font-size:clamp\(30px,9\.25vw,40px\)/);
  assert.match(mobilePositionCss, /\.mobile-app-name\{[\s\S]*max-width:100%/);
  assert.match(mobilePositionCss, /\.greeting p\{display:none\}/);
  assert.match(mobilePositionCss, /\.topbar-icon\{display:none!important\}/);
  assert.match(mobilePositionCss, /\.top-actions \.language-picker\{display:none!important\}/);
  assert.match(mobilePositionCss, /\.top-actions\{[\s\S]*display:flex;[\s\S]*min-width:90px/);
  assert.match(mobilePositionCss, /min-height:44px/);
  assert.match(mobilePositionCss, /icon-action svg\{[\s\S]*width:18px;height:18px[\s\S]*stroke:#d8b65f/);
  assert.match(html, /hero-label">Available to spend<span class="sr-only" id="heroDateRange"><\/span>/);
});

test('mobile Position palette and five-icon navigation follow the approved visual system', () => {
  assert.match(html, /assets\/v25\/mobile-position\.css/);
  assert.match(mobilePositionCss, /--position-navy:#101e2d/);
  assert.match(mobilePositionCss, /--position-slate:#526f91/);
  assert.match(mobilePositionCss, /--position-gold:#c3a052/);
  assert.doesNotMatch(mobilePositionCss, /teal|turquoise|cyan|green/i);
  assert.match(mobilePositionCss, /grid-template-columns:repeat\(5,1fr\)!important/);
  assert.match(reports, /classList\.contains\('mobile-tabs'\)[\s\S]*<svg[\s\S]*<span>Reports<\/span>/);
  assert.equal((reports.match(/reportTab\(document\.querySelector\('\.mobile-tabs'\)\)/g) || []).length, 1);
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
