# Quantity BOQ Trust — Remaining Work

Branch `feat/app-journey`, HEAD `b499961` (equal to `origin/feat/app-journey`), working tree uncommitted. Written 16 Oct 2026; updated the same day after the "Defensible Quantity BOQ + DSR Intelligence" milestone (see `docs/MAJOR-MILESTONE-RESULT.md` and `docs/DSR-IMPLEMENTATION-PLAN.md`). Production facts come from the read-only probes recorded in `docs/TRUSTWORTHY-QUANTITY-TECHNICAL-PLAN.md` §2. The 404 on `boq_commercial_revision` was re-observed today in a read-only browser session.

Evidence labels:
- **[TEST]**: automated test (Vitest, jsdom, mocked or in-memory database).
- **[LIVE-RO]**: real login against production, read-only, with every write blocked.
- **[CODE]**: code reading only.
- **[PGLITE]**: SQL executed on PGlite (real Postgres 16 in-process) against stub `auth`/RLS — not Supabase.

---

## 1. Fixes completed

### Earlier on this branch (Phase 1 and the journey work)

**Shared quantity rule** (`src/lib/quantity.ts`)
- Distinguishes established, confirmed-zero, pending and unavailable quantities.
- Provenance is read only from `basis` and `basis_note`; legacy lines stay "Basis not recorded".
- It drives the BOQ table, workspace panel, BOQ list, live and revision PDF/CSV, the combined project quote, the public-share function and work packages. [TEST]

**No silent provenance loss on save** (`src/lib/provenanceSave.ts`)
- The column-stripping retry fallbacks are gone. A missing column fails with an actionable error.
- Detection is limited to `PGRST204`/`42703`. [TEST]

**Remove and undo** (`src/lib/lineRemoval.ts`)
- Undo restores the complete stored row and re-attaches its set-null links.
- Removal is refused if it would cascade-delete records. [TEST]

**Honest labels**
- Drawing-summary quantities are labelled as the estimator's reading, never a measured take-off.
- Exports state each line's basis. [TEST]

**Journey**
- Five steps, linked blockers, and a return path from the review screen and the BOQ builder.
- Verified end to end against an in-memory database, including Apply (`src/pages/app/JourneyApply.integration.test.tsx`). [TEST], [LIVE-RO] for every non-writing step.

### This pass

| # | Gap (plan finding) | Fix | Evidence |
|---|---|---|---|
| 1 | **F7.** Apply wrote `basis = null` on every applied quantity. That erased the previous basis and labelled a reviewer-checked quantity "Basis not recorded". | Apply records the reviewer's decision as the basis: `REVIEW_VERIFIED` ("Verified in drawing review") or `REVIEW_CORRECTED` ("Corrected in drawing review"), on updated and new lines. A pending result stays `PENDING`. These are new values in the existing text column; no schema change. | `src/lib/review/applyReviewBasis.test.ts` (real `applyReviewPlan`, in-memory DB); journey integration test asserts the stored basis and the label on screen [TEST] |
| 2 | Reviewer corrections to **dimension and specification** were disclosed but written nowhere. | Apply adds them to `boq_line_change_log` beside the qty and unit rows (`field` is free text), for both updated and new lines. | `applyReviewBasis.test.ts` [TEST] |
| 3 | **F2.** Manual quantity and unit edits were last-writer-wins and unaudited, in both the journey BOQ and the builder. Undo could revert another user's later change. | `src/lib/lineEdit.ts`: compare-and-swap on the qty and unit edited from; a change-log row per changed field; failed history insert compensated by a guarded revert. Undo and redo use the same guard. | `ProjectBoq.test.tsx` (conflict, history row, "not recorded" notice, undo refused after a later change); `OpsBoqBuilder.editSafety.test.tsx` (conflict, history row) [TEST] |
| 4 | **F9.** A reviewer note was erased when the item was later verified, marked pending or edited. Decisions overwrote each other. | The note is kept unless a new one is given. Decisions are compare-and-swap on the status the reviewer saw (`ReviewDecisionConflictError`). | `BoqReviewWorkstationVerifyPreservesReviewer.test.tsx`, `src/lib/review/reviewDecisionSafety.test.ts` [TEST] |
| 5 | **F8.** Apply classified against decisions loaded in the browser and did not re-read them. | Before writing, Apply re-reads the decisions (`src/lib/review/reviewDrift.ts`). If any changed, nothing is applied and the screen reloads them. | `BoqReviewWorkstationApplyGate.test.tsx` [TEST] |
| 6 | **F8.** Exports were built from cached lines and could omit another editor's saved change. | CSV is built from a fresh read. PDF opens from the click, then the lines are re-read; if they changed, the user is told to export again. Waiting before opening would risk the pop-up blocker. (`src/lib/exportFreshness.ts`, journey Export and the builder) | `ProjectExport.test.tsx` [TEST] |
| 7 | **F10.** After a failed save, the screen could show a value the database does not hold. | Every failed line write re-reads the lines (journey BOQ, builder). | Covered by the conflict tests above [TEST] |
| 8 | **F11.** The revision diff ignored quantity status and source drawing. | The diff reports "quantity status" and "source" changes. Sources compare by document id and page, so a renamed drawing is not a change. | `src/lib/boqRevision.test.ts` [TEST] |

