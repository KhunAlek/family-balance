import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanningState, authoritativeLedgerMovements, goalCommitmentState, qualifyingCurrentCycleContributions } from '../../slice-b/src/planning.mjs';
import { computeWeeklyVariablesCards } from '../../slice-b/src/weekly.mjs';
import { buildDashboardReadModel } from '../../slice-b/src/read-model.mjs';
import { accountLedgerBalance } from '../../slice-b/src/ef-goals.mjs';
import { buildOneOffPaymentPreview, planFinancialWrite } from '../src/write-actions.mjs';
import { FinancialWriteValidationError } from '../src/write-protocol.mjs';
import { planSalaryReceiptTransition } from '../src/salary-cycle.mjs';
import { buildMissingClosedWeeklySnapshots } from '../src/weekly-freeze.mjs';

const toSatang = value => Math.round((Number(value) + Number.EPSILON) * 100);
const clone = value => structuredClone(value);
const approx = (actual, expected, label = 'value', tolerance = 0.011) => {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

function balanceRow(date, combined, order = 1) {
  return {
    balance_row_id: order,
    business_date: date,
    sheet_order: order,
    alex_balance_satang: toSatang(combined),
    olga_balance_satang: 0,
    one_off_payment_name: null,
    income_receipt_source: null,
    source_sheet: 'Balance Check',
    source_row: order
  };
}
function obligation(name, amount, dueDay = 15, amountType = 'Fixed') {
  return {
    name,
    expected_amount_satang: toSatang(amount),
    due_type: 'Day of month',
    due_day: dueDay,
    amount_type: amountType,
    category: 'Bill',
    legacy_paid_this_month: 0
  };
}
function goal(name, target, commitment = 0, status = 'active', rank = 1) {
  return {
    name,
    target_amount_satang: toSatang(target),
    priority_rank: rank,
    status,
    target_date: null,
    cycle_commitment_satang: toSatang(commitment)
  };
}
function ledgerRow(id, date, account, direction, amount, sourceSheet = 'Ledger', sourceRow = id) {
  return {
    ledger_id: id,
    business_date: date,
    sheet_order: Number(id) || 1,
    account,
    direction,
    amount_satang: toSatang(amount),
    source_sheet: sourceSheet,
    source_row: sourceRow
  };
}
function correctionAudit(id, entityId, before, after) {
  return {
    correction_id: id,
    entity_type: 'ledger_movement',
    entity_id: String(entityId),
    before_json: before ? JSON.stringify(before) : null,
    after_json: after ? JSON.stringify(after) : null,
    reason: 'test',
    actor_email: 'test@example.com',
    corrected_at: '2026-08-20T10:00:00Z',
    base_revision: 1,
    write_token: `token-${id}`
  };
}
function snapshot(options = {}) {
  const cycleStart = options.cycleStart || '2026-08-01';
  const nextSalary = Object.prototype.hasOwnProperty.call(options, 'nextSalary') ? options.nextSalary : '2026-08-31';
  const asOf = options.asOf || (nextSalary === '2026-08-31' ? '2026-08-20' : cycleStart);
  const cash = Object.prototype.hasOwnProperty.call(options, 'cash') ? options.cash : 20000;
  const openingCash = Object.prototype.hasOwnProperty.call(options, 'openingCash') ? options.openingCash : cash;
  const openingDate = options.openingDate || (() => {
    const d = new Date(`${cycleStart}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0,10);
  })();
  const balances = options.balanceHistory || [balanceRow(openingDate, openingCash, 1), balanceRow(asOf, cash, 2)];
  return {
    householdId: 'family',
    config: {
      currency: 'THB',
      emergency_fund_target_satang: toSatang(220000),
      ef_monthly_claim_cap_satang: toSatang(options.configEfDefault ?? 15000),
      obligation_payments_cutover_period: '2026-08',
      salary_receipt_cutover_date: '2026-07-13'
    },
    salaryCycle: {
      current_cycle_start: cycleStart,
      next_salary_date: nextSalary,
      salary_receipt_cutover_date: '2026-07-13',
      variables_target_satang: options.variablesTarget === null ? null : toSatang(options.variablesTarget ?? 22000),
      ef_cycle_commitment_satang: toSatang(options.efCommitment ?? 0)
    },
    salaryCycleSources: options.salaryCycleSources || [],
    balanceHistory: balances,
    incomeDefinitions: options.incomeDefinitions || [],
    incomeReceipts: options.incomeReceipts || [],
    obligations: options.obligations || [],
    obligationPayments: options.obligationPayments || [],
    goals: options.goals || [],
    ledger: options.ledger || [],
    weeklySnapshots: options.weeklySnapshots || [],
    correctionAudits: options.correctionAudits || []
  };
}
function writeContext(action, payload, snap, nowIso = '2026-08-20T12:00:00.000Z') {
  return {
    snapshot: snap,
    householdId: 'family',
    baseRevision: 3,
    nextRevision: 4,
    actorEmail: 'test@example.com',
    action,
    payload,
    nowIso,
    writeToken: 'v3-acceptance-token'
  };
}
async function rejected(promise, pattern) {
  await assert.rejects(promise, error => error instanceof FinancialWriteValidationError && pattern.test(error.message));
}

// A. Available to spend

test('V3-M01 — Basic Available', () => {
  const s = snapshot({ cash: 20000, obligations: [obligation('Bill',1500)] });
  const p = buildPlanningState(s,'2026-08-20');
  approx(p.commitments.requiredOutstanding,1500);
  approx(p.availableToSpend,18500);
});

test('V3-M02 — Obligation outside runway', () => {
  const s = snapshot({ cash:20000, obligations:[obligation('Electricity',1500,15),obligation('Rent',6000,31)] });
  const p = buildPlanningState(s,'2026-08-20');
  approx(p.commitments.requiredOutstanding,1500);
  approx(p.availableToSpend,18500);
  assert.equal(p.fixedObligations.items.some(item=>item.name==='Rent'),false);
});

test('V3-M03 — Negative Available', () => {
  const s = snapshot({ cash:5000, obligations:[obligation('Required',8000)] });
  const p = buildPlanningState(s,'2026-08-20');
  approx(p.availableToSpend,-3000);
});

// B. Variables

test('V3-M04 — Target never reserves cash', () => {
  const a = snapshot({ cash:20000, variablesTarget:22000, obligations:[obligation('Bill',1500)] });
  const b = clone(a); b.salaryCycle.variables_target_satang=toSatang(30000);
  const pa=buildPlanningState(a,'2026-08-20'),pb=buildPlanningState(b,'2026-08-20');
  approx(pa.availableToSpend,pb.availableToSpend);
  assert.deepEqual(a.balanceHistory,b.balanceHistory);
  assert.deepEqual(a.ledger,b.ledger);
  assert.notEqual(pa.variables.target,pb.variables.target);
});

test('V3-M05 — Target edit is planning-only', async () => {
  const s=snapshot({variablesTarget:22000});
  const plan=await planFinancialWrite(writeContext('setVariablesTarget',{amount:30000},s));
  assert.equal(plan.statements.length,1);
  assert.match(plan.statements[0].sql,/UPDATE salary_cycle_state SET variables_target_satang/);
  assert.doesNotMatch(plan.statements[0].sql,/balance_history|ledger_movements|weekly_snapshots/);
});

test('V3-M06 — Pacing while target active', () => {
  const s=snapshot({cash:5000,openingCash:7000,asOf:'2026-08-21',variablesTarget:10000});
  const p=buildPlanningState(s,'2026-08-21');
  approx(p.variables.spent,2000);
  approx(p.variables.targetRemaining,8000);
  assert.equal(p.variables.remainingRunwayDays,10);
  approx(p.variables.targetPace,800);
  approx(p.variables.runwayPace,500);
  approx(p.variables.recommendedPace,500);
});

test('V3-M07 — Target exceeded', () => {
  const s=snapshot({cash:7000,openingCash:30000,asOf:'2026-08-21',variablesTarget:22000});
  const p=buildPlanningState(s,'2026-08-21');
  approx(p.variables.spent,23000);
  approx(p.variables.targetExceededBy,1000);
  approx(p.variables.runwayPace,700);
  approx(p.variables.recommendedPace,700);
});

// C. EF commitment

test('V3-M08 — Partial EF completion', () => {
  const s=snapshot({efCommitment:15000,ledger:[ledgerRow(1,'2026-08-10','EF','Contribution',5000)]});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.commitments.ef.grossCompleted,5000);
  approx(p.commitments.ef.outstanding,10000);
});

test('V3-M09 — EF withdrawal does not replenish', () => {
  const s=snapshot({efCommitment:15000,ledger:[ledgerRow(1,'2026-08-10','EF','Contribution',15000),ledgerRow(2,'2026-08-15','EF','Withdrawal',8000)]});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.commitments.ef.grossCompleted,15000);
  approx(p.commitments.ef.outstanding,0);
  approx(accountLedgerBalance(s.ledger,'EF'),7000);
});

test('V3-M10 — Commitment increase counts earlier contributions', () => {
  const s=snapshot({efCommitment:20000,ledger:[ledgerRow(1,'2026-08-10','EF','Contribution',18000)]});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.commitments.ef.grossCompleted,18000);
  approx(p.commitments.ef.outstanding,2000);
});

// D. Goal commitments

test('V3-M11 — Lifetime target is not reserved', () => {
  const s=snapshot({goals:[goal('A',20000,0)]});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.goals[0].lifetimeRemaining,20000);
  approx(p.goals[0].outstanding,0);
  approx(p.commitments.goalsOutstanding,0);
});

test('V3-M12 — Goal contribution completion survives withdrawal', () => {
  const s=snapshot({goals:[goal('A',20000,4000)],ledger:[ledgerRow(1,'2026-08-05','A','Contribution',4000),ledgerRow(2,'2026-08-18','A','Withdrawal',1000)]});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.goals[0].grossCompleted,4000);
  approx(p.goals[0].outstanding,0);
  approx(p.goals[0].factualBalance,3000);
});

test('V3-M13 — Goal commitment increase counts earlier contribution', () => {
  const s=snapshot({goals:[goal('A',20000,7000)],ledger:[ledgerRow(1,'2026-08-05','A','Contribution',6000)]});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.goals[0].grossCompleted,6000);
  approx(p.goals[0].outstanding,1000);
});

// E. Income and salary lifecycle

test('V3-M14 — Expected vs actual income', () => {
  const expected={source:'Salary',expected_amount_satang:toSatang(5000),pay_day:'31',lands_in:'Alex KTB'};
  const before=snapshot({cash:20000,incomeDefinitions:[expected]});
  const after=snapshot({cash:25000,incomeDefinitions:[expected],incomeReceipts:[{source:'Salary',business_date:'2026-08-20',amount_satang:toSatang(5000),lands_in:'Alex KTB'}]});
  approx(buildPlanningState(before,'2026-08-20').availableToSpend,20000);
  approx(buildPlanningState(after,'2026-08-20').availableToSpend,25000);
});

test('V3-M15 — New salary cycle state', () => {
  const s=snapshot({cycleStart:'2026-08-01',nextSalary:'2026-08-31',variablesTarget:27500,efCommitment:9000,configEfDefault:12000,goals:[goal('A',20000,3500)],incomeDefinitions:[{source:'Salary',pay_day:'31'}],salaryCycleSources:[{cycle_start:'2026-08-01',source:'Salary'}]});
  const tr=planSalaryReceiptTransition(s,'2026-08-31','Salary','family');
  assert.equal(tr.advanced,true);
  assert.equal(tr.variablesTargetRequired,true);
  const cycle=tr.statements.find(x=>/UPDATE salary_cycle_state SET current_cycle_start/.test(x.sql));
  assert.deepEqual(cycle.params.slice(0,2),['2026-08-31',toSatang(12000)]);
  assert.ok(tr.statements.some(x=>/variables_target_satang=NULL/.test(x.sql)));
  assert.ok(tr.statements.some(x=>/UPDATE goals SET cycle_commitment_satang=0/.test(x.sql)));
});

// F. Weekly reporting

test('V3-M16 — Weekly cards are not spending authority', () => {
  const a=snapshot({cash:20000,variablesTarget:14000,asOf:'2026-08-20'}),b=clone(a);b.salaryCycle.variables_target_satang=toSatang(28000);
  const pa=buildPlanningState(a,'2026-08-20'),pb=buildPlanningState(b,'2026-08-20');
  const ca=computeWeeklyVariablesCards(a,'2026-08-20',pa),cb=computeWeeklyVariablesCards(b,'2026-08-20',pb);
  approx(pa.availableToSpend,pb.availableToSpend);
  assert.notEqual(ca.find(x=>x.isCurrent).planned,cb.find(x=>x.isCurrent).planned);
  assert.equal(ca.some(card=>Object.prototype.hasOwnProperty.call(card,'available')),false);
});

test('V3-M17 — No target means no invented weekly plan', () => {
  const s=snapshot({variablesTarget:null,asOf:'2026-08-20'}),p=buildPlanningState(s,'2026-08-20'),cards=computeWeeklyVariablesCards(s,'2026-08-20',p);
  assert.equal(p.planningState,'target_not_set');
  assert.equal(cards.filter(x=>!x.isClosed).every(x=>x.planned===null),true);
  assert.equal(cards.some(x=>x.planned===22000||x.planned===28000),false);
});

// G. Transactions

test('V3-M18 — Payment within Available', async () => {
  const s=snapshot({cash:10000,obligations:[obligation('Bill',5000)],asOf:'2026-08-20'});
  const p=buildPlanningState(s,'2026-08-20');approx(p.availableToSpend,5000);
  const plan=await planFinancialWrite(writeContext('oneOffPayment',{date:'2026-08-20',oneOffName:'Exact',oneOffAlexAmount:5000,oneOffOlgaAmount:0},s));
  assert.equal(plan.statements.length,1);
  const after=clone(s);after.balanceHistory.push(balanceRow('2026-08-20',5000,99));
  approx(buildPlanningState(after,'2026-08-20').availableToSpend,0);
});

test('V3-M19 — Payment above Available', () => {
  const s=snapshot({cash:10000,obligations:[obligation('Bill',8000)],asOf:'2026-08-20'});
  const preview=buildOneOffPaymentPreview(s,{date:'2026-08-20',oneOffName:'Above',oneOffAlexAmount:5000,oneOffOlgaAmount:0},'2026-08-20T12:00:00Z');
  approx(preview.availableToSpend,2000);
  approx(preview.fundingNeeded,3000);
});

test('V3-M20 — Committed EF transfer is Available-neutral', () => {
  const before=snapshot({cash:30000,efCommitment:15000,obligations:[obligation('Other',8000)],asOf:'2026-08-20'});
  approx(buildPlanningState(before,'2026-08-20').availableToSpend,7000);
  const after=snapshot({cash:15000,efCommitment:15000,obligations:[obligation('Other',8000)],asOf:'2026-08-20',ledger:[ledgerRow(1,'2026-08-20','EF','Contribution',15000)]});
  const p=buildPlanningState(after,'2026-08-20');
  approx(p.commitments.ef.outstanding,0);
  approx(p.availableToSpend,7000);
});

test('V3-M21 — Voluntary contribution consumes Available', () => {
  const before=snapshot({cash:3000,efCommitment:1000,asOf:'2026-08-20'}),pb=buildPlanningState(before,'2026-08-20');
  approx(pb.availableToSpend,2000);approx(pb.transferLimits.emergencyFund,3000);
  const after=snapshot({cash:0,efCommitment:1000,asOf:'2026-08-20',ledger:[ledgerRow(1,'2026-08-20','EF','Contribution',3000)]});
  approx(buildPlanningState(after,'2026-08-20').availableToSpend,0);
  const gBefore=snapshot({cash:3000,goals:[goal('A',10000,1000)],asOf:'2026-08-20'}),gAfter=snapshot({cash:0,goals:[goal('A',10000,1000)],asOf:'2026-08-20',ledger:[ledgerRow(1,'2026-08-20','A','Contribution',3000)]});
  approx(buildPlanningState(gBefore,'2026-08-20').transferLimits.goals.A,3000);
  approx(buildPlanningState(gAfter,'2026-08-20').availableToSpend,0);
});

// V3-M22 is DB-level in slice-d acceptance tests.

// I. Review-closure cases

test('V3-M23 — Cross-month salary-cycle Variables actual', () => {
  const s=snapshot({cycleStart:'2026-08-22',nextSalary:'2026-09-29',asOf:'2026-09-05',cash:8000,openingCash:10000,variablesTarget:5000,balanceHistory:[balanceRow('2026-08-21',10000,1),balanceRow('2026-08-31',9000,2),balanceRow('2026-09-05',8000,3)]});
  const p=buildPlanningState(s,'2026-09-05');
  approx(p.variables.spentCycleToDate,2000);
  approx(p.variables.targetRemaining,3000);
  assert.equal(p.variables.remainingRunwayDays,24);
  approx(p.variables.targetPace,125);
});

test('V3-M24 — Last runway day', () => {
  const s=snapshot({asOf:'2026-08-30',cash:10000,variablesTarget:10000});
  const p=buildPlanningState(s,'2026-08-30');
  assert.equal(p.variables.remainingRunwayDays,1);
  approx(p.variables.runwayPace,p.availableToSpend);
});

test('V3-M25 — Salary date before receipt is recorded', async () => {
  const s=snapshot({asOf:'2026-08-30',cash:10000,variablesTarget:22000,efCommitment:1000,obligations:[obligation('Old bill',1500,15)],goals:[goal('A',10000,1000)]});
  const p=buildPlanningState(s,'2026-08-31');
  assert.equal(p.planningState,'awaiting_salary_receipt');
  approx(p.commitments.requiredOutstanding,1500);
  assert.equal(p.guidanceAvailable,false);
  assert.equal(p.spendingAuthorityAvailable,true);
  approx(p.availableToSpend,6500);
  assert.equal(p.variables.targetPace,null);
  assert.equal(p.variables.runwayPace,null);
  assert.equal(p.variables.recommendedPace,null);
  assert.equal(p.variables.targetRemaining,null);
  approx(p.transferLimits.emergencyFund,7500);
  approx(p.transferLimits.goals.A,7500);
  approx(p.paymentSafety.availableToSpend,6500);
  const model=buildDashboardReadModel(s,'2026-08-31');
  assert.equal(model.planningState,'awaiting_salary_receipt');
  assert.equal(model.guidanceAvailable,false);
  assert.equal(model.spendingAuthorityAvailable,true);
  approx(model.availableToSpend,6500);
  approx(model.commitments.requiredOutstanding,1500);
  approx(model.transferLimits.emergencyFund,7500);
  approx(model.transferLimits.goals.A,7500);
  approx(model.paymentSafety.availableToSpend,6500);
  const now='2026-08-31T12:00:00.000Z';
  const preview=buildOneOffPaymentPreview(s,{date:'2026-08-31',oneOffName:'Live',oneOffAlexAmount:100,oneOffOlgaAmount:0},now);
  assert.equal(preview.guidanceAvailable,true);
  assert.equal(preview.planningState,'awaiting_salary_receipt');
  approx(preview.availableToSpend,6500);
  assert.ok((await planFinancialWrite(writeContext('oneOffPayment',{date:'2026-08-31',oneOffName:'Live',oneOffAlexAmount:100,oneOffOlgaAmount:0},s,now))).statements.length>0);
  assert.ok((await planFinancialWrite(writeContext('dedicatedTransfer',{date:'2026-08-31',sourceAccount:'Alex',destinationType:'EF',amount:100},s,now))).statements.length>0);
  assert.ok((await planFinancialWrite(writeContext('dedicatedTransfer',{date:'2026-08-31',sourceAccount:'Alex',destinationType:'Goal',destinationName:'A',amount:100},s,now))).statements.length>0);
});

function correctedContributionFixture({account='EF',originalDirection='Contribution',replacementDirection='Contribution',replacementAmount=10000,laterWithdrawal=0,reCorrectAmount=null}={}) {
  const original=ledgerRow(1,'2026-08-05',account,originalDirection,15000,'Ledger',1);
  const reverseDirection=originalDirection==='Contribution'?'Withdrawal':'Contribution';
  const reversal=ledgerRow(2,'2026-08-05',account,reverseDirection,15000,'Correction',101);
  const replacementA=ledgerRow(3,'2026-08-05',account,replacementDirection,replacementAmount,'Correction',102);
  const rows=[original,reversal,replacementA];
  const audits=[correctionAudit('a1',1,original,{...replacementA,source_sheet:'Correction',source_row:102})];
  if(reCorrectAmount!==null){
    const reversalA=ledgerRow(4,'2026-08-05',account,replacementDirection==='Contribution'?'Withdrawal':'Contribution',replacementAmount,'Correction',103);
    const replacementB=ledgerRow(5,'2026-08-05',account,'Contribution',reCorrectAmount,'Correction',104);
    rows.push(reversalA,replacementB);
    audits.push(correctionAudit('a2',3,replacementA,{...replacementB,source_sheet:'Correction',source_row:104}));
  }
  if(laterWithdrawal) rows.push(ledgerRow(9,'2026-08-18',account,'Withdrawal',laterWithdrawal,'Ledger',9));
  return {rows,audits};
}

test('V3-M26 — Corrected EF contribution amount', () => {
  const f=correctedContributionFixture({replacementAmount:10000});
  const s=snapshot({efCommitment:15000,ledger:f.rows,correctionAudits:f.audits});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.commitments.ef.grossCompleted,10000);
  approx(p.commitments.ef.outstanding,5000);
});

test('V3-M27 — EF contribution corrected to Withdrawal', () => {
  const f=correctedContributionFixture({replacementDirection:'Withdrawal',replacementAmount:15000});
  const s=snapshot({efCommitment:15000,ledger:f.rows,correctionAudits:f.audits});
  approx(buildPlanningState(s,'2026-08-20').commitments.ef.grossCompleted,0);
});

test('V3-M28 — Withdrawal corrected to Contribution', () => {
  const f=correctedContributionFixture({originalDirection:'Withdrawal',replacementDirection:'Contribution',replacementAmount:4000});
  const s=snapshot({efCommitment:15000,ledger:f.rows,correctionAudits:f.audits});
  approx(buildPlanningState(s,'2026-08-20').commitments.ef.grossCompleted,4000);
});

test('V3-M29 — Re-correction uses terminal replacement only', () => {
  const f=correctedContributionFixture({replacementAmount:10000,reCorrectAmount:7000});
  const s=snapshot({efCommitment:15000,ledger:f.rows,correctionAudits:f.audits});
  const resolved=authoritativeLedgerMovements(s,{cycleStart:'2026-08-01',throughDate:'2026-08-20'});
  assert.equal(resolved.rows.filter(r=>r.account==='EF').length,1);
  approx(qualifyingCurrentCycleContributions(s,'EF','2026-08-20').grossCompleted,7000);
});

test('V3-M30 — Ordinary withdrawal still does not resurrect', () => {
  const f=correctedContributionFixture({replacementAmount:15000,laterWithdrawal:9000});
  const s=snapshot({efCommitment:15000,ledger:f.rows,correctionAudits:f.audits});
  approx(buildPlanningState(s,'2026-08-20').commitments.ef.outstanding,0);
});

test('V3-M31 — Goal correction-aware completion', () => {
  const f=correctedContributionFixture({account:'A',replacementAmount:4000,laterWithdrawal:1000});
  const s=snapshot({goals:[goal('A',20000,5000)],ledger:f.rows,correctionAudits:f.audits});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.goals[0].grossCompleted,4000);
  approx(p.goals[0].outstanding,1000);
});

test('V3-M32 — Multiple Goal commitments sum', () => {
  const s=snapshot({cash:20000,efCommitment:1000,goals:[goal('A',20000,2000),goal('B',20000,3500,'active',2)],obligations:[obligation('Bill',4000)]});
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.commitments.goalsOutstanding,5500);
  approx(p.commitments.chosenOutstanding,6500);
  approx(p.commitments.totalOutstanding,10500);
});

test('V3-M33 — Goal outstanding limit accepted case', async () => {
  const s=snapshot({goals:[goal('A',5000,0)],ledger:[ledgerRow(1,'2026-07-20','A','Contribution',2000),ledgerRow(2,'2026-08-10','A','Contribution',2000)]});
  const state=goalCommitmentState(s,'A','2026-08-20',4000);
  approx(state.lifetimeRemaining,1000); // factual balance is 4k of 5k
  // Use a 7k lifetime target for the acceptance numbers: remaining 3k, cycle-completed 2k, outstanding 2k.
  s.goals[0].target_amount_satang=toSatang(7000);
  const proposed=goalCommitmentState(s,'A','2026-08-20',4000);
  approx(proposed.lifetimeRemaining,3000);
  approx(proposed.outstanding,2000);
  const plan=await planFinancialWrite(writeContext('setGoalCommitment',{goalName:'A',amount:4000},s));
  assert.equal(plan.statements.length,1);
});

test('V3-M34 — Goal outstanding limit rejection', async () => {
  const s=snapshot({goals:[goal('A',4000,0)],ledger:[ledgerRow(1,'2026-07-20','A','Contribution',1000),ledgerRow(2,'2026-08-10','A','Contribution',1000)]});
  const proposed=goalCommitmentState(s,'A','2026-08-20',5000);
  approx(proposed.lifetimeRemaining,2000);
  approx(proposed.outstanding,4000);
  await rejected(planFinancialWrite(writeContext('setGoalCommitment',{goalName:'A',amount:5000},s)),/outstanding while only/);
});

test('V3-M35 — Goal target reduction cannot strand larger commitment', async () => {
  const s=snapshot({goals:[goal('A',10000,3000)],ledger:[ledgerRow(1,'2026-07-20','A','Contribution',7000)]});
  await rejected(planFinancialWrite(writeContext('correctRecord',{entityType:'goal',entityId:'A',reason:'lower target',correctedValues:{targetAmount:9000}},s)),/Reduce the cycle commitment first/);
  assert.equal(s.goals[0].cycle_commitment_satang,toSatang(3000));
});

test('V3-M36 — Goal status change does not silently erase commitment', async () => {
  const s=snapshot({goals:[goal('A',10000,3000)]});
  const plan=await planFinancialWrite(writeContext('correctRecord',{entityType:'goal',entityId:'A',reason:'archive display',correctedValues:{status:'done'}},s));
  assert.equal(plan.statements.some(x=>/cycle_commitment_satang/.test(x.sql)),false);
  const after=clone(s);after.goals[0].status='done';
  const p=buildPlanningState(after,'2026-08-20');
  approx(p.commitments.goalsOutstanding,3000);
  assert.equal(p.commitments.goals[0].name,'A');
});

test('V3-M37 — Negative Available payment funding', () => {
  const s=snapshot({cash:10000,obligations:[obligation('Required',13000)],asOf:'2026-08-20'});
  const preview=buildOneOffPaymentPreview(s,{date:'2026-08-20',oneOffName:'Emergency',oneOffAlexAmount:5000,oneOffOlgaAmount:0},'2026-08-20T12:00:00Z');
  approx(preview.availableToSpend,-3000);
  approx(preview.fundingNeeded,8000);
});

test('V3-M38 — Mid-cycle cutover with prior EF contribution', () => {
  const s=snapshot({variablesTarget:null,efCommitment:15000,ledger:[ledgerRow(1,'2026-08-10','EF','Contribution',5000)],goals:[goal('A',20000,0)]});
  const p=buildPlanningState(s,'2026-08-20');
  assert.equal(p.variables.target,null);
  assert.equal(p.planningState,'target_not_set');
  approx(p.commitments.ef.grossCompleted,5000);
  approx(p.commitments.ef.outstanding,10000);
  approx(p.commitments.goalsOutstanding,0);
});

test('V3-M39 — Frozen card survives target edit', async () => {
  const frozen={week_start:'2026-08-03',week_end:'2026-08-09',planned_variables_satang:toSatang(7000),spent_variables_satang:toSatang(6500),spent_variables_status:null,difference_satang:toSatang(-500),opening_balance_satang:null,opening_balance_status:'no data',closing_balance_satang:null,status:'closed'};
  const s=snapshot({asOf:'2026-08-20',variablesTarget:31000,weeklySnapshots:[frozen]});
  const before=computeWeeklyVariablesCards(s,'2026-08-20',buildPlanningState(s,'2026-08-20'));
  const edit=await planFinancialWrite(writeContext('setVariablesTarget',{amount:62000},s));
  assert.equal(edit.statements.length,1);
  const after=clone(s);after.salaryCycle.variables_target_satang=toSatang(62000);
  const cards=computeWeeklyVariablesCards(after,'2026-08-20',buildPlanningState(after,'2026-08-20'));
  approx(before.find(x=>x.weekStart==='2026-08-03').planned,7000);
  approx(cards.find(x=>x.weekStart==='2026-08-03').planned,7000);
  assert.notEqual(before.find(x=>x.isCurrent).planned,cards.find(x=>x.isCurrent).planned);
  approx(buildPlanningState(s,'2026-08-20').availableToSpend,buildPlanningState(after,'2026-08-20').availableToSpend);
});

test('V3-M40 — Freeze before salary reset', () => {
  const s=snapshot({cycleStart:'2026-08-24',nextSalary:'2026-09-01',asOf:'2026-08-31',variablesTarget:31000,efCommitment:9000,goals:[goal('A',20000,3500)],incomeDefinitions:[{source:'Salary',pay_day:'1'}],salaryCycleSources:[{cycle_start:'2026-08-24',source:'Salary'}]});
  const tr=planSalaryReceiptTransition(s,'2026-09-01','Salary','family');
  assert.ok(tr.frozenWeeklySnapshots.length>0);
  assert.ok(tr.frozenWeeklySnapshots.every(row=>row.planned_variables_satang!==null));
  const firstReset=tr.statements.findIndex(x=>/UPDATE salary_cycle_state SET current_cycle_start/.test(x.sql));
  const lastFreeze=Math.max(...tr.statements.map((x,i)=>/INSERT INTO weekly_snapshots/.test(x.sql)?i:-1));
  assert.ok(lastFreeze<firstReset);
  assert.match(tr.statements[firstReset].sql,/variables_target_satang=NULL/);
});

// V3-M41 and V3-M42 are DB-level in slice-d acceptance tests.

test('V3-M43 — Unresolvable Ledger correction fails closed narrowly', () => {
  const historical=ledgerRow(1,'2026-07-01','A','Contribution',1000,'Ledger',1);
  const historicalAudit=correctionAudit('h',1,historical,{...historical,source_sheet:'Correction',source_row:999});
  const sA=snapshot({goals:[goal('A',10000,2000)],ledger:[historical],correctionAudits:[historicalAudit]});
  const pA=buildPlanningState(sA,'2026-08-20');
  assert.equal(pA.planningState,'ready');
  assert.deepEqual(pA.affectedPlanningAccounts,[]);

  const current=ledgerRow(2,'2026-08-10','A','Contribution',1000,'Ledger',2);
  const currentAudit=correctionAudit('c',2,current,{...current,source_sheet:'Correction',source_row:998});
  const sB=snapshot({cash:10000,efCommitment:1000,goals:[goal('A',10000,2000),goal('B',10000,1500,'active',2)],ledger:[current,ledgerRow(3,'2026-08-11','EF','Contribution',400),ledgerRow(4,'2026-08-12','B','Contribution',500)],correctionAudits:[currentAudit]});
  const pB=buildPlanningState(sB,'2026-08-20');
  assert.equal(pB.planningState,'degraded_correction_data');
  assert.deepEqual(pB.affectedPlanningAccounts,['A']);
  const a=pB.goals.find(g=>g.name==='A'),b=pB.goals.find(g=>g.name==='B');
  assert.equal(a.degraded,true);approx(a.grossCompleted,0);approx(a.outstanding,2000);
  assert.equal(b.degraded,false);approx(b.grossCompleted,500);approx(b.outstanding,1000);
  approx(pB.commitments.ef.grossCompleted,400);approx(pB.commitments.ef.outstanding,600);
  approx(pB.availableToSpend,6400);
  assert.equal(pB.conservativeSafeMinimum,true);
});

test('V3-M44 — Correction-aware completion reconciles with factual net balance', () => {
  const f=correctedContributionFixture({replacementAmount:10000});
  const s=snapshot({efCommitment:15000,ledger:f.rows,correctionAudits:f.audits});
  approx(accountLedgerBalance(s.ledger,'EF'),10000);
  approx(qualifyingCurrentCycleContributions(s,'EF','2026-08-20').grossCompleted,10000);
  const p=buildPlanningState(s,'2026-08-20');
  approx(p.emergencyFund.currentBalance,10000);
  approx(p.commitments.ef.outstanding,5000);
});

test('V3-M45 — Explicit read-model states', () => {
  assert.equal(buildDashboardReadModel(snapshot({variablesTarget:22000}),'2026-08-20').planningState,'ready');
  assert.equal(buildDashboardReadModel(snapshot({variablesTarget:null}),'2026-08-20').planningState,'target_not_set');
  assert.equal(buildDashboardReadModel(snapshot({variablesTarget:22000,asOf:'2026-08-30'}),'2026-08-31').planningState,'awaiting_salary_receipt');
  const current=ledgerRow(2,'2026-08-10','A','Contribution',1000,'Ledger',2),audit=correctionAudit('c',2,current,{...current,source_sheet:'Correction',source_row:998});
  assert.equal(buildDashboardReadModel(snapshot({variablesTarget:22000,goals:[goal('A',10000,2000)],ledger:[current],correctionAudits:[audit]}),'2026-08-20').planningState,'degraded_correction_data');
  assert.equal(buildPlanningState(snapshot({cycleStart:'2026-09-01',nextSalary:'2026-09-30',asOf:'2026-09-10',variablesTarget:22000}),'2026-08-20').planningState,'historical_not_authoritative');
});

test('V3-M46 — Entire cycle closes without Variables target', () => {
  const s=snapshot({cycleStart:'2026-08-24',nextSalary:'2026-09-01',asOf:'2026-08-31',variablesTarget:null,incomeDefinitions:[{source:'Salary',pay_day:'1'}],salaryCycleSources:[{cycle_start:'2026-08-24',source:'Salary'}]});
  const rows=buildMissingClosedWeeklySnapshots(s,'2026-08-24','2026-09-01','2026-08-31');
  assert.ok(rows.length>0);
  assert.ok(rows.every(row=>row.planned_variables_satang===null));
  const tr=planSalaryReceiptTransition(s,'2026-09-01','Salary','family');
  assert.ok(tr.frozenWeeklySnapshots.every(row=>row.planned_variables_satang===null));
  assert.ok(tr.statements.some(x=>/variables_target_satang=NULL/.test(x.sql)));
});
