# Historical Transaction Refusal UX Failure Report

**Report date:** 14 September 2026 (Asia/Bangkok)  
**Environment:** Production  
**Application:** Family Cash Flow  
**Exact deployed commit:** `a3c4c3c1c7fc39962387c5fa3e5ef6eebfffc0e5`  
**Worker version:** `f40d7ee2-8938-4202-b3f3-6fb3faf45507`  
**Production deployment:** `8aa6b399-df1e-4565-99a0-8a2c6408ba8f`  
**Evidence supplied:** `codex-clipboard-89077a04-fb44-4725-a4dd-a75db1411568.png`

## Executive summary

Production exposes the internal refusal code `MANAGEMENT_NOT_ENABLED_STEP_7` directly to a household user when an unmodifiable historical transaction is opened. The same detail view also exposes a large raw JSON structure when **Technical details** is expanded.

The underlying refusal is intentional and financially safe. The selected record is a historical one-off payment reconstructed by the historical adapter rather than a transaction created under the new durable identity model. It has no persisted terminal version, so correction, deletion, restoration, and undo are disabled. This prevents the application from guessing relationships or rewriting historical accounting.

The failure is therefore not lost data, a failed migration, or an incorrect accounting result. It is a production UX, localization, and abstraction-boundary defect: an internal implementation code is rendered as the primary explanation instead of a plain-language refusal reason. The screenshot also demonstrates that technical implementation details can dominate the household-facing transaction view once expanded.

## Severity and classification

**Recommended severity:** P2 / Medium  
**Failure class:** User-facing error handling, localization, and information architecture  
**Financial integrity impact:** None observed  
**Data-loss impact:** None observed  
**Availability impact:** None  
**Mutation safety:** Working as designed

The defect does not permit an unsafe write. Its risk is that a non-technical household user cannot understand why the transaction is view-only and may interpret the code as corruption, incomplete deployment, or a broken transaction. This is especially concerning in financial software, where unexplained technical states weaken confidence in otherwise correct balances and history.

## Observed behavior

The supplied production screenshot shows the transaction **Olga residence certificate**, dated `2026-09-10`, amount `500.00 THB`, paid from Alex.

The transaction detail correctly shows:

- the transaction description, date, kind, and amount;
- the financial consequence, `500.00 THB leaves Alex`;
- the allocation, `Alex 500.00 THB`;
- no correction, deletion, restoration, or undo controls.

The view then renders the bare token:

`MANAGEMENT_NOT_ENABLED_STEP_7`

When **Technical details** is expanded, the page displays raw fields including:

- a generated `historical:one-off-payment:...` logical transaction identifier;
- `terminalVersion.id: null`;
- `terminalVersion.number: null`;
- `terminalVersion.operationType: historical_import`;
- component kinds, identifiers, and roles;
- balance-effect component `131`.

## Expected behavior

The transaction should remain view-only. The application must not add management controls or infer a durable transaction identity merely to remove the refusal.

Instead of the internal token, the primary view should provide a localized household explanation, for example:

> This historical transaction is view-only because it was recorded before safe transaction management was available. Its amount and account history remain unchanged.

The Russian surface should show an equivalent explanation in Russian. The explanation should state the safe consequence and, where useful, the alternative action. It must not imply that the record is corrupt or invite the user to modify a different factual record to force reconciliation.

Technical details may remain available behind an explicitly collapsed disclosure, but their presentation should be secondary to the household explanation and should use stable labels rather than requiring the user to interpret raw JSON.

## Reproduction

1. Open the production Family Cash Flow application.
2. Sign in with an approved Google account.
3. Open **Position**.
4. Open **Move money** / **Accounts & records**.
5. Open **Transaction history**.
6. Select a transaction whose `identitySource` is `historical_adapter`, such as **Olga residence certificate**.
7. Observe the text below **Financial consequences**.
8. Expand **Technical details**.

**Actual result:** the raw refusal code is shown, and the expanded section is a raw JSON dump.  
**Expected result:** a localized household-language refusal explanation is shown; technical data remains clearly secondary and interpretable.

## Exact-code evidence

