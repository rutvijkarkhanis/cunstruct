# Major Milestone: Defensible Quantity BOQ + DSR Intelligence — Result

Branch `feat/app-journey`, HEAD `b499961` (same as origin). Everything below is **uncommitted**. Nothing was committed, pushed, merged, migrated or deployed, and no production data was changed. 16 Oct 2026.

Detail lives in:
- `docs/QUANTITY-TRUST-REMAINING.md`: quantity trust, blockers, migration decisions and deployment order.
- `docs/DSR-IMPLEMENTATION-PLAN.md`: what the DSR code does, its limits and the real-data run.

## 1. What a contractor can now do

1. **See why a quantity is what it is.**
   - Every line states its basis, including how the quantity was taken: "Counted on drawing, verified in review", "Measured on drawing, corrected in review", "Changed manually", "Awaiting quantity", "Basis not recorded".
   - On Build BOQ, a line's **Evidence** row shows:
     - the review decision;
     - the extracted and corrected values;
     - whether the line has changed since review;
     - the stored calculation (never reconstructed);
     - reviewer notes;
     - a link that opens the drawing with the measured region drawn.
   - The link is by stable key only, never by description.
2. **Edit without losing anyone's work.**
   - Quantity, unit, description, section, included and cost edits are compare-and-swap guarded, and recorded per field.
   - Undo never reverts someone else's later change.
   - Review decisions are guarded and recorded.
3. **Check the BOQ against its own schedule** in Check & finalise. Each line gets one of:
   - reliable / possible / no reliable match against DSR `<rate_year>`;
   - unit, convertible-unit and specification conflicts;
   - ambiguity;
   - "this work may not be in this schedule".
4. **Be told what the schedule says is missing.** When a matched item says it excludes formwork or reinforcement and nothing in the BOQ covers that work, it is suggested with:
   - the trigger and the schedule's own words;
   - what is missing;
   - possible duplicates;
   - the next decision.
5. **Accept, Reject, Defer or Undo**, durably and guarded:
   - Accept adds **pending** lines (code, description and unit from the schedule; no quantity; no rate).
   - The schedule rate is a separate, validated, audited action.
   - The pending lines flow through the BOQ, the check summary, CSV/PDF (now with their code) and the revision snapshot as pending, never as 0.

## 2. Workstream results

| | Result | Main files |
|---|---|---|
| **A1** provenance | Done. COUNTED/MEASURED is recorded by Apply and review-added lines, and labels are method-aware. Legacy lines stay "Basis not recorded"; nothing is backfilled. | `src/lib/quantity.ts`, `src/lib/review/applyReview.ts`, `src/lib/applyFinding.ts` |
| **A2** evidence linkage | Done without a migration: line → review item → document, page, region. It survives Apply, edits ("changed since review") and undo. Revisions carry basis via the prepared migration. Exports state the basis. | `src/lib/lineEvidence.ts`, `src/components/app/LineEvidencePanel.tsx`, `BoqTable.tsx`, `ProjectBoq.tsx`, `ProjectDrawings.tsx`, `WorkspaceCanvas.tsx` |
| **A3** calculation transparency | Done for what the analysis stored: dimensions × formula = result, with units, or the analysis's verbatim text, plus the arithmetic advisory. "No calculation was recorded" otherwise. | `lineEvidence.ts` (`explainCalculation`) |
| **A4** history and safe editing | Done in code: generalised guarded edits, review-decision history, and consistent "saved but not recorded" behaviour where the change log is missing (rates fail closed). The missing change log is investigated and its runbook already exists. The revision migration is a follow-up (`20261007`); no applied migration was edited. | `src/lib/lineEdit.ts`, `src/lib/review/reviewStore.ts`, `BoqReviewWorkstation.tsx`, `OpsBoqBuilder.tsx`, `supabase/deferred-migrations/20261007000000_…sql`, `src/lib/boqRevision.ts` |
| **B1** matching | Done; tested on the real 2,758-item schedule; tuned on production data (§4). | `src/lib/dsr/catalogue.ts`, `src/lib/dsr/match.ts` |
| **B2** missing scope | Reliable subset only: the schedule's own formwork and reinforcement exclusions. Other rules are listed as not implemented. | `src/lib/dsr/scope.ts` |
| **B3** decisions | Done. Stored in `boq.spec` (no migration), guarded on `boq.updated_at`, and recorded in the change log. Accept → pending lines, idempotent. Reject and Defer delete nothing. | `src/lib/dsr/scopeStore.ts` |
| **B4** guidance and rates | The measurement wording is shown labelled as guidance. The schedule rate validates schedule, code, unit and rate, is guarded and audited, and fails closed. | `scopeStore.ts`, `DsrCheckSection.tsx` |
| **C** journey | One journey: the schedule check is a section of Check & finalise, and accepted work is traced through the BOQ, check, export and revision. Missing quantity and missing rate stay distinct. | `src/components/app/DsrCheckSection.tsx`, `src/pages/app/ProjectExport.tsx`, `src/lib/boqDsrDocument.ts`, `src/lib/boqRevision.ts` |
| **D** release readiness | Migrations prepared and verified on PGlite; deployment order written. No staging credentials exist here, so nothing ran on staging. | `docs/QUANTITY-TRUST-REMAINING.md` §5, `supabase/deferred-migrations/README.md` |

