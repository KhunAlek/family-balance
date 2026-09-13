import { BACKUP_TABLES } from './backup.mjs';
import { classifyHistoricalRows } from './historical-preflight.mjs';

export const TERMINAL_TRANSACTION_READ_MODEL_FORMAT = 'family-cash-flow-terminal-transactions-v1';

export const READ_MODEL_REFUSAL_CODES = Object.freeze({
  MANAGEMENT_NOT_ENABLED: 'MANAGEMENT_NOT_ENABLED_STEP_7',
  AMBIGUOUS_LEGACY_ITEM: 'AMBIGUOUS_LEGACY_ITEM',
});

export class TerminalTransactionReadError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'TerminalTransactionReadError';
    this.code = code;
  }
}

const fail = (code, detail) => { throw new TerminalTransactionReadError(code, detail); };
const text = value => String(value ?? '');
const compare = (a, b) => text(a).localeCompare(text(b));
const sorted = (items, key) => [...items].sort((a, b) => compare(a[key], b[key]));
const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function indexUnique(rows, key, code) {
  const result = new Map();
  for (const row of rows) {
    const id = text(row[key]);
    if (!id || result.has(id)) fail(code, `Invalid or duplicate ${key}.`);
    result.set(id, row);
  }
  return result;
}

function creationEvidence(transaction) {
  const values = [transaction.created_actor_email, transaction.created_at_utc, transaction.creation_request_id,
    transaction.creation_write_token, transaction.creation_committed_revision];
  if (values.every(value => value === null || value === undefined)) return { availability: 'not_recorded', actorEmail: null, committedAtUtc: null, requestId: null, writeToken: null, committedRevision: null };
  if (values.some(value => value === null || value === undefined || text(value).trim() === '')) fail('INCOMPLETE_CREATION_EVIDENCE', `Logical transaction ${transaction.logical_transaction_id} has partial creation evidence.`);
  return { availability: 'recorded', actorEmail: text(transaction.created_actor_email), committedAtUtc: text(transaction.created_at_utc), requestId: text(transaction.creation_request_id), writeToken: text(transaction.creation_write_token), committedRevision: Number(transaction.creation_committed_revision) };
}

function disabledActions(code = READ_MODEL_REFUSAL_CODES.MANAGEMENT_NOT_ENABLED) {
  const refusal = Object.freeze([code]);
  return { correct: false, delete: false, restore: false, undo: false, refusalCodes: refusal };
}
function persistedActions(kind,lifecycle,auditCount) {
  if(kind!=='one_off_payment'&&kind!=='other_income_receipt'&&kind!=='obligation_payment'&&kind!=='ktb_transfer'&&kind!=='ef_movement'&&kind!=='goal_movement'&&kind!=='salary_receipt') return disabledActions();
  return lifecycle==='deleted'
    ? {correct:false,delete:false,restore:true,undo:auditCount>0,refusalCodes:[]}
    : {correct:true,delete:true,restore:false,undo:auditCount>0,refusalCodes:[]};
}

function componentDto(component) {
  return { kind: text(component.component_kind), id: text(component.component_id), role: text(component.component_role) };
}

function factualIndexes(tables) {
  const allocations = new Map();
  for (const row of tables.one_off_payment_allocations) {
    const key = `${row.one_off_payment_id}:${row.account}`;
    if (allocations.has(key)) fail('DUPLICATE_TYPED_FACT', 'Duplicate one-off payment allocation identity.');
    allocations.set(key, row);
  }
  return {
    payments: indexUnique(tables.one_off_payments, 'one_off_payment_id', 'DUPLICATE_TYPED_FACT'),
    receipts: indexUnique(tables.income_receipts, 'receipt_id', 'DUPLICATE_TYPED_FACT'),
    obligationPayments: indexUnique(tables.obligation_payments, 'payment_id', 'DUPLICATE_TYPED_FACT'),
    obligationOccurrences: indexUnique(tables.obligation_occurrences,'occurrence_id','DUPLICATE_TYPED_FACT'),
    ledger: indexUnique(tables.ledger_movements, 'ledger_id', 'DUPLICATE_TYPED_FACT'),
    balances: indexUnique(tables.balance_history, 'balance_row_id', 'DUPLICATE_TYPED_FACT'),
    categories: indexUnique(tables.one_off_categories, 'category_id', 'DUPLICATE_TYPED_FACT'),
    allocations,
    obligationAllocations:new Map(tables.obligation_payment_allocations.map(row=>[`${row.payment_id}:${row.account}`,row])),
    ktbTransfers:indexUnique(tables.ktb_transfers,'transfer_id','DUPLICATE_TYPED_FACT'),
    fundMovements:indexUnique(tables.fund_movements,'fund_movement_id','DUPLICATE_TYPED_FACT'),
    salaryParents:indexUnique(tables.salary_receipt_parents,'salary_receipt_parent_id','DUPLICATE_TYPED_FACT'),
  };
}