### Milestone pass (Defensible Quantity BOQ)

| # | Gap | Fix | Evidence |
|---|---|---|---|
| 9 | A counted reviewed quantity was stored as `MEASURED`, so the label could not say how it was taken. | Apply and review-added lines store `COUNTED` for countable units (nos, each, …) and `MEASURED` otherwise. The label combines method and decision: "Counted on drawing, verified in review", "Measured on drawing, corrected in review". | `applyReviewBasis.test.ts`, `applyReviewSourceDocumentIntegrity.test.ts`, journey integration test [TEST] |
| 10 | **P1-1.** No line → evidence link. | `src/lib/lineEvidence.ts` links a line to its reviewed item by the stable `external_key` across all of the BOQ's analysis runs, newest first. It never links by description. Several matches in the newest run are reported as ambiguous unless the line's document picks one. The BOQ table's "Evidence" row (`LineEvidencePanel`) shows the decision, extracted and corrected values, "changed since review", the stored calculation (`computeCalculation` or the analysis's verbatim text; never reconstructed), reviewer notes and a link that opens the drawing with the measured region drawn. No migration. | `lineEvidence.test.ts` (9), `ProjectBoq.test.tsx`, `ProjectDrawings.test.tsx` [TEST] |
| 11 | **P1-4.** Description, section, included and cost edits were last-writer-wins and unrecorded. | `saveLineEdit` guards every edited field (value compare-and-swap) and writes a history row per changed field; all journey-BOQ and builder non-rate edits go through it. | `ProjectBoq.test.tsx`, `OpsBoqBuilder.editSafety.test.tsx` [TEST] |
| 12 | **P1-3.** Review decisions kept no history. | Each guarded decision also inserts a `boq_line_change_log` row (`field "review_decision"`, from → to, with the note and `changed_by`). The reviewer is told when history could not be recorded. | `reviewDecisionSafety.test.ts` [TEST] |
| 13 | **P1-2 / D3.** Frozen revision lines had no basis. | Follow-up deferred migration `20261007000000_boq_commercial_revision_provenance.sql`: `basis`/`basis_note` on revision lines; the freeze function copies them and refuses a stale status or basis. The revision diff compares basis only when the frozen line recorded one, so older revisions never show an invented change. | `boqRevisionProvenanceMigration.test.ts` [TEST]; applied twice (idempotent) after `20261006000000` and `20260921000000`, frozen line keeps COUNTED/REVIEW_VERIFIED/note, frozen line update refused, stale status and stale basis refused, an older client without basis still freezes [PGLITE] |
| 14 | Accepted DSR-check work, and every pending line, lost its schedule code in the export. | Pending rows in CSV and PDF carry the line's code; no quantity, rate or amount. | `boqDsrDocument.test.ts`, `DsrCheck.integration.test.tsx` [TEST] |

**Verification of the earlier pass**
- Full Vitest suite: 220 files, 2,563 tests, all passing.
- `tsc -p tsconfig.app.json`: 433 errors, the same error signatures as the starting commit (459 there).
- ESLint: 202 problems (180 errors, 22 warnings), identical per file and rule to the starting commit.
- `vite build`: passes.
- Read-only production session: every journey step renders, with 0 write attempts [LIVE-RO].

---

## 2. Remaining blockers

### P0 — must be decided before the BOQ can be called trustworthy in production

**P0-1. `boq_line_change_log` does not exist in production.**

Consequences until it exists:
- Apply's history inserts fail. Apply already reports "change history NOT recorded".
- Manual quantity edits save but are not recorded; the user is told so.
- Manual rate edits are refused outright (`audit_unavailable`).
- Review decisions and DSR-check decisions save, but are not recorded in history; "Use schedule rate" is refused (fails closed).
- The dimension and specification corrections from fix 2 are lost.

See decision D1.