**Unrelated issue found and recorded, not fixed:** the DSR 2023 seed has PDF spill-over in a few dozen descriptions (item 26.96.2 holds about 42 kB of appendix text). Matching works around it; the seed is untouched.

## 3. Verification: baseline vs final

| Check | Milestone baseline | Final |
|---|---|---|
| Vitest | 220 files, 2,563 tests, all pass | **226 files, 2,630 tests, all pass** |
| `tsc -p tsconfig.app.json` | 433 errors (pre-existing) | **433, no new error signature** |
| ESLint | 202 problems (180 errors, 22 warnings) | **202 (180, 22)**; new files lint clean |
| `vite build` | passes | **passes** |
| `npm run build` | sitemap pre-step fails here (no DNS to Supabase from this sandbox) | same, unrelated to this change |

One existing test expectation was changed deliberately: `OpsBoqBuilder.exportGuard.test.tsx`, where a pending CSV row now shows its code "2.1".

## 4. How each claim was checked

| Claim | Where it was checked |
|---|---|
| Matching verdicts, conflicts, ambiguity, absent coverage | Vitest against the **real seed schedule** (2,758 items), parsed from the migration file |
| Scope suggestions, cover and duplicates | Vitest, real seed schedule |
| Decisions, Accept, Undo, schedule rate, paging, missing change log | Vitest, **in-memory database** (real store code) |
| Full journey: suggestion → reject/undo → defer → accept two items → pending lines → schedule rate → change-log rows → export row with code, pending → revision snapshot pending, amount null | Vitest + jsdom, real shell and page, **in-memory database** (`src/pages/app/DsrCheck.integration.test.tsx`) |
| Revision provenance migration | **PGlite** (real Postgres, stub auth and RLS): idempotent, frozen basis kept, frozen line immutable, stale status and stale basis refused, older client still freezes |
| Production catalogue load, real-BOQ matching, the evidence row | **Production, read-only** (real login, Chromium, writes blocked, **0 write attempts**). 2,758 items in 3 pages. On the real BOQ: before the fix, 8 "possible" matches included window/door hardware (false leads); after it, 3 possible and 15 none, with honest reasons. The evidence row rendered from a real reviewed item, with its region link |
| Anything on staging | **Not run**: no staging credentials in this environment |
| Accept, Reject, Defer, rate on real data | **Not run**: writes, by design |

## 5. Readiness verdict

