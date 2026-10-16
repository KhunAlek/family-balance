const fs=require('fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
(async()=>{
const html=fs.readFileSync('index.html','utf8');
const section=html.split('\n').find(x=>x.includes('id="historyDetails"'));
const css=[...html.matchAll(/href="(assets\/[^"?]+\.css)/g)].map(x=>fs.readFileSync(x[1],'utf8')).join('\n');
const entries=[{entryType:'balance_observation',businessDate:'2026-10-16',balancesSatang:{alex:1234500,olga:null,combined:null}},{entryType:'balance_observation',businessDate:'2026-10-16',balancesSatang:{alex:1234500,olga:950050,combined:2184550}},...['Groceries','Transfer to Olga','Deleted payment'].map((description,i)=>({entryType:'transaction_balance_effect',businessDate:'2026-10-16',transactionLink:{status:'linked',logicalTransactionId:'sample'},transactionSummary:{description,kind:i===1?'ktb_transfer':'one_off_payment',lifecycle:i===2?'deleted':'active',accountChanges:i===1?[{account:'Alex',changeSatang:-35000},{account:'Olga',changeSatang:35000}]:[{account:'Alex',changeSatang:-35000}]}})),{entryType:'transaction_balance_effect',businessDate:'2026-10-15',transactionSummary:null}];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
for(const width of [360,691,1440]){
const page=await browser.newPage({viewport:{width,height:1000}});
await page.setContent('<style>'+css+'</style><button id="transactionHistoryBtn">Transactions</button><button id="balanceHistoryBtn">Balances</button>'+section);
await page.evaluate(entries=>{window.currentData={config:{currency:'THB'}};window.fmtMoney=x=>'฿'+x.toFixed(2);window.openDetail=id=>document.getElementById(id).hidden=false;window.closeDetail=()=>{};window.apiCall=async action=>action==='balanceHistory'?{ok:true,entries,counts:{entries:6,observations:2,transactionEffects:4},pagination:{hasMore:false}}:{ok:true,transactions:[],totals:{moneyInSatang:0,moneyOutSatang:0,resultCount:0},pagination:{hasMore:false},detail:{logicalTransactionId:'sample',description:'Groceries',kind:'one_off_payment',businessDate:'2026-10-16',totalSatang:35000,direction:'money_out',allocations:[{account:'Alex',amountSatang:35000}],permittedActions:{}}};},entries);
await page.addScriptTag({content:fs.readFileSync('assets/v24/v24_1_history.js','utf8')});
await page.click('#balanceHistoryBtn');
await page.waitForSelector('.history-row');
assert.equal(await page.locator('.history-row').count(),6);
assert.ok((await page.locator('.history-row').nth(0).innerText()).includes('Alex ฿12345.00'));
assert.ok(!(await page.locator('#historyList').innerText()).includes('Partial accounts'));
assert.ok((await page.locator('#historyList').innerText()).includes('Olga +฿350.00'));
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.screenshot({path:'/tmp/history-'+width+'.png',fullPage:true});
await page.locator('.history-row').nth(2).click();await page.click('#historyLinkedTransaction');
assert.ok((await page.locator('#historyRecordDetail').innerText()).includes('Groceries'));
console.log('PASS layout, partial/combined balances, signed transfer, deleted/unlinked records and transaction navigation: '+width+'px');
await page.close();
}
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
