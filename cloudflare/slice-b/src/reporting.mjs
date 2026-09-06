import { addDays, isoDate, bangkokBusinessDate } from './dates.mjs';

function fail(message) { const error = new Error(message); error.validation = true; throw error; }
export function reportingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('A valid reporting date is required.');
  const parsed = new Date(value+'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) fail('A valid reporting date is required.');
  return value;
}
export function reportingCycleForDate(cycles, date) {
  let selected = null;
  for (const row of cycles) if (row.cycle_start<=date && (!selected || row.cycle_start>selected)) selected=row.cycle_start;
  return selected;
}

export async function loadReportingCycles(db, householdId='family') {
  const [result] = await db.batch([db.prepare('SELECT cycle_start FROM reporting_salary_cycles WHERE household_id=? ORDER BY cycle_start DESC LIMIT 3').bind(householdId)]);
  return (result.results||[]).map(row=>({...row})).reverse();
}

export async function loadReportingPayments(db, householdId, from, through) {
  const results = await db.batch([
    db.prepare('SELECT p.*,c.name AS category_name FROM one_off_payments p LEFT JOIN one_off_categories c ON c.category_id=p.category_id AND c.household_id=p.household_id WHERE p.household_id=? AND p.business_date>=? AND p.business_date<=? ORDER BY p.business_date DESC,p.one_off_payment_id DESC').bind(householdId,from,through),
    db.prepare('SELECT a.* FROM one_off_payment_allocations a JOIN one_off_payments p ON p.one_off_payment_id=a.one_off_payment_id WHERE p.household_id=? AND p.business_date>=? AND p.business_date<=? ORDER BY a.one_off_payment_id,a.account').bind(householdId,from,through)
  ]);
  const allocations = new Map();
  for (const row of results[1].results||[]) {
    const list=allocations.get(row.one_off_payment_id)||[]; list.push({...row}); allocations.set(row.one_off_payment_id,list);
  }
  return (results[0].results||[]).map(row=>{
    const split=allocations.get(row.one_off_payment_id)||[];
    if (!Number.isSafeInteger(row.amount_satang) || split.reduce((sum,a)=>sum+a.amount_satang,0)!==row.amount_satang) fail('Typed payment allocations do not reconcile.');
    return {...row,allocations:split};
  });
}

export function reportTotals(cycles,payments) {
  const totals = cycles.map(c=>({cycleStart:c.cycle_start,amountSatang:0,paymentCount:0,categories:{}}));
  const byStart=new Map(totals.map(t=>[t.cycleStart,t]));
  for (const payment of payments) {
    const total=byStart.get(reportingCycleForDate(cycles,payment.business_date));
    if (!total) continue;
    const key=payment.category_id||'Uncategorized';
    total.amountSatang+=payment.amount_satang;total.paymentCount++;
    total.categories[key]=(total.categories[key]||0)+payment.amount_satang;
    if (!Number.isSafeInteger(total.amountSatang)) fail('Report total exceeds the supported exact amount.');
  }
  return totals;
}

export async function getOneOffReport(db,payload={},householdId='family',today=bangkokBusinessDate()) {
  const cycles=await loadReportingCycles(db,householdId);
  if (!cycles.length) fail('Factual reporting cycle history is required.');
  const selected=payload.cycleStarts===undefined?[cycles.at(-1).cycle_start]:payload.cycleStarts;
  if (!Array.isArray(selected)||!selected.length||selected.length>3||new Set(selected).size!==selected.length||selected.some(start=>!cycles.some(c=>c.cycle_start===start))) fail('Choose a nonempty selection from the latest three factual cycles.');
  const payments=await loadReportingPayments(db,householdId,cycles[0].cycle_start,today);
  const totals=reportTotals(cycles,payments).filter(t=>selected.includes(t.cycleStart));
  const baseline=payload.baseline||totals[0].cycleStart;
  if (!selected.includes(baseline)) fail('Choose a selected cycle as the baseline.');
  return {ok:true,cycles:cycles.map((c,i)=>({cycleStart:c.cycle_start,cycleEnd:cycles[i+1]?isoDate(addDays(cycles[i+1].cycle_start,-1)):null})),selectedCycleStarts:totals.map(t=>t.cycleStart),baseline:totals.length>1?baseline:null,totals};
}

export async function salaryReportingImpact(db,snapshot,newStart,householdId='family',today=bangkokBusinessDate()) {
  newStart=reportingDate(newStart);
  if (newStart>today) fail('A factual salary-cycle start cannot be in the future.');
  const before=await loadReportingCycles(db,householdId);
  const oldStart=snapshot.salaryCycle.current_cycle_start;
  if (!before.length || before.at(-1).cycle_start!==oldStart) fail('Reporting and current salary-cycle starts must be reconciled before correction.');
  const previous=before.at(-2)?.cycle_start;
  if (previous && newStart<=previous) fail('Corrected start must remain after the preceding factual reporting cycle start.');
  const after=before.map(c=>({cycle_start:c.cycle_start===oldStart?newStart:c.cycle_start}));
  const from=[before[0].cycle_start,newStart].sort()[0];
  const payments=await loadReportingPayments(db,householdId,from,today);
  const movedPayments=[];
  for (const p of payments) {
    const fromCycle=reportingCycleForDate(before,p.business_date),toCycle=reportingCycleForDate(after,p.business_date);
    if (fromCycle!==null && toCycle===null) fail('This correction would leave a payment without a factual reporting cycle. Earlier cycle evidence is required.');
    // Renaming the current boundary does not move a payment to another cycle.
    if (fromCycle===oldStart && toCycle===newStart) continue;
    if (fromCycle!==toCycle) movedPayments.push({paymentId:p.one_off_payment_id,businessDate:p.business_date,description:p.description,amountSatang:p.amount_satang,fromCycleStart:fromCycle,toCycleStart:toCycle});
  }
  return {oldStart,newStart,movedPayments,beforeTotals:reportTotals(before,payments),afterTotals:reportTotals(after,payments)};
}
