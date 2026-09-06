(()=>{
  const action=document.getElementById('recordsCorrectionBtn');
  if(!action)return;

  const modal=document.createElement('div');
  modal.className='modal-backdrop';
  modal.id='correctionModal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-labelledby','correctionTitle');
  modal.innerHTML=`<aside class="modal movement-drawer">
    <div class="drawer-head"><div><h2 id="correctionTitle">Correct a record</h2><p>Corrections are audited. The original history is preserved where possible.</p></div><button type="button" class="detail-back" id="correctionCancel">← Back</button></div>
    <form id="correctionForm">
      <div class="form-summary"><strong>Use this only to fix a factual mistake.</strong> Select the existing record, enter the corrected value(s), and explain why. Every correction records before/after values, your signed-in account, time, revision and write token.</div>
      <label for="correctionType">Record type</label><select id="correctionType" required></select>
      <label for="correctionRecord">Record</label><select id="correctionRecord" required><option value="">Choose a record</option></select>
      <div class="movement-summary" id="correctionCurrent">Choose a record to see its current values.</div>
      <div id="correctionFields"></div><div class="form-summary" id="correctionImpact" hidden aria-live="polite"></div>
      <label for="correctionReason">Reason for correction</label><textarea id="correctionReason" required placeholder="What was wrong, and what evidence are you correcting it from?"></textarea>
      <div class="form-msg" id="correctionMsg"></div>
      <div class="modal-actions"><button type="button" class="btn secondary" id="correctionCancelBottom">Cancel</button><button type="submit" class="btn primary" id="correctionSubmit" disabled>Apply audited correction</button></div>
    </form>
  </aside>`;
  document.body.appendChild(modal);

  const typeEl=document.getElementById('correctionType');
  const recordEl=document.getElementById('correctionRecord');
  const fieldsEl=document.getElementById('correctionFields');
  const currentEl=document.getElementById('correctionCurrent');
  const reasonEl=document.getElementById('correctionReason');
  const submit=document.getElementById('correctionSubmit');
  let catalog=null;
  let preview=null;
  let reportingPreview=null;
  let reportingPreviewKey=null;
  let correctionRequestId=null;
  const impactEl=document.getElementById('correctionImpact');
  function invalidateImpact(){reportingPreview=null;reportingPreviewKey=null;impactEl.hidden=true;submit.textContent=typeEl.value==='salaryCycle'?'Preview reporting changes':'Apply audited correction';}
  function renderImpact(impact){
    impactEl.hidden=false;
    if(!impact){impactEl.textContent='Review the corrected salary-cycle dates, then apply the audited correction.';return;}
    const amount=n=>new Intl.NumberFormat('en-TH',{style:'currency',currency:'THB'}).format(n/100);
    const date=d=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T00:00:00Z'));
    const cycleName=(start,totals)=>{const i=totals.findIndex(t=>t.cycleStart===start);return i===totals.length-1?'Current cycle':i===totals.length-2?'Previous cycle':i>=0?'Earlier cycle':'Previously unassigned';};
    const totals=impact.beforeTotals.map((before,i)=>{const after=impact.afterTotals[i];return `<li>${escape(cycleName(before.cycleStart,impact.beforeTotals))}: ${escape(amount(before.amountSatang))} → ${escape(amount(after.amountSatang))}</li>`;}).join('');
    const moved=impact.movedPayments.map(p=>`<li>${escape(date(p.businessDate))} · ${escape(p.description||'Categorized payment')} · ${escape(amount(p.amountSatang))}: ${escape(cycleName(p.fromCycleStart,impact.beforeTotals))} → ${escape(cycleName(p.toCycleStart,impact.afterTotals))}</li>`).join('');
    impactEl.innerHTML=`<strong>Reporting changes</strong><p>Cycle start: ${escape(date(impact.oldStart))} → ${escape(date(impact.newStart))}</p><p>One-off totals before → after</p><ul>${totals}</ul>${moved?`<p>Payments moving between cycles</p><ul>${moved}</ul>`:'<p>No payments move between cycles.</p>'}<p>Payment dates, amounts and accounts stay unchanged. Frozen weekly snapshots stay unchanged.</p>`;
  }

  const escape=v=>escapeHtml(v==null?'':v);
  const moneySatang=v=>v==null?'':String(Math.round(Number(v))/100);
  const fieldSpecs={
    balance:[
      ['businessDate','Business date','date',c=>c.business_date],
      ['alexBalance','Alex KTB balance','number',c=>moneySatang(c.alex_balance_satang)],
      ['olgaBalance','Olga KTB balance','number',c=>moneySatang(c.olga_balance_satang)]
    ],
    obligationPayment:[
      ['paymentDate','Payment date','date',c=>c.payment_date],
      ['actualAmount','Actual amount','number',c=>moneySatang(c.actual_amount_satang)],
      ['paidFrom','Paid from','select',c=>c.paid_from,['Alex','Olga']],
      ['paymentStatus','Payment status','select',c=>c.payment_status||'Partial',['Partial','Final']],
      ['note','Note','text',c=>c.note||'']
    ],
    ledgerMovement:[
      ['businessDate','Movement date','date',c=>c.business_date],
      ['account','Account','text',c=>c.account],
      ['direction','Direction','select',c=>c.direction,['Contribution','Withdrawal']],
      ['amount','Amount','number',c=>moneySatang(c.amount_satang)]
    ],
    goal:[
      ['targetAmount','Target amount','number',c=>moneySatang(c.target_amount_satang)],
      ['priorityRank','Priority rank','number',c=>c.priority_rank],
      ['status','Status','text',c=>c.status],
      ['targetDate','Target date','date',c=>c.target_date||'']
    ],
    salaryCycle:[
      ['currentCycleStart','Current cycle start','date',c=>c.current_cycle_start],
      ['nextSalaryDate','Next salary date','date',c=>c.next_salary_date||'']
    ]
  };

  function setCorrectionMsg(text,type='err'){
    setMsg('correctionMsg',text,type);
  }
  function closeCorrection(){modal.classList.remove('show');preview=null;invalidateImpact();}
  function resetRecord(){invalidateImpact();correctionRequestId=null;recordEl.innerHTML='<option value="">Choose a record</option>';fieldsEl.innerHTML='';currentEl.textContent='Choose a record to see its current values.';reasonEl.value='';submit.disabled=true;preview=null;}
  function renderRecordOptions(){
    resetRecord();
    const records=catalog&&catalog.records&&catalog.records[typeEl.value]||[];
    recordEl.innerHTML='<option value="">Choose a record</option>'+records.map(r=>`<option value="${escape(r.entityId)}">${escape(r.label)}</option>`).join('');
  }
  function renderFields(data){
    preview=data;invalidateImpact();correctionRequestId=null;
    const c=data.current||{};
    currentEl.innerHTML='<strong>Current stored record</strong><br>'+escape((catalog.records[typeEl.value]||[]).find(r=>String(r.entityId)===String(data.entityId))?.label||data.entityId);
    const specs=fieldSpecs[data.entityType]||[];
    fieldsEl.innerHTML=specs.map(([name,label,type,getValue,options])=>{
      const value=getValue(c);
      if(type==='select')return `<label for="correction-${name}">${escape(label)}</label><select id="correction-${name}" data-correction-field="${escape(name)}">${options.map(o=>`<option value="${escape(o)}"${String(o)===String(value)?' selected':''}>${escape(o)}</option>`).join('')}</select>`;
      const step=type==='number'?' step="0.01"':'';
      return `<label for="correction-${name}">${escape(label)}</label><input id="correction-${name}" data-correction-field="${escape(name)}" type="${escape(type)}"${step} value="${escape(value)}">`;
    }).join('');
    submit.disabled=false;
  }
  async function loadCatalog(){
    resetRecord();
    typeEl.innerHTML='<option value="">Loading records…</option>';
    setCorrectionMsg('');
    try{
      const result=await apiCall('correctionCatalog',{});
      if(!result||!result.ok)throw new Error(result&&result.error||'Could not load correction records.');
      catalog=result;
      typeEl.innerHTML='<option value="">Choose a record type</option>'+result.entityTypes.map(t=>`<option value="${escape(t.value)}">${escape(t.label)}</option>`).join('');
    }catch(err){
      typeEl.innerHTML='<option value="">Unavailable</option>';
      setCorrectionMsg(err&&err.message||'Could not load correction records.');
    }
  }
  async function loadPreview(){
    fieldsEl.innerHTML='';preview=null;submit.disabled=true;setCorrectionMsg('');
    if(!typeEl.value||!recordEl.value){currentEl.textContent='Choose a record to see its current values.';return;}
    currentEl.textContent='Loading current record…';
    try{
      const result=await apiCall('correctionPreview',{entityType:typeEl.value,entityId:recordEl.value});
      if(!result||!result.ok)throw new Error(result&&result.error||'Could not load current record.');
      renderFields(result);
    }catch(err){currentEl.textContent='Current record unavailable.';setCorrectionMsg(err&&err.message||'Could not load current record.');}
  }

  action.addEventListener('click',async()=>{modal.classList.add('show');await loadCatalog();});
  document.getElementById('correctionCancel').addEventListener('click',closeCorrection);
  document.getElementById('correctionCancelBottom').addEventListener('click',closeCorrection);
  modal.addEventListener('click',e=>{if(e.target===modal)closeCorrection();});
  typeEl.addEventListener('change',renderRecordOptions);
  recordEl.addEventListener('change',loadPreview);
  fieldsEl.addEventListener('input',()=>{invalidateImpact();correctionRequestId=null;});
  reasonEl.addEventListener('input',()=>{invalidateImpact();correctionRequestId=null;});
  document.getElementById('correctionForm').addEventListener('submit',async e=>{
    e.preventDefault();setCorrectionMsg('');
    if(!preview||!typeEl.value||!recordEl.value){setCorrectionMsg('Choose a record first.');return;}
    const reason=reasonEl.value.trim();if(!reason){setCorrectionMsg('Explain why this correction is needed.');return;}
    const correctedValues={};
    fieldsEl.querySelectorAll('[data-correction-field]').forEach(el=>{correctedValues[el.dataset.correctionField]=el.value;});
    const values={action:'correctRecord',entityType:typeEl.value,entityId:recordEl.value,correctedValues,reason};
    const key=JSON.stringify(values);
    const salary=typeEl.value==='salaryCycle';
    const needsPreview=salary&&(!reportingPreview||reportingPreviewKey!==key);
    setBusy(submit,true,needsPreview?'Previewing…':'Applying…','Apply audited correction');
    const controls=[...document.getElementById('correctionForm').querySelectorAll('input,select,textarea')];
    controls.forEach(el=>{el.disabled=true;});
    try{
      if(needsPreview){
        const result=await apiCall('previewSalaryCycleCorrection',values);
        if(!result||!result.ok)throw new Error(result&&result.error||'Could not preview reporting changes.');
        reportingPreview=result;reportingPreviewKey=key;renderImpact(result.reportingImpact);
        return;
      }
      if(salary){
        correctionRequestId=correctionRequestId||crypto.randomUUID();
        values.requestId=correctionRequestId;
        values.previewRevision=reportingPreview.previewRevision;
      }
      const result=await postAction(values);
      if(!result||!result.ok){if(result&&result.staleWriter)invalidateImpact();setCorrectionMsg(result&&result.error||'Could not apply correction.');return;}
      closeCorrection();
      await refreshLiveData();
    }catch(err){setCorrectionMsg(needsPreview?(err&&err.message||'Could not preview reporting changes.'):'Network error — correction was not confirmed. Retry with the same details to check the result.');}
    finally{controls.forEach(el=>{el.disabled=false;});setBusy(submit,false,'',salary&&!reportingPreview?'Preview reporting changes':'Apply audited correction');}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('show'))closeCorrection();});
})();
