# Core Product Closure Sprint — Report

Branch `feat/app-journey`, HEAD `b499961` (equal to origin). Everything is **uncommitted**. Nothing was committed, pushed, merged, deployed or migrated, and no production data was read or written during the sprint. 17 Oct 2026.

Evidence labels:
- **[TEST]**: Vitest + jsdom against mocks or the in-memory Supabase stand-in.
- **[REAL-DSR]**: tests against the real 2,758-item DSR 2023 seed.
- **[PGLITE]**: real Postgres 16 in-process, with stub auth/RLS and no PostgREST.
- **Nothing in this sprint ran on Supabase, staging or production.**

## 1. Closure matrix

| WS | Scope | Status | Basis |
|---|---|---|---|
| A | Quantity integrity, Review → Apply | **PASS** (local) | 8 defects fixed; 24 new tests [TEST] |
| B | Editing, audit history, undo | **PASS** (local); one product decision pending | 14 defects fixed; fail-open/closed policy in `B-audit-policy.md`; +35 tests [TEST] |
| C | DSR matching, scope, decisions | **PASS** (local) | Concurrency race closed; 12 matching/seed defects fixed; +33 tests [REAL-DSR][TEST] |
| D | Revisions, snapshots, diffs | **PASS** (local) | 7 diff/fidelity defects fixed; new deferred `20261008`; lifecycle 46/46 [PGLITE] |
| E | Pricing, totals, exports | **PASS** (local) | Cross-representation consistency test; P2-3/4/5 closed; ~20 new tests [TEST] |
| F | Journey and recovery | **PASS** (local) | Recovery and persistence across 6 steps; +16 tests [TEST]. Playwright specs fail **identically at HEAD** (pre-existing, outside the journey) |

**"Local" means:** each definition of done is met against simulation. Each stream's last step is the same: one staging run, because every guarded write still has to meet real PostgREST and RLS.

## 2. Completed work (by meaning, not by file)

**Quantities keep their meaning end to end (A, E).**
- **Apply:**
  - now uses the shared quantity rule;
  - a reviewer's confirmed 0 or a basis-only pending line is applied correctly;
  - an AI item marked PENDING is never written as established;
  - negative quantities are refused;
  - a unit-only correction records the review basis;
  - the stale-plan guard covers status and basis, not just qty and unit.
- **Interrupted Apply:**
  - it reports exactly what was written and what was not (`ApplyInterruptedError`);
  - its receipt and toasts can no longer show a partial or refused Apply as a success;
  - a retry never duplicates.
- **"Set qty"** records MANUAL.
- **Indicative costing** now follows the shared pending rule.
- **Confirmed ₹0** is distinct from "To be priced" in PDF abstracts.

**Every mutation is guarded and honest about history (B).**
- **Adds, removals, restores and undo/redo:**
  - all go through compare-and-swap;
  - all are recorded (`line_created`, `line_removed` with the full row, `line_restored`);
  - each is compensated if its history write fails.
- **Undo:**
  - can no longer delete a line someone else edited, or cascade-delete linked quotations or reviews;
  - stays in step with the database, including after a double Ctrl+Z.
- **Fail-open/closed policy:** decided per mutation and documented in `B-audit-policy.md` (decision D1-b closed).

**DSR check is safer and explainable (C).**
- **One guarded writer** for `boq.spec` (`lib/boqSpecWrite.ts`, compare-and-swap on `updated_at`, bounded retry) is used by the builder and by DSR decisions. The overwrite race is closed.
- **Contractor defaults** no longer copy DSR decisions into other BOQs.
- **Matching:**
  - extra/add/deduct items, multi-item seed rows and family variants can no longer be "reliable";
  - plain vs reinforced concrete is reported as a conflict;
  - the seed clean-up no longer cuts legitimate text.
- **Decisions:** double-clicks and retries are idempotent, and Undo after Accept says the lines remain.

**Revisions mean what they meant (D).**
- **Re-exports** never price a line that was frozen as pending.
- **The diff** reports no false changes (blank vs null, 0 vs null pending, renamed or still-loading drawings, legacy rows without basis) and now reports changed DSR codes.
- **Follow-up migration `20261008`** refuses a stale or invented code, section, note or source at freeze time.
- **Freezing waits for drawings,** so a source is never frozen as blank.

**Exports agree with what is saved (E + integration).**
- **One test proves it:** UI totals, live PDF, live CSV and revision lines agree on identity, qty, unit, basis and price state.
- **Both PDF exports** (journey and builder) now open the tab from the click and fill it from a **fresh read** of lines and spec. A failed read produces no document.
- **Accepted pending DSR lines** keep their code in every export, including the combined project quote.

**The journey recovers instead of misleading (F + integration).**
- **Every step:**
  - shows a failed read as an error with Retry, never as "No BOQ yet" or "no drawings";
  - names an unknown `?boq=` instead of swapping it silently;
  - shows a stale evidence link for what it is.
- **Reloads** re-read decisions, applied quantities and DSR decisions from the database.

