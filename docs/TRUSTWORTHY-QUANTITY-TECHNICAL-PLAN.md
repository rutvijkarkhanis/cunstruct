# Trustworthy Quantity BOQ — Technical Investigation and Plan

**Question this plan answers:** can a contractor inspect a BOQ line, understand where its quantity came from, verify it, safely correct it, and rely on the saved result?

**Short answer today: no, for most lines.**
- **Where it came from:** recorded for 18 of 1,111 production lines (1.6%).
- **Verifiable from evidence:** only those 18 have even a drawing reference, and none can show the specific region in the BOQ journey.
- **Safe correction:** manual quantity corrections leave no record and can silently overwrite each other.
- **Provenance is dropped on the way out:** the shared link, the workspace panel and the frozen revision each discard most of it.

Much of the needed data already exists, either in the review items or in unused columns. The first useful slice therefore needs no database migration.

This is an investigation; nothing was implemented. Database access was read-only (§1.3).

---

## 1. Verified repository and environment snapshot

### 1.1 Repository

| Item | Value |
|---|---|
| Branch | `feat/app-journey` (tracking `origin/feat/app-journey`) |
| HEAD at start | `672afc6dfe0895a9e607cd1f2a538b960422bc5e` — matches `origin/feat/app-journey` |
| `main` | `66fcd15cbd4c8e6dee651f954a137215d8bdf9c4` ("V1 release candidate") |
| Worktree | clean at start; no stashes, a single worktree |
| Migrations | 45 in `supabase/migrations/` (latest `20261002000000`); 4 held in `supabase/deferred-migrations/` (`20261003`–`20261006`) |
| Relevant recent commits (this branch) | `d10e0ba` builder edit safety (negative qty refused, revert on failed save, no undo step for failed writes, load-error state); `e9a4b5d` internal section name kept out of exports; `7c124b3` live export moved to `lib/boqLiveExport`; `426f35a` shared `quantityEditPatch`; `0cfc581` Apply blocked until review finished + receipt; `672afc6` UX audit (`docs/UX-UI-AUDIT.md`) |

`docs/UX-UI-AUDIT.md` was read. Its headline finding, "a quantity cannot be defended from inside the product", is confirmed and quantified below. Its statement that "revisions and rate audit are unavailable on this database" is refined in §5.

### 1.2 Evidence classes used in this document

- **[LIVE]** — observed against the production database through read-only probes (§1.3) or in the live app with writes blocked (UX audit, 16 Oct 2026).
- **[CODE]** — verified by reading the code at HEAD; the file and function are cited.
- **[TEST]** — covered by an existing automated test (cited).
- **[RISK]** — a code-level hazard whose triggering conditions were not observed.
- **[UNVERIFIED]** — an assumption not yet checked.

### 1.3 Read-only production probes (16 Oct 2026)

I signed in as the configured ops test account through the auth API. I then used:
- `GET /rest/v1/<table>?select=<cols>&limit=0` to test existence, returning no rows;
- paginated `GET` reads of selected `boq_line`, `analysis_run` and `analysis_review_item` columns, aggregated locally to counts only. No row contents were printed or kept.

No database writes, migrations, RPC calls or storage changes were made. The scripts live outside the repository, in the session scratchpad.

---

## 2. Production ground truth [LIVE]

### 2.1 Schema presence

| Object | Present in production? |
|---|---|
| `boq_line` columns `basis, basis_note, drawing, measurement_method, quantity_status, external_key, scope_id, source_document_id, source_revision_id, source_page, calculation, confidence` | **All present** |
| `analysis_run` (+ `resolved_document_id`, `mode`, `contract_version`), `analysis_review_item`, `analysis_run_source` (+ `mode`, `boq_id`), `analysis_observation`, `document_revision.content_hash`, `boq_document.analyzed_revision_id`, `boq_audit_finding.signal_key`, `project_scope` | Present |
| `boq_line_change_log` (`20260921000000_boq_review_apply.sql`, in `migrations/`) | **Absent** (PGRST205) |
| `scope_module` (`20260910000000_scope_taxonomy.sql`, in `migrations/`) | **Absent** |
| `boq_line_dsr_mapping`, `boq_line_rate_evidence`, `boq_line_rate_adoption`, `boq_commercial_revision`, `boq_commercial_revision_line` (`deferred-migrations/`) | Absent (by design: deferred) |
| Identity unique indexes from `20260929000000` | **Unverified** — indexes are not visible through REST; `docs/audit-history-deployment.md` §2d gives the SQL check |

### 2.2 Data (counts only)

`boq_line`: **1,111 rows across 27 BOQs.**