function reconstructKtbTransfer(base,components,indexes,householdId){
  const effects=components.filter(x=>x.component_kind==='balance_effect'&&x.component_role==='cash_effect');
  if(effects.length!==1||components.length!==1)fail('INCOMPLETE_TYPED_COMPONENTS','KTB transfer requires one cash effect with one typed parent.');
  const effect=indexes.balances.get(text(effects[0].component_id)),matches=[...indexes.ktbTransfers.values()].filter(x=>text(x.balance_effect_id)===text(effect?.balance_row_id)),transfer=matches[0];
  if(matches.length!==1)fail('INVALID_TYPED_TRANSFER','KTB transfer cash effect has no unique typed parent.');
  if(!transfer||text(transfer.household_id)!==householdId||!effect||text(transfer.balance_effect_id)!==text(effect.balance_row_id)||text(transfer.business_date)!==base.businessDate||!positiveInteger(transfer.amount_satang)||!['Alex','Olga'].includes(transfer.source_account)||!['Alex','Olga'].includes(transfer.destination_account)||transfer.source_account===transfer.destination_account)fail('INVALID_TYPED_TRANSFER','KTB transfer typed facts are invalid.');
  return{...base,totalSatang:Number(transfer.amount_satang),direction:'internal_movement',allocations:[{account:text(transfer.source_account),amountSatang:-Number(transfer.amount_satang)},{account:text(transfer.destination_account),amountSatang:Number(transfer.amount_satang)}],source:text(transfer.source_account),payee:text(transfer.destination_account)};
}
function reconstructFundMovement(base,components,indexes,householdId){
  const ledger=components.filter(x=>x.component_kind==='ledger_movement'&&x.component_role==='fund_effect'),effects=components.filter(x=>x.component_kind==='balance_effect'&&x.component_role==='cash_effect');
  if(ledger.length!==1||effects.length!==1||components.length!==2)fail('INCOMPLETE_TYPED_COMPONENTS','Fund movement requires one fund effect and one KTB effect.');
  const fundRow=indexes.ledger.get(text(ledger[0].component_id)),cash=indexes.balances.get(text(effects[0].component_id)),matches=[...indexes.fundMovements.values()].filter(x=>text(x.ledger_effect_id)===text(fundRow?.ledger_id)&&text(x.balance_effect_id)===text(cash?.balance_row_id)),movement=matches[0];
  if(matches.length!==1||!movement||text(movement.household_id)!==householdId||!fundRow||!cash||text(movement.business_date)!==base.businessDate||Number(movement.amount_satang)!==Number(fundRow.amount_satang)||text(movement.direction)!==text(fundRow.direction)||!positiveInteger(movement.amount_satang)||!['Contribution','Withdrawal'].includes(movement.direction)||!['Alex','Olga'].includes(movement.ktb_account))fail('INVALID_TYPED_FUND_MOVEMENT','Fund movement typed facts are invalid.');
  const goal=movement.fund_kind==='Goal'?text(movement.goal_name):null,account=movement.fund_kind==='EF'?'EF':goal;if(text(fundRow.account)!==account||(base.kind==='ef_movement')!==(movement.fund_kind==='EF'))fail('INVALID_TYPED_FUND_MOVEMENT','Fund identity conflicts with its Ledger effect.');
  return{...base,totalSatang:Number(movement.amount_satang),direction:'internal_movement',description:movement.withdrawal_purpose||null,source:movement.direction==='Contribution'?text(movement.ktb_account):account,payee:movement.direction==='Contribution'?account:text(movement.ktb_account),allocations:[{account:text(movement.ktb_account),amountSatang:movement.direction==='Contribution'?-Number(movement.amount_satang):Number(movement.amount_satang)}],fund:{kind:text(movement.fund_kind),goalName:goal,direction:text(movement.direction)}};
}