**Ready for review and staging validation; not ready to call production-complete.**

The code paths are complete and tested. Production today lacks the change log, so:
- edits, review decisions and DSR-check decisions save, with "not recorded in history" notices;
- manual and schedule rates are refused;
- revisions are unavailable.

**Minimal blockers**, in order:
1. Apply `supabase/migrations/20260921000000_boq_review_apply.sql` (runbook `docs/audit-history-deployment.md`): staging first, then production with approval.
2. Deploy the updated `workspace-share` function, which still prices pending lines on the public share page.
3. Only if revisions are to ship: the deferred Stage 3–6 set, including `20261006000000` immediately followed by `20261007000000`, per the deferred-migrations README.
4. Run the write paths once on staging: Apply, a guarded edit with a second session, review decision, DSR Accept/Reject/Defer/Undo, the schedule rate. This is the first test against real PostgREST and RLS. An update filtered out by RLS would currently show as "changed elsewhere".

**Known limitation (documented, not a blocker):** DSR decisions in `boq.spec` can race with the builder's own `spec` writes, which do not bump `updated_at`. The window is one round trip.

## 6. Changed files (this milestone)

**New**
- `src/lib/dsr/catalogue.ts`, `match.ts`, `scope.ts`, `scopeStore.ts`, `seedFixture.ts` (test-only)
- `src/lib/dsr/match.test.ts`, `scope.test.ts`, `scopeStore.test.ts`
- `src/components/app/DsrCheckSection.tsx`, `src/pages/app/DsrCheck.integration.test.tsx`
- `src/lib/lineEvidence.ts`, `lineEvidence.test.ts`, `src/components/app/LineEvidencePanel.tsx`
- `src/lib/boqRevisionProvenanceMigration.test.ts`
- `supabase/deferred-migrations/20261007000000_boq_commercial_revision_provenance.sql` (not applied anywhere except PGlite)
- `docs/DSR-IMPLEMENTATION-PLAN.md`, `docs/MAJOR-MILESTONE-RESULT.md`

**Modified**
- `src/lib/quantity.ts`, `src/lib/review/applyReview.ts`, `src/lib/applyFinding.ts`, `src/lib/lineEdit.ts`
- `src/lib/review/reviewStore.ts`, `src/lib/boqRevision.ts`, `src/lib/boqDsrDocument.ts`
- `src/lib/untypedDb.ts` (`range` on the query type)
- `src/lib/e2e/inMemorySupabase.ts` (test harness: `dsr_item`, `order`/`range`, missing-table emulation)
- `src/components/app/BoqTable.tsx`, `src/components/ops/workspace/WorkspaceCanvas.tsx`
- `src/pages/app/ProjectBoq.tsx`, `ProjectDrawings.tsx`, `ProjectExport.tsx`
- `src/pages/ops/BoqReviewWorkstation.tsx`, `OpsBoqBuilder.tsx`
- `supabase/deferred-migrations/README.md`, `docs/QUANTITY-TRUST-REMAINING.md`
- Tests:
  - `applyReviewBasis.test.ts`, `applyReviewSourceDocumentIntegrity.test.ts`, `JourneyApply.integration.test.tsx`
  - `ProjectBoq.test.tsx`, `ProjectDrawings.test.tsx`
  - `reviewDecisionSafety.test.ts`, `boqRevision.test.ts`, `boqDsrDocument.test.ts`
  - `OpsBoqBuilder.exportGuard.test.tsx`, `lineRemoval.test.ts`

All earlier uncommitted work on the branch (Phase 1, journey, quantity trust) was preserved. Nothing was reset, stashed or discarded.

## 7. Single highest-priority next step

With approval, apply the existing change-log migration (`20260921000000`) to **staging**, following `docs/audit-history-deployment.md`. Then run blocker 4's write paths there. It unlocks history, rates and DSR decision records everywhere, and it is the first real-PostgREST test of every guarded write.
