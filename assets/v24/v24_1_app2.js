function getSessionToken(){return sessionStorage.getItem(SESSION_KEY)||''}
function setSessionToken(token){if(token)sessionStorage.setItem(SESSION_KEY,token);else sessionStorage.removeItem(SESSION_KEY)}
function showAuthGate(message=''){document.getElementById('loadingState').style.display='none';document.getElementById('app').style.display='none';document.getElementById('authGate').classList.add('show');const e=document.getElementById('authError');e.textContent=message;e.classList.toggle('show',!!message)}
function hideAuthGate(){document.getElementById('authGate').classList.remove('show');document.getElementById('authError').classList.remove('show')}
async function rawApi(body){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(API_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify(body||{}),
      redirect:'follow',
      signal:controller.signal
    });
    const text=await response.text();
    if(!response.ok)throw new Error('Backend request failed with HTTP '+response.status+'.');
    let data;
    try{data=JSON.parse(text)}catch(err){throw new Error('Backend returned an invalid response.');}
    return data||{ok:false,error:'Empty response.'};
  }catch(err){
    if(err&&err.name==='AbortError')throw new Error('Backend request timed out.');
    throw err;
  }finally{
    clearTimeout(timer);
  }
}
async function apiCall(apiAction,payload){
  const sessionToken=getSessionToken();
  if(!sessionToken)throw new Error('Authentication required.');
  const data=await rawApi({apiAction,sessionToken,payload:payload||{}});
  if(data&&data.ok===false&&/Authentication required/i.test(data.error||'')){setSessionToken('');showAuthGate('Your session expired. Sign in again.');throw new Error('Authentication required.')}
  return data;
}
async function fetchDashboard(){return apiCall('dashboard',{})}
async function refreshLiveData(){const data=await fetchDashboard();if(data&&data.ok===false)throw new Error(data.error||'Could not load data.');render(data,{stale:false});return data}
async function loadData(){try{await refreshLiveData()}catch(err){if(/Authentication required/i.test(err.message||'')){showAuthGate();return}document.getElementById('loadingState').style.display='none';document.getElementById('errorState').style.display='block';document.getElementById('errorState').textContent='Could not load data: '+err.message}}
function initGoogleTokenClient(){
  if(!window.google||!google.accounts||!google.accounts.oauth2)return false;
  if(authTokenClient)return true;
  authTokenClient=google.accounts.oauth2.initTokenClient({
    client_id:GOOGLE_CLIENT_ID,
    scope:'openid email',
    callback:async response=>{
      const btn=document.getElementById('googleLoginBtn');
      setBusy(btn,true,'Signing in…','Continue with Google');
      try{
        if(!response||response.error||!response.access_token)throw new Error((response&&response.error_description)||'Google sign-in was cancelled.');
        const result=await rawApi({apiAction:'authBootstrap',googleAccessToken:response.access_token});
        if(!result.ok)throw new Error(result.error||'This Google account is not authorized.');
        setSessionToken(result.sessionToken);
        AUTHENTICATED_USER=result.identity&&result.identity.email||'';
        hideAuthGate();
        document.getElementById('loadingState').style.display='grid';
        await refreshLiveData();
      }catch(err){showAuthGate(err.message||'Could not sign in.')}
      finally{setBusy(btn,false,'','Continue with Google')}
    }
  });
  return true;
}
document.getElementById('googleLoginBtn').addEventListener('click',()=>{
  if(!initGoogleTokenClient()){showAuthGate('Google sign-in is still loading. Try again in a moment.');return}
  authTokenClient.requestAccessToken({prompt:'select_account'});
});
async function initializeApp(){
  document.getElementById('loadingState').style.display='grid';
  if(!getSessionToken()){showAuthGate();return}
  try{
    const status=await apiCall('authStatus',{});
    if(!status.ok)throw new Error(status.error||'Authentication required.');
    AUTHENTICATED_USER=status.identity&&status.identity.email||'';
    hideAuthGate();
    await refreshLiveData();
  }catch(err){
    if(/Authentication required/i.test(err&&err.message||'')){
      setSessionToken('');
      showAuthGate('Your session expired. Sign in again.');
      return;
    }
    document.getElementById('loadingState').style.display='none';
    document.getElementById('app').style.display='none';
    document.getElementById('errorState').style.display='block';
    document.getElementById('errorState').textContent='Could not load data: '+(err&&err.message||'Unknown error.');
  }
}
