import { BACKUP_TABLES } from './backup.mjs';
import { buildTerminalTransactionReadModel } from './terminal-transaction-read-model.mjs';
import { executeRequestReceiptWrite, loadRequestReceipt, semanticPayloadHash } from '../../slice-c/src/request-receipts.mjs';
import { FinancialWriteValidationError, statement } from '../../slice-c/src/write-protocol.mjs';

export const TRANSACTION_MANAGEMENT_PROTOCOL_FORMAT = 'family-cash-flow-transaction-management-v1';
export const MANAGEMENT_DISABLED_CODE = 'MANAGEMENT_NOT_ENABLED_STEP_7';
const OPERATIONS = new Set(['corrected','deleted','restored','replaced','undone']);
const text = value => String(value ?? '').trim();
const fail = (code,message,status=400) => { throw new TransactionManagementProtocolError(code,message,status); };

export class TransactionManagementProtocolError extends Error {
  constructor(code,message,status=400) { super(message); this.name='TransactionManagementProtocolError'; this.code=code; this.status=status; }
}

function primary(db) { return typeof db?.withSession==='function' ? db.withSession('first-primary') : db; }
async function loadTables(db) {
  if (!db || typeof db.prepare!=='function' || typeof db.batch!=='function') fail('DATABASE_UNAVAILABLE','D1 binding is unavailable.',503);
  const target=primary(db);
  const results=await target.batch(BACKUP_TABLES.map(table=>target.prepare(`SELECT * FROM "${table}"`)));
  if (!Array.isArray(results)||results.length!==BACKUP_TABLES.length) fail('INCOMPLETE_INVENTORY','Database returned an incomplete inventory.');
  return Object.fromEntries(BACKUP_TABLES.map((table,index)=>[table,results[index]?.results||[]]));
}
function revisionOf(tables,householdId) {
  const rows=tables.household_revisions.filter(row=>String(row.household_id)===householdId);
  if(rows.length!==1||!Number.isSafeInteger(Number(rows[0].current_revision))||Number(rows[0].current_revision)<0) fail('REVISION_UNAVAILABLE','One authoritative household revision is required.');
  return Number(rows[0].current_revision);
}
function findTransaction(model,id) {
  return [...model.activeTransactions,...model.deletedTransactions].find(item=>item.logicalTransactionId===id)||null;
}
function correlationId(value) {
  const id=text(value);
  if(id && /^[a-zA-Z0-9:_-]{1,128}$/.test(id)) return id;
  if(id) fail('INVALID_CORRELATION_ID','A valid correlation ID is required.');
  if(!globalThis.crypto?.randomUUID) fail('CORRELATION_ID_UNAVAILABLE','Secure correlation ID generation is unavailable.',503);
  return globalThis.crypto.randomUUID();
}
function validateOperation(value) { const operation=text(value); if(!OPERATIONS.has(operation)) fail('INVALID_MANAGEMENT_OPERATION','A supported management operation is required.'); return operation; }
function disabledEligibility(transaction,operation) {
  return { eligible:false, operation, kind:transaction.kind, refusalCodes:[MANAGEMENT_DISABLED_CODE] };
}

export async function previewTransactionManagement(db,payload={},householdId='family') {
  const id=text(payload.logicalTransactionId), operation=validateOperation(payload.operation);
  if(!id) fail('INVALID_LOGICAL_TRANSACTION_ID','A logical transaction ID is required.');
  const tables=await loadTables(db), revision=revisionOf(tables,householdId);
  const transaction=findTransaction(buildTerminalTransactionReadModel(tables),id);
  if(!transaction) fail('TRANSACTION_NOT_FOUND','The logical transaction was not found.',404);
  if(transaction.identitySource!=='persisted'||!transaction.terminalVersion.id) fail('MANAGEMENT_IDENTITY_UNAVAILABLE','Persisted transaction identity is required.');
  return { ok:true,format:TRANSACTION_MANAGEMENT_PROTOCOL_FORMAT,correlationId:correlationId(payload.correlationId),logicalTransactionId:id,
    operation,baseRevision:revision,terminalVersionId:transaction.terminalVersion.id,terminalVersionNumber:transaction.terminalVersion.number,
    lifecycle:transaction.lifecycle,kind:transaction.kind,eligibility:disabledEligibility(transaction,operation),commitRequired:{requestId:true,semanticPayload:true,baseRevision:true,terminalVersionId:true} };
}

function requireCommitPayload(payload) {
  const requestId=text(payload.requestId), logicalTransactionId=text(payload.logicalTransactionId), operation=validateOperation(payload.operation);
  if(!/^[a-zA-Z0-9:_-]{1,128}$/.test(requestId)) fail('INVALID_REQUEST_ID','A stable request ID is required.');
  if(!logicalTransactionId) fail('INVALID_LOGICAL_TRANSACTION_ID','A logical transaction ID is required.');
  if(!Number.isSafeInteger(payload.baseRevision)||payload.baseRevision<0) fail('INVALID_BASE_REVISION','A non-negative integer base revision is required.');
  if(!text(payload.terminalVersionId)) fail('INVALID_TERMINAL_VERSION','A terminal version ID is required.');
  if(!payload.semanticPayload||typeof payload.semanticPayload!=='object'||Array.isArray(payload.semanticPayload)) fail('INVALID_SEMANTIC_PAYLOAD','A semantic payload object is required.');
  return {requestId,logicalTransactionId,operation};
}
function stableId(prefix,logicalId,requestId) { return `${prefix}:${logicalId}:${requestId}`; }