function reconstructObligation(base,components,indexes,householdId){
  const primary=components.filter(x=>x.component_kind==='obligation_payment'&&x.component_role==='primary'),effects=components.filter(x=>x.component_kind==='balance_effect'&&x.component_role==='cash_effect');
  if(primary.length!==1||effects.length!==1||components.length!==2)fail('INCOMPLETE_TYPED_COMPONENTS','Obligation payment requires one payment and one typed cash effect.');
  const payment=indexes.obligationPayments.get(text(primary[0].component_id)),occurrence=payment&&indexes.obligationOccurrences.get(text(payment.occurrence_id)),rows=[...indexes.obligationAllocations.values()].filter(x=>text(x.payment_id)===text(payment?.payment_id)),effect=indexes.balances.get(text(effects[0].component_id));
  if(!payment||text(payment.household_id)!==householdId||!occurrence||text(occurrence.household_id)!==householdId||text(payment.payment_date)!==base.businessDate)fail('MISSING_TYPED_FACT','Obligation payment or occurrence is unavailable.');
  if(rows.some(x=>!x||text(x.payment_id)!==text(payment.payment_id)||!positiveInteger(x.amount_satang))||new Set(rows.map(x=>text(x.account))).size!==rows.length||rows.reduce((s,x)=>s+Number(x.amount_satang),0)!==Number(payment.actual_amount_satang))fail('INCOMPLETE_TYPED_COMPONENTS','Obligation payment allocations are invalid.');
  if(!effect||text(effect.household_id)!==householdId||text(effect.obligation_payment_id)!==text(payment.payment_id))fail('INVALID_BALANCE_EFFECT','Obligation payment cash effect is invalid.');
  return {...base,description:payment.note??null,payee:text(payment.obligation_name),category:occurrence.category?{id:null,name:text(occurrence.category)}:null,totalSatang:Number(payment.actual_amount_satang),direction:'money_out',allocations:rows.map(x=>({account:text(x.account),amountSatang:Number(x.amount_satang)})).sort((a,b)=>compare(a.account,b.account)),occurrence:{id:text(occurrence.occurrence_id),dueDate:text(occurrence.due_date),expectedAmountSatang:Number(occurrence.expected_amount_satang)}};
}

function commonBase(kind, businessDate, revision) {
  return { kind, businessDate, committedRevision: Number(revision), description: null, source: null, payee: null,
    category: null, totalSatang: null, direction: null, allocations: [] };
}

function reconstructOneOff(base, components, indexes, householdId) {
  const primary = components.filter(item => item.component_kind === 'one_off_payment' && item.component_role === 'primary');
  const allocations = components.filter(item => item.component_kind === 'one_off_payment_allocation' && item.component_role === 'allocation');
  const effects = components.filter(item => item.component_kind === 'balance_effect' && item.component_role === 'cash_effect');
  if (primary.length !== 1 || !allocations.length || effects.length > 1 || components.length !== primary.length + allocations.length + effects.length) fail('INCOMPLETE_TYPED_COMPONENTS', 'One-off payment requires one primary, positive allocations, and at most one typed cash effect.');
  const payment = indexes.payments.get(text(primary[0].component_id));
  if (!payment || text(payment.household_id) !== householdId) fail('MISSING_TYPED_FACT', `Missing same-household one-off payment ${primary[0].component_id}.`);
  if (text(payment.business_date) !== base.businessDate || !positiveInteger(payment.amount_satang)) fail('INVALID_TYPED_FACT', `One-off payment ${payment.one_off_payment_id} conflicts with its terminal version.`);
  const rows = allocations.map(component => indexes.allocations.get(text(component.component_id)));
  if (rows.some(row => !row || text(row.one_off_payment_id) !== text(payment.one_off_payment_id) || !positiveInteger(row.amount_satang))) fail('MISSING_TYPED_FACT', `One-off payment ${payment.one_off_payment_id} has an invalid allocation relationship.`);
  if (new Set(rows.map(row => text(row.account))).size !== rows.length || rows.reduce((sum, row) => sum + Number(row.amount_satang), 0) !== Number(payment.amount_satang)) fail('INCOMPLETE_TYPED_COMPONENTS', `One-off payment ${payment.one_off_payment_id} allocations are incomplete.`);
  for (const effect of effects) {
    const row = indexes.balances.get(text(effect.component_id));
    if (!row || text(row.household_id) !== householdId || text(row.one_off_payment_id) !== text(payment.one_off_payment_id)) fail('INVALID_BALANCE_EFFECT', `One-off payment ${payment.one_off_payment_id} has an invalid typed cash effect.`);
  }
  const category = payment.category_id ? indexes.categories.get(text(payment.category_id)) : null;
  if (payment.category_id && (!category || text(category.household_id) !== householdId)) fail('MISSING_TYPED_FACT', `Missing same-household category ${payment.category_id}.`);
  return { ...base, description: payment.description ?? null, category: category ? { id: text(category.category_id), name: text(category.name) } : null,
    totalSatang: Number(payment.amount_satang), direction: 'money_out', allocations: rows.map(row => ({ account: text(row.account), amountSatang: Number(row.amount_satang) })).sort((a, b) => compare(a.account, b.account)) };
}