**Release plumbing (integration).** `npm run staging:migrate` now applies `20261007` and `20261008` in order; it previously stopped at `20261006`. The staging doc and README are corrected.

## 3. Verification

| Check | Sprint baseline | Final |
|---|---|---|
| Vitest (full) | 226 files, 2,630 tests, all pass | **232 files, 2,777 tests, all pass** (`npx vitest run`) |
| `tsc -p tsconfig.app.json` | 433 errors (pre-existing) | **408; no new error signature** |
| ESLint | 180 errors, 22 warnings | **180, 22; identical per file and rule** |
| `vite build` | passes | **passes** |
| `npm run build` | sitemap step fails (no DNS here) | same, environment only |
| PGlite revision lifecycle | — | **46/46** (`npx vite-node <scratchpad>/pg-ws-d/lifecycle.ts`) |
| Benchmark frozen-file check | — | **passes** (`npx vitest run --config scripts/benchmark/vitest.bench.config.ts`) |
| Playwright `e2e/clickToIdentify.spec.ts` | fails 2/2 at HEAD | fails 2/2, same cause (Identify button disabled): **pre-existing** |

**Critical end-to-end flows covered [TEST]:**
- `JourneyApply` (review → Apply → BOQ → check → export);
- `JourneyRecovery` (16 tests);
- `DsrCheck` (suggestion → decisions → pending lines → rate → export → revision);
- `boqExportConsistency`;
- `applyReviewClosure` (retry and partial failure);
- `OpsBoqBuilder.removeUndo` and `.exportGuard`;
- `boqSpecWrite` interleavings.

**Final-diff checks:**
- no applied migration changed;
- no tracked file deleted;
- the public-share function was not touched this sprint;
- scratch probes removed;
- seven of the eight frozen benchmark files match their hashes — the eighth (`pipeline.ts`) changed before the sprint, handled by the v1.1 amendment (§6).

## 4. Remaining blockers (by severity)

1. **No guarded write has met real PostgREST/RLS.**
   - This covers compare-and-swap filters (`.is(col, null)`, `updated_at`), the 23505 identity handling, and history inserts.
   - RLS-filtered updates would read as "changed elsewhere".
   - Needs staging; **no staging credentials exist in this environment.**
2. **`boq_line_change_log` is absent in production.** Until it exists:
   - edits save with a "not recorded" notice;
   - review and DSR decisions are not in history;
   - manual and schedule rates are refused;
   - **line removal is refused** (new behaviour from B).
3. **Product decision:** should removal stay refused until (2) is applied? The switch is `REMOVAL_REQUIRES_HISTORY` in `src/lib/lineRemoval.ts`; it is currently `true`.
4. **Revisions are unavailable in production** until the deferred set (`20261003`–`20261008`) is approved and applied in order.

**Not blockers, recorded:**
- "Set qty" is unguarded.
- "Add from JSON" is unrecorded.
- Two known wrong-reliable DSR matches:
  - waterproofing to terrace → 22.7.1;
  - TMT bars → 5.22.6.
- The "Last Apply" note is per-tab.
- `RateEvidencePanel` keeps its own `qty>0` amount rule (deferred feature).
- Playwright Identify specs fail (pre-existing).

## 5. Database and migration status

| Item | Local | Real database |
|---|---|---|
| `20260921` change log | PGlite: applies, idempotent | **Not applied** to staging or production |
| `20261003`–`20261006` | PGlite: chain applies in order, idempotent | **Not applied** |
| `20261007` provenance | PGlite; static tests | **Not applied** |
| `20261008` line identity (new) | PGlite: 9 stale or invented snapshots refused; order hazard confirmed (07 after 08 drops 08's checks) | **Not applied** |
| `staging:migrate` list | Now includes 07 and 08 in order; test pinned | Not run (no credentials) |

## 6. Release recommendation

**Not yet a release candidate.**
- The code side of every workstream is closed and green locally.
- Release-candidate status is prevented only by blockers 1–3: one staging run of the change-log migration plus the write paths, and the removal decision.
- No further engineering is known to be required before that staging run.

The extraction benchmark is a separate track. It is **not executed**, and no accuracy is claimed. The protocol is amended to v1.1 (frozen-file hash) and a scoring driver exists. It waits on a Set A drawing and an independent reference BOQ (`docs/benchmarks/BENCHMARK-EXECUTION-PLAN.md`).

## 7. Next actions

| # | Action | Owner |
|---|---|---|
| 1 | Decide: removal refused until history exists (yes/no) | Product owner |
| 2 | Provide staging credentials; approve applying `20260921` on staging per `docs/audit-history-deployment.md` | Product owner / operator |
| 3 | On staging: Apply (with and without the change log), a two-session edit conflict, remove/undo, DSR Accept/Reject/Undo plus a concurrent commercials change, schedule rate | Engineering |
| 4 | If revisions ship: `npm run staging:migrate` (03→08), then freeze → edit → diff → freeze → export on staging | Engineering |
| 5 | Supply the Set A drawing and the independent reference BOQ; run the benchmark driver | Product owner, then engineering |
