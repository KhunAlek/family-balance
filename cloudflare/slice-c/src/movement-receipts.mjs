import { FinancialWriteValidationError } from './write-protocol.mjs';
import { loadRequestReceipt, semanticPayloadHash, executeRequestReceiptWrite } from './request-receipts.mjs';
import { planFinancialWrite } from './write-actions.mjs';

const MOVEMENT_ACTIONS = new Set(['ktbTransfer', 'efWithdrawal', 'dedicatedTransfer']);
const validRequestId = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);

export async function executeMovementWrite(db, options) {
  if (!MOVEMENT_ACTIONS.has(options.action)) throw new FinancialWriteValidationError('Unsupported movement action.');
  const { requestId, ...semantic } = options.payload || {};
  return executeRequestReceiptWrite(db, options, semantic, planFinancialWrite);
}

export async function getMovementRequestStatus(db, request = {}, householdId = 'family') {
  const { requestId, movement } = request;
  if (!validRequestId(requestId)) throw new FinancialWriteValidationError('A stable request ID is required.');
  if (!movement || typeof movement !== 'object' || Array.isArray(movement) || !MOVEMENT_ACTIONS.has(movement.action)) {
    throw new FinancialWriteValidationError('A supported movement is required.');
  }
  const { requestId: ignored, ...semantic } = movement;
  const semanticHash = await semanticPayloadHash(movement.action, semantic);
  const response = await loadRequestReceipt(db, { householdId, requestId, action: movement.action, semanticHash });
  return { ok: true, found: !!response, response: response || null };
}