function reconstructIncome(base, components, indexes, householdId) {
  const receipts = components.filter(item => item.component_kind === 'income_receipt' && item.component_role === 'receipt');
  const effects = components.filter(item => item.component_kind === 'balance_effect' && item.component_role === 'cash_effect');
  if (!receipts.length || (effects.length!==0&&effects.length!==receipts.length) || receipts.length+effects.length !== components.length) fail('INCOMPLETE_TYPED_COMPONENTS', `${base.kind} requires receipt components and, when linked, one cash effect per receipt.`);
  const rows = receipts.map(component => indexes.receipts.get(text(component.component_id)));
  if (rows.some(row => !row || text(row.household_id) !== householdId || text(row.business_date) !== base.businessDate || !positiveInteger(row.amount_satang))) fail('MISSING_TYPED_FACT', `${base.kind} has a missing or conflicting receipt.`);
  if (new Set(rows.map(row => text(row.lands_in))).size !== rows.length || new Set(rows.map(row => text(row.source))).size !== 1) fail('INCOMPLETE_TYPED_COMPONENTS', `${base.kind} receipts do not form one complete action.`);
  const isOther = rows.every(row => row.other_income_source_id !== null && row.other_income_source_id !== undefined);
  if ((base.kind === 'other_income_receipt') !== isOther) fail('INVALID_TYPED_FACT', `${base.kind} receipt class conflicts with its terminal version.`);
  if(base.kind==='salary_receipt'){
    const ids=new Set(rows.map(row=>text(row.receipt_id))),parents=[...indexes.salaryParents.values()].filter(parent=>[parent.alex_receipt_id,parent.olga_receipt_id].filter(Boolean).some(id=>ids.has(text(id))));
    if(parents.length!==1)fail('INCOMPLETE_TYPED_COMPONENTS','Salary receipts require one immutable typed parent.');
    const parent=parents[0],parentIds=[parent.alex_receipt_id,parent.olga_receipt_id].filter(Boolean).map(text);
    if(text(parent.household_id)!==householdId||text(parent.business_date)!==base.businessDate||text(parent.source)!==text(rows[0].source)||parentIds.length!==ids.size||parentIds.some(id=>!ids.has(id))||Number(parent.total_satang)!==rows.reduce((sum,row)=>sum+Number(row.amount_satang),0))fail('INCOMPLETE_TYPED_COMPONENTS','Salary parent and receipt facts disagree.');
  }
  for(const effect of effects){const row=indexes.balances.get(text(effect.component_id));if(!row||text(row.household_id)!==householdId||!rows.some(receipt=>text(receipt.source_balance_row_id)===text(row.balance_row_id)))fail('INVALID_BALANCE_EFFECT',`${base.kind} has an invalid typed cash effect.`);}
  return { ...base, source: text(rows[0].source), totalSatang: rows.reduce((sum, row) => sum + Number(row.amount_satang), 0), direction: 'money_in', allocations: rows.map(row => ({ account: text(row.lands_in), amountSatang: Number(row.amount_satang) })).sort((a, b) => compare(a.account, b.account)) };
}

