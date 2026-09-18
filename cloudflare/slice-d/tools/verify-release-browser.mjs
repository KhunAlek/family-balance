import { createRequire } from 'node:module';

const {chromium}=createRequire(import.meta.url)('playwright');

const origin=String(process.env.CANDIDATE_ORIGIN||'').replace(/\/$/,'');
if(!/^https:\/\//.test(origin))throw new Error('CANDIDATE_ORIGIN must be an HTTPS preview origin.');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],failed=[];
  page.on('pageerror',error=>errors.push(String(error)));page.on('requestfailed',request=>failed.push(`${request.url()} :: ${request.failure()?.errorText||'failed'}`));
  const response=await page.goto(`${origin}/?release_gate=${Date.now()}`,{waitUntil:'networkidle',timeout:60000});
  if(!response?.ok())throw new Error(`Candidate page returned HTTP ${response?.status()}.`);
  const result=await page.evaluate(()=>{
    const localStyles=[...document.querySelectorAll('link[rel="stylesheet"]')].filter(link=>new URL(link.href).origin===location.origin);
    const loaded=localStyles.filter(link=>[...document.styleSheets].some(sheet=>sheet.href===link.href));
    const body=getComputedStyle(document.body),nav=document.querySelector('.top-tabs,nav,[role="navigation"]');
    return{localStyleCount:localStyles.length,loadedStyleCount:loaded.length,bodyFont:body.fontFamily,bodyBackground:body.backgroundColor,navDisplay:nav?getComputedStyle(nav).display:null};
  });
  await page.screenshot({path:'/tmp/production-candidate-phone.png',fullPage:true});
  if(errors.length||failed.length)throw new Error(`Browser failures: ${[...errors,...failed].join(' | ')}`);
  if(result.localStyleCount<1||result.loadedStyleCount!==result.localStyleCount)throw new Error(`Only ${result.loadedStyleCount}/${result.localStyleCount} local stylesheets loaded.`);
  if(/^(serif|Times New Roman)/i.test(result.bodyFont))throw new Error(`Candidate fell back to an unstyled serif font: ${result.bodyFont}`);
  if(result.bodyBackground==='rgba(0, 0, 0, 0)'||result.navDisplay==='inline')throw new Error('Candidate computed styles indicate an unstyled page.');
  console.log(JSON.stringify({status:'PASS',...result}));
}finally{await browser.close();}
