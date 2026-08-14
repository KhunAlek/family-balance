import assert from 'node:assert/strict';

// First run the complete, already locked concurrency / rollback / safety proof.
await import('./proof.mjs');

const url=process.env.TEST_URL;
const secret=process.env.TEST_SECRET;
const headers={'content-type':'application/json','x-slice-c-test-secret':secret};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,body,method='POST'){
  const r=await fetch(url+path,{method,headers,body:method==='POST'?JSON.stringify(body):undefined});
  let data;try{data=await r.json()}catch{data={};}
  return {status:r.status,data};
}
async function state(){
  let last;
  for(let i=0;i<20;i++){
    last=await request('/state',null,'GET');
    if(last.status===200)return last.data;
    await sleep(500);
  }
  assert.equal(last?.status,200,JSON.stringify(last));
}
const write=(action,payload,writeToken,nowIso)=>request('/write',{action,payload,writeToken,nowIso});

let before=await state();
assert.equal(before.weeklyRows,8);
assert.deepEqual(before.salaryCycle,{current_cycle_start:'2026-07-31',next_salary_date:'2026-08-31'});
assert.deepEqual(before.salaryCycleSources,[
  {cycle_start:'2026-07-31',source:'Alex Salary'},
  {cycle_start:'2026-07-31',source:'Olga Salary'}
]);

let r=await write('correctRecord',{
  entityType:'goal',entityId:"Olga's laptop",correctedValues:{targetAmount:26000,priorityRank:1,status:'active',targetDate:''},reason:'Disposable real-D1 correction proof'
},'remote-correction','2026-08-14T12:00:00.000Z');
assert.equal(r.status,200,JSON.stringify(r));
assert.equal(r.data.ok,true);
let after=await state();
assert.equal(after.revision,before.revision+1);
assert.equal(after.claims,before.claims+1);
assert.equal(after.corrections,before.corrections+1);
assert.equal(Number(after.goals[0].target_amount_satang),2600000);
console.log(JSON.stringify({test:'audited correction on real D1',status:'PASS',revision:after.revision}));

before=after;
r=await write('incomeReceipt',{
  date:'2026-08-31',incomeSource:'Alex Salary',incomeAlexAmount:33775,incomeOlgaAmount:0
},'remote-salary-boundary','2026-08-31T12:00:00.000Z');
assert.equal(r.status,200,JSON.stringify(r));
assert.equal(r.data.ok,true);
assert.equal(r.data.salaryCycleAdvanced,true);
assert.equal(r.data.nextSalaryDateRequired,true);
after=await state();
assert.equal(after.revision,before.revision+1);
assert.equal(after.claims,before.claims+1);
assert.equal(after.weeklyRows,11);
assert.deepEqual(after.salaryCycle,{current_cycle_start:'2026-08-31',next_salary_date:null});
assert.deepEqual(after.salaryCycleSources,[
  {cycle_start:'2026-07-31',source:'Alex Salary'},
  {cycle_start:'2026-07-31',source:'Olga Salary'},
  {cycle_start:'2026-08-31',source:'Alex Salary'}
]);
assert.equal(after.latestBalance.business_date,'2026-08-31');
console.log(JSON.stringify({test:'salary boundary freezes old-cycle weekly cards on real D1',status:'PASS',weeklyRows:after.weeklyRows,cycle:after.salaryCycle}));
console.log(JSON.stringify({status:'PASS_V4',finalState:after},null,2));
