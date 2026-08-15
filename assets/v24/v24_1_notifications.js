let notificationPanelBusy=false;

function webPushSupported(){
  return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
}
function base64UrlToUint8(value){
  const padding='='.repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}
async function getPushRegistration(){
  return navigator.serviceWorker.register('/sw.js',{scope:'/'});
}
async function currentPushSubscription(){
  if(!webPushSupported())return null;
  const registration=await getPushRegistration();
  return registration.pushManager.getSubscription();
}
function notificationDate(value){
  if(!value)return'';
  try{return new Date(value).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'})}catch{return value}
}
function renderNotificationHistory(items){
  const el=document.getElementById('notificationHistory');
  if(!items||!items.length){el.innerHTML='<div class="empty-state">No reminders yet.</div>';return}
  el.innerHTML=items.map(item=>'<div class="notification-item"><b>'+escapeHtml(item.title)+'</b><p>'+escapeHtml(item.body)+'</p><small>'+escapeHtml(notificationDate(item.createdAt))+'</small></div>').join('');
}
function setNotificationPanel(state,subscription){
  const supported=webPushSupported(),permission=supported?Notification.permission:'unsupported',enabled=!!subscription&&!!state.currentDeviceEnabled;
  const pill=document.getElementById('notificationStatusPill'),title=document.getElementById('notificationStatusTitle'),copy=document.getElementById('notificationStatusText');
  if(!supported){pill.textContent='Unsupported';pill.className='status-pill red';title.textContent='Web Push is unavailable';copy.textContent='This browser does not expose Android Web Push.'}
  else if(!state.configured){pill.textContent='Setup needed';pill.className='status-pill red';title.textContent='Server keys are not configured';copy.textContent='The app is ready, but Web Push keys must be installed before this device can subscribe.'}
  else if(enabled){pill.textContent='Enabled';pill.className='status-pill green';title.textContent='Notifications are enabled here';copy.textContent='This account has '+Number(state.actorEnabledCount||1)+' subscribed device'+(Number(state.actorEnabledCount||1)===1?'':'s')+'.'}
  else if(permission==='denied'){pill.textContent='Blocked';pill.className='status-pill red';title.textContent='Notifications are blocked in Edge';copy.textContent='Allow notifications for this site in Edge settings, then return here.'}
  else{pill.textContent='Off';pill.className='status-pill';title.textContent='Notifications are off on this device';copy.textContent='Enable them here; the other phone must be enabled separately.'}
  document.getElementById('enableNotificationsBtn').disabled=notificationPanelBusy||!supported||!state.configured||enabled||permission==='denied';
  document.getElementById('disableNotificationsBtn').disabled=notificationPanelBusy||!enabled;
  document.getElementById('testNotificationBtn').disabled=notificationPanelBusy||!enabled;
  renderNotificationHistory(state.history||[]);
}
async function refreshNotificationPanel(){
  if(!AUTHENTICATED_USER)return;
  const subscription=await currentPushSubscription();
  const status=await apiCall('notificationStatus',{endpoint:subscription?subscription.endpoint:''});
  if(!status.ok)throw new Error(status.error||'Could not load notification status.');
  setNotificationPanel(status,subscription);
  return{status,subscription};
}
async function notificationAction(button,busyText,normalText,work){
  if(notificationPanelBusy)return;
  notificationPanelBusy=true;setBusy(button,true,busyText,normalText);clearMsg('notificationMsg');
  try{await work()}catch(err){setMsg('notificationMsg',err.message||'Notification action failed.')}
  finally{notificationPanelBusy=false;setBusy(button,false,'',normalText);try{await refreshNotificationPanel()}catch(err){setMsg('notificationMsg',err.message||'Could not refresh notification status.')}}
}
document.getElementById('enableNotificationsBtn').addEventListener('click',e=>notificationAction(e.currentTarget,'Enabling…','Enable on this device',async()=>{
  if(!webPushSupported())throw new Error('Web Push is unavailable in this browser.');
  const status=await apiCall('notificationStatus',{endpoint:''});
  if(!status.configured||!status.vapidPublicKey)throw new Error('Web Push keys are not configured.');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('Notification permission was not granted.');
  const registration=await getPushRegistration();
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToUint8(status.vapidPublicKey)});
  const result=await apiCall('subscribeNotifications',{subscription:subscription.toJSON()});
  if(!result.ok)throw new Error(result.error||'Could not save this device subscription.');
  setMsg('notificationMsg','Enabled on this device. Send a test while the phone is locked.','ok');
}));
document.getElementById('disableNotificationsBtn').addEventListener('click',e=>notificationAction(e.currentTarget,'Disabling…','Disable',async()=>{
  const subscription=await currentPushSubscription();
  if(!subscription)return;
  const result=await apiCall('unsubscribeNotifications',{endpoint:subscription.endpoint});
  if(!result.ok)throw new Error(result.error||'Could not remove this device subscription.');
  await subscription.unsubscribe();
  setMsg('notificationMsg','Notifications disabled on this device.','ok');
}));
document.getElementById('testNotificationBtn').addEventListener('click',e=>notificationAction(e.currentTarget,'Sending…','Send test',async()=>{
  const subscription=await currentPushSubscription();
  if(!subscription)throw new Error('Enable notifications on this device first.');
  const result=await apiCall('testNotification',{endpoint:subscription.endpoint});
  if(!result.ok)throw new Error(result.error||'The test notification failed.');
  setMsg('notificationMsg','Test sent. Lock the phone and confirm it appears.','ok');
}));
document.getElementById('refreshNotificationsBtn').addEventListener('click',()=>refreshNotificationPanel().catch(err=>setMsg('notificationMsg',err.message)));
