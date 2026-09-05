import { executeRevisionClaimWrite, FinancialWriteValidationError, statement } from './write-protocol.mjs';

export const CATEGORY_ACTIONS = new Set([
  'addOneOffCategory', 'deactivateOneOffCategory', 'reactivateOneOffCategory'
]);

function fail(message) { throw new FinancialWriteValidationError(message); }
function primary(db) { return typeof db.withSession === 'function' ? db.withSession('first-primary') : db; }

export function normalizeCategoryName(value) {
  if (typeof value !== 'string') fail('Category name is required.');
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 120) fail('Category name must contain 1–120 characters.');
  const nameKey = name.toLowerCase();
  if (nameKey === 'uncategorized') fail('Uncategorized is reserved.');
  return { name, nameKey };
}

function semanticPayload(action, payload) {
  if (!CATEGORY_ACTIONS.has(action)) fail('Unsupported category action.');
  const field = action === 'addOneOffCategory' ? 'name' : 'categoryId';
  for (const key of Object.keys(payload)) {
    if (![field, 'action', 'requestId'].includes(key)) fail(`Unexpected category field: ${key}`);
  }
  if (payload.action !== undefined && payload.action !== action) fail('Category action does not match.');
  if (action === 'addOneOffCategory') return normalizeCategoryName(payload.name);
  if (typeof payload.categoryId !== 'string' || !payload.categoryId || payload.categoryId.length > 200) fail('Choose a category.');
  return { categoryId: payload.categoryId };
}

export async function loadOneOffCategories(db, householdId = 'family') {
  const [result] = await db.batch([
    db.prepare('SELECT category_id,name,name_key,active FROM one_off_categories WHERE household_id=? ORDER BY name_key,category_id').bind(householdId)
  ]);
  return (result.results || []).map(row => ({ ...row }));
}

function categoryPlan(ctx, categories, semantic) {
  if (ctx.action === 'addOneOffCategory') {
    if (categories.some(row => row.name_key === semantic.nameKey)) fail('A category with this name already exists, including inactive categories.');
    const category = { category_id: `${ctx.writeToken}:category`, name: semantic.name, name_key: semantic.nameKey, active: 1 };
    return {
      statements: [statement('INSERT INTO one_off_categories(category_id,household_id,name,name_key,active) VALUES(?,?,?,?,1)', category.category_id, ctx.householdId, category.name, category.name_key)],
      response: { category }
    };
  }
  const previous = categories.find(row => row.category_id === semantic.categoryId);
  if (!previous) fail('Category was not found.');
  const category = { ...previous, active: ctx.action === 'reactivateOneOffCategory' ? 1 : 0 };
  return {
    statements: [statement('UPDATE one_off_categories SET active=? WHERE household_id=? AND category_id=?', category.active, ctx.householdId, category.category_id)],
    response: { category }
  };
}

export async function previewCategoryAction(db, action, payload, householdId = 'family') {
  const semantic = semanticPayload(action, payload);
  const categories = await loadOneOffCategories(primary(db), householdId);
  const plan = categoryPlan({ action, householdId, writeToken: 'preview' }, categories, semantic);
  const { category_id, ...category } = plan.response.category;
  return { ok: true, action, category, categoryId: action === 'addOneOffCategory' ? null : category_id };
}

async function payloadHash(action, semantic) {
  const bytes = new TextEncoder().encode(JSON.stringify({ action, ...semantic }));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function replay(db, householdId, requestId, action, hash) {
  const row = await primary(db).prepare('SELECT action,semantic_payload_hash,response_json FROM new_function_request_receipts WHERE household_id=? AND request_id=?').bind(householdId, requestId).first();
  if (!row) return null;
  if (row.action !== action || row.semantic_payload_hash !== hash) fail('This request ID was already used with different details.');
  return JSON.parse(row.response_json);
}

export async function executeCategoryWrite(db, options) {
  const { householdId = 'family', action, payload = {} } = options;
  const requestId = payload.requestId;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(requestId)) fail('A stable request ID is required.');
  const semantic = semanticPayload(action, payload);
  const hash = await payloadHash(action, semantic);
  const original = await replay(db, householdId, requestId, action, hash);
  if (original) return original;
  try {
    return await executeRevisionClaimWrite(db, {
      ...options,
      householdId,
      planWrite: async ctx => {
        // The financial revision is read before these rows. A concurrent
        // lifecycle change consumes that revision claim and this batch loses.
        const categories = await loadOneOffCategories(primary(db), householdId);
        const plan = categoryPlan(ctx, categories, semantic);
        const response = { ok: true, action, baseRevision: ctx.baseRevision, revision: ctx.nextRevision, writeToken: ctx.writeToken, ...plan.response };
        plan.statements.push(statement(
          'INSERT INTO new_function_request_receipts(household_id,request_id,action,semantic_payload_hash,committed_revision,response_json) VALUES(?,?,?,?,?,?)',
          householdId, requestId, action, hash, ctx.nextRevision, JSON.stringify(response)
        ));
        return plan;
      }
    });
  } catch (error) {
    // Resolve the winner of a same-request race, including a changed base
    // revision. An unrelated SQL failure remains a failure without a receipt.
    const original = await replay(db, householdId, requestId, action, hash);
    if (original) return original;
    throw error;
  }
}
