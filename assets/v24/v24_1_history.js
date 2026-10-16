(()=>{
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let page=null,items=[],selected=null,preview=null,requestId=null,correctionField=null,categories=[],managementOpener=null,previewSequence=0,loadSequence=0;

const money=satang=>fmtMoney(Number(satang||0)/100,(currentData&&currentData.config&&currentData.config.currency)||'THB',true);
const label=t=>t.description||t.payee||t.source||t.category?.name||String(t.kind||'').replaceAll('_',' ');
const recordedConsequence=t=>t.direction==='money_out'?money(t.totalSatang)+' paid from '+t.allocations.map(a=>a.account).join(' + '):t.direction==='money_in'?money(t.totalSatang)+' received into '+t.allocations.map(a=>a.account).join(' + '):'Money moved between household accounts.';
const accountName=value=>String(value||'').replace(/ KTB$/,'');
const accountSelect=(value,index)=>'<select data-allocation-account data-index="'+index+'"><option value="Alex"'+(accountName(value)==='Alex'?' selected':'')+'>Alex KTB</option><option value="Olga"'+(accountName(value)==='Olga'?' selected':'')+'>Olga KTB</option></select>';

function impactConsequences(impact){
  const changes=impact&&impact.cashChangeSatang||{};
  const rows=[['Alex',Number(changes.alexSatang||0)],['Olga',Number(changes.olgaSatang||0)]].filter(([,amount])=>amount!==0);
  const result=rows.map(([account,amount])=>money(Math.abs(amount))+' '+(amount>0?'enters ':'leaves ')+account);
  const combined=Number.isFinite(Number(impact?.combinedHouseholdChangeSatang))?Number(impact.combinedHouseholdChangeSatang):Number(impact?.combinedCashChangeSatang);
  if(Number.isFinite(combined))result.push(combined===0?'Total household cash does not change.':money(Math.abs(combined))+(combined>0?' increases':' decreases')+' total household cash.');
  if(impact?.before?.paymentStatus!==impact?.after?.paymentStatus&&impact?.after?.paymentStatus)result.push(impact.after.paymentStatus==='Final'?'This bill will be closed.':'This bill will remain open until fully paid.');
  return result.length?result:['Account balances do not change.'];
}
function message(value,type=''){const el=$('historyMessage');el.textContent=value||'';el.className='form-msg'+(type?' '+type:'')}
function query(cursor){return {account:$('historyAccount').value,period:$('historyPeriod').value,text:$('historySearch').value.trim(),pageSize:50,...($('historyPeriod').value==='custom'?{customFrom:$('historyFrom').value,customThrough:$('historyThrough').value}:{}),...(cursor?{cursor}:{})}}
function leaveManagementView(){correctionField=null;preview=null;requestId=null;previewSequence++;$('historyDetails').classList.remove('management-active')}

async function load(append=false){
  const sequence=++loadSequence;message('Loading…');
  const result=await apiCall('accountHistory',query(append&&page?.pagination?.nextCursor));
  if(sequence!==loadSequence)return;
  if(!result.ok)throw new Error(result.error||'Could not load history.');
  page=result;items=append?[...new Map(items.concat(result.entries||[]).map(item=>[item.id,item])).values()]:(result.entries||[]);
  leaveManagementView();render();message('');
}
function signed(value){return value==null||value===0?'—':(value<0?'−':'+')+money(Math.abs(value))}
function balanceValue(value){return value==null?'—':money(value)}
function amountCell(label,value,change=false){return '<td data-label="'+esc(label)+'"><span class="account-cell-label">'+esc(label)+'</span><b>'+esc(change?signed(value):balanceValue(value))+'</b></td>'}
function accountRow(row,index){
  const both=$('historyAccount').value==='Both',person=$('historyAccount').value.toLowerCase(),balances=row.balancesAfterSatang||{},changes=row.changesSatang||{};
  const note=row.businessDate!==row.postingDate?'Transaction date: '+row.businessDate:row.entryType==='balance_update'?'Recorded bank balance':row.entryType==='unlinked_balance'?'Transaction link unavailable':!row.balanceAvailable?'Balance after this transaction is unavailable':'';
  const date=esc(row.postingDate)+(row.recordedAtUtc?'<small>'+esc(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}).format(new Date(row.recordedAtUtc)))+'</small>':'');
  return '<tr><td class="account-date">'+date+'</td><td class="account-operation"><button type="button" data-history-index="'+index+'">'+esc(row.title)+'</button>'+(note?'<small>'+esc(note)+'</small>':'')+'</td>'+(both?amountCell('Alex change',changes.alex,true)+amountCell('Alex balance',balances.alex)+amountCell('Olga change',changes.olga,true)+amountCell('Olga balance',balances.olga)+amountCell('Combined balance',balances.combined):amountCell('Change',changes[person],true)+amountCell('Balance after',balances[person]))+'</tr>';
}
function render(){
  $('historyTitle').textContent='Account history';
  const both=$('historyAccount').value==='Both';
  const headers=both?['Date / time','Operation','Alex change','Alex balance','Olga change','Olga balance','Combined balance']:['Date / time','Operation','Change','Balance after'];
  $('historyList').innerHTML=items.length?'<table class="account-history-table"><thead><tr>'+headers.map(name=>'<th scope="col">'+esc(name)+'</th>').join('')+'</tr></thead><tbody>'+items.map(accountRow).join('')+'</tbody></table>':'<div class="empty-state">No records in this view.</div>';
  $('historyList').querySelectorAll('[data-history-index]').forEach(button=>button.onclick=()=>show(items[Number(button.dataset.historyIndex)]));
  $('historyMore').hidden=!page.pagination.hasMore;$('historyRecordDetail').hidden=true;
}
async function show(item){
  preview=null;requestId=null;correctionField=null;const sequence=++previewSequence;
  const el=$('historyRecordDetail');el.hidden=true;selected=null;
  if(item.logicalTransactionId){
    try{
      const result=await apiCall('transactionHistory',{period:'all',showAudit:true,detailLogicalTransactionId:item.logicalTransactionId,pageSize:1});
      if(sequence!==previewSequence)return;
      if(!result.ok||!result.detail)throw new Error('The related transaction is unavailable.');
      selected=result.detail;renderTransactionDetail();el.hidden=false;el.scrollIntoView({block:'start'});
    }catch(error){message(error.message,'error')}
    return;
  }
  selected=null;const balances=item.balancesAfterSatang||{},difference=item.discrepancySatang||{};
  el.innerHTML='<h3>'+esc(item.title)+'</h3><p>'+esc(item.postingDate)+'</p><div class="history-consequences"><b>Recorded balances</b>'+['alex','olga'].filter(name=>item.recordedAccounts?.[name]).map(name=>'<p>'+esc(name==='alex'?'Alex':'Olga')+': '+esc(balanceValue(balances[name]))+(difference[name]!=null&&difference[name]!==0?' · Difference from previous balance: '+esc(signed(difference[name])):'')+'</p>').join('')+'</div><p>'+(item.entryType==='balance_update'?'This is a recorded balance update, not an expense or income. Record a new balance update if it is wrong.':'This record has no verified transaction link. Its recorded balances remain visible.')+'</p>';
  el.hidden=false;el.scrollIntoView({block:'start'});
}

