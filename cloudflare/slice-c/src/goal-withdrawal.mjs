import { executeRequestReceiptWrite } from './request-receipts.mjs';
import { planFinancialWrite } from './write-actions.mjs';

export async function executeGoalWithdrawal(db, options) {
  const { requestId, ...semantic } = options.payload || {};
  return executeRequestReceiptWrite(db, options, semantic, planFinancialWrite);
}