**P0-2. The public share link still runs the old `workspace-share` function.**

Until the updated function is deployed:
- A line marked PENDING that has a number typed in is priced, and included in the share link's totals.
- The share page shows no quantity basis.

The frontend handles both old and new responses. This is a deployment decision, not a migration: deploy `supabase/functions/workspace-share`, then run acceptance criterion D1-c.

### P1

- **P1-1. Line ↔ evidence region.** **Resolved without a migration** (fix 10). Remaining: lines created before `external_key` was written, and lines added by hand, have no evidence, and say so.
- **P1-2. Revision snapshots.** Basis fidelity is **prepared** (fix 13), not deployed. The revision tables are still not in production, so freezing a revision is unavailable there. See D3.
- **P1-3. Review decision history.** **Resolved in code** (fix 12); effective once `boq_line_change_log` exists (P0-1). The item row still holds only the current state.
- **P1-4. Concurrent edits to other line fields.** **Resolved with value compare-and-swap** (fix 11). A change to a field the person did not edit (e.g. a rate changed while they edit the description) is not a conflict; a row version (D5) would make it one.

### P2

- **P2-1. Lines Apply updated before this change are labelled "Basis not recorded".**
  - Today: any line Apply changed before this change has `basis = null`.
  - Recovering their basis needs change-log rows that production never kept, so it cannot be done safely. Leave them unknown unless a reviewed backfill is approved.
- **P2-2. `setLineQty` clears the basis.** **Resolved (closure sprint, WS-A):** it writes `MANUAL` and COUNTED/MEASURED, and refuses negative or NaN. Still unguarded (no compare-and-swap) and writes no history row: its caller, `BoqAuditReview.tsx`, would need to pass the line's current values.
- **P2-3. The Workspace panel's "Reviewed" badge swallows query errors.** **Resolved (WS-E):** a failed read is stated, and no badge is shown.
- **P2-4. Indicative costing (DSR mapping) keeps its own pending rule.** **Resolved (WS-E + integration):** it uses `quantityEstablished`, and `useDsrMapping` now reads `basis`, with fallbacks for older databases.
- **P2-5. The PDF stale check only warns.** **Resolved (WS-E + integration):** the journey Export and the builder both open the tab from the click, then fill it from a fresh read of lines and spec. A failed re-read produces no document.
- **P2-6. "Last Apply" is recorded only in the browser tab.**
  - Today: the journey cannot show whether a review was applied once that tab is gone (sessionStorage). The note says "in this browser tab"; re-applying is harmless (WS-A).
  - Open: a durable applied marker needs a schema change.

---

## 3. Migration-dependent decisions and acceptance criteria

No migration has been applied. Each item names the operator decision, prerequisites, rollback and acceptance criteria.

### D1 — Deploy `boq_line_change_log` (existing migration `supabase/migrations/20260921000000_boq_review_apply.sql`)

- **Decision:**
  - (a) Apply the existing migration to production.
  - (b) **Decided (closure sprint):** see `docs/closure/B-audit-policy.md`. While the table is absent, edits are saved and the user is told they are not recorded, removal is refused, and rates are refused. Once the table exists, a failed history insert is reverted.
- **Prerequisites:**
  - verified backup;
  - applied first to staging;
  - RLS confirmed: staff manage, project owners read.
- **Rollback:** the table is additive with `on delete set null` references, and nothing reads it as required. Dropping it returns to today's behaviour, but loses the history written since.
- **Acceptance criteria:**
  - D1-a. Apply on a staging BOQ writes `qty`/`unit`/`line_created` rows, plus a `dimension` row for a corrected dimension. The receipt shows no "history not recorded" warning.
  - D1-b. A manual quantity edit in the journey and in the builder writes one `qty` row each, with `changed_by` set. A rate edit is no longer refused.
  - D1-b2. Removing a line writes `line_removed` (`old_value` holds the full row), and Undo writes `line_restored`. A manual add writes `line_created` + `qty` + `unit`. Removal is no longer refused.
  - D1-b3. Review and DSR-check decisions write `review_decision` / `dsr_scope_decision` rows. "Use schedule rate" is no longer refused.
  - D1-c. Deploy the updated `workspace-share` function (P0-2). On a staging share link:
    - a line marked PENDING with qty > 0 shows "Quantity pending", has no amount, and is excluded from Subtotal and Grand Total;
    - each line shows its basis.
  - D1-d. A conflicting edit from a second session on staging is refused with "changed elsewhere", and the database keeps the second session's value.

### D2 — Evidence region on the line — **done without a migration** (fix 10)

