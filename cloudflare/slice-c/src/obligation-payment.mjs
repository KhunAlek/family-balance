import {executeRequestReceiptWrite} from './request-receipts.mjs';
import {executeRevisionClaimWrite,loadAuthoritativeFinancialState} from './write-protocol.mjs';
import {planFinancialWrite} from './write-actions.mjs';

export async function executeObligationPayment(db,options){
  const state=await loadAuthoritativeFinancialState(db,options.householdId||'family');
  if(!state.snapshot.obligationPaymentManagementEnabled){
    return executeRevisionClaimWrite(db,{...options,planWrite:planFinancialWrite});
  }
  const {requestId,...semantic}=options.payload||{};
  return executeRequestReceiptWrite(db,options,semantic,planFinancialWrite);
}
