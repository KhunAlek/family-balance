import { executeRevisionClaimWrite, FinancialWriteValidationError, statement } from './write-protocol.mjs';

const primary=db=>typeof db.withSession==='function'?db.withSession('first-primary'):db;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}

// Request receipts are scoped to the authorized new mutation family and the
// owner-approved reporting correction. The revision protocol stays unchanged.
export async function executeRequestReceiptWrite(db,options,semantic,planWrite,encoding=null) {
  const {householdId='family',action,payload={}}=options;
  const requestId=payload.requestId;
  if (typeof requestId!=='string'||!/^[a-zA-Z0-9:_-]{1,128}$/.test(requestId)) throw new FinancialWriteValidationError('A stable request ID is required.');
  const bytes=new TextEncoder().encode(encoding || JSON.stringify(canonical({action,payload:semantic})));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  async function replay() {
    const row=await primary(db).prepare('SELECT action,semantic_payload_hash,response_json FROM new_function_request_receipts WHERE household_id=? AND request_id=?').bind(householdId,requestId).first();
    if (!row) return null;
    if (row.action!==action||row.semantic_payload_hash!==hash) throw new FinancialWriteValidationError('This request ID was already used with different details.');
    return JSON.parse(row.response_json);
  }
  const original=await replay();if(original)return original;
  try {
    return await executeRevisionClaimWrite(db,{...options,householdId,planWrite:async ctx=>{
      const plan=await planWrite(ctx);
      const response={ok:true,action,baseRevision:ctx.baseRevision,revision:ctx.nextRevision,writeToken:ctx.writeToken,...plan.response};
      plan.statements.push(statement('INSERT INTO new_function_request_receipts(household_id,request_id,action,semantic_payload_hash,committed_revision,response_json) VALUES(?,?,?,?,?,?)',householdId,requestId,action,hash,ctx.nextRevision,JSON.stringify(response)));
      return plan;
    }});
  } catch(error) {
    const original=await replay();if(original)return original;
    throw error;
  }
}