- **Decision:** either
  - read the region through `boq_line_change_log.review_item_id` → `analysis_review_item.ai_json.source.evidence` (no new column), or
  - add `boq_line.source_region jsonb` (page, bbox, review_item_id), written by Apply.
- **Recommendation:** the first; it needs no new migration beyond D1.
- **Outcome:** neither was needed. The link uses the stable `external_key` the line already carries.
- **Acceptance:** a line created or updated by Apply opens the drawing at its page with the evidence box highlighted. A line edited manually afterwards shows its basis as "Changed manually", not the evidence as current.

### D3 — Revision snapshot fidelity — **migration prepared**: `supabase/deferred-migrations/20261007000000_boq_commercial_revision_provenance.sql` (follow-up; `20261006000000` is not edited)

- **Decision:** before the first production apply, add `basis text` and `basis_note text` to `boq_commercial_revision_line`. Either edit the deferred file, since it has never been applied, or add a follow-up migration, which is the CLAUDE.md convention. Have `create_boq_commercial_revision` copy both columns from `p_lines`.
- **Prerequisites:** D1; a decision on how the deferred revision feature reaches production.
- **Rollback:** additive columns; a revision frozen without them exports with "This document does not state the basis…" (the current behaviour).
- **Acceptance:**
  - a revision frozen on staging re-exports PDF and CSV with the same per-line basis as the live export at freeze time;
  - the revision diff shows a status, source or quantity change against the working BOQ.

### D4 — Review decision history — **done through the change log** (fix 12); a separate table is not needed

- **Decision:** add `analysis_review_decision` (item id, status, reviewer values, flag reason, note, decided_by, decided_at), inserted alongside each guarded decision. Alternatively, keep only the current-state row as today.
- **Acceptance:** an item verified, then flagged, then corrected shows all three decisions with who and when, and the current state is unchanged.

### D5 — Row version for concurrency

- **Decision:** add `boq_line.updated_at timestamptz not null default now()`, plus a trigger to bump it, and guard every line write on it instead of on values.
- **Rollback:** drop the trigger and column; value-based guards keep working.
- **Acceptance:** two sessions editing different fields of the same line: the second write is refused with "changed elsewhere", including description and section edits.

---

## 4. Explicitly unverified

- **Guarded writes against real Postgres/PostgREST with RLS.**
  - The new compare-and-swap paths for manual edits, undo and review decisions run only in tests.
  - They reuse the guarded update Apply already uses (`applyReviewQtyUnit`) [CODE]. There is no evidence that a guarded update has run against production.
  - An update that RLS filters out returns zero rows and would be shown as "changed elsewhere", not as a permission error.
- **Change-log inserts from manual edits and correction rows.** The table is absent in production, and no staging run was done.
- **`REVIEW_VERIFIED`/`REVIEW_CORRECTED` written by a real Apply.** Proven only in tests and the in-memory journey. No Apply was run on production data, by design.
- **Two real users editing concurrently.** Simulated only.
- **The updated `workspace-share` function.** Not deployed; its handler is tested under Vitest only, and there is no Deno type check.
- **PDF pop-up behaviour after the post-open re-read** in Safari or Firefox.
- **Contractor (non-staff) access to any of these write paths.** Not exercised.
- **The milestone's evidence linkage on production data.** Lines in production that predate `external_key`, or were created by hand, will show no evidence; the share of such lines is unknown.
- **Schedule check (DSR) on real BOQs.** Matching thresholds were tuned on the real DSR 2023 schedule with constructed line descriptions, not on real project BOQs. See `docs/DSR-IMPLEMENTATION-PLAN.md` §8.

---

## 5. Deployment order (prepared, not executed)

No step below has been run. Each needs explicit approval, a verified backup, and staging first. No staging credentials exist in this environment, so none of it has been tried on staging.

1. **Change log** — `supabase/migrations/20260921000000_boq_review_apply.sql`, following `docs/audit-history-deployment.md`. This unlocks: history for Apply, edits, review decisions and DSR-check decisions; manual and schedule rate edits; the dimension and specification correction rows. Acceptance: D1-a, D1-b, D1-d.
2. **`workspace-share` function** — deploy `supabase/functions/workspace-share` (P0-2). Acceptance: D1-c.
3. **Revision feature, only when it is approved for production** — the deferred Stage 3–6 set per `supabase/deferred-migrations/README.md` and `docs/staging-validation-stage3-6.md`, including `20261006000000` immediately followed by `20261007000000`. `npm run staging:migrate` applies them in order. Acceptance: D3.

Rollback for each is in §3 and in the runbook.