export async function executeTransactionManagementCommit(db,payload={},options={}) {
  const householdId=options.householdId||'family', actorEmail=text(options.actorEmail), required=requireCommitPayload(payload);
  if(!actorEmail) fail('ACTOR_IDENTITY_REQUIRED','Actor identity is required.',401);
  const action='transactionManagementCommit';
  const semantic={logicalTransactionId:required.logicalTransactionId,operation:required.operation,baseRevision:payload.baseRevision,
    terminalVersionId:text(payload.terminalVersionId),semanticPayload:payload.semanticPayload};
  const hash=await semanticPayloadHash(action,semantic);
  let replay;
  try { replay=await loadRequestReceipt(db,{householdId,requestId:required.requestId,action,semanticHash:hash}); }
  catch(error) { if(error instanceof FinancialWriteValidationError) fail('REQUEST_ID_CONFLICT',error.message,409); throw error; }
  if(replay) return replay;
  const tables=await loadTables(db), authoritativeRevision=revisionOf(tables,householdId);
  if(authoritativeRevision!==payload.baseRevision) fail('STALE_MANAGEMENT_REVISION','The household revision changed; refresh the preview.',409);
  const transaction=findTransaction(buildTerminalTransactionReadModel(tables),required.logicalTransactionId);
  if(!transaction) fail('TRANSACTION_NOT_FOUND','The logical transaction was not found.',404);
  if(transaction.identitySource!=='persisted'||!transaction.terminalVersion.id) fail('MANAGEMENT_IDENTITY_UNAVAILABLE','Persisted transaction identity is required.');
  if(transaction.terminalVersion.id!==text(payload.terminalVersionId)) fail('STALE_TERMINAL_VERSION','The terminal transaction version changed; refresh the preview.',409);
  const eligibility=options.testOnlyEligibility ? await options.testOnlyEligibility({transaction,payload}) : disabledEligibility(transaction,required.operation);
  if(!eligibility?.eligible) fail(eligibility?.refusalCodes?.[0]||'MANAGEMENT_NOT_ELIGIBLE','Transaction management is not enabled for this transaction.',409);
  if(typeof options.testOnlyBuildReplacement!=='function') fail(MANAGEMENT_DISABLED_CODE,'Transaction management is not enabled in Step 7.',409);
  const replacement=await options.testOnlyBuildReplacement({transaction,payload});
  if(!replacement||!Array.isArray(replacement.factStatements)||!Array.isArray(replacement.components)||!replacement.businessDate||!replacement.kind) fail('INVALID_REPLACEMENT_PLAN','The replacement plan is incomplete.');
  const operationId=stableId('management-operation',required.logicalTransactionId,required.requestId);
  const versionId=stableId('transaction-version',required.logicalTransactionId,required.requestId);
  const nowIso=options.nowIso||new Date().toISOString();
  try { return await executeRequestReceiptWrite(db,{householdId,actorEmail,action,payload:{requestId:required.requestId},nowIso,
    writeToken:options.writeToken,testOnlyForcedFailure:options.testOnlyForcedFailure,testOnlyBeforeBatch:options.testOnlyBeforeBatch},semantic,async ctx=>{
      if(ctx.baseRevision!==payload.baseRevision) throw new TransactionManagementProtocolError('STALE_MANAGEMENT_REVISION','The household revision changed; refresh the preview.',409);
      const nextVersion=transaction.terminalVersion.number+1;
      const impact=JSON.stringify(replacement.impactSummary||{});
      const lifecycle=required.operation==='deleted'?'deleted':'active';
      const statements=[...replacement.factStatements,
        statement('INSERT INTO logical_transaction_versions(version_id,logical_transaction_id,version_number,kind,business_date,committed_revision,operation_type,management_operation_id) VALUES(?,?,?,?,?,?,?,?)',versionId,required.logicalTransactionId,nextVersion,replacement.kind,replacement.businessDate,ctx.nextRevision,required.operation,operationId),
        ...replacement.components.map(component=>statement('INSERT INTO logical_transaction_components(version_id,component_kind,component_id,component_role) VALUES(?,?,?,?)',versionId,component.kind,component.id,component.role)),
        statement('INSERT INTO transaction_management_audit(operation_id,operation_type,logical_transaction_id,prior_version_id,resulting_version_id,actor_email,committed_at_utc,reason_code,reason_explanation,request_id,semantic_payload_hash,preview_base_revision,committed_revision,write_token,impact_summary_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',operationId,required.operation,required.logicalTransactionId,transaction.terminalVersion.id,versionId,actorEmail,nowIso,text(payload.semanticPayload.reasonCode)||'not_specified',payload.semanticPayload.reasonExplanation??null,required.requestId,ctx.semanticPayloadHash,payload.baseRevision,ctx.nextRevision,ctx.writeToken,impact),
        statement('UPDATE logical_transactions SET lifecycle_status=?,terminal_version_id=? WHERE logical_transaction_id=? AND terminal_version_id=?',lifecycle,versionId,required.logicalTransactionId,transaction.terminalVersion.id)];
      return {statements,response:{format:TRANSACTION_MANAGEMENT_PROTOCOL_FORMAT,logicalTransactionId:required.logicalTransactionId,operation:required.operation,terminalVersionId:versionId,priorVersionId:transaction.terminalVersion.id,lifecycle}};
    }); }
  catch(error) { if(error instanceof FinancialWriteValidationError) fail('REQUEST_ID_CONFLICT',error.message,409); throw error; }
}
