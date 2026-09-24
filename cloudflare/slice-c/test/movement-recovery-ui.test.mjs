import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const recovery=fs.readFileSync(new URL('../../../assets/v24/v24_1_movement_recovery.js',import.meta.url),'utf8');
const app4=fs.readFileSync(new URL('../../../assets/v24/v24_1_app4.js',import.meta.url),'utf8');
const app2=fs.readFileSync(new URL('../../../assets/v24/v24_1_app2.js',import.meta.url),'utf8');

function browser(sharedStorage=new Map(),useActualRefresh=false) {
  const elements=new Map(),handlers=new Map(),messages=[],posts=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      id,value:'',dataset:{},style:{},classList:{add(){},remove(){},contains(){return false}},
      addEventListener(type,handler){handlers.set(id+':'+type,handler)},reset(){},removeAttribute(name){this.removedAttribute=name},
      setAttribute(){},focus(){}
    });
    return elements.get(id);
  };
  const document={getElementById:element,querySelectorAll(){return []},addEventListener(){}};
  const sessionStorage={getItem:key=>sharedStorage.get(key)||null,setItem:(key,value)=>sharedStorage.set(key,value)};
  const context=vm.createContext({document,sessionStorage,crypto:webcrypto,globalThis:null,setMsg:(id,message)=>messages.push([id,message]),clearMsg:()=>{},setBusy:()=>{},postAction:async payload=>{posts.push(payload);return {ok:true}},currentSourceBalance:()=>100,refreshLiveData:async()=>{},render:()=>{},closeActionDrawer:()=>{},initializeApp:()=>{},todayIso:()=> '2026-08-14',fmtMoney:v=>String(v),setTimeout:()=>{},console});
  context.globalThis=context;
  vm.runInContext("let AUTHENTICATED_USER='alex@example.com';let currentData={emergencyFund:{current:100},config:{currency:'THB'}};let currentRenderMeta={stale:false};let movementContext={type:'ef',safeAmount:100};",context);
  vm.runInContext(recovery,context);
  vm.runInContext('renderMovementRecoveryBanner=()=>{};',context);
  if(!useActualRefresh)vm.runInContext('refreshAfterRecordedMovement=async()=>{};',context);
  vm.runInContext(app4,context);
  return {context,element,handlers,messages,posts,sharedStorage,submit:id=>handlers.get(id+':submit')({preventDefault(){}})};
}

test('actual forms send all eight movement directions with valid IDs and exact business details',async()=>{
  for(const source of ['Alex','Olga']){
    const b=browser(),destination=source==='Alex'?'Olga':'Alex';
    b.element('kt-date').value='2026-08-14';b.element('kt-source').value=source;b.element('kt-destination').value=destination;b.element('kt-amount').value='10';
    await b.submit('ktbTransferForm');
    assert.equal(b.posts.length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(b.posts[0])),{action:'ktbTransfer',date:'2026-08-14',sourceAccount:source,destinationAccount:destination,amount:10,requestId:b.posts[0].requestId});
    assert.match(b.posts[0].requestId,/^[a-zA-Z0-9:_-]{1,128}$/);
  }
  for(const destination of ['Alex','Olga']){
    const b=browser();
    b.element('ew-date').value='2026-08-14';b.element('ew-destination').value=destination;b.element('ew-amount').value='10';
    await b.submit('efWithdrawalForm');
    assert.equal(b.posts.length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(b.posts[0])),{action:'efWithdrawal',date:'2026-08-14',destinationAccount:destination,amount:10,requestId:b.posts[0].requestId});
  }
  for(const source of ['Alex','Olga'])for(const type of ['ef','goal']){
    const b=browser(),name=type==='goal'?"Olga's laptop":'EF';
    vm.runInContext(`movementContext={type:'${type}',name:${JSON.stringify(name)},safeAmount:100}`,b.context);
    b.element('movementDate').value='2026-08-14';b.element('movementSource').value=source;b.element('movementAmount').value='10';
    await b.submit('movementForm');
    assert.equal(b.posts.length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(b.posts[0])),{date:'2026-08-14',sourceAccount:source,amount:10,action:'dedicatedTransfer',destinationType:type==='goal'?'Goal':'EF',destinationName:name,requestId:b.posts[0].requestId});
  }
});

test('actual KTB form keeps one ID after an uncertain result and releases it after confirmation',async()=>{
  const b=browser();
  b.element('kt-date').value='2026-08-14';b.element('kt-source').value='Alex';b.element('kt-destination').value='Olga';b.element('kt-amount').value='10';
  b.context.postAction=async payload=>{b.posts.push(payload);if(b.posts.length===1){const error=new Error('timeout');error.kind='timeout';throw error}return {ok:true}};
  await b.submit('ktbTransferForm');
  assert.equal(b.posts.length,1);assert.match(b.posts[0].requestId,/^[a-zA-Z0-9:_-]{1,128}$/);
  assert.match(b.messages.at(-1)[1],/result is unconfirmed/);
  b.element('kt-amount').value='11';
  await b.submit('ktbTransferForm');
  assert.equal(b.posts.length,1);
  assert.match(b.messages.at(-1)[1],/Resolve the pending movement/);
  b.element('kt-amount').value='10';
  b.context.currentSourceBalance=()=>0;
  await b.submit('ktbTransferForm');
  assert.equal(b.posts.length,2);
  assert.equal(b.posts[1].requestId,b.posts[0].requestId);
  b.context.currentSourceBalance=()=>100;
  b.element('kt-amount').value='10';
  await b.submit('ktbTransferForm');
  assert.notEqual(b.posts[2].requestId,b.posts[0].requestId);
});

