(()=>{
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let mode='transactions',page=null,items=[],selected=null,preview=null,requestId=null,correctionField=null,categories=[],managementOpener=null;

const money=satang=>fmtMoney(Number(satang||0)/100,(currentData&&currentData.config&&currentData.config.currency)||'THB',true);
const label=t=>t.description||t.payee||t.source||String(t.kind||'').replaceAll('_',' ');
const recordedConsequence=t=>t.direction==='money_out'?money(t.totalSatang)+' paid from '+t.allocations.map(a=>a.account).join(' + '):t.direction==='money_in'?money(t.totalSatang)+' received into '+t.allocations.map(a=>a.account).join(' + '):'Money moved between household accounts.';
const accountName=value=>String(value||'').replace(/ KTB$/,'');
const accountSelect=(value,index)=>'<select data-allocation-account data-index="'+index+'"><option value="Alex"'+(accountName(value)==='Alex'?' selected':'')+'>Alex KTB</option><option value="Olga"'+(accountName(value)==='Olga'?' selected':'')+'>Olga KTB</option></select>';

function impactConsequences(impact){
  const changes=impact&&impact.cashChangeSatang||{};
  const rows=[['Alex',Number(changes.alexSatang||0)],['Olga',Number(changes.olgaSatang||0)]].filter(([,amount])=>amount!==0);
  const result=rows.map(([account,amount])=>money(Math.abs(amount))+' '+(amount>0?'enters ':'leaves ')+account);
  const combined=Number.isFinite(Number(impact?.combinedHouseholdChangeSatang))?Number(impact.combinedHouseholdChangeSatang):Number(impact?.combinedCashChangeSatang);
  if(Number.isFinite(combined))result.push(combined===0?'Total household cash does not change.':money(Math.abs(combined))+(combined>0?' increases':' decreases')+' total household cash.');
  return result.length?result:['Account balances do not change.'];
}
function message(value,type=''){const el=$('historyMessage');el.textContent=value||'';el.className='form-msg'+(type?' '+type:'')}
function query(cursor){return mode==='balances'?{pageSize:50,...(cursor?{cursor}:{})}:{period:$('historyPeriod').value,text:$('historySearch').value.trim(),showAudit:$('historyAudit').checked,pageSize:50,...($('historyPeriod').value==='custom'?{customFrom:$('historyFrom').value,customThrough:$('historyThrough').value}:{}),...(cursor?{cursor}:{})}}
function historyItems(result){return [...(result.transactions||[])]}
function leaveManagementView(){correctionField=null;preview=null;requestId=null;$('historyDetails').classList.remove('management-active')}

async function load(append=false){
  message('Loading…');
  const result=await apiCall(mode==='balances'?'balanceHistory':'transactionHistory',query(append&&page?.pagination?.nextCursor));
  if(!result.ok)throw new Error(result.error||'Could not load history.');
  page=result;
  const loaded=mode==='balances'?(result.entries||[]):historyItems(result);
  items=append?items.concat(loaded):loaded;
  leaveManagementView();render();message('');
}
function render(){
  const list=$('historyList');
  $('historyTitle').textContent=mode==='balances'?'Balance history':'Transaction history';
  $('historyTransactionsMode').classList.toggle('active',mode==='transactions');
  $('historyBalancesMode').classList.toggle('active',mode==='balances');
  $('historyFilters').hidden=mode==='balances';
  if(mode==='transactions'){
    const changed=items.filter(item=>item.lifecycle==='deleted'||Number(item.auditSummary?.operationCount||0)>0).length;
    const total=page.pagination?.resultCount??page.totals.resultCount;
    $('historySummary').innerHTML='<div><span>Results</span><b>'+total+'</b></div><div><span>Money in</span><b>'+esc(money(page.totals.moneyInSatang))+'</b></div><div><span>Money out</span><b>'+esc(money(page.totals.moneyOutSatang))+'</b></div>'+($('historyAudit').checked?'<div><span>Corrections / deleted</span><b>'+changed+'</b></div>':'');
  }else $('historySummary').innerHTML='<div><span>Entries</span><b>'+page.counts.entries+'</b></div><div><span>Observations</span><b>'+page.counts.observations+'</b></div><div><span>Transaction effects</span><b>'+page.counts.transactionEffects+'</b></div>';
  list.innerHTML=items.map((item,index)=>mode==='balances'?balanceRow(item,index):transactionRow(item,index)).join('')||'<div class="empty-state">No records in this view.</div>';
  list.querySelectorAll('[data-history-index]').forEach(button=>button.onclick=()=>show(items[Number(button.dataset.historyIndex)]));
  $('historyMore').hidden=!page.pagination.hasMore;
  $('historyRecordDetail').hidden=true;
}
function transactionRow(t,index){
  const corrected=$('historyAudit').checked&&t.lifecycle!=='deleted'&&Number(t.auditSummary?.operationCount||0)>0;
  return '<button type="button" class="history-row" data-history-index="'+index+'"><span><b>'+esc(label(t))+'</b><small>'+esc(t.businessDate)+' · '+esc(String(t.kind).replaceAll('_',' '))+(t.lifecycle==='deleted'?' · Deleted':corrected?' · Corrected':'')+'</small></span><strong>'+esc(money(t.totalSatang))+'</strong></button>';
}
function balanceRow(row,index){
  const observation=row.entryType==='balance_observation',values=row.balancesSatang||{};
  return '<button type="button" class="history-row" data-history-index="'+index+'"><span><b>'+(observation?'Balance observation':'Transaction balance effect')+'</b><small>'+esc(row.businessDate)+' · '+(observation?'Immutable recorded balance':esc(row.transactionLink?.status||'unlinked'))+'</small></span><strong>'+esc(values.combined==null?'Partial accounts':money(values.combined))+'</strong></button>';
}
function show(item){
  selected=item;preview=null;requestId=null;correctionField=null;
  const el=$('historyRecordDetail');el.hidden=false;
  if(mode==='balances'){
    el.innerHTML='<h3>'+esc(item.entryType==='balance_observation'?'Balance observation':'Transaction balance effect')+'</h3><div class="history-consequences"><b>Financial meaning</b><p>'+(item.entryType==='balance_observation'?'This immutable observation anchors the recorded account position. Record a new observation if the factual balance is wrong.':'This effect belongs to a financial transaction; manage the linked transaction rather than changing this row.')+'</p></div><details class="history-technical"><summary>Technical details</summary><pre>'+esc(JSON.stringify(item,null,2))+'</pre></details>';
    el.scrollIntoView({block:'start'});return;
  }
  renderTransactionDetail();el.scrollIntoView({block:'start'});
}

function refusalMessage(code){
  if(code==='MANAGEMENT_NOT_ENABLED_STEP_7')return 'This historical transaction is view-only because it was recorded before safe transaction management was available. Its financial history remains unchanged.';
  if(code==='AMBIGUOUS_LEGACY_ITEM')return 'This historical item is view-only because the application cannot prove all records that belong to the same transaction.';
  const known={DEPENDENT_ACTIVITY_EXISTS:'Later household activity prevents a safe undo.',UNDO_WINDOW_EXPIRED:'The safe ten-minute undo window has ended.',ACTIVE_TRANSACTION_REQUIRED:'Only an active transaction can be changed.',DELETED_TRANSACTION_REQUIRED:'Only a deleted transaction can be restored.',REPLACEMENT_NOT_ENABLED:'Transaction replacement is not available in this workflow.'};
  return known[code]||'This transaction is safely view-only. Its recorded financial history remains unchanged.';
}
function reasonLabel(code){return {entered_by_mistake:'Entered by mistake',duplicate_entry:'Duplicate entry',wrong_household:'Wrong household',test_entry:'Test entry',owner_correction:'Owner correction',restore_last_active:'Restored last active version',undo:'Undo'}[code]||'Other';}
function bangkokTime(value){
  const instant=new Date(value);if(!Number.isFinite(instant.getTime()))return 'Time unavailable';
  return new Intl.DateTimeFormat(displayLocale('en-GB'),{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(instant)+' Bangkok time';
}
function stateSummary(value){
  if(!value)return 'Not recorded';
  const amount=value.totalSatang??value.amountSatang;
  const allocations=Array.isArray(value.allocations)?value.allocations.map(row=>accountName(row.account)+' KTB: '+money(row.amountSatang)).join(', '):null;
  const transfer=value.sourceAccount&&value.destinationAccount?accountName(value.sourceAccount)+' KTB → '+accountName(value.destinationAccount)+' KTB':null;
  const fund=value.direction&&value.ktbAccount?value.direction+' · '+accountName(value.ktbAccount)+' KTB':null;
  return [value.lifecycle==='deleted'?'Deleted':'Active',value.businessDate,Number.isFinite(Number(amount))?money(amount):null,allocations,transfer,fund,value.goalName||null].filter(Boolean).join(' · ');
}
function auditHistory(t){
  const operations=t.auditSummary?.operations||[];if(!operations.length)return '';
  return '<section class="history-audit"><h4>Complete audit history</h4>'+operations.map(operation=>{
    const impact=operation.impactSummary||{};
    return '<article class="history-audit-entry"><div class="history-audit-head"><b>'+esc(String(operation.operationType||'').replaceAll('_',' '))+'</b><span>Revision '+esc(operation.committedRevision)+'</span></div><p>'+esc(bangkokTime(operation.committedAtUtc))+' · '+esc(operation.actorEmail||'Actor unavailable')+'</p><p><b>Reason:</b> '+esc(reasonLabel(operation.reasonCode))+(operation.reasonExplanation?' — '+esc(operation.reasonExplanation):'')+'</p><div class="history-audit-change"><span><b>Before</b>'+esc(stateSummary(impact.before))+'</span><span><b>After</b>'+esc(stateSummary(impact.after))+'</span></div><ul>'+impactConsequences(impact).map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul></article>';
  }).join('')+'</section>';
}
function renderTransactionDetail(){
  const t=selected,actions=t.permittedActions||{};
  const buttons=[['correct','corrected','Correct transaction'],['delete','deleted','Delete transaction'],['restore','restored','Restore transaction'],['undo','undone','Undo']].filter(([key])=>actions[key]).map(([,op,name])=>'<button class="btn secondary" type="button" data-management="'+op+'">'+name+'</button>').join('');
  const refusals=(actions.refusalCodes||[]).map(refusalMessage);
  $('historyRecordDetail').innerHTML='<h3>'+esc(label(t))+'</h3><p>'+esc(t.businessDate)+' · '+esc(String(t.kind).replaceAll('_',' '))+' · '+esc(money(t.totalSatang))+(t.lifecycle==='deleted'?' · Deleted':'')+'</p><div class="history-consequences"><b>Recorded transaction</b><p>'+esc(recordedConsequence(t))+'</p></div><div class="history-actions">'+buttons+'</div>'+(buttons?'':'<div class="history-view-only">'+refusals.map(value=>'<p>'+esc(value)+'</p>').join('')+'</div>')+auditHistory(t)+'<div id="historyManagement"></div>';
  $('historyRecordDetail').querySelectorAll('[data-management]').forEach(button=>button.onclick=()=>managementForm(button.dataset.management,button));
}

function correctionChoices(t){
  const choices=[['date','Date'],['amount','Amount'],['account','Account']];
  if(t.kind==='one_off_payment')choices.push(['category','Category']);
  if(['one_off_payment','obligation_payment','goal_movement'].includes(t.kind))choices.push(['description','Description']);
  choices.push(['more','More than one detail']);
  return choices;
}
function activateManagement(){
  $('historyDetails').classList.add('management-active');
  setTimeout(()=>$('historyManagementHeading')?.focus(),0);
}
function cancelManagement(){
  const operation=managementOpener;leaveManagementView();renderTransactionDetail();
  setTimeout(()=>$('historyRecordDetail').querySelector('[data-management="'+operation+'"]')?.focus(),0);
}
async function managementForm(operation,opener){
  preview=null;requestId=null;correctionField=null;managementOpener=operation;
  if(operation==='corrected'){
    categories=[];
    if(selected.kind==='one_off_payment'){
      try{const result=await apiCall('getOneOffCategories',{});categories=result.categories||[]}catch{categories=[]}
    }
    $('historyManagement').innerHTML='<section class="history-management-choice"><h3 id="historyManagementHeading" tabindex="-1">What needs correcting?</h3><p>Transaction type stays unchanged.</p><div class="history-correction-options">'+correctionChoices(selected).map(([value,name])=>'<button type="button" class="btn secondary" data-correction-field="'+value+'">'+name+'</button>').join('')+'</div><button type="button" class="btn secondary" id="hmCancel">Cancel</button></section>';
    $('historyManagement').querySelectorAll('[data-correction-field]').forEach(button=>button.onclick=()=>renderCorrectionForm(button.dataset.correctionField));
    $('hmCancel').onclick=cancelManagement;activateManagement();return;
  }
  renderOperationForm(operation);
}

function categoryField(){
  const currentId=selected.category?.id||'',currentName=selected.category?.name||'Uncategorized';
  const rows=categories.filter(row=>Number(row.active)===1||row.category_id===currentId);
  if(currentId&&!rows.some(row=>row.category_id===currentId))rows.push({category_id:currentId,name:currentName,active:0});
  return '<label>Category<select id="hmCategory"><option value=""'+(!currentId?' selected':'')+'>Uncategorized</option>'+rows.map(row=>'<option value="'+esc(row.category_id)+'"'+(row.category_id===currentId?' selected':'')+'>'+esc(row.name)+(Number(row.active)===1?'':' (inactive)')+'</option>').join('')+'</select></label>';
}
function allocationFields(showAccount,showAmount){
  return selected.allocations.map((allocation,index)=>'<div class="allocation-row">'+(showAccount?'<label>Account'+accountSelect(allocation.account,index)+'</label>':'<div class="history-fixed-value"><span>Account</span><b>'+esc(accountName(allocation.account))+' KTB</b></div>')+(showAmount?'<label>Amount<input data-allocation-amount data-index="'+index+'" type="number" min="0.01" step="0.01" value="'+(Math.abs(allocation.amountSatang)/100).toFixed(2)+'"></label>':'')+'</div>').join('');
}
function correctionFields(choice){
  const t=selected,all=choice==='more',show=name=>all||choice===name;
  let html='<div class="history-management-fields">';
  if(show('date'))html+='<label>Date<input id="hmDate" type="date" value="'+esc(t.businessDate)+'"></label>';
  if(t.kind==='one_off_payment'){
    if(show('category'))html+=categoryField();
    if(show('description'))html+='<label>Description<input id="hmDescription" value="'+esc(t.description||'')+'"></label>';
  }
  if(t.kind==='other_income_receipt'&&all)html+='<div class="history-fixed-value"><span>Source</span><b>'+esc(t.source||'')+'</b></div>';
  if(t.kind==='salary_receipt'&&all)html+='<label>Source<input id="hmSource" value="'+esc(t.source||'')+'"></label>';
  if(t.kind==='obligation_payment'){
    if(all)html+='<div class="history-fixed-value"><span>Obligation</span><b>'+esc(t.payee||'')+'</b><small>Due '+esc(t.occurrence?.dueDate||'')+'</small></div>';
    if(show('description'))html+='<label>Note<input id="hmNote" value="'+esc(t.description||'')+'"></label>';
  }
  if(t.kind==='ktb_transfer'){
    if(show('amount'))html+='<label>Amount<input id="hmAmount" type="number" min="0.01" step="0.01" value="'+(Math.abs(t.totalSatang)/100).toFixed(2)+'"></label>';
    if(show('account'))html+='<label>Source account'+accountSelect(t.source,'source')+'</label><label>Destination account'+accountSelect(t.payee,'destination')+'</label>';
  }
  if(t.kind==='ef_movement'||t.kind==='goal_movement'){
    if(show('amount'))html+='<label>Amount<input id="hmAmount" type="number" min="0.01" step="0.01" value="'+(Math.abs(t.totalSatang)/100).toFixed(2)+'"></label>';
    if(show('account'))html+='<label>KTB account'+accountSelect(t.allocations[0]?.account,'fund')+'</label>';
    if(all)html+='<label>Direction<select id="hmDirection"><option'+(t.fund?.direction==='Contribution'?' selected':'')+'>Contribution</option><option'+(t.fund?.direction==='Withdrawal'?' selected':'')+'>Withdrawal</option></select></label>'+(t.kind==='goal_movement'?'<label>Goal name<input id="hmGoal" value="'+esc(t.fund?.goalName||'')+'"></label>':'');
    if(t.kind==='goal_movement'&&show('description'))html+='<label>Withdrawal purpose<select id="hmPurpose"><option value="">Not applicable</option><option value="useForGoal"'+(t.description==='useForGoal'?' selected':'')+'>Use for this goal</option><option value="anotherReason"'+(t.description==='anotherReason'?' selected':'')+'>Withdraw for another reason</option></select></label>';
  }
  html+='</div>';
  if(!['ktb_transfer','ef_movement','goal_movement'].includes(t.kind)&&(show('amount')||show('account')))html+='<div>'+allocationFields(show('account'),show('amount'))+'</div>';
  return html;
}
function renderCorrectionForm(choice){
  correctionField=choice;preview=null;requestId=null;
  $('historyManagement').innerHTML='<form class="history-management" id="historyManagementForm"><div class="history-management-head"><h3 id="historyManagementHeading" tabindex="-1">Correction details</h3><button type="button" class="text-action" id="hmDifferent">Choose a different detail</button></div>'+correctionFields(choice)+reasonFields('corrected')+'<div class="history-preview" id="hmPreview">Preview is read-only. Review the financial consequences before confirming.</div><div class="history-actions"><button type="button" class="btn secondary" id="hmCancel">Cancel</button><button type="button" class="btn" id="hmPreviewBtn">Preview</button><button type="submit" class="btn primary" id="hmCommitBtn" disabled>Confirm correction</button></div></form>';
  $('hmDifferent').onclick=()=>managementForm('corrected',managementOpener);$('hmCancel').onclick=cancelManagement;$('hmPreviewBtn').onclick=()=>previewOperation('corrected');$('historyManagementForm').onsubmit=e=>{e.preventDefault();commitOperation('corrected')};
  activateManagement();
}
function reasonFields(){
  return '<label>Reason<select id="hmReason"><option value="entered_by_mistake">Entered by mistake</option><option value="duplicate_entry">Duplicate entry</option><option value="wrong_household">Wrong household</option><option value="test_entry">Test entry</option><option value="other">Other</option></select></label><label>Explanation<textarea id="hmExplanation"></textarea></label>';
}
function renderOperationForm(operation){
  $('historyManagement').innerHTML='<form class="history-management" id="historyManagementForm"><h3 id="historyManagementHeading" tabindex="-1">Review '+esc(operation.replace('ed',''))+'</h3>'+reasonFields()+'<div class="history-preview" id="hmPreview">Preview is read-only. Review the financial consequences before confirming.</div><div class="history-actions"><button type="button" class="btn secondary" id="hmCancel">Cancel</button><button type="button" class="btn" id="hmPreviewBtn">Preview</button><button type="submit" class="btn primary" id="hmCommitBtn" disabled>Confirm '+esc(operation.replace('ed',''))+'</button></div></form>';
  $('hmCancel').onclick=cancelManagement;$('hmPreviewBtn').onclick=()=>previewOperation(operation);$('historyManagementForm').onsubmit=e=>{e.preventDefault();commitOperation(operation)};activateManagement();
}
function satang(value){return Math.round(Number(value)*100)}
function allocationsFromForm(){
  return selected.allocations.map((allocation,index)=>{
    const account=$('historyManagement').querySelector('[data-allocation-account][data-index="'+index+'"]');
    const amount=$('historyManagement').querySelector('[data-allocation-amount][data-index="'+index+'"]');
    return {account:account?accountName(account.value):accountName(allocation.account),amountSatang:amount?satang(amount.value):Math.abs(Number(allocation.amountSatang))};
  });
}
function semantics(operation){
  const result={reasonCode:$('hmReason').value,reasonExplanation:$('hmExplanation').value.trim()||null};
  if(operation!=='corrected')return result;
  const t=selected,date=$('hmDate')?.value||t.businessDate,allocations=allocationsFromForm();
  result.businessDate=date;
  if(t.kind==='one_off_payment')Object.assign(result,{categoryId:$('hmCategory')?.value??t.category?.id??null,description:$('hmDescription')?.value??t.description??'',allocations});
  if(t.kind==='other_income_receipt')Object.assign(result,{otherIncomeSourceId:t.sourceId,allocations});
  if(t.kind==='salary_receipt')Object.assign(result,{source:$('hmSource')?.value??t.source,allocations});
  if(t.kind==='obligation_payment')Object.assign(result,{occurrenceId:t.occurrence?.id,allocations,note:$('hmNote')?.value??t.description??''});
  if(t.kind==='ktb_transfer')Object.assign(result,{amountSatang:$('hmAmount')?satang($('hmAmount').value):Math.abs(Number(t.totalSatang)),sourceAccount:accountName($('historyManagement').querySelector('[data-index="source"]')?.value||t.source),destinationAccount:accountName($('historyManagement').querySelector('[data-index="destination"]')?.value||t.payee)});
  if(t.kind==='ef_movement'||t.kind==='goal_movement')Object.assign(result,{amountSatang:$('hmAmount')?satang($('hmAmount').value):Math.abs(Number(t.totalSatang)),direction:$('hmDirection')?.value||t.fund?.direction,ktbAccount:accountName($('historyManagement').querySelector('[data-index="fund"]')?.value||t.allocations[0]?.account),...(t.kind==='goal_movement'?{goalName:$('hmGoal')?.value||t.fund?.goalName,withdrawalPurpose:$('hmPurpose')?.value||t.description||null}:{})});
  return result;
}
async function previewOperation(operation){
  try{
    preview=await apiCall('transactionManagementPreview',{logicalTransactionId:selected.logicalTransactionId,operation,correlationId:crypto.randomUUID(),semanticPayload:semantics(operation)});
    const eligible=preview.eligibility&&preview.eligibility.eligible,summary=eligible?impactConsequences(preview.impact):(preview.eligibility.refusalCodes||[]).map(refusalMessage);
    $('hmPreview').innerHTML='<b>'+(eligible?'Eligible to confirm':'Cannot be confirmed')+'</b><ul>'+summary.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>';
    $('hmCommitBtn').disabled=!eligible;requestId=null;
  }catch(e){message(e.message,'error')}
}
async function commitOperation(operation){
  if(!preview)return;const button=$('hmCommitBtn');button.disabled=true;
  try{
    requestId=requestId||crypto.randomUUID();
    await apiCall('transactionManagementCommit',{logicalTransactionId:selected.logicalTransactionId,operation,requestId,baseRevision:preview.baseRevision,terminalVersionId:preview.terminalVersionId,semanticPayload:semantics(operation)});
    await load(false);message('Transaction updated from the authoritative server.','success');
  }catch(e){button.disabled=false;message('The change was not confirmed. '+e.message,'error')}
}
async function open(nextMode){
  mode=nextMode;items=[];selected=null;leaveManagementView();openDetail('historyDetails',nextMode==='transactions'?$('transactionHistoryBtn'):$('balanceHistoryBtn'));
  try{await load(false)}catch(e){if(nextMode==='transactions'&&$('historyPeriod').value==='current_cycle'&&/PERIOD_UNAVAILABLE/.test(e.message||'')){$('historyPeriod').value='all';await load(false);message('The recorded salary-cycle boundary is unavailable. Showing all history; choose a custom range if needed.')}else message(e.message,'error')}
}
$('transactionHistoryBtn').onclick=()=>open('transactions');
$('balanceHistoryBtn').onclick=()=>open('balances');
$('historyTransactionsMode').onclick=()=>open('transactions');
$('historyBalancesMode').onclick=()=>open('balances');
$('historyPeriod').onchange=()=>{$('historyCustomDates').hidden=$('historyPeriod').value!=='custom'};
$('historyFilters').onsubmit=e=>{e.preventDefault();load(false).catch(err=>message(err.message,'error'))};
$('historyClear').onclick=()=>{$('historyPeriod').value='all';$('historySearch').value='';$('historyAudit').checked=false;$('historyCustomDates').hidden=true;load(false).catch(err=>message(err.message,'error'))};
$('historyMore').onclick=()=>load(true).catch(err=>message(err.message,'error'));
$('historyAudit').onchange=()=>load(false).catch(err=>message(err.message,'error'));
$('historyBack').onclick=()=>{$('historyDetails').classList.contains('management-active')?cancelManagement():closeDetail($('historyDetails'))};
})();