All code findings below were read at deployed commit `a3c4c3c1c7fc39962387c5fa3e5ef6eebfffc0e5`.

### 1. The backend intentionally assigns the internal code

`cloudflare/slice-d/src/terminal-transaction-read-model.mjs` defines:

```js
MANAGEMENT_NOT_ENABLED: 'MANAGEMENT_NOT_ENABLED_STEP_7'
```

The same module reconstructs historical transactions with:

```js
identitySource: 'historical_adapter'
terminalVersion: { id: null, number: null, operationType: 'historical_import' }
permittedActions: disabledActions()
```

This proves that the screenshot represents the designed historical-adapter path, not a missing post-migration identity row for a newly created managed transaction.

### 2. The frontend prints refusal codes verbatim

`assets/v24/v24_1_history.js` builds the transaction detail with:

```js
(actions.refusalCodes || []).join(', ')
```

There is no mapping from stable internal reason code to user-facing English or Russian copy at this rendering boundary. Consequently, `MANAGEMENT_NOT_ENABLED_STEP_7` is inserted directly into the page.

### 3. The frontend renders technical data as raw JSON

The same function renders:

```js
JSON.stringify({
  logicalTransactionId: t.logicalTransactionId,
  terminalVersion: t.terminalVersion,
  components: t.components,
  creationEvidence: t.creationEvidence,
  audit: t.auditSummary
}, null, 2)
```

The disclosure is correctly placed after financial consequences, but its contents are implementation-oriented rather than a formatted technical summary.

### 4. Existing tests lock the code but miss the presentation failure

`cloudflare/slice-d/test/transaction-management-protocol.test.mjs` explicitly asserts the value `MANAGEMENT_NOT_ENABLED_STEP_7`. That is valid as a protocol-level assertion, but it does not prove that the UI translates the code before display.

The current UI contract tests assert ordering and the presence of transaction-management surfaces. They do not assert that every possible refusal code is mapped to localized household copy or that unknown codes fail closed with a generic explanation.

## Requirement conflict

The deployed behavior conflicts with the accepted Stage 16 UI requirements at the same commit:

- `STAGE_16_PHONE_DESKTOP_EN_RU_COMPLETION_TASK_SPEC.md` requires every warning, error, dynamic impact, and refusal to be available in English and Russian.
- It requires desktop and phone to preserve identical terminology, permissions, eligibility, refusal reasons, and financial results.
- It requires financial consequences to precede expandable technical details.

The ordering requirement is satisfied. The permission and safety semantics are satisfied. The localized refusal requirement is not satisfied because the internal token is neither household English nor Russian.

## Root cause

The read model correctly separates a stable machine-readable refusal code from the permission booleans. The frontend, however, treats `refusalCodes` as display strings rather than protocol identifiers.

The root cause is a missing presentation-layer translation boundary:

1. `disabledActions()` returns a stable internal code.
2. The transaction-history response carries that code to the browser.
3. `renderTransactionDetail()` joins and prints the code without mapping it.
4. The localization dictionary is bypassed because the dynamically inserted token has no household-language source string.
5. Automated tests verify the internal code and broad UI structure but not the rendered explanation for each refusal family.

The raw JSON concern has a related cause: the technical disclosure was implemented as direct serialization of the domain transfer object instead of a deliberately designed diagnostic summary.

## Scope of affected records

The defect is not limited to the pictured payment. At this commit, every transaction produced through `legacyDto()` receives `disabledActions()` and therefore the same management refusal code. The Stage 18 production verification classified 20 historical logical transactions and 28 ambiguous legacy items. The 20 reconstructed historical transactions are the primary population expected to display this exact code when opened.

Ambiguous legacy items use a different refusal code, `AMBIGUOUS_LEGACY_ITEM`. Any UI path that prints their `refusalCodes` with the same renderer is vulnerable to the same class of leakage.

New transactions with persisted identity and valid terminal versions are a different population. Their permitted actions are derived by transaction family and lifecycle and should not be relabeled as historical merely because this defect exists.

## Financial and operational impact

### Confirmed unaffected