function refusalMessage(code){
  if(code==='MANAGEMENT_NOT_ENABLED_STEP_7')return 'This historical transaction is view-only because the records required for safe editing have not been verified.';
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
  $('historyRecordDetail').innerHTML='<h3>'+esc(label(t))+'</h3><p>'+esc(t.businessDate)+' · '+esc(String(t.kind).replaceAll('_',' '))+' · '+esc(money(t.totalSatang))+(t.kind==='obligation_payment'?' · '+esc(t.paymentStatus||'Partial')+' payment':'')+(t.lifecycle==='deleted'?' · Deleted':'')+'</p><div class="history-consequences"><b>Recorded transaction</b><p>'+esc(recordedConsequence(t))+'</p></div><div class="history-actions">'+buttons+'</div>'+(buttons?'':'<div class="history-view-only">'+refusals.map(value=>'<p>'+esc(value)+'</p>').join('')+'</div>')+auditHistory(t)+'<div id="historyManagement"></div>';
  $('historyRecordDetail').querySelectorAll('[data-management]').forEach(button=>button.onclick=()=>managementForm(button.dataset.management,button));
}

function correctionChoices(t){
  const choices=[['date','Date'],['amount','Amount'],['account','Account']];
  if(t.kind==='one_off_payment')choices.push(['category','Category']);
  if(t.kind==='obligation_payment')choices.push(['paymentStatus','Payment type']);
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
  preview=null;requestId=null;correctionField=null;previewSequence++;managementOpener=operation;
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
    if(show('paymentStatus'))html+='<label>Payment type<select id="hmPaymentStatus"><option value="Final"'+(t.paymentStatus==='Final'?' selected':'')+'>Final payment — Close this bill</option><option value="Partial"'+(t.paymentStatus!=='Final'?' selected':'')+'>Partial payment — keep it open</option></select></label>';
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
  correctionField=choice;preview=null;requestId=null;previewSequence++;
  $('historyManagement').innerHTML='<form class="history-management" id="historyManagementForm"><div class="history-management-head"><h3 id="historyManagementHeading" tabindex="-1">Correction details</h3><button type="button" class="text-action" id="hmDifferent">Choose a different detail</button></div>'+correctionFields(choice)+reasonFields('corrected')+'<div class="history-preview" id="hmPreview">Preview is read-only. Review the financial consequences before confirming.</div><div class="history-actions"><button type="button" class="btn secondary" id="hmCancel">Cancel</button><button type="button" class="btn" id="hmPreviewBtn">Preview</button><button type="submit" class="btn primary" id="hmCommitBtn" disabled>Confirm correction</button></div></form>';
  $('hmDifferent').onclick=()=>managementForm('corrected',managementOpener);$('hmCancel').onclick=cancelManagement;$('hmPreviewBtn').onclick=()=>previewOperation('corrected');$('historyManagementForm').onsubmit=e=>{e.preventDefault();commitOperation('corrected')};watchPreviewInputs();
  activateManagement();
}
function reasonFields(){
  return '<label>Reason<select id="hmReason"><option value="entered_by_mistake">Entered by mistake</option><option value="duplicate_entry">Duplicate entry</option><option value="wrong_household">Wrong household</option><option value="test_entry">Test entry</option><option value="other">Other</option></select></label><label>Explanation<textarea id="hmExplanation"></textarea></label>';
}
function renderOperationForm(operation){
  const labels={deleted:['Review deletion','Confirm deletion'],restored:['Review restoration','Confirm restoration'],undone:['Review undo','Confirm undo']};
  const [heading,confirm]=labels[operation]||['Review transaction','Confirm change'];
  $('historyManagement').innerHTML='<form class="history-management" id="historyManagementForm"><h3 id="historyManagementHeading" tabindex="-1">'+heading+'</h3>'+reasonFields()+'<div class="history-preview" id="hmPreview">Preview is read-only. Review the financial consequences before confirming.</div><div class="history-actions"><button type="button" class="btn secondary" id="hmCancel">Cancel</button><button type="button" class="btn" id="hmPreviewBtn">Preview</button><button type="submit" class="btn primary" id="hmCommitBtn" disabled>'+confirm+'</button></div></form>';
  $('hmCancel').onclick=cancelManagement;$('hmPreviewBtn').onclick=()=>previewOperation(operation);$('historyManagementForm').onsubmit=e=>{e.preventDefault();commitOperation(operation)};watchPreviewInputs();activateManagement();
}
function invalidatePreview(){
  preview=null;requestId=null;previewSequence++;
  const button=$('hmCommitBtn'),result=$('hmPreview');
  if(button)button.disabled=true;
  if(result)result.textContent='Preview is read-only. Review the financial consequences before confirming.';
}
function watchPreviewInputs(){
  const form=$('historyManagementForm');
  form.addEventListener('input',invalidatePreview);
  form.addEventListener('change',invalidatePreview);
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
  if(t.kind==='obligation_payment')Object.assign(result,{occurrenceId:t.occurrence?.id,allocations,note:$('hmNote')?.value??t.description??'',paymentStatus:$('hmPaymentStatus')?.value??t.paymentStatus??'Partial'});
  if(t.kind==='ktb_transfer')Object.assign(result,{amountSatang:$('hmAmount')?satang($('hmAmount').value):Math.abs(Number(t.totalSatang)),sourceAccount:accountName($('historyManagement').querySelector('[data-index="source"]')?.value||t.source),destinationAccount:accountName($('historyManagement').querySelector('[data-index="destination"]')?.value||t.payee)});
  if(t.kind==='ef_movement'||t.kind==='goal_movement')Object.assign(result,{amountSatang:$('hmAmount')?satang($('hmAmount').value):Math.abs(Number(t.totalSatang)),direction:$('hmDirection')?.value||t.fund?.direction,ktbAccount:accountName($('historyManagement').querySelector('[data-index="fund"]')?.value||t.allocations[0]?.account),...(t.kind==='goal_movement'?{goalName:$('hmGoal')?.value||t.fund?.goalName,withdrawalPurpose:$('hmPurpose')?.value||t.description||null}:{})});
  return result;
}
async function previewOperation(operation){
  const sequence=++previewSequence,payload=semantics(operation);
  preview=null;$('hmCommitBtn').disabled=true;
  try{
    const result=await apiCall('transactionManagementPreview',{logicalTransactionId:selected.logicalTransactionId,operation,correlationId:crypto.randomUUID(),semanticPayload:payload});
    if(sequence!==previewSequence||JSON.stringify(payload)!==JSON.stringify(semantics(operation)))return;
    preview=result;
    const eligible=preview.eligibility&&preview.eligibility.eligible,summary=eligible?impactConsequences(preview.impact):(preview.eligibility.refusalCodes||[]).map(refusalMessage);
    $('hmPreview').innerHTML='<b>'+(eligible?'Eligible to confirm':'Cannot be confirmed')+'</b><ul>'+summary.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>';
    $('hmCommitBtn').disabled=!eligible;requestId=null;
  }catch(e){if(sequence===previewSequence)message(e.message,'error')}
}
async function commitOperation(operation){
  if(!preview)return;const button=$('hmCommitBtn');button.disabled=true;
  try{
    requestId=requestId||crypto.randomUUID();
    await apiCall('transactionManagementCommit',{logicalTransactionId:selected.logicalTransactionId,operation,requestId,baseRevision:preview.baseRevision,terminalVersionId:preview.terminalVersionId,semanticPayload:semantics(operation)});
  }catch(e){button.disabled=false;message('The change was not confirmed. '+e.message,'error');return}
  const [dashboard,history]=await Promise.allSettled([refreshLiveData(),load(false)]);
  if(dashboard.status==='fulfilled'&&history.status==='fulfilled')message('Transaction updated from the authoritative server.','success');
  else message('Transaction saved, but the page did not fully refresh. Reload the page to see current data.','error');
}
async function open(){
  items=[];selected=null;leaveManagementView();openDetail('historyDetails',$('accountHistoryBtn'));
  try{await load(false)}catch(e){if($('historyPeriod').value==='current_cycle'&&/PERIOD_UNAVAILABLE/.test(e.message||'')){$('historyPeriod').value='all';await load(false);message('The recorded salary-cycle boundary is unavailable. Showing all history; choose a custom range if needed.')}else message(e.message,'error')}
}
$('accountHistoryBtn').onclick=open;
$('historyAccount').onchange=()=>load(false).catch(err=>message(err.message,'error'));
$('historyPeriod').onchange=()=>{$('historyCustomDates').hidden=$('historyPeriod').value!=='custom'};
$('historyFilters').onsubmit=e=>{e.preventDefault();load(false).catch(err=>message(err.message,'error'))};
$('historyClear').onclick=()=>{$('historyPeriod').value='all';$('historyAccount').value='Both';$('historySearch').value='';$('historyCustomDates').hidden=true;load(false).catch(err=>message(err.message,'error'))};
$('historyMore').onclick=()=>load(true).catch(err=>message(err.message,'error'));
$('historyBack').onclick=()=>{$('historyDetails').classList.contains('management-active')?cancelManagement():closeDetail($('historyDetails'))};
})();