| Breakdown | Rows |
|---|---|
| `source = auto` (column default; nothing in current code writes it) | 862 |
| `source = manual` | 249 |
| `basis = DRAWING_INPUT` (operator's drawing summary, e.g. "Five WC symbols visible.") | 681 |
| `basis = DSR_AOR` (DSR coefficient-derived) | 143 |
| `basis = HEURISTIC` (archetype / built-up-area assumption) | 34 — **11 included and priced**, in 6 BOQs |
| `basis = DRAWING_DERIVED` | 4 |
| `basis = Counted` (free-text basis from pasted evaluation JSON) | 18 |
| `basis = PENDING` | 15 (all with qty 0) |
| `basis` null | 216 |
| `quantity_status` set (`MEASURED`) | 18; **1,093 are null** |
| `measurement_method`, `calculation` or `confidence` set | **0** |
| `external_key` / `source_document_id` / `source_revision_id` / `source_page` set | 18 / 18 / 18 / 15 — all 18 are lines created by review Apply (section "Drawing review — added") |
| positive qty with no `quantity_status` | 1,078 |
| negative qty / duplicate (boq, external_key) | 0 / 0 |

The meaning of the `basis` vocabulary comes from the comment in `20260810120000_boq_line_basis.sql`. **No current source file writes `DRAWING_INPUT`, `DSR_AOR`, `HEURISTIC` or `DRAWING_DERIVED`.** These rows came from a generator that no longer exists in this tree. Its history was not found with `git log -S` [UNVERIFIED].

Analysis data:
- `analysis_run`: 13 runs (6 `json_import`, 7 `ai_api`).
- `analysis_review_item`: 93 items — 90 with evidence boxes, **85 with quantity-claim evidence**, 76 with `pageSize`, 14 with structured `calculationData`, 0 with free-text `calculation`. Statuses: 70 PENDING_REVIEW, 16 VERIFIED, 5 EDITED, 2 FLAGGED.

**What this means:**
- Region-level evidence exists, but only on review items, which feed 1.6% of lines.
- 78% of lines are generator output whose only provenance is the `basis` code and `basis_note` text. Neither is shown in the BOQ journey, the share link or any export.

---

## 3. The quantity lifecycle, traced through the code

Each stage lists what exists, where it is persisted, and whether it survives to the next stage.

| # | Stage | What exists | Persisted where | Survives to the BOQ line? | Notes |
|---|---|---|---|---|---|
| 1 | Drawing ingestion | file, page count, page titles, content hash, revision | `project_document`, `document_revision`, storage `project-drawings` | doc and revision ids, as references | `useDocumentManagement.uploadOnePdf`; `drawingStorage.ts`. The page count is correct (verified live: stored 4 = pdf.js 4) |
| 2a | AI / JSON extraction (review route) | key, item, quantity or null, unit, dimension, specification, location, confidence, `aiStatus` (MEASURED/INFERRED/PENDING), `source{documentId, page, pageSize, evidence[{bbox, page, claim}]}`, `calculation` text, `calculationData{formula, inputs}`, `candidates[]` | `analysis_review_item.ai_json` (immutable after creation; `reviewStore.createAnalysisRun`) | **Partly**: only qty, unit, document, page, revision | `analysisSchemaV1.ts` `AnalysisItemV1`; analysed revision recorded in `analysis_run_source.document_revision_id` |
| 2b | Pasted evaluation JSON (no review) | description, qty, unit, basis text, status, method, external_key | written directly to `boq_line` | yes, unreviewed | `boqEvalJson.evalLinesToRows` (`source: "manual"`), `OpsBoqBuilder.addFromJson`, `ProjectBoqs.insertEvalRows`. **No evidence, no review step** |
| 2c | Spreadsheet import | description, qty, unit, rate | `boq_line` | yes | `ProjectBoqs` import (`source: "manual"`); no status or basis |
| 2d | Legacy generator | qty with `basis` code and `basis_note` | `boq_line` (`source` defaults to `auto`) | yes | No current writer (§2.2) |
| 3 | Formula / assumptions | `calculationData` (6 formulas: `SUM_OF_SEGMENTS`, `LENGTH_TIMES_WIDTH`, …, `UNIT_CONVERSION`); `measurementValidator` / `calculationAdvisory` verdicts | `ai_json` only | **No** — `boq_line.calculation` exists but is never written | No deductions, wastage or rounding policy (`measurementValidator.ts` header: "deduction rules … explicitly out of scope"; `ROUNDING_POLICY_UNRESOLVED`). Calculation inputs carry no per-input evidence |
| 4 | Review | status (PENDING_REVIEW / VERIFIED / EDITED / FLAGGED / MARKED_PENDING), reviewer values (qty, unit, dimension, specification, location), flag reason, note, reviewer, time | `analysis_review_item` columns; the AI values stay in `ai_json` | Only the effective qty and unit, through Apply | `reviewStore.saveReviewDecision` is an **unconditional update** (no compare-and-swap, no decision history). The original AI value is preserved (good) |
| 5 | Apply | classification (APPLY / NEW_LINE / NO_CHANGE / AMBIGUOUS / CANNOT_APPLY / …), field changes, freshness and provenance gates, CAS on qty and unit | `boq_line`; `boq_line_change_log` (with `review_item_id`) | qty, unit; `quantity_status` = `MEASURED` or `PENDING`; source doc, revision and page; `external_key`; `basis_note` = "Added from drawing analysis review"; `source = "manual"` | `applyReview.applyReviewPlan`, `applyFinding.addReviewItemAsLine` / `applyReviewQtyUnit`. **In production the change log is missing, so the line-to-review-item link is not persisted at all** |
| 6 | Manual correction | new qty, unit, description, section, included, rate | `boq_line` | — | Rates: CAS + change log, fail closed (`manualRateEdit.applyManualRateEdit`). **Everything else: unconditional update, no log** (`OpsBoqBuilder.updateLine`/`applyLinePatch`, `ProjectBoq.save`) |
| 7 | Undo | builder session ledger; journey session stack | memory only | — | Builder undo replays `backward` unconditionally; journey undo writes the inverse unconditionally |
| 8 | Revision freeze | the snapshot line: qty, `quantity_status`, `source_line_id`, source doc, name and page, detailed rate provenance and adoption, limitations | `boq_commercial_revision_line` (deferred; absent in production) | — | Freeze re-reads fresh lines (`OpsBoqBuilder`, `groupSubheads(freshLines)`). **No `basis`, `basis_note`, origin, `source_revision_id` or review-item reference** |
| 9 | Live export (PDF/CSV) | qty, unit, rate, amount, source document, source page, pending section, unfinished-review count, incomplete-scope notice | file | — | `lib/boqLiveExport` + `boqDsrDocument`. **No basis or origin**; uses cached lines (§4.8) |
| 10 | Workspace panel / share link | qty, unit, rate, amount, totals | screen / public page | — | Its own copies of the amount and commercials formulas **without the pending rule**; share returns no status, basis or source (§4.5) |

### 3.1 Capability matrix (what the architecture supports today)

| Capability | Supported? | Evidence |
|---|---|---|
| Source classification (measured / counted / extracted / manual …) | **No, as recorded data.** It can only be *inferred* from indirect signals: the `basis` code, `quantity_status`, `external_key` + source document, the "Drawing review — added" section, the `basis_note` text | `source` is constrained to `auto`/`manual` (`20260803120000_boq_module.sql`). Apply, JSON import, spreadsheet import and manual add all write `"manual"` (`applyFinding.ts:176,263`, `boqEvalJson.ts:354`, `ProjectBoqs.tsx`). Apply stamps every non-pending quantity `MEASURED`, even counts and reviewer-typed values (`applyReview.ts:853`, `applyFinding.ts:260`) |
| Drawing page reference | Yes, for review-applied lines (18) | `source_document_id/revision_id/page` |
| Precise region reference | **Exists in `ai_json`, not linked to lines.** The line has no review-item id; the only persisted link is the change log's `review_item_id`, which is absent in production. `external_key` can be matched to a run's item key, but that is an inference — the key may be reused across runs, and run selection is "latest" | `applyReview.ts`, `WorkspaceBoqPanel.tsx` ("Reviewed" badge relies on the change log) |
| Dimensions, formulas, deductions, rounding, assumptions | Dimension and specification text plus structured formula inputs live in `ai_json` only. No deductions or rounding policy anywhere. `boq_line.calculation`/`confidence`/`drawing` exist but are unused | §3 stages 3 and 4 |
| Suggested vs reviewed vs accepted vs manually adjusted | Suggested and reviewed: yes (`ai_json` vs `reviewer_json` + status). Accepted: only via Apply's change log (absent in production). **Manually adjusted after acceptance: indistinguishable**, because manual edits write no log and leave `quantity_status` as `MEASURED` | §4.2 |
| Original evidence kept when a quantity is edited | The review item is untouched (good). But after a manual edit the line still points at the original source document and page, so **the evidence now describes a different number with nothing saying so** | `quantityEditPatch` changes qty/basis/status only |
| Stable BOQ item identity across revisions | `boq_line.id` is the revision diff key (`source_line_id`). Stable while the row lives. Lost by delete and re-add. Builder undo of a removal re-inserts the same id but drops provenance (§4.3). Across re-analysis, identity depends on the model's `key`; keys like `SD-AR-101:TABLE:8032,216` embed coordinates [RISK] | `boqRevision.diffRevisionAgainstWorking` |

---

## 4. Findings

Severity is the impact on quantity trust. "Status" uses the evidence classes from §1.2.

### 4.1 F1 — Quantities of very different reliability look identical everywhere (P0 for trust) · [LIVE][CODE]

**Observed**
- A drawing count, a coefficient-derived quantity, an assumption (`HEURISTIC`), unreviewed pasted-JSON output and a typed-in number are shown, totalled and exported the same way.
- 11 included `HEURISTIC` lines are priced as if established. The journey's status column calls them "Complete" (`lib/app/boqTable.lineStatus`).
- The 681 `DRAWING_INPUT` lines carry their evidence text in `basis_note`, which no screen, export or revision shows. The builder loads `basis` but displays it only when it is `PENDING`.

**Code references:** `OpsBoqBuilder.tsx` (`LINE_COLS`, pending badge), `boqLiveExport.liveCsv` / `boqDsrDocument.buildBoqCsv` (no basis column), `RevisionLine` (no basis).

**Consequence:** a contractor cannot tell an estimate from a count, and the exported BOQ presents assumptions as quantities.

### 4.2 F2 — Manual quantity corrections are unaudited and last-writer-wins (P1) · [CODE]

**Observed**
- `OpsBoqBuilder.applyLinePatch` (line 465) and `ProjectBoq.save` (line 64) issue an unconditional `boq_line.update(patch).eq("id")`. There's no compare-and-swap and no `boq_line_change_log` row.
- The only writers of the change log are Apply (`applyReview.ts`) and rate edits (`manualRateEdit.ts`). So rates are audited and fail closed, while **quantities, the core of the BOQ, are not**.
- Undo in both screens writes the previous value unconditionally, so it can revert another user's later change.
- `boq_line` has no `updated_at` or version column (`20260803120000_boq_module.sql`).

**Tests:** existing tests cover the single-user paths (`OpsBoqBuilder.editSafety.test.tsx`, `ProjectBoq.test.tsx`); no test covers concurrency or history.

**Consequence:** "who changed 42.5 to 44 and why" is unanswerable, and two editors can silently overwrite each other.

### 4.3 F3 — Undoing a line removal in the builder strips its provenance (P1) · [CODE]

**Observed:** `OpsBoqBuilder.removeLine` (line 544), `backward` (line 550), re-inserts the line with only `id, boq_id, section, dsr_code, description, unit, qty, dsr_rate, custom_rate, cost, included, source, sort`.

**Lost on undo:**
- `external_key` → the next Apply cannot match the line, so it creates a duplicate NEW_LINE;
- `quantity_status`/`basis` → a verified zero becomes pending, and the pending marker is lost;
- `measurement_method`, `scope_id`;
- every `source_*` field.

**Consequence:** a user who removes and then restores a line believes nothing changed; in fact its evidence and identity are gone.

### 4.4 F4 — "Resilient" fallbacks silently drop all provenance (P1 risk) · [CODE][RISK]

**Observed**
- `applyFinding.insertLineResilient` (line 56) and `updateLineResilient` (line 111) retry **without every provenance column** when the error matches `/schema cache|could not find|does not exist/` (`OPTIONAL_COL_RE`, line 27).
- `OpsBoqBuilder.addFromJson` and `ProjectBoqs.insertEvalRows` go further, also matching bare column names (`\bbasis\b|external_key|…`). That is exactly the pattern `applyFinding.ts`'s own comments warn misfires on unrelated errors such as foreign-key violations.

**Why this matters now:** production now has every one of these columns (§2.1), so the fallbacks no longer serve a purpose. "does not exist" can still come from an unrelated missing relation (for example a policy or trigger referencing an absent table), and the line would then be saved and reported successful with no traceability.

### 4.5 F5 — Three copies of the amount/commercials formula; two ignore the pending rule (P1) · [CODE]

**Observed**
- `WorkspaceBoqPanel.tsx:133` (staff Workspace) and `supabase/functions/workspace-share/handler.ts:165` (public share link) compute `qty × rate` without `qtyPending`, and carry private copies of `computeCommercials`.
- The share handler does not return `quantity_status`, `basis` or source fields. A pending line therefore reaches a contractor as "0 sqm", and any qty-but-`PENDING` line would be priced into the Grand Total.
- In current production data, all 15 pending lines have qty 0, so the totals are not yet wrong. The divergence is latent, but the "0" display is real.

**Consequence:** the most contractor-facing surface is the least honest about completeness.

### 4.6 F6 — The line ↔ evidence link is not persisted (P1) · [LIVE][CODE]

**Observed**
- Evidence boxes exist for 85 of 93 review items, but a BOQ line stores no review-item or run id.
- The change log's `review_item_id` is the only durable link, and that table is absent in production. So in production, no line can be traced back to its review decision.
- The Workspace "Reviewed" badge silently shows nothing: the query error is swallowed and the data comes back undefined (`WorkspaceBoqPanel.tsx` `reviewedLineIds`).

**Consequence:** the "evidence-anchored BOQ line" recommended in the UX audit cannot be built reliably without first persisting this link.

### 4.7 F7 — Apply records counts and edits as "MEASURED" and as "manual" (P2) · [CODE]

**Observed:** `applyReview.ts:853` and `applyFinding.addReviewItemAsLine` (lines 260, 263) set `quantity_status = "MEASURED"` and `source = "manual"` for every applied quantity, whether the AI counted it, measured it, inferred it (`aiStatus: INFERRED`), or the reviewer typed it (EDITED).

**Consequence:** the most precise provenance the system has is downgraded at the moment it is accepted.

### 4.8 F8 — Exports and Apply can act on stale state (P2) · [CODE][RISK]

**Observed**
- Live exports use the React Query cache of lines (`OpsBoqBuilder.exportQuote/exportExcel`, `ProjectExport.build`). Only revision freeze re-reads. With two editors, an export can omit a just-saved change.
- Apply classifies against review statuses loaded in the browser and does not re-read `analysis_review_item` before writing. An item flagged by a second reviewer after loading can still be applied.
- Line state is re-checked by CAS, but review state is not.

### 4.9 F9 — Review decisions: overwrite without history; a note is lost on later Verify (P2) · [CODE]

**Observed**
- `reviewStore.saveReviewDecision` (line 162) is an unconditional update.
- `BoqReviewWorkstation.applyDecision` (line 784) always sends `reviewNote: opts.note ?? null`, so a note written with Edit is erased when the item is later Verified, Flagged or Marked Pending.
- There is no decision history.

### 4.10 F10 — Failure surfacing and write ambiguity (P2) · [LIVE][CODE]

**Observed**
- A failed BOQ load shows a skeleton for **~38 s**: 16 requests, because `@supabase/postgrest-js` 2.105 retries GET/HEAD/OPTIONS three times (1/2/4 s) under React Query's default of three retries (measured live in the UX audit).
- Retries are **never** applied to writes (`RETRYABLE_METHODS`), so the client cannot duplicate inserts.
- A write whose response is lost after commit is reported as failed. Since `d10e0ba` the field also reverts, so the screen shows the old value while the database holds the new one, until the next refetch [RISK].

### 4.11 F11 — The revision model under-records quantity provenance (P2) · [CODE]

**Observed**
- `boq_commercial_revision_line` (deferred migration `20261006000000`) records rich rate provenance (adoption source, date, who confirmed) but, for quantities, only `quantity_status` and the source document, name and page.
- `diffRevisionAgainstWorking` compares description, qty, unit, rate and included. It ignores status, source and origin changes.

**Opportunity:** because the migration has **not yet been applied anywhere**, adding the missing columns now costs one edit, not a later migration.

### 4.12 Answers to the data-integrity questions

| Question | Answer | Evidence |
|---|---|---|
| Can a failed save appear successful? | Builder and journey line edits: **no** (since `d10e0ba`; tests in `OpsBoqBuilder.editSafety.test.tsx`, `ProjectBoq.test.tsx`). Apply: no — a CAS miss is reported as a conflict (`applyReview*.test.ts`). **Yes, in effect, via the provenance-stripping fallbacks** (F4): the line saves, but without its provenance | F4 |
| Can an invalid value remain visible? | Builder: no (since `d10e0ba`). Journey: no (validation before save). Lost-response case: the field shows the old value while the database has the new one [RISK] | F10 |
| Can a failed operation enter undo history? | Builder: no (`applyLinePatch` throws; test). Journey: no (history recorded only after `error == null`). **But undo itself is unconditional** and can clobber a newer value | F2 |
| Can a failed load appear as an empty BOQ? | Builder: no (since `d10e0ba`). Journey BOQ/Export: no (error state after retries). **Workspace panel: yes** — its `queryFn` ignores the Supabase `error` and returns `[]` (`WorkspaceBoqPanel.tsx` `ActiveBoqCard`), so a failed load renders as an empty BOQ [CODE] | F5 |
| Excessive retry delay or duplicate operations? | Delay: yes, ~38 s. Duplicates: no (writes are not retried) | F10 |
| Can concurrent changes silently overwrite? | Line edits: **yes**. Review decisions: **yes**. Apply: no (CAS on qty/unit). Rates: no (CAS) | F2, F9 |
| Does revision history accurately represent change? | Not available in production. Where present, it omits quantity provenance and status/source changes. The per-line change log covers Apply and rates only | F2, F11 |
| Do exports reflect the saved and reviewed state? | They reflect the cached saved state (can be stale; F8). They state unfinished review items and pending lines. They do **not** distinguish reviewed from unreviewed (pasted JSON) or estimated lines | F1, F8 |

---

## 5. Production readiness reconciliation

1. **`20260921000000_boq_review_apply.sql`** (change log) is in `migrations/` but **not applied** in production, which matches `docs/audit-history-deployment.md`'s 14 Oct probe. Consequences:
   - Apply saves without history and says so ("change history NOT recorded");
   - rate edits fail closed;
   - the "Reviewed" badge is always absent;
   - there is no line ↔ review-item link.

   **This is the prerequisite for every audit and history item below.** The procedure, checksums and stop rules are already documented; it needs an authorised operator and a backup.
2. **`20260910000000_scope_taxonomy.sql`** is not applied (`scope_module` absent). It is not on the quantity-trust path; recorded only.
3. **`20260929000000` identity indexes:** presence unverified (not visible over REST). The duplicate-prevention code expects them (`applyFinding.isBoqLineIdentityConflict`). Check with §2d of the audit-history doc. If they are absent, NEW_LINE duplicates across separate Apply calls are prevented only in memory, within a single call [RISK].
4. **Deferred `20261003`–`20261006`:** absent by design. **Recommendation:** amend `20261006000000_boq_commercial_revision.sql` to carry quantity provenance (§6.4) *before* its first application. It has never been applied, so the change is free now.
5. **Migration history:** `docs/deployment-log.md` records that production's `schema_migrations` was baselined outside migration tracking. Any new migration must follow the same preflight discipline: target confirmation, `to_regclass` checks, stop rules.
6. **Compatibility:** the client still carries "stale schema" fallbacks for columns that production now has (§4.4). Removing or narrowing them is safe for production; any other deployment (staging, local) should be checked to confirm it also has the columns.
7. **Generated types:** `src/integrations/supabase/types.ts` does not reflect `boq_line` or `boq`, so writers bypass typing via `untypedDb`. New columns will not be type-checked unless the types are regenerated [CODE].

**Never do as part of this work:** run migrations, backfills or seed scripts from a session; write to production; change RLS without a reviewed migration.

---

## 6. Proposed architecture: the smallest coherent solution

**Guiding principle:** record provenance at the moment a quantity is written. Show it wherever the quantity is shown. Never present an inferred origin as recorded.

### 6.1 Quantity provenance model

A single pure module, `src/lib/quantityProvenance.ts`. It has no I/O and is Deno-compatible, like `analysisSchemaV1.ts`, so the share edge function can import it.

```ts
type QuantityOrigin =
  | "drawing_review"     // applied from a reviewed analysis item (VERIFIED)
  | "drawing_review_edited" // applied from a review item the reviewer EDITED
  | "drawing_takeoff"    // operator's drawing summary (legacy DRAWING_INPUT / DRAWING_DERIVED)
  | "coefficient"        // DSR_AOR
  | "assumption"         // HEURISTIC
  | "unreviewed_import"  // pasted evaluation JSON
  | "spreadsheet_import"
  | "manual"             // typed by staff
  | "unknown";

interface QuantityProvenance {
  origin: QuantityOrigin;
  recorded: boolean;      // true only when written explicitly at save time; false = inferred
  establishment: "pending" | "established" | "assumed";
  evidence: { documentId: string; page: string | null; reviewItemId: string | null } | null;
  note: string | null;    // basis_note / reviewer note — verbatim, never generated
  adjustedAfterAcceptance: boolean;
}
```

`provenanceOf(line)` returns:
- the recorded `quantity_origin` when the column is set (Phase 2);
- otherwise an **inferred** origin, from rules over the existing columns that are tested and listed in this document (`basis` codes, `external_key` + source document + the review section, `basis_note` text, `source`), with `recorded: false` shown as "inferred";
- `unknown` when no rule applies.

It never fabricates evidence.

Make `qtyPending`, `lineAmount` and `effRate` live in the same Deno-compatible module, and have the builder, journey, Workspace panel, exports and share handler import them. That replaces the three divergent copies (F5).

### 6.2 Data-model changes (one additive migration, after the change log)

| Change | Why it is essential | Notes |
|---|---|---|
| `boq_line.quantity_origin text null` (check constraint on the vocabulary above) | Recorded, not inferred, origin | Null = legacy / unknown. **No backfill**: an inferred value must not be written as if it had been recorded |
| `boq_line.source_review_item_id uuid null references analysis_review_item(id) on delete set null` | The durable line → evidence link (F6) | Written by Apply (APPLY and NEW_LINE). `ai_json` is immutable, so the evidence it points to is stable |
| `boq_line.row_version int not null default 0` + `before update` trigger incrementing it | One concurrency token for **every** edit, including description, included and section, instead of per-field CAS | Alternative with no migration: extend `updateLineResilient`'s value-CAS (`withExpectedFilters`) to every edited field — acceptable for Phase 3a, weaker for multi-field patches |
| `boq_line_change_log`: add `origin text null` (e.g. `apply`, `manual_edit`, `undo`, `import`) and `reason text null` | Distinguish manual adjustments from accepted review values; capture a correction reason | Additive to an existing (not yet applied) table: can be folded into `20260921` **only if** it is still unapplied when this work lands; otherwise a follow-up migration |
| Deferred `boq_commercial_revision_line`: add `quantity_origin`, `basis`, `basis_note`, `source_revision_id`, `source_review_item_id` | A frozen revision must explain its quantities, not just its rates (F11) | Edit before first application (§5.4); update `create_boq_commercial_revision`'s insert list and `RevisionLine` |

Deliberately **not** added:
- a separate evidence table — the review item already holds it;
- formula, deduction or rounding columns — out of scope until the extraction contract produces them;
- `boq_line.drawing` usage — leave it as-is and document it as legacy.

### 6.3 Write paths (who records what)

| Writer | Records |
|---|---|
| `applyReviewPlan` / `addReviewItemAsLine` / `applyReviewQtyUnit` | `quantity_origin` = `drawing_review` or `drawing_review_edited`; `source_review_item_id`; `quantity_status` from the item (`COUNTED` for count units / `aiStatus`, `MEASURED` otherwise; never `MEASURED` for INFERRED — record `DERIVED`); the change log with `origin='apply'`. Stop writing `source="manual"` (column constraint: `auto`/`manual`; leave `source` alone and rely on `quantity_origin`) |
| `evalLinesToRows` (pasted JSON) | `quantity_origin='unreviewed_import'`; keep its own `quantity_status` claims but display them as "claimed by import" |
| Spreadsheet import | `quantity_origin='spreadsheet_import'` |
| Manual add / edit / undo (builder + journey) | One shared `saveLineEdit(lineId, patch, expectedVersion)` in `src/lib/lineEdit.ts`: CAS on `row_version` (or values), a change-log row with `origin`, `quantity_origin='manual'` **only when qty changes**, `adjustedAfterAcceptance` derivable (the line has `source_review_item_id` and a later manual qty log). Undo = a forward `saveLineEdit` with CAS against the value the user is undoing, never a blind inverse. **Fail closed** for quantity edits when the change log is unavailable — the same policy as rates — after a short transition in which the UI says "history not recorded" |
| `removeLine` undo | Re-insert the complete original row (all selected columns), or replace hard delete with `included=false` + a log entry |
| Provenance-stripping fallbacks | Remove for columns production has; any remaining fallback strips only the column named in the error and logs a visible warning |

### 6.4 Read paths (where provenance must appear)

| Surface | Change |
|---|---|
| Journey BOQ table (`components/app/BoqTable.tsx`, `lib/app/boqTable.ts`) | "Basis" column (origin label + "inferred" marker + `basis_note` tooltip); status: `assumption` lines are shown as **"Assumed"**, never "Complete"; filter by origin |
| Journey Drawings (`pages/app/ProjectDrawings.tsx`) | `?line=<id>` → load `source_review_item_id`'s `ai_json.source` → pass `source.evidence` (quantity claim first) and `pageSize` to `PdfEvidenceViewer` (it already renders evidence boxes and markers; `evidenceCoords.ts` already transforms them). For lines without a recorded review item: show the page only, with "Region not recorded". Never resolve evidence by `external_key` without labelling it "matched by key" |
| Line detail panel (journey) | Origin, evidence, AI value vs reviewer value (`ai_json` vs `reviewer_json`), change history (`boq_line_change_log`), "adjusted after acceptance" |
| Exports (`lib/boqLiveExport`, `boqDsrDocument`) | CSV "Quantity basis" column; PDF: a basis code per line and a legend; an assumption count in the notices. Re-read lines at export time (F8) |
| Workspace panel + share link | Import the shared module (F5); the share handler returns `quantity_status`, origin and source page; pending shows as "Pending", not "0" |
| Frozen revision + diff | Snapshot the provenance columns; the diff reports status, origin and source changes |

### 6.5 Review integrity

- `saveReviewDecision` with CAS on the `reviewed_at` the reviewer saw (or `review_status`). On a mismatch, reload the item and tell the user.
- Preserve `review_note` unless explicitly changed (F9).
- `applyReviewPlan` re-reads the selected items' `review_status`/`reviewer_json` and refuses any that changed since classification. That is a small addition next to the existing freshness gate.

### 6.6 Reuse rather than duplicate

| Reuse | For |
|---|---|
| `PdfEvidenceViewer` (evidence boxes, markers, claim selection), `evidenceCoords.ts`, `claimEvidence.ts`, `evidenceDisplay.ts` | Evidence-anchored line view |
| `applyFinding.updateLineResilient` + `withExpectedFilters` | Value-CAS for manual edits (Phase 3a) |
| `manualRateEdit.applyManualRateEdit` pattern (CAS → audit → revert or report; fail closed when the audit table is missing) | `saveLineEdit` |
| `boq_line_change_log` (+ `WorkspaceBoqPanel`'s reader) | History and "Reviewed" status |
| `revisionFreshness.ts` / `assessRunFreshness` | Review-state re-check before Apply |
| `resolveDrawingSource`, `loadProjectDrawings` | Document names in every surface |
| `qtyPending`, `quantityEditPatch`, `lib/boqLiveExport`, `saveErrorMessage` | Single rules |
| `measurementValidator` / `calculationAdvisory` | Show the formula verdict in the line detail (read-time only) |
| `src/lib/e2e/` in-memory Supabase pipeline (`boqEndToEnd.test.ts`) | End-to-end provenance regression |

---

## 7. Dependency-ordered plan

### Phase 0 — production prerequisites (operator decision; no code)

- **0a.** Apply `20260921000000` (change log) via `docs/audit-history-deployment.md`: backup, preflight, stop rules.
- **0b.** Verify the `20260929` identity indexes (§2d SQL); apply them separately if absent and reconciled.
- **0c.** Amend the *deferred* `20261006` revision migration to carry quantity provenance (§6.2) before it is ever applied.

**Risk:** an operational, schema-history baseline issue (`deployment-log.md`). **Deferred:** applying `20261003`–`20261006`.

### Phase 1 — honest provenance with no migration (recommended first slice; §9)

1. `lib/quantityProvenance.ts`: inferred origin + shared `qtyPending`/`lineAmount`; Deno-importable.
2. Journey BOQ: Basis column, "Assumed" status, origin filter; Workspace panel and share handler use the shared rule; share shows "Pending".
3. CSV "Quantity basis" column; PDF basis legend and assumption count.
4. Remove the provenance-stripping fallbacks (F4); fix `removeLine` undo (F3); preserve the review note (F9).

**Acceptance:**
- Each of the 1,111 production lines maps to exactly one origin.
- Every inferred origin is labelled "inferred".
- `HEURISTIC` lines show "Assumed" and appear in the export's assumption count.
- A pending line never renders as "0" on any surface.
- A remove → undo round-trip preserves every column.

### Phase 2 — recorded provenance and the evidence link (one migration, after 0a)

1. Migration: `quantity_origin`, `source_review_item_id`, `row_version` + trigger; change-log `origin`/`reason`.
2. Apply writes origin, review-item id and a correct `quantity_status` (F7).
3. Imports write origin.
4. Journey Drawings `?line=` evidence view; line detail panel.

**Acceptance:**
- A newly applied line opens its drawing with the quantity-claim evidence region highlighted on the correct page and revision.
- AI value and reviewer value are both visible.
- Legacy lines say "Region not recorded".

### Phase 3 — safe correction

1. `saveLineEdit` (CAS + log + origin) in the builder and journey.
2. Undo as a CAS forward edit.
3. Fail closed when the log is unavailable.
4. Review decision CAS; Apply re-reads review state.
5. Bounded retries for BOQ reads (`retry: 1` at one layer; failure shown within ~5 s).

**Acceptance:**
- Two-session test: the second save gets a conflict, not an overwrite.
- Every quantity change has a log row naming the user and origin.
- Undo after someone else's change is refused with an explanation.

### Phase 4 — revision fidelity and export consistency

1. Snapshot the provenance columns (after 0c and the deferred migration is applied).
2. The diff includes status, origin and source.
3. Exports re-read lines.

**Acceptance:** a revision's PDF/CSV shows the same basis per line as the live export at freeze time; the diff lists a manual adjustment as one.

### Phase 5 — contractor validation (§8.2)

**Deferred beyond this plan:**
- deductions, wastage and a rounding policy;
- per-input evidence for calculations;
- drawing scale calibration and in-app measurement tools;
- contractor write access (RLS is staff-manage / owner-read today; a product decision);
- stability of model item keys across re-analysis;
- backfilling `quantity_origin` for legacy lines (never write inferred values as recorded).

---

## 8. Regression-test plan and production safeguards

### 8.1 Tests to add, by phase

| Area | Test (type) |
|---|---|
| Origin inference | Unit: every `basis`/`source`/`external_key`/section combination present in §2.2 maps to one origin; unknown combinations → `unknown`; `recorded` false for inferred |
| Single pending rule | Unit: `qtyPending`/`lineAmount` shared by builder, journey, Workspace panel, exports; Deno import smoke test for the share handler |
| Share link | Handler test: pending line returns `quantityStatus: "PENDING"`, renders "Pending", is excluded from totals |
| Fallback removal | Unit: an unrelated "relation … does not exist" error throws; it never strips columns |
| Remove/undo | Builder test: remove → undo restores `external_key`, `quantity_status`, `basis`, `scope_id`, `source_*` |
| Apply provenance | Extend `applyReview*.test.ts`: origin, `source_review_item_id`, `quantity_status` (COUNTED / MEASURED / DERIVED for INFERRED); EDITED → `drawing_review_edited` |
| Evidence view | Render test: `?line=` passes the quantity-claim evidence and `pageSize` to the viewer; a legacy line shows "Region not recorded" |
| Concurrency | `saveLineEdit` CAS mismatch → conflict, no write, no log; undo CAS; review decision CAS; Apply refuses items whose review state changed |
| History | Every successful quantity edit writes exactly one log row with origin; a failed edit writes none; log missing → fail closed |
| Revision | Snapshot includes provenance; diff reports status, origin and source changes |
| End-to-end | `src/lib/e2e/boqEndToEnd.test.ts`: analysis → review → Apply → manual adjust → freeze → export, asserting provenance survives each step |
| Exports | CSV basis column; PDF assumption notice; export re-reads lines |

### 8.2 Safeguards

- **No writes from sessions:** migrations only through the documented operator procedure (backup, read-only preflight, stop rules).
- **Phase 1 is migration-free and read-mostly:** it is safe to ship first.
- Every new column is **additive and nullable** (`row_version` defaults to 0), and there is no backfill. Old clients keep working; new clients treat null as "not recorded".
- Feature flag for fail-closed quantity edits until 0a is confirmed in production. Before that, show an explicit "history not recorded" banner rather than silently allowing edits.
- **Live verification before release:** with writes blocked, repeat the UX-audit scripts. Then, on a staging copy (not production), run the two-session conflict test and the Apply → freeze → export trace.

---

## 9. Recommendation

**1. Most consequential current failure mode.**
Quantities of very different reliability (drawing counts, coefficient-derived values, assumptions, unreviewed AI/JSON output and typed-in numbers) are displayed, totalled, shared and exported identically. On top of that, manual quantity changes leave no trace.
- In production, 98% of lines have no drawing reference.
- 11 assumption-based lines are priced as fact.
- The evidence text that does exist (`basis_note` on 681 lines) is never shown.

A contractor cannot tell an estimate from a count, or who changed a number.

**2. Smallest first slice that materially increases trust — "Show where every quantity came from" (Phase 1, no migration):**
- (a) a pure, tested `quantityProvenance` + shared pending/amount module;
- (b) a Basis column with "inferred" labelling and "Assumed" status in the journey BOQ;
- (c) basis in the CSV and a PDF legend with an assumption count;
- (d) the Workspace panel and share link use the shared pending rule, and the share shows "Pending";
- (e) remove the provenance-stripping fallbacks and fix remove-undo.

It touches all 1,111 lines, needs no schema change, and is fully reversible.

**3. Data-model changes that are essential before further UI work:**
- (i) apply the existing change-log migration (`20260921`) — the prerequisite for history, the evidence link and audited edits;
- (ii) `boq_line.source_review_item_id` — without it, evidence-anchored lines can only be guessed by key;
- (iii) `boq_line.quantity_origin` — so that origin is recorded at write time, not inferred;
- (iv) a concurrency token (`row_version`), or at minimum value-CAS for every edited field;
- (v) amend the deferred revision migration to snapshot quantity provenance before its first application.

(i), (ii) and (iii) are essential for Phase 2 evidence UI; Phase 1 needs none of them.

**4. Reuse, don't duplicate:**
- `PdfEvidenceViewer` + `evidenceCoords` + `claimEvidence` (evidence display);
- `updateLineResilient`/`withExpectedFilters` and the `manualRateEdit` pattern (CAS + audit + fail closed);
- `boq_line_change_log` (history);
- `assessRunFreshness` (pre-Apply checks);
- `qtyPending` / `boqLiveExport` / `quantityEditPatch` / `saveErrorMessage` (single rules);
- the `src/lib/e2e` in-memory pipeline (end-to-end tests).

Remove the duplicated formula copies in `WorkspaceBoqPanel.tsx` and `workspace-share/handler.ts`.

**5. Must be tested before production release:**
- the origin mapping against the real production combinations (§2.2);
- pending never shown as "0" on any surface;
- the remove/undo provenance round-trip;
- Apply writing origin, review-item id and the correct status;
- the evidence view landing on the correct revision, page and region;
- two-session conflict on edits, review decisions and Apply;
- the change log present → every quantity change logged; absent → fail closed;
- revision snapshot and diff provenance;
- export consistency with a fresh read.

All of this first with automated tests, then live with writes blocked, then on staging for the write paths.

**6. Risks that cannot be resolved without real contractor testing:**
- whether the origin vocabulary ("Assumed", "Coefficient", "Drawing takeoff", "Reviewed from drawing", "Imported (unreviewed)") is understood and trusted;
- whether a highlighted region plus page is enough evidence to *defend* a quantity to a client, or whether the formula inputs are also needed (Bluebeam-style measurement markup);
- how contractors expect to correct quantities, given RLS is owner-read-only today, and whether they need a request-a-correction flow rather than direct edits;
- whether showing assumptions and pending items in client-facing exports helps credibility or harms adoption;
- the acceptable latency and conflict-message behaviour in a real multi-editor workflow.

---

## 10. Remaining uncertainties

- The origin of the legacy `auto` lines and their `basis` vocabulary (no current writer; generator history not found).
- Whether the `20260929` identity indexes exist in production.
- Whether any non-production deployment still lacks the `boq_line` provenance columns (affects removing the fallbacks).
- Production RLS and policies were inferred from migration files, not read from `pg_policies`.
- AI key stability across re-analysis was not measured.
- The lost-response write case (F10) and stale-export case (F8) are code-level risks; neither was reproduced live.
- Contractor comprehension: all usability claims here are expert judgement; no contractor was tested.
