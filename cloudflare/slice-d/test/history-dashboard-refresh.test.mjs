import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../../assets/v24/v24_1_history.js',import.meta.url),'utf8');

function historyScreen({commitFails=false,dashboardFails=false}={}){
  const elements=new Map(),calls=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      value:id==='historyPeriod'?'all':id==='hmReason'?'entered_by_mistake':'',
      checked:false,disabled:false,hidden:false,textContent:'',innerHTML:'',
      classList:{add(){},remove(){},toggle(){}},
      querySelectorAll(){return[]}
    });
    return elements.get(id);
  };
  const dashboard={available:100};
  const context={
    document:{getElementById:element},
    crypto:{randomUUID:()=> 'request-1'},
    currentData:null,
    fmtMoney:value=>String(value),
    apiCall:async action=>{
      calls.push(action);
      if(action==='transactionManagementCommit'){
        if(commitFails)throw new Error('Commit failed');
        return{ok:true};
      }
      if(action==='transactionHistory')return{ok:true,transactions:[],totals:{moneyInSatang:0,moneyOutSatang:0},pagination:{hasMore:false,resultCount:0}};
      throw new Error(`Unexpected action ${action}`);
    },
    refreshLiveData:async()=>{
      calls.push('dashboard');
      if(dashboardFails)throw new Error('Dashboard unavailable');
      dashboard.available=101;
    }
  };
  const instrumented=source.replace(/\}\)\(\);\s*$/,`globalThis.historyTest={commitOperation,setSelected(value){selected=value},setPreview(value){preview=value}};})();`);
  assert.notEqual(instrumented,source);
  vm.runInNewContext(instrumented,context);
  context.historyTest.setSelected({logicalTransactionId:'payment-1'});
  context.historyTest.setPreview({baseRevision:10,terminalVersionId:'version-1'});
  return{commit:()=>context.historyTest.commitOperation('deleted'),calls,dashboard,element};
}

test('deleting a transaction refreshes the displayed Available value and history',async()=>{
  const screen=historyScreen();
  await screen.commit();
  assert.deepEqual(screen.calls,['transactionManagementCommit','dashboard','transactionHistory']);
  assert.equal(screen.dashboard.available,101);
  assert.equal(screen.element('historyMessage').textContent,'Transaction updated from the authoritative server.');
});

test('a failed refresh says the transaction was saved and asks for a reload',async()=>{
  const screen=historyScreen({dashboardFails:true});
  await screen.commit();
  assert.equal(screen.calls.filter(action=>action==='transactionManagementCommit').length,1);
  assert.match(screen.element('historyMessage').textContent,/Transaction saved.*Reload the page/);
});

test('a failed commit does not refresh or claim the transaction was saved',async()=>{
  const screen=historyScreen({commitFails:true});
  await screen.commit();
  assert.deepEqual(screen.calls,['transactionManagementCommit']);
  assert.equal(screen.element('hmCommitBtn').disabled,false);
  assert.match(screen.element('historyMessage').textContent,/The change was not confirmed/);
});