function reconstructTerminal(version, components, indexes, householdId) {
  if (!positiveInteger(version.committed_revision)) fail('INVALID_COMMITTED_REVISION', `Version ${version.version_id} has an invalid committed revision.`);
  const base = commonBase(text(version.kind), text(version.business_date), version.committed_revision);
  if (version.kind === 'one_off_payment') return reconstructOneOff(base, components, indexes, householdId);
  if (version.kind === 'other_income_receipt' || version.kind === 'salary_receipt') return reconstructIncome(base, components, indexes, householdId);
  if(version.kind==='obligation_payment')return reconstructObligation(base,components,indexes,householdId);
  if(version.kind==='ktb_transfer')return reconstructKtbTransfer(base,components,indexes,householdId);
  if(version.kind==='ef_movement'||version.kind==='goal_movement')return reconstructFundMovement(base,components,indexes,householdId);
  fail('UNSUPPORTED_TRANSACTION_KIND', `Transaction kind ${version.kind} is not reconstructable from current typed relationships.`);
}

function auditDto(row) {
  let impactSummary;
  try { impactSummary = JSON.parse(row.impact_summary_json); } catch { fail('INVALID_AUDIT_SUMMARY', `Audit ${row.operation_id} has invalid impact JSON.`); }
  return { operationId: text(row.operation_id), operationType: text(row.operation_type), priorVersionId: text(row.prior_version_id), resultingVersionId: text(row.resulting_version_id), actorEmail: text(row.actor_email), committedAtUtc: text(row.committed_at_utc), reasonCode: text(row.reason_code), reasonExplanation: row.reason_explanation ?? null, requestId: text(row.request_id), committedRevision: Number(row.committed_revision), writeToken: text(row.write_token), impactSummary };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonicalize(value[key])]));
  return value;
}