test('actual EF and Goal movement form retries the exact request despite changed safe limits',async()=>{
  for(const type of ['ef','goal']){
    const b=browser();
    vm.runInContext(`movementContext={type:'${type}',name:${JSON.stringify(type==='goal'?"Olga's laptop":'EF')},safeAmount:100}`,b.context);
    b.element('movementDate').value='2026-08-14';b.element('movementSource').value='Alex';b.element('movementAmount').value='10';
    b.context.postAction=async payload=>{b.posts.push(payload);if(b.posts.length===1){const error=new Error('transport');error.kind='transport';throw error}return {ok:true}};
    await b.submit('movementForm');
    assert.equal(b.posts.length,1);
    assert.equal(b.posts[0].action,'dedicatedTransfer');
    vm.runInContext(`movementContext.safeAmount=0`,b.context);
    b.context.currentSourceBalance=()=>0;
    b.context.updateMovementSourceBalance();
    assert.equal(b.element('movementAmount').removedAttribute,'max');
    await b.submit('movementForm');
    assert.equal(b.posts.length,2);
    assert.equal(b.posts[1].requestId,b.posts[0].requestId);
  }
});

test('reload reconciles a committed receipt without another write and preserves a missing receipt for retry',async()=>{
  const shared=new Map(),first=browser(shared),movement={action:'efWithdrawal',date:'2026-08-14',destinationAccount:'Alex',amount:10};
  const attempt=vm.runInContext(`movementAttempt(${JSON.stringify(movement)})`,first.context);
  const reloaded=browser(shared);
  reloaded.context.apiCall=async()=>({ok:true,found:true,response:{ok:true}});
  await reloaded.context.reconcilePendingMovements();
  assert.equal(reloaded.posts.length,0);
  assert.equal(vm.runInContext('movementRecords().length',reloaded.context),0);
  assert.match(vm.runInContext('movementRecoveryNotice',reloaded.context),/confirmed recorded/);
  const next=vm.runInContext(`movementAttempt(${JSON.stringify(movement)})`,reloaded.context);
  assert.notEqual(next.requestId,attempt.requestId);
  const anotherReload=browser(shared);
  anotherReload.context.apiCall=async()=>({ok:true,found:false,response:null});
  await anotherReload.context.reconcilePendingMovements();
  assert.equal(vm.runInContext('movementRecords().length',anotherReload.context),1);
  anotherReload.context.postAction=async payload=>{anotherReload.posts.push(payload);return {ok:true}};
  await anotherReload.context.retryPendingMovement(next.requestId);
  assert.equal(anotherReload.posts.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(anotherReload.posts[0])),{...movement,requestId:next.requestId});
});

test('unavailable session storage prevents sending a movement',async()=>{
  const b=browser();
  b.context.sessionStorage.setItem=()=>{throw new Error('quota')};
  b.element('ew-date').value='2026-08-14';b.element('ew-destination').value='Alex';b.element('ew-amount').value='10';
  await b.submit('efWithdrawalForm');
  assert.equal(b.posts.length,0);
  assert.match(b.messages.at(-1)[1],/recovery is unavailable/);
});

test('failed dashboard refresh after a confirmed write is reported as recorded',async()=>{
  const b=browser(new Map(),true),rendered=[];
  b.context.refreshLiveData=async()=>{throw new Error('dashboard offline')};
  b.context.render=(_,meta)=>rendered.push(meta);
  b.element('ew-date').value='2026-08-14';b.element('ew-destination').value='Alex';b.element('ew-amount').value='10';
  await b.submit('efWithdrawalForm');
  assert.equal(b.posts.length,1);
  assert.equal(vm.runInContext('movementRecords().length',b.context),0);
  assert.equal(rendered.length,1);
  assert.equal(rendered[0].stale,true);
  assert.match(vm.runInContext('movementRecoveryNotice',b.context),/Movement recorded, but dashboard data could not refresh/);
});

test('shared request layer preserves service, invalid-response, auth, and timeout categories',async()=>{
  const elements=new Map(),element=id=>{
    if(!elements.has(id))elements.set(id,{style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){}});
    return elements.get(id);
  };
  const context=vm.createContext({document:{getElementById:element,querySelectorAll(){return []},addEventListener(){}},window:{scrollTo(){}},AbortController,Response,fetch:async()=>new Response(JSON.stringify({error:'Service unavailable.'}),{status:503}),setTimeout,clearTimeout});
  vm.runInContext(app2,context);
  vm.runInContext('scheduleGoogleButton=()=>{}',context);
  await assert.rejects(context.requestJson('/api/action'),error=>error.status===503&&error.kind==='http'&&error.message==='Service unavailable.');
  context.fetch=async()=>new Response('<html>failure</html>',{status:503});
  await assert.rejects(context.requestJson('/api/action'),error=>error.status===503&&error.kind==='invalid_response');
  context.fetch=async()=>new Response(JSON.stringify({error:'Authentication required.'}),{status:401});
  await assert.rejects(context.apiCall('write',{}),error=>error.status===401&&error.kind==='auth');
  context.fetch=async()=>{throw new DOMException('aborted','AbortError')};
  await assert.rejects(context.requestJson('/api/action'),error=>error.kind==='timeout');
});