- The payment remains present in Transaction history.
- Its amount, date, description, and Alex allocation are readable.
- No unsafe management action is offered.
- Historical accounting rows are not rewritten or attached to guessed identities.
- The Stage 18 dashboard baseline and historical reconstruction remained unchanged after migration and deployment.
- The production database passed foreign-key checks.

### User impact

- A household user sees an unexplained engineering token.
- The token refers to an obsolete delivery-stage name (`STEP_7`), making the current production deployment appear incomplete even though later stages were deployed.
- The user cannot tell whether the restriction is intentional, temporary, or evidence of corruption.
- The raw component dump exposes internal concepts that do not help with a daily spending decision.
- In Russian mode, the refusal remains untranslated.

### Risk if fixed incorrectly

The most dangerous incorrect response would be to make historical transactions editable by attaching them to new identity rows or guessing relationships. That would violate the historical-preservation and ambiguity rules and could rewrite factual balances or audit meaning.

This report does not recommend any data migration, factual repair, historical attachment, or management enablement.

## Recommended remediation

### Required

1. Add a presentation-layer mapping from every supported refusal code to concise English and Russian household copy.
2. Map `MANAGEMENT_NOT_ENABLED_STEP_7` to wording that explains historical view-only status without mentioning implementation stages.
3. Map `AMBIGUOUS_LEGACY_ITEM` separately so it explains missing durable relationship evidence rather than using the generic historical message.
4. Provide a safe generic fallback for unknown refusal codes. Log or retain the machine code in technical details, but never render it as the primary message.
5. Keep all management actions disabled for historical-adapter transactions.
6. Replace the raw technical JSON presentation with a structured, collapsed diagnostic summary, or clearly label the raw form as developer information.

### Suggested user-facing copy

**English — historical reconstructed transaction**

> This historical transaction is view-only because it was recorded before safe transaction management was available. Its financial history remains unchanged.

**Russian — historical reconstructed transaction**

> Эта историческая транзакция доступна только для просмотра, потому что она была записана до появления безопасного управления транзакциями. Её финансовая история не изменена.

**English — ambiguous legacy item**

> This historical item is view-only because the application cannot prove all records that belong to the same transaction.

**Russian — ambiguous legacy item**

> Эта историческая запись доступна только для просмотра, потому что приложение не может достоверно определить все записи, относящиеся к одной транзакции.

## Acceptance criteria for a future fix

The defect should be considered fixed only when all of the following are proven at one exact candidate SHA:

1. No raw refusal code is visible in the normal English or Russian transaction-detail UI.
2. `MANAGEMENT_NOT_ENABLED_STEP_7` produces the approved historical view-only explanation in both languages.
3. `AMBIGUOUS_LEGACY_ITEM` produces its distinct approved explanation in both languages.
4. An unknown refusal code produces a safe localized fallback and remains visible only in technical diagnostics.
5. Historical-adapter transactions still expose no correct, delete, restore, or undo controls.
6. The server still refuses direct or stale-client mutation attempts with zero writes.
7. Newly created persisted transactions retain their correct family-specific management actions.
8. Financial consequences remain before technical details on phone and desktop.
9. Technical details are collapsed by default and contain no household-facing instruction to manipulate raw identifiers.
10. English and Russian screenshots or browser assertions cover both historical and ambiguous refusal states.
11. The complete Slice B/C/D regression passes without changing migrations, historical rows, or acceptance rules.
12. Production deployment, if later authorized separately, confirms the same behavior without synthetic financial writes.

## Evidence gaps and limits

- The screenshot proves the visible defect for one reconstructed historical one-off payment.
- Exact-SHA code proves that the same rendering mechanism applies broadly to historical-adapter refusal codes.
- This report does not assert that balance row `131` is factually wrong. It appears only as a linked component in the supplied technical details.
- This report does not authorize code changes, data repair, migration, deployment, or historical identity attachment.

## Final assessment

The production system is protecting historical accounting correctly but explaining that protection incorrectly. The correct remediation is a narrow presentation and localization change with stronger refusal-rendering tests. The safety lock must remain in place, and no historical financial data should be rewritten as part of the fix.