function resolveIdentityTransactions(tables) {
  const versions = indexUnique(tables.logical_transaction_versions, 'version_id', 'DUPLICATE_VERSION_ID');
  const audits = indexUnique(tables.transaction_management_audit, 'operation_id', 'DUPLICATE_AUDIT_ID');
  const indexes = factualIndexes(tables);
  const componentOwners = new Set();
  const claimedFacts = new Set();
  const usedAudits = new Set();
  const usedVersions = new Set();
  const result = [];
  for (const transaction of sorted(tables.logical_transactions, 'logical_transaction_id')) {
    const logicalId = text(transaction.logical_transaction_id), householdId = text(transaction.household_id);
    if (!logicalId || !householdId || !transaction.terminal_version_id) fail('MISSING_TERMINAL_POINTER', `Logical transaction ${logicalId || '(missing)'} has no terminal pointer.`);
    if (!['active', 'deleted'].includes(transaction.lifecycle_status)) fail('INVALID_LIFECYCLE', `Logical transaction ${logicalId} has an unsupported lifecycle.`);
    const chain = tables.logical_transaction_versions.filter(row => text(row.logical_transaction_id) === logicalId).sort((a, b) => Number(a.version_number) - Number(b.version_number));
    if (!chain.length || chain.some((row, index) => Number(row.version_number) !== index + 1)) fail('INCOMPLETE_VERSION_CHAIN', `Logical transaction ${logicalId} has a missing or duplicate version.`);
    const terminal = versions.get(text(transaction.terminal_version_id));
    if (!terminal) fail('MISSING_TERMINAL_VERSION', `Logical transaction ${logicalId} points to a missing terminal version.`);
    if (text(terminal.logical_transaction_id) !== logicalId || terminal !== chain.at(-1)) fail('CROSSED_TERMINAL_POINTER', `Logical transaction ${logicalId} terminal pointer is crossed or not latest.`);
    const terminalMeansDeleted=terminal.operation_type==='deleted'||(terminal.operation_type==='undone'&&chain.length>2&&chain.at(-3).operation_type==='deleted');
    if ((transaction.lifecycle_status === 'deleted') !== terminalMeansDeleted) fail('INVALID_LIFECYCLE_OPERATION', `Logical transaction ${logicalId} lifecycle conflicts with its terminal operation.`);
    const auditChain = [];
    chain.forEach((version, index) => {
      usedVersions.add(text(version.version_id));
      if (index === 0 && (version.operation_type !== 'created' || version.management_operation_id !== null)) fail('INVALID_CREATION_VERSION', `Logical transaction ${logicalId} has an invalid creation version.`);
      if (index > 0) {
        const audit = audits.get(text(version.management_operation_id));
        if (!audit || text(audit.logical_transaction_id) !== logicalId || text(audit.prior_version_id) !== text(chain[index - 1].version_id) || text(audit.resulting_version_id) !== text(version.version_id) || text(audit.operation_type) !== text(version.operation_type) || Number(audit.committed_revision) !== Number(version.committed_revision)) fail('INCOMPLETE_AUDIT_CHAIN', `Logical transaction ${logicalId} has an incomplete or crossed audit relationship.`);
        if (usedAudits.has(text(audit.operation_id))) fail('DUPLICATE_OR_ORPHAN_AUDIT', `Audit ${audit.operation_id} is referenced more than once.`);
        usedAudits.add(text(audit.operation_id));
        auditChain.push(auditDto(audit));
      }
    });
    if (tables.transaction_management_audit.some(row => text(row.logical_transaction_id) === logicalId) && auditChain.length !== chain.length - 1) fail('DUPLICATE_OR_ORPHAN_AUDIT', `Logical transaction ${logicalId} has an orphan audit row.`);
    const allComponents = tables.logical_transaction_components.filter(row => versions.has(text(row.version_id)) && text(versions.get(text(row.version_id)).logical_transaction_id) === logicalId);
    for (const component of allComponents) {
      const owner = `${component.component_kind}\0${component.component_id}`;
      if (componentOwners.has(owner)) fail('DUPLICATE_COMPONENT_OWNERSHIP', `Typed component ${component.component_kind}:${component.component_id} has duplicate ownership.`);
      componentOwners.add(owner); claimedFacts.add(owner);
    }
    const terminalComponents = allComponents.filter(row => text(row.version_id) === text(terminal.version_id)).sort((a, b) => compare(`${a.component_kind}:${a.component_id}:${a.component_role}`, `${b.component_kind}:${b.component_id}:${b.component_role}`));
    for (const version of chain) {
      const versionComponents = allComponents.filter(row => text(row.version_id) === text(version.version_id));
      reconstructTerminal(version, versionComponents, indexes, householdId);
    }
    const facts = reconstructTerminal(terminal, terminalComponents, indexes, householdId);
    result.push({ logicalTransactionId: logicalId, identitySource: 'persisted', lifecycle: text(transaction.lifecycle_status), ...facts,
      terminalVersion: { id: text(terminal.version_id), number: Number(terminal.version_number), operationType: text(terminal.operation_type) },
      components: terminalComponents.map(componentDto), creationEvidence: creationEvidence(transaction), auditSummary: { operationCount: auditChain.length, operations: auditChain }, reconciliationState: terminalComponents.some(row => row.component_kind === 'balance_effect') ? 'typed_effect_linked' : 'not_linked', permittedActions:persistedActions(text(terminal.kind),text(transaction.lifecycle_status),auditChain.length) });
  }
  for (const version of tables.logical_transaction_versions) if (!tables.logical_transactions.some(tx => text(tx.logical_transaction_id) === text(version.logical_transaction_id))) fail('ORPHAN_VERSION', `Version ${version.version_id} has no logical transaction.`);
  for (const version of tables.logical_transaction_versions) if (!usedVersions.has(text(version.version_id))) fail('ORPHAN_VERSION', `Version ${version.version_id} is outside a resolved chain.`);
  for (const component of tables.logical_transaction_components) if (!usedVersions.has(text(component.version_id))) fail('ORPHAN_COMPONENT', `Component ${component.component_kind}:${component.component_id} points outside a resolved chain.`);
  for (const audit of tables.transaction_management_audit) if (!usedAudits.has(text(audit.operation_id))) fail('DUPLICATE_OR_ORPHAN_AUDIT', `Audit ${audit.operation_id} is outside a resolved chain.`);
  return { transactions: result, claimedFacts };
}

