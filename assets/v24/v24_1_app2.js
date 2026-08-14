function getSessionToken(){return sessionStorage.getItem(SESSION_KEY)||''}
function setSessionToken(token){if(token)sessionStorage.setItem(SESSION_KEY,token);else sessionStorage.removeItem(SESSION_KEY)}
function showAuthGate(message=''){document.getElementById('loadingState').style.display='none';document.getElementById('app').style.display='none';document.getElementById('authGate').classList.add('show');const e=document.getElementById('authError');e.textContent=message;e.classList.toggle('show',!!message)}
function hideAuthGate(){document.getElementById('authGate').classList.remove('show');document.getElementById('authError').classList.remove('show')}
function rawApi(body){
  return new Promise((resolve,reject)=>{
    const requestId='fcf_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
    const frame=document.createElement('iframe');
    const form=document.createElement('form');
    const frameName='fcf_transport_'+requestId;
    let settled=false;
    let timer=null;

    frame.name=frameName;
    frame.setAttribute('aria-hidden','true');
    frame.tabIndex=-1;
    frame.style.position='fixed';
    frame.style.width='1px';
    frame.style.height='1px';
    frame.style.border='0';
    frame.style.opacity='0';
    frame.style.pointerEvents='none';
    frame.style.left='-10000px';
    frame.style.top='-10000px';

    form.method='POST';
    form.action=APPS_SCRIPT_URL;
    form.target=frameName;
    form.acceptCharset='UTF-8';
    form.style.display='none';

    const addField=(name,value)=>{
      const input=document.createElement('input');
      input.type='hidden';
      input.name=name;
      input.value=value;
      form.appendChild(input);
    };
    addField('transport','iframe');
    addField('requestId',requestId);
    addField('requestJson',JSON.stringify(body||{}));

    const cleanup=()=>{
      window.removeEventListener('message',onMessage);
      if(timer)clearTimeout(timer);
      form.remove();
      frame.remove();
    };
    const finish=(fn,value)=>{
      if(settled)return;
      settled=true;
      cleanup();
      fn(value);
    };
    const onMessage=event=>{
      if(event.source!==frame.contentWindow)return;
      const msg=event.data;
      if(!msg||msg.type!=='fcf-api-response'||String(msg.requestId)!==requestId)return;
      finish(resolve,msg.result||{ok:false,error:'Empty response.'});
    };

    window.addEventListener('message',onMessage);
    document.body.appendChild(frame);
    document.body.appendChild(form);
    timer=setTimeout(()=>finish(reject,new Error('Backend request timed out.')),30000);
    form.submit();
  });
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
  }catch(err){setSessionToken('');showAuthGate('Sign in to continue.')}
}
