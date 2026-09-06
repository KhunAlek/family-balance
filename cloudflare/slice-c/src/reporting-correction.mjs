import { executeRequestReceiptWrite } from './request-receipts.mjs';
import { loadAuthoritativeFinancialState, executeRevisionClaimWrite, FinancialWriteValidationError, StaleFinancialWriterError, statement } from './write-protocol.mjs';
import { previewCorrection, planCorrection } from './correction.mjs';
import { salaryReportingImpact } from '../../slice-b/src/reporting.mjs';
import { bangkokBusinessDate } from '../../slice-b/src/dates.mjs';

export async function previewSalaryReportingCorrection(db,payload,options={}) {
  const householdId=options.householdId||'family';
  const {snapshot,target,baseRevision}=await loadAuthoritativeFinancialState(db,householdId);
  if (payload.entityType!=='salaryCycle') throw new FinancialWriteValidationError('Choose the salary-cycle record.');
  const preview=previewCorrection(snapshot,payload);
  // Validate the ordinary correction as well as the reporting implications.
  await planCorrection({snapshot,householdId,baseRevision,nextRevision:baseRevision+1,reportingCorrectionValidated:true,actorEmail:'preview',writeToken:'preview',nowIso:options.nowIso||new Date().toISOString(),payload:{...payload,reason:payload.reason||'Preview'}});
  const reportingImpact=snapshot.reportingEnabled?await salaryReportingImpact(target,snapshot,payload.correctedValues?.currentCycleStart||snapshot.salaryCycle.current_cycle_start,householdId,bangkokBusinessDate(new Date(options.nowIso||Date.now()))):null;
  return {...preview,previewRevision:baseRevision,reportingImpact};
}

export async function executeReportingCorrection(db,options) {
  const {snapshot}=await loadAuthoritativeFinancialState(db,options.householdId||'family');
  if (!snapshot.reportingEnabled) return executeRevisionClaimWrite(db,{...options,planWrite:planCorrection});
  const values=options.payload||{};
  const semantic={entityType:values.entityType,entityId:values.entityId,correctedValues:values.correctedValues,reason:String(values.reason||'').trim()};
  return executeRequestReceiptWrite(db,options,semantic,async ctx=>{
      if (!ctx.snapshot.reportingEnabled) return planCorrection(ctx);
      if (!Number.isInteger(ctx.payload.previewRevision) || ctx.payload.previewRevision!==ctx.baseRevision) throw new StaleFinancialWriterError('Financial state changed or the reporting preview is missing. Review a fresh correction preview.');
      const target=typeof db.withSession==='function'?db.withSession('first-primary'):db;
      const impact=await salaryReportingImpact(target,ctx.snapshot,ctx.payload.correctedValues?.currentCycleStart||ctx.snapshot.salaryCycle.current_cycle_start,ctx.householdId,bangkokBusinessDate(new Date(ctx.nowIso)));
      const plan=await planCorrection({...ctx,reportingCorrectionValidated:true});
      if (impact.newStart!==impact.oldStart) plan.statements.push(statement('UPDATE reporting_salary_cycles SET cycle_start=? WHERE household_id=? AND cycle_start=?',impact.newStart,ctx.householdId,impact.oldStart));
      // Enrich the existing salary correction audit; do not create a second
      // history mechanism or modify factual payment rows.
      const audit=plan.statements.find(s=>s.sql.includes('INSERT INTO correction_audit'));
      const before=JSON.parse(audit.params[4]),after=JSON.parse(audit.params[5]);
      before.reportingCycleStart=impact.oldStart;
      after.reportingCycleStart=impact.newStart;
      after.reportingImpact=impact;
      audit.params[4]=JSON.stringify(before);audit.params[5]=JSON.stringify(after);
      plan.response.reportingImpact=impact;
      return plan;
  });
}
