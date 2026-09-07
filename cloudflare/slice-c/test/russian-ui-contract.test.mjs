import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const i18n = fs.readFileSync(new URL('assets/v24/v24_1_i18n.js', root), 'utf8');

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
