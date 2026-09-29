let categoryView='active',categoryRows=[],categoryRequestId=null,categoryPending=null;
const categoryId=()=>categoryRequestId||(categoryRequestId=(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random()));
const newCategoryActionId=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random();

function renderCategoryRows(){
  const list=document.getElementById('categoryList'),active=categoryView==='active';
  list.innerHTML='';
  for(const row of categoryRows.filter(x=>!!x.active===active)){
    const el=document.createElement('div');el.className='compact-row';
    el.innerHTML='<div class="row-main"><div class="row-title">'+escapeHtml(row.name)+'</div></div><div class="row-side"><button type="button" class="mini-action" data-category-id="'+escapeHtml(row.category_id)+'">'+(active?'Deactivate':'Reactivate')+'</button></div>';
    list.appendChild(el);
  }
  if(!list.children.length)list.innerHTML='<div class="empty-state">No '+categoryView+' categories.</div>';
  document.getElementById('categoryActive').className='btn '+(active?'':'secondary');
  document.getElementById('categoryInactive').className='btn '+(active?'secondary':'');
  document.getElementById('categoryActive').setAttribute('aria-pressed',String(active));
  document.getElementById('categoryInactive').setAttribute('aria-pressed',String(!active));
}

async function loadCategoryManagement(){
  const r=await apiCall('getOneOffCategories',{});
  if(!r.ok)throw new Error(r.error||'Could not load categories.');
  categoryRows=r.categories;renderCategoryRows();
}
function resetCategoryForm(){
  document.getElementById('categoryForm').hidden=true;
  document.getElementById('categoryName').value='';
  document.getElementById('categoryPreview').hidden=true;
  document.getElementById('categorySave').disabled=true;
  categoryRequestId=null;
}
function resetCategoryAction(){
  categoryPending=null;
  document.getElementById('categoryActionPreview').hidden=true;
  document.getElementById('categoryActionConfirm').disabled=false;
}
for(const [id,view] of [['categoryActive','active'],['categoryInactive','inactive']]){
  document.getElementById(id).addEventListener('click',()=>{
    categoryView=view;resetCategoryForm();resetCategoryAction();renderCategoryRows();
  });
}
document.getElementById('categoryAdd').addEventListener('click',()=>{
  resetCategoryAction();resetCategoryForm();document.getElementById('categoryForm').hidden=false;
});
document.getElementById('categoryCancel').addEventListener('click',resetCategoryForm);
document.getElementById('categoryActionCancel').addEventListener('click',resetCategoryAction);
document.getElementById('categoryName').addEventListener('input',()=>{
  document.getElementById('categoryPreview').hidden=true;
  document.getElementById('categorySave').disabled=true;
  categoryRequestId=null;
});
document.getElementById('categoryPreviewBtn').addEventListener('click',async()=>{
  clearMsg('categoryMsg');
  try{
    const r=await apiCall('previewCategory',{action:'addOneOffCategory',name:document.getElementById('categoryName').value});
    if(!r.ok)throw new Error(r.error);
    document.getElementById('categoryPreview').textContent='Add “'+r.category.name+'” as an active category.';
    document.getElementById('categoryPreview').hidden=false;
    document.getElementById('categorySave').disabled=false;
  }catch(e){setMsg('categoryMsg',e.message)}
});
document.getElementById('categoryForm').addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    const r=await postAction({action:'addOneOffCategory',name:document.getElementById('categoryName').value,requestId:categoryId()});
    if(!r.ok)throw new Error(r.error);
    resetCategoryForm();await loadCategoryManagement();await refreshPaymentCategories();
  }catch(err){setMsg('categoryMsg',err.message)}
});
document.getElementById('categoryList').addEventListener('click',async e=>{
  const b=e.target.closest('[data-category-id]');if(!b)return;
  const row=categoryRows.find(x=>x.category_id===b.dataset.categoryId);if(!row)return;
  resetCategoryForm();resetCategoryAction();clearMsg('categoryMsg');
  const action=row.active?'deactivateOneOffCategory':'reactivateOneOffCategory';
  b.disabled=true;
  try{
    const r=await apiCall('previewCategory',{action,categoryId:row.category_id});
    if(!r.ok)throw new Error(r.error);
    categoryPending={action,categoryId:row.category_id,requestId:newCategoryActionId()};
    document.getElementById('categoryActionText').textContent=row.active
      ?'Deactivate “'+row.name+'”? Historical reports will remain unchanged.'
      :'Reactivate “'+row.name+'” for new payments. Historical reports remain unchanged.';
    document.getElementById('categoryActionConfirm').textContent=row.active?'Confirm deactivation':'Confirm reactivation';
    document.getElementById('categoryActionPreview').hidden=false;
    document.getElementById('categoryActionPreview').scrollIntoView({block:'nearest'});
  }catch(err){setMsg('categoryMsg',err.message)}finally{b.disabled=false}
});
document.getElementById('categoryActionConfirm').addEventListener('click',async()=>{
  if(!categoryPending)return;
  const pending=categoryPending,button=document.getElementById('categoryActionConfirm');
  button.disabled=true;clearMsg('categoryMsg');
  try{
    const r=await postAction({action:pending.action,categoryId:pending.categoryId,requestId:pending.requestId});
    if(!r.ok)throw new Error(r.error);
    resetCategoryAction();await loadCategoryManagement();await refreshPaymentCategories();
  }catch(err){setMsg('categoryMsg',err.message);button.disabled=false}
});

const manageCategories=document.createElement('button');
manageCategories.type='button';manageCategories.className='text-action';manageCategories.textContent='Manage categories';
manageCategories.addEventListener('click',()=>{
  categoryView='active';resetCategoryForm();resetCategoryAction();openActionDrawer('categories');
  loadCategoryManagement().catch(e=>setMsg('categoryMsg',e.message));
});
document.getElementById('paymentForm').prepend(manageCategories);
