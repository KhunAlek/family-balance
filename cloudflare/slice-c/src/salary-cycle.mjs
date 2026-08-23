import { addDays, compareDates, isoDate } from '../../slice-b/src/dates.mjs';
import { statement } from './write-protocol.mjs';
import { buildMissingClosedWeeklySnapshots } from './weekly-freeze.mjs';

const EF_DEFAULT_SATANG = 1500000;

function salarySources(snapshot) {
  return new Set((snapshot.incomeDefinitions || [])
    .filter(item => String(item.pay_day || '').trim() !== 'Variable')
    .map(item => String(item.source || '').trim())
    .filter(Boolean));
}

function activeCycleSources(snapshot, cycleStart) {
  return new Set((snapshot.salaryCycleSources || [])
    .filter(item => isoDate(item.cycle_start) === isoDate(cycleStart))
    .map(item => String(item.source || '').trim())
    .filter(Boolean));
}

function insertCycleSource(householdId, cycleStart, source) {
  return statement(
    'INSERT OR IGNORE INTO salary_cycle_sources(household_id,cycle_start,source) VALUES(?,?,?)',
    householdId, isoDate(cycleStart), source
  );
}

function insertWeeklySnapshot(row) {
  return statement(
    `INSERT INTO weekly_snapshots(
      household_id,week_start,week_end,planned_variables_satang,spent_variables_satang,spent_variables_status,
      difference_satang,opening_balance_satang,opening_balance_status,closing_balance_satang,status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    row.household_id,row.week_start,row.week_end,row.planned_variables_satang,row.spent_variables_satang,row.spent_variables_status,
    row.difference_satang,row.opening_balance_satang,row.opening_balance_status,row.closing_balance_satang,row.status
  );
}

function efDefaultSatang(snapshot) {
  const configured = snapshot.config?.ef_monthly_claim_cap_satang;
  return configured === null || configured === undefined ? EF_DEFAULT_SATANG : Number(configured);
}

function resetPlanningStatements(snapshot, householdId, newCycleStart) {
  return [
    statement(
      'UPDATE salary_cycle_state SET current_cycle_start=?,next_salary_date=NULL,variables_target_satang=NULL,ef_cycle_commitment_satang=? WHERE household_id=?',
      isoDate(newCycleStart), efDefaultSatang(snapshot), householdId
    ),
    statement('UPDATE goals SET cycle_commitment_satang=0 WHERE household_id=?', householdId)
  ];
}

export function planSalaryReceiptTransition(snapshot, receiptDate, source, householdId = 'family') {
  const salarySet = salarySources(snapshot);
  source = String(source || '').trim();
  if (!salarySet.has(source)) return { salary:false, advanced:false, statements:[], frozenWeeklySnapshots:[], variablesTargetRequired:false };

  const currentStart = isoDate(snapshot.salaryCycle?.current_cycle_start);
  const nextSalary = isoDate(snapshot.salaryCycle?.next_salary_date);
  const receipt = isoDate(receiptDate);
  if (!receipt) throw new Error('Invalid salary receipt date.');

  if (!currentStart) {
    return {
      salary:true, advanced:true, newCycleStart:receipt, variablesTargetRequired:true, frozenWeeklySnapshots:[],
      statements:[
        ...resetPlanningStatements(snapshot, householdId, receipt),
        insertCycleSource(householdId,receipt,source)
      ]
    };
  }

  const received = activeCycleSources(snapshot,currentStart);
  if (compareDates(receipt,currentStart) <= 0) {
    const statements = receipt === currentStart && !received.has(source) ? [insertCycleSource(householdId,currentStart,source)] : [];
    return { salary:true, advanced:false, cycleStart:currentStart, statements, frozenWeeklySnapshots:[], variablesTargetRequired:false };
  }

  const sourceAlreadyReceived = received.has(source);
  const reachedExpectedBoundary = !!nextSalary && compareDates(receipt,nextSalary) >= 0;
  if (!sourceAlreadyReceived && !reachedExpectedBoundary) {
    return {
      salary:true, advanced:false, cycleStart:currentStart,
      statements:[insertCycleSource(householdId,currentStart,source)], frozenWeeklySnapshots:[], variablesTargetRequired:false
    };
  }

  // Freeze the old cycle from the pre-reset snapshot. Only after every missing
  // closed card is planned do we reset the current-only v3 planning state.
  const frozenWeeklySnapshots = nextSalary
    ? buildMissingClosedWeeklySnapshots(snapshot,currentStart,receipt,addDays(receipt,-1))
    : [];
  return {
    salary:true,
    advanced:true,
    newCycleStart:receipt,
    variablesTargetRequired:true,
    frozenWeeklySnapshots,
    statements:[
      ...frozenWeeklySnapshots.map(insertWeeklySnapshot),
      ...resetPlanningStatements(snapshot, householdId, receipt),
      insertCycleSource(householdId,receipt,source)
    ]
  };
}