function legacyDto(group, tables, indexes) {
  const components = group.proposedComponents.map(item => ({ component_kind: item.componentKind, component_id: item.componentId, component_role: item.componentRole }));
  let date = null, revision = null;
  if (group.kind === 'one_off_payment') date = indexes.payments.get(text(components.find(item => item.component_kind === 'one_off_payment')?.component_id))?.business_date;
  else {
    const rows = components.map(item => indexes.receipts.get(text(item.component_id))).filter(Boolean);
    date = rows[0]?.business_date;
    const proof = group.evidence.find(item => item.type === 'committed_revision'); revision = proof?.committedRevision ?? null;
  }
  const facts = reconstructTerminal({ kind: group.kind, business_date: date, committed_revision: revision || 1 }, components, indexes, text((group.kind === 'one_off_payment' ? indexes.payments.get(text(components.find(item => item.component_kind === 'one_off_payment')?.component_id)) : indexes.receipts.get(text(components[0]?.component_id)))?.household_id));
  return { logicalTransactionId: text(group.logicalTransactionId), identitySource: 'historical_adapter', lifecycle: 'active', ...facts,
    committedRevision: revision === null ? null : Number(revision), terminalVersion: { id: null, number: null, operationType: 'historical_import' }, components: components.map(componentDto).sort((a, b) => compare(`${a.kind}:${a.id}:${a.role}`, `${b.kind}:${b.id}:${b.role}`)), creationEvidence: { availability: 'not_recorded', actorEmail: null, committedAtUtc: null, requestId: null, writeToken: null, committedRevision: null }, auditSummary: { operationCount: 0, operations: [] }, reconciliationState: components.some(row => row.component_kind === 'balance_effect') ? 'typed_effect_linked' : 'not_linked', permittedActions: disabledActions() };
}

export function buildTerminalTransactionReadModel(tables) {
  const expected = [...BACKUP_TABLES].sort(), actual = Object.keys(tables || {}).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual) || BACKUP_TABLES.some(table => !Array.isArray(tables[table]))) fail('INCOMPLETE_INVENTORY', 'Canonical read model requires the complete reviewed table inventory.');
  const identity = resolveIdentityTransactions(tables);
  const preflight = classifyHistoricalRows(tables);
  const indexes = factualIndexes(tables);
  const legacy = [];
  for (const group of preflight.logicalTransactions) {
    const overlaps = group.proposedComponents.filter(item => identity.claimedFacts.has(`${item.componentKind}\0${item.componentId}`));
    if (overlaps.length === group.proposedComponents.length) continue;
    if (overlaps.length) fail('PARTIAL_IDENTITY_OVERLAP', `Historical group ${group.logicalTransactionId} partially overlaps persisted identity material.`);
    legacy.push(legacyDto(group, tables, indexes));
  }
  const transactions = [...identity.transactions, ...legacy].sort((a, b) => compare(a.logicalTransactionId, b.logicalTransactionId));
  const activeTransactions = transactions.filter(item => item.lifecycle === 'active');
  const deletedTransactions = transactions.filter(item => item.lifecycle === 'deleted');
  const ambiguousLegacyItems = preflight.ambiguousLegacyItems.map(item => ({ itemId: item.itemId, relatedItemIds: [...item.relatedItemIds].sort(compare), reasonCode: item.reasonCode, missingDurableEvidence: item.missingDurableEvidence, permittedActions: disabledActions(READ_MODEL_REFUSAL_CODES.AMBIGUOUS_LEGACY_ITEM) }));
  return { format: TERMINAL_TRANSACTION_READ_MODEL_FORMAT, schemaVersion: 1, counts: { activeTransactions: activeTransactions.length, deletedTransactions: deletedTransactions.length, ambiguousLegacyItems: ambiguousLegacyItems.length, balanceObservations: preflight.balanceObservations.length }, activeTransactions, deletedTransactions, ambiguousLegacyItems, balanceObservations: preflight.balanceObservations, exclusions: { nonTransactionItemCount: preflight.nonTransactionItems.length } };
}

export function serializeTerminalTransactionReadModel(model) { return `${JSON.stringify(canonicalize(model))}\n`; }

export async function runTerminalTransactionReadModel(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') fail('DATABASE_UNAVAILABLE', 'D1 binding is unavailable.');
  const target = typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
  const results = await target.batch(BACKUP_TABLES.map(table => target.prepare(`SELECT * FROM "${table}"`)));
  if (!Array.isArray(results) || results.length !== BACKUP_TABLES.length) fail('INCOMPLETE_INVENTORY', 'Database returned an incomplete inventory.');
  const tables = Object.fromEntries(BACKUP_TABLES.map((table, index) => [table, results[index]?.results || []]));
  const model = buildTerminalTransactionReadModel(tables);
  return { model, serialization: serializeTerminalTransactionReadModel(model) };
}
