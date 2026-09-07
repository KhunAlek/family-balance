(function(root){
  function monthFromBangkokDate(today){return String(today||'').slice(0,7)}
  function normalizedStatus(item){if(item.status==='Paid'||Number(item.remainingAmount)<=0)return'Paid';return item.status==='Overdue'?'Overdue':'Outstanding'}
  function build(items,today){
    const month=monthFromBangkokDate(today),year=Number(month.slice(0,4)),monthIndex=Number(month.slice(5,7))-1;
    const days=new Date(Date.UTC(year,monthIndex+1,0)).getUTCDate(),first=(new Date(Date.UTC(year,monthIndex,1)).getUTCDay()+6)%7;
    const byDay=new Map();
    (items||[]).filter(x=>String(x.dueDate||'').slice(0,7)===month).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate))||String(a.name).localeCompare(String(b.name))).forEach(item=>{const day=Number(String(item.dueDate).slice(8,10));if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push({...item,calendarStatus:normalizedStatus(item)})});
    return{month,year,monthIndex,days,first,cells:Array.from({length:first+days},(_,i)=>i<first?null:{day:i-first+1,items:byDay.get(i-first+1)||[]})}
  }
  root.ObligationCalendar={build,normalizedStatus,monthFromBangkokDate};
  if(typeof module!=='undefined')module.exports=root.ObligationCalendar;
})(typeof globalThis==='undefined'?window:globalThis);
