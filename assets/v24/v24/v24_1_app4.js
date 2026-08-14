(()=>{
  const src='https://khunalek.github.io/family-balance/assets/v24/v24_1_app4.js?v=20260814d';
  const s=document.createElement('script');
  s.src=src;
  s.async=false;
  s.onload=()=>{};
  s.onerror=()=>{
    const loading=document.getElementById('loadingState');
    const error=document.getElementById('errorState');
    if(loading) loading.style.display='none';
    if(error){
      error.style.display='block';
      error.textContent='Startup file failed to load: '+src;
    }
  };
  document.head.appendChild(s);
})();
