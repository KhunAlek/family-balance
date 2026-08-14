import { addDays, isoDate } from '../../slice-b/src/dates.mjs';
import { buildMissingClosedWeeklySnapshots } from '../../slice-c/src/weekly-freeze.mjs';
import { executeRevisionClaimWrite, statement } from '../../slice-c/src/write-protocol.mjs';

class NoWeeklySnapshotsToWrite extends Error {}

export function bangkokBusinessDate(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weeklySnapshotInsert(row) {
  return statement(
    `INSERT INTO weekly_snapshots(
      household_id,week_start,week_end,planned_variables_satang,spent_variables_satang,
      spent_variables_status,difference_satang,opening_balance_satang,opening_balance_status,
      closing_balance_satang,status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    row.household_id,
    row.week_start,
    row.week_end,
    row.planned_variables_satang,
    row.spent_variables_satang,
    row.spent_variables_status,
    row.difference_satang,
    row.opening_balance_satang,
    row.opening_balance_status,
    row.closing_balance_satang,
    row.status
  );
}

export async function runWeeklySnapshotJob(db, options = {}) {
  const householdId = options.householdId || 'family';
  const businessDate = options.businessDate || bangkokBusinessDate(options.scheduledTime);
  const closedThrough = isoDate(addDays(businessDate, -1));
  try {
    const result = await executeRevisionClaimWrite(db, {
      householdId,
      actorEmail: options.actorEmail || 'system:weekly-snapshot',
      action: 'weeklySnapshot',
      nowIso: options.nowIso || new Date(options.scheduledTime ?? Date.now()).toISOString(),
      writeToken: options.writeToken,
      planWrite: async ({ snapshot }) => {
        const cycleStart = isoDate(snapshot.salaryCycle?.current_cycle_start);
        const nextSalaryDate = isoDate(snapshot.salaryCycle?.next_salary_date);
        const rows = buildMissingClosedWeeklySnapshots(snapshot, cycleStart, nextSalaryDate, closedThrough);
        if (!rows.length) throw new NoWeeklySnapshotsToWrite();
        return {
          statements: rows.map(weeklySnapshotInsert),
          response: { written: rows.length, weekStarts: rows.map(row => row.week_start), businessDate, closedThrough },
        };
      },
    });
    return result;
  } catch (error) {
    if (error instanceof NoWeeklySnapshotsToWrite) {
      return { ok: true, action: 'weeklySnapshot', written: 0, businessDate, closedThrough };
    }
    throw error;
  }
}
