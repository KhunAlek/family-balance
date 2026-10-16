const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
(async()=>{
const {buildAccountHistory}=await import(pathToFileURL(path.resolve('cloudflare/slice-d/src/account-history.mjs')));
const {BACKUP_TABLES}=await import(pathToFileURL(path.resolve('cloudflare/slice-d/src/backup.mjs')));
let tables=Object.fromEntries(BACKUP_TABLES.map(name=>[name,[]]));tables.households=[{household_id:'family'}];tables.household_revisions=[{household_id:'family',current_revision:1}];
const addBalance=(id,alex,olga)=>tables.balance_history.push({household_id:'family',balance_row_id:id,business_date:'2026-10-16',sheet_order:id,source_sheet:'Balance Check',source_row:id,alex_balance_satang:alex,olga_balance_satang:olga});
addBalance(1,1300000,400000);addBalance(2,1200000,500000);addBalance(3,1165000,500000);
const addTx=(id,kind,components)=>{tables.logical_transactions.push({household_id:'family',logical_transaction_id:id,lifecycle_status:'active',terminal_version_id:id+'-v1'});tables.logical_transaction_versions.push({version_id:id+'-v1',logical_transaction_id:id,kind,version_number:1,business_date:'2026-10-16',committed_revision:1,operation_type:'created',management_operation_id:null});components.forEach(([kind,componentId,role])=>tables.logical_transaction_components.push({version_id:id+'-v1',component_kind:kind,component_id:String(componentId),component_role:role}));};
tables.ktb_transfers.push({household_id:'family',transfer_id:'transfer',business_date:'2026-10-16',amount_satang:100000,source_account:'Alex',destination_account:'Olga',balance_effect_id:2});addTx('transfer','ktb_transfer',[['balance_effect',2,'cash_effect']]);
tables.balance_history[2].one_off_payment_id='groceries';tables.one_off_payments.push({household_id:'family',one_off_payment_id:'groceries',business_date:'2026-10-16',amount_satang:35000,description:'Groceries',category_id:null});tables.one_off_payment_allocations.push({one_off_payment_id:'groceries',account:'Alex',amount_satang:35000});addTx('groceries','one_off_payment',[['one_off_payment','groceries','primary'],['one_off_payment_allocation','groceries:Alex','allocation'],['balance_effect',3,'cash_effect']]);
if(process.env.FCF_HISTORY_FIXTURE)tables=JSON.parse(fs.readFileSync(process.env.FCF_HISTORY_FIXTURE));
const results={};for(const account of ['Both','Alex','Olga'])results[account]=await buildAccountHistory(tables,{account,pageSize:10});
let html=fs.readFileSync('index.html','utf8');const css=[...html.matchAll(/href="(assets\/[^"?]+\.css)/g)].map(x=>fs.readFileSync(x[1],'utf8')).join('\n');
html=html.replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'').replace('</head>','<style>'+css+'</style></head>').replace('id="app" style="display:none"','id="app"');
html=html.replace(/src="(assets\/[^"?]+\.png)(?:\?[^"<>]*)?"/g,(_,file)=>'src="data:image/png;base64,'+fs.readFileSync(file).toString('base64')+'"');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
for(const width of [360,691,1440]){
const page=await browser.newPage({viewport:{width,height:1000}});await page.setContent(html);
await page.evaluate(results=>{document.getElementById('loadingState').style.display='none';document.getElementById('authGate').style.display='none';Object.defineProperty(crypto,'randomUUID',{value:()=> 'browser-fixture-request'});window.historyCalls=[];window.currentData={config:{currency:'THB'}};window.fmtMoney=x=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'THB',maximumFractionDigits:2}).format(x);window.openDetail=id=>document.getElementById(id).hidden=false;window.closeDetail=el=>el.hidden=true;window.refreshLiveData=async()=>historyCalls.push('dashboard');window.displayLocale=()=> 'en-GB';window.apiCall=async(action,payload)=>{historyCalls.push(action);if(action==='accountHistory')return results[payload.account||'Both'];if(action==='transactionHistory')return {ok:true,detail:{logicalTransactionId:payload.detailLogicalTransactionId,description:'Groceries',kind:'one_off_payment',businessDate:'2026-10-16',direction:'money_out',totalSatang:35000,allocations:[{account:'Alex',amountSatang:35000}],permittedActions:{correct:true,delete:true}}};if(action==='transactionManagementPreview')return {ok:true,eligibility:{eligible:true},baseRevision:1,terminalVersionId:'test-v1',impact:{cashChangeSatang:{alexSatang:5000,olgaSatang:0},combinedCashChangeSatang:5000}};if(action==='transactionManagementCommit')return {ok:true};throw Error(action)};},results);
await page.addScriptTag({content:fs.readFileSync('assets/v24/v24_1_history.js','utf8')});
await page.evaluate(()=>{openDetail('accountsDetails');document.getElementById('accountHistoryBtn').click()});
await page.waitForSelector('.account-history-table tbody tr');
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
assert.equal(await page.locator('.history-mode').count(),0);
assert.equal(await page.locator('.account-history-table thead th').count(),7);
await page.screenshot({path:'/tmp/unified-history-'+width+'.png',fullPage:true});
await page.selectOption('#historyAccount','Alex');await page.waitForFunction(()=>document.querySelectorAll('.account-history-table thead th').length===4);
await page.selectOption('#historyAccount','Both');await page.waitForFunction(()=>document.querySelectorAll('.account-history-table thead th').length===7);
if(!process.env.FCF_HISTORY_FIXTURE){
assert.ok((await page.locator('.account-history-table').innerText()).includes('Transfer: Alex → Olga'));
await page.locator('[data-history-index="0"]').click();await page.getByRole('button',{name:'Correct transaction',exact:true}).click();await page.getByRole('button',{name:'Amount',exact:true}).click();
await page.locator('[data-allocation-amount]').fill('300');await page.click('#hmPreviewBtn');await page.waitForFunction(()=>!document.getElementById('hmCommitBtn').disabled);await page.click('#hmCommitBtn');await page.waitForFunction(()=>window.historyCalls.includes('dashboard'));assert.ok(await page.evaluate(()=>historyCalls.filter(x=>x==='accountHistory').length>=4));
}
console.log('PASS unified '+width+'px: full app shell, Both/Alex/Olga filters, readable table, no horizontal overflow'+(process.env.FCF_HISTORY_FIXTURE?' (production read-only fixture)':' and correction/refresh workflow'));
await page.close();
}
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
