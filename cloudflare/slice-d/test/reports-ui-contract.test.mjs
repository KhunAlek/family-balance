import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../../../assets/v24/v24_1_reports.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../../../assets/v24/v24_1_tabs.css',import.meta.url),'utf8')+fs.readFileSync(new URL('../../../assets/v24/v24_1_repair.css',import.meta.url),'utf8');

test('Reports UI presents category names, numeric category totals and shared filtered/unfiltered drill-down',()=>{
  assert.match(source,/label:r\.categoryLabels\[c\]\|\|c/);
  assert.match(source,/class="compact-row report-total" data-report-category/);
  assert.match(source,/data-report-grand/);
  assert.match(source,/async function loadReportPayments\(categoryId\)/);
  assert.match(source,/payload\.categoryId=categoryId/);
});

test('Reports empty state suppresses both charts and phone layout remains independently scrollable',()=>{
  assert.match(source,/reportCategoryCard\.hidden=empty;reportTrendCard\.hidden=empty/);
  assert.match(source,/No one-off spending yet/);
  assert.match(css,/@media\(max-width:760px\).*\.reports-panel\{overflow-y:auto\}/s);
});

test('Reports charts wait for visible layout and use stable non-animated fixed-height containers',()=>{
  assert.match(source,/reportLayoutReady/);assert.match(source,/maintainAspectRatio:false/);assert.match(source,/animation:false/);assert.match(source,/resizeDelay:120/);assert.match(source,/reportCharts\.forEach\(x=>x\.destroy\(\)\)/);assert.match(css,/report-chart-wrap/);
});
