import assert from 'node:assert/strict';

const url=process.env.TEST_URL;
const secret=process.env.TEST_SECRET;
const nowIso=process.env.NOW_ISO;
const headers={'content-type':'application/json','x-slice-c-test-secret':secret};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function request(path,body,method='POST'){
  const r=await fetch(url+path,{method,headers,body:method==='POST'?JSON.stringify(body):undefined});
  let data;try{data=await r.json()}catch{data={};}
  return {status:r.status,data};
}

// Read-only state polling may retry transient workers.dev propagation failures.
// Financial writes below are NEVER retried.
async function state(){
  let last=null;
  for(let i=0;i<20;i++){
    last=await request('/state',null,'GET');
    if(last.status===200)return last.data;
    if(![404,500,502,503].includes(last.status))break;
    await sleep(500);
  }
  assert.equal(last?.status,200,`state endpoint did not stabilize: ${JSON.stringify(last)}`);
  return last.data;
}
const write=(action,payload,writeToken,extra={})=>request('/write',{action,payload,writeToken,nowIso,...extra});
const preview=payload=>request('/preview',{payload,nowIso});
const unchanged=(a,b,fields)=>{for(const f of fields)assert.equal(b[f],a[f],`${f} changed unexpectedly`);};

async function race(label,a,b){
  const before=await state();
  const [ra,rb]=await Promise.all([
    write(a.action,a.payload,`${label}-a`,{delayBeforeBatchMs:1200}),
    write(b.action,b.payload,`${label}-b`,{delayBeforeBatchMs:1200})
  ]);
  const statuses=[ra.status,rb.status].sort((x,y)=>x-y);
  assert.deepEqual(statuses,[200,409],`${label}: expected one success and one stale writer: ${JSON.stringify({ra,rb})}`);
  const loser=ra.status===409?ra:rb;
  assert.equal(loser.data.staleWriter,true,`${label}: loser was not classified stale`);
  const after=await state();
  assert.equal(after.revision,before.revision+1,`${label}: revision`);
  assert.equal(after.claims,before.claims+1,`${label}: claims`);
  console.log(JSON.stringify({test:label,status:'PASS',beforeRevision:before.revision,afterRevision:after.revision}));
}

const initial=await state();
assert.equal(initial.revision,0);
assert.equal(initial.claims,0);
assert.equal(initial.balanceRows,69);
assert.equal(initial.ledgerRows,3);
assert.equal(initial.paymentRows,8);

let r=await write('obligationPayment',{
  date:'2026-08-12',sourceAccount:'Alex',amount:14,
  obligationName:'Claude',occurrenceDueDate:'2026-08-03',paymentStatus:'Partial',note:'remote proof'
},'backdated-proof');
assert.equal(r.status,200,JSON.stringify(r));
let s=await state();
assert.equal(s.revision,1);
assert.equal(s.latestPayment.payment_date,'2026-08-12');
assert.equal(s.latestPayment.occurrence_due_date,'2026-08-03');
assert.equal(Number(s.latestPayment.actual_amount_satang),1400);
console.log(JSON.stringify({test:'backdated submitted date',status:'PASS'}));

await race('two-payments',
  {action:'oneOffPayment',payload:{date:'2026-08-14',oneOffName:'Remote race A',oneOffAlexAmount:10,oneOffOlgaAmount:0}},
  {action:'oneOffPayment',payload:{date:'2026-08-14',oneOffName:'Remote race B',oneOffAlexAmount:0,oneOffOlgaAmount:10}}
);
await race('balance-vs-payment',
  {action:'balanceCheck',payload:{date:'2026-08-14',alexBalance:'2270',olgaBalance:''}},
  {action:'oneOffPayment',payload:{date:'2026-08-14',oneOffName:'Remote payment',oneOffAlexAmount:0,oneOffOlgaAmount:5}}
);
await race('ef-vs-payment',
  {action:'dedicatedTransfer',payload:{date:'2026-08-14',sourceAccount:'Alex',amount:5,destinationType:'EF',destinationName:'EF'}},
  {action:'oneOffPayment',payload:{date:'2026-08-14',oneOffName:'Remote payment',oneOffAlexAmount:0,oneOffOlgaAmount:5}}
);

let before=await state();
r=await write('balanceCheck',{date:'2026-08-14',alexBalance:'2200',olgaBalance:''},'forced-failure',{forcedFailure:true});
assert.equal(r.status,500,JSON.stringify(r));
s=await state();
unchanged(before,s,['revision','claims','balanceRows','ledgerRows','paymentRows']);
console.log(JSON.stringify({test:'forced mid-batch rollback',status:'PASS'}));

before=await state();
r=await write('ktbTransfer',{date:'2026-08-14',sourceAccount:'Alex',destinationAccount:'Olga',amount:999999},'overdraft');
assert.equal(r.status,400,JSON.stringify(r));
s=await state();
unchanged(before,s,['revision','claims','balanceRows','ledgerRows','paymentRows']);
console.log(JSON.stringify({test:'account overdraft rejection',status:'PASS'}));

before=await state();
r=await preview({date:'2026-08-14',oneOffName:'Preview only',oneOffAlexAmount:0,oneOffOlgaAmount:500});
assert.equal(r.status,200,JSON.stringify(r));
s=await state();
unchanged(before,s,['revision','claims','balanceRows','ledgerRows','paymentRows']);
console.log(JSON.stringify({test:'preview zero writes',status:'PASS'}));

r=await preview({date:'2026-08-14',oneOffName:'Fresh-state proof',oneOffAlexAmount:0,oneOffOlgaAmount:999999});
assert.equal(r.status,200,JSON.stringify(r));
const oldSafe=Math.floor(Number(r.data.safeDiscretionaryKTB)*100)/100;
assert.ok(oldSafe>10,`unexpected safe capacity ${oldSafe}`);
r=await write('dedicatedTransfer',{date:'2026-08-14',sourceAccount:'Alex',amount:5,destinationType:'EF',destinationName:'EF'},'preceding-ef');
assert.equal(r.status,200,JSON.stringify(r));
r=await write('oneOffPayment',{date:'2026-08-14',oneOffName:'Fresh-state proof',oneOffAlexAmount:0,oneOffOlgaAmount:oldSafe},'stale-preview-final');
assert.equal(r.status,400,JSON.stringify(r));
assert.equal(r.data.requiresEFWithdrawal,true,JSON.stringify(r));
assert.ok(Number(r.data.split?.efPortion)>0,JSON.stringify(r));
console.log(JSON.stringify({test:'final recalculates authoritative state',status:'PASS',oldSafe,newEfRequired:r.data.split.efPortion}));

r=await write('efWithdrawal',{date:'2026-08-14',destinationAccount:'Alex',amount:5},'explicit-ef-withdrawal');
assert.equal(r.status,200,JSON.stringify(r));
s=await state();
assert.equal(s.latestLedger.account,'EF');
assert.equal(s.latestLedger.direction,'Withdrawal');
assert.equal(Number(s.latestLedger.amount_satang),500);
assert.equal(s.latestLedger.source_sheet,'Cloudflare');
console.log(JSON.stringify({test:'explicit EF withdrawal persisted',status:'PASS'}));

console.log(JSON.stringify({status:'PASS',finalState:await state()},null,2));
