# Stage 1 Result

## Verdict

Implemented candidate. This stage is not accepted, merged, or deployed.

## Authorization boundary

The owner authorized local application, test, translation, and implementation-documentation edits; local inspections and tests; one local candidate commit; and the Step 2 handoff package. No merge, deployment, D1/R2 mutation, Cloudflare configuration change, dependency change, production repair, historical rewrite, or Step 2 implementation was performed.

## Exact revisions

- Starting SHA: `6f08eb03f9cda40ea2cb357dd4e69a09a3747164`
- Candidate SHA: `7574ce7f5e4b9e87131fe68254fdee42c6a0f0cc`
- Candidate commit: `Fail close unsafe legacy corrections`
- Working tree after candidate: candidate code is committed; the two pre-existing untracked owner specification files remain untouched; this result, the completed ledger, and Step 2 packet are post-candidate handoff artifacts.

## Requirement-to-evidence mapping

| Requirement | Implementation | Exact check | Observed result |
|---|---|---|---|
| Unsafe legacy previews and commits fail before claim | `LEGACY_CORRECTION_ENTITY_TYPES` contains only `salaryCycle`; `previewCorrection` and `planCorrection` share `requireLegacyCorrectionEntityType` | Focused candidate suite under bundled Node 24.19.0 | Disabled balance, obligation-payment, ledger-movement, and Goal previews/commits refused; protected tables and revision remained byte-for-byte equal in tests |
| Unsafe catalog/UI paths absent | Catalog contains only salary cycle; client field definitions for unsafe families removed; entry/dialog renamed | Correction catalog and phone contract tests | Passed |
| Guarded salary correction preserved | Production Worker still dispatches salary-cycle commits to `executeReportingCorrection`; existing preview, stale/missing preview, retry, race, rollback, audit, receipt, restore, and reporting tests retained | Focused candidate suite | 42 passed, 0 failed |
| English/Russian safe explanations | Added immutable-balance and deferred complete-effect explanations, plus Goal settings routing, with Russian translations | Phone and Russian UI contracts | Passed; persisted value localization contract unchanged |
| Phone horizontal-scroll protection | Existing `overflow-x:hidden` contract retained; new explanation list uses bounded width and `overflow-wrap:anywhere` | Phone UI contract | Passed |
| Other financial behavior unchanged | No accounting/schema/configuration changes; complete Slice B/C/D suites exercised creation, mutation, retries, races, rollback, reporting, salary transitions, frozen weeks, backup/restore, and read models | Full candidate regression | 253 passed, 0 failed |

## Changed files

- `cloudflare/slice-c/src/correction.mjs`: shared salary-only legacy correction allowlist and explicit fail-closed messages.
- `cloudflare/slice-c/src/correction-catalog.mjs`: salary cycle is the sole catalog family.
- `assets/v24/v24_1_correction.js`: salary-only dialog and safe alternatives; unsafe client field controls removed.
- `assets/v24/v24_1_i18n.js`: complete Russian copy for the new surface and explanations.
- `assets/v24/v24_1_responsive.css`, `index.html`: safe mobile wrapping, cache bust, and renamed entry.
- Slice A/C/D correction, Worker, phone, localization, and acceptance tests: unsafe positive cases replaced with authorized refusal/zero-write cases; salary and historical interpretation coverage retained.
- `STAGE_1_EXECUTION_LEDGER.md`: contemporaneous evidence ledger.

## Financial invariant review

- Valid creation and read-model reconstruction: covered by the 253-test Slice B/C/D regression with no accounting implementation changes.
- Invalid creation: existing validation suites passed.
- Unsafe legacy mutation: preview and commit fail before the revision-claim batch is constructed; tests compare claims, audit, balance history, obligation payments, ledger movements, and household revision state.
- Retry/concurrency/rollback: guarded salary and other write-family tests passed; disabled requests never create a receipt or claim to replay.
- Reversal/correction: new unsafe balance, obligation, ledger, and Goal corrections are disabled; historical correction rows remain interpreted by existing read-model tests; guarded salary correction remains revision-bound and atomic.
- Ordering/serialization/restore: history-order and portable backup/restore suites passed; no schema or serialization format changed.

## Known limitations and deferred scope

- The standalone Slice A bridge test file stops before its correction section on a pre-existing, unchanged dashboard expectation: it expects `target_not_set` but observes `ready` under Node 24.19.0. It is not reported as passing. Production Worker correction routes have direct passing Slice D coverage.
- Old unsafe planner functions remain in `correction.mjs` as historical implementation behind the audited entry gate, per the Step 1 constraint favoring fail-closed entry validation over broad deletion. Direct planner and main dispatcher tests prove they are unreachable for new requests.
- This candidate does not repair the previously observed production balance history and does not add transaction identity, correction, deletion, restore, or undo behavior.

## Owner gate

The next gate is owner review/acceptance of candidate `7574ce7f5e4b9e87131fe68254fdee42c6a0f0cc`. Deployment requires separate explicit authorization. Step 2 also requires owner acceptance of the controlling transaction-history specification and separate authorization in a fresh chat.
