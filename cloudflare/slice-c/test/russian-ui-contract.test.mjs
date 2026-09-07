import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const i18n = fs.readFileSync(new URL('assets/v24/v24_1_i18n.js', root), 'utf8');
const app1 = fs.readFileSync(new URL('assets/v24/v24_1_app1.js', root), 'utf8');
const reports = fs.readFileSync(new URL('assets/v24/v24_1_reports.js', root), 'utf8');
const notifications = fs.readFileSync(new URL('assets/v24/v24_1_notifications.js', root), 'utf8');

function translations(language = 'ru') {
  const stored = new Map([['familyCashFlowLanguage', language]]);
  const context = {
    localStorage: { getItem:key=>stored.get(key)||null, setItem:(key,value)=>stored.set(key,value) },
    navigator: { language: 'en' },
    document: {
      body: {}, documentElement: {}, getElementById:()=>null,
      createTreeWalker:()=>({nextNode:()=>null}), querySelectorAll:()=>[]
    },
    NodeFilter: { SHOW_TEXT: 4 }, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    MutationObserver: class { observe(){} }, CustomEvent: class { constructor(type,init){this.type=type;this.detail=init.detail} },
    window: { dispatchEvent(){} }
  };
  vm.runInNewContext(i18n, context);
  return context.window.FamilyCashFlowLanguage;
}

test('English and Russian are selectable without changing financial values', () => {
  assert.match(html, /id="languageSelect"[\s\S]*value="en"[\s\S]*value="ru"/);
  assert.match(html, /v24_1_i18n\.js/);
  assert.match(i18n, /const STORAGE_KEY='familyCashFlowLanguage'/);
  assert.match(i18n, /'Available to spend':'Доступно для расходов'/);
  assert.match(i18n, /document\.documentElement\.lang=language/);
  assert.doesNotMatch(i18n, /fetch\(|apiCall\(|postAction\(/);
});

test('English remains the fallback for unsupported or incomplete locale data', () => {
  assert.match(i18n, /if\(language!=='ru'\)language='en'/);
  assert.match(i18n, /if\(language!=='ru'\)return value/);
  assert.match(i18n, /return value}/);
});

test('phase two translates remaining surfaces while preserving user-entered names', () => {
  const language = translations();
  assert.equal(language.translate('One-off spending Reports'), 'Отчёты по разовым расходам');
  assert.equal(language.translate('Correct a record'), 'Исправить запись');
  assert.equal(language.translate('Manage categories'), 'Управление категориями');
  assert.equal(language.translate('Recent reminders'), 'Недавние напоминания');
  assert.equal(language.translate('Final payment — Close this bill'), 'Окончательный платёж — закрыть счёт');
  assert.equal(language.translate('Add “Отпуск 2027” as an active category.'), 'Добавить «Отпуск 2027» как активную категорию.');
  assert.equal(language.translate('Deactivate “Подработка” from 7 сент. Existing receipts stay unchanged.'), 'Отключить «Подработка» с 7 сент. Существующие поступления останутся без изменений.');
  assert.equal(language.translate('Моя цель'), 'Моя цель');
});

test('every static English UI phrase is translated except stable product and account identifiers', () => {
  const language = translations();
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const visible = [...new Set([...withoutScripts.matchAll(/>([^<>]+)</g)]
    .map(match=>match[1].replace(/&amp;/g, '&').trim()).filter(value=>/[A-Za-z]/.test(value)))];
  const stable = new Set(['Family Cash Flow','EN','RU','THB','Alex KTB','Olga KTB','KTB ↔ KTB','Alex → Olga','Olga → Alex']);
  assert.deepEqual(visible.filter(value=>!stable.has(value)&&language.translate(value)===value), []);
});

test('locale formatting is display-only and keeps Bangkok business-date construction', () => {
  assert.match(app1, /displayLocale\('en-GB'\)/);
  assert.match(app1, /timeZone:'Asia\/Bangkok'/);
  assert.match(app1, /Intl\.DateTimeFormat\('en-CA'/);
  assert.match(reports, /fmtDate\(p\.business_date\)/);
  assert.match(notifications, /timeZone:'Asia\/Bangkok'/);
});

test('localization does not alter API actions, identifiers, or persisted report values', () => {
  assert.doesNotMatch(i18n, /fetch\(|apiCall\(|postAction\(/);
  assert.doesNotMatch(i18n, /oneOffReportSelection|oneOffReportBaseline|categoryId|sourceId|requestId/);
  assert.match(reports, /localStorage\.setItem\('oneOffReportSelection',JSON\.stringify\(reportSelection\)\)/);
  assert.match(app1, /source==='Alex'\?b\.alex:b\.olga/);
});
