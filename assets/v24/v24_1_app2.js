function showAuthGate(message=''){document.getElementById('loadingState').style.display='none';document.getElementById('app').style.display='none';document.getElementById('authGate').classList.add('show');const e=document.getElementById('authError');e.textContent=message;e.classList.toggle('show',!!message);scheduleGoogleButton()}
function hideAuthGate(){document.getElementById('authGate').classList.remove('show');document.getElementById('authError').classList.remove('show')}
async function requestJson(path,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(path,{credentials:'same-origin',signal:controller.signal,...options});
    const text=await response.text();
    let data;
    try{data=text?JSON.parse(text):{}}catch(err){throw new Error('Backend returned an invalid response.')}
    if(!response.ok){const error=new Error(data.error||'Backend request failed with HTTP '+response.status+'.');error.status=response.status;throw error}
    return data||{ok:false,error:'Empty response.'};
  }catch(err){
    if(err&&err.name==='AbortError')throw new Error('Backend request timed out.');
    throw err;
  }finally{clearTimeout(timer)}
}
async function apiCall(apiAction,payload){
  try{
    return await requestJson('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiAction,payload:payload||{}})});
  }catch(err){
    if(err&&err.status===401){showAuthGate('Your session expired. Sign in again.');throw new Error('Authentication required.')}
    throw err;
  }
}
async function fetchDashboard(){return apiCall('dashboard',{})}
async function refreshLiveData(){const data=await fetchDashboard();if(data&&data.ok===false)throw new Error(data.error||'Could not load data.');render(data,{stale:false});if(typeof refreshNotificationPanel==='function')refreshNotificationPanel().catch(()=>{});return data}
async function loadData(){try{await refreshLiveData()}catch(err){if(/Authentication required/i.test(err.message||'')){showAuthGate();return}document.getElementById('loadingState').style.display='none';document.getElementById('errorState').style.display='block';document.getElementById('errorState').textContent='Could not load data: '+err.message}}
async function handleGoogleCredential(response){
  const mount=document.getElementById('googleLoginBtn');
  try{
    if(!response||!response.credential)throw new Error('Google sign-in was cancelled.');
    mount.setAttribute('aria-busy','true');
    const result=await requestJson('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:response.credential})});
    if(!result.ok)throw new Error(result.error||'This Google account is not authorized.');
    AUTHENTICATED_USER=result.identity&&result.identity.email||'';
    hideAuthGate();
    document.getElementById('loadingState').style.display='grid';
    await refreshLiveData();
  }catch(err){showAuthGate(err.message||'Could not sign in.')}
  finally{mount.removeAttribute('aria-busy')}
}
function initGoogleButton(){
  if(googleButtonInitialized)return true;
  if(!window.google||!google.accounts||!google.accounts.id)return false;
  google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:handleGoogleCredential,auto_select:false,cancel_on_tap_outside:true});
  const mount=document.getElementById('googleLoginBtn');
  mount.innerHTML='';
  google.accounts.id.renderButton(mount,{type:'standard',theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:280});
  googleButtonInitialized=true;
  return true;
}
function scheduleGoogleButton(){if(initGoogleButton())return;setTimeout(scheduleGoogleButton,250)}
async function initializeApp(){
  document.getElementById('loadingState').style.display='grid';
  scheduleGoogleButton();
  try{
    const status=await requestJson('/api/auth/session',{method:'GET'});
    AUTHENTICATED_USER=status.identity&&status.identity.email||'';
    hideAuthGate();
    await refreshLiveData();
  }catch(err){
    if(err&&err.status===401){showAuthGate();return}
    document.getElementById('loadingState').style.display='none';
    document.getElementById('app').style.display='none';
    document.getElementById('errorState').style.display='block';
    document.getElementById('errorState').textContent='Could not load data: '+(err&&err.message||'Unknown error.');
  }
}
async function logout(){
  try{await requestJson('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}catch(err){}
  AUTHENTICATED_USER='';
  if(window.google&&google.accounts&&google.accounts.id)google.accounts.id.disableAutoSelect();
  showAuthGate('You have signed out.');
}
document.getElementById('logoutBtn').addEventListener('click',logout);
