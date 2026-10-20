# Cunstruct execution plan: v1.2 — owner-only engineering preview

| | |
|---|---|
| **Version** | v1.2; effective on merge into `main` |
| **Date** | 18 Oct 2026 |
| **Supersedes for active execution** | v1.1 in `docs/PLAN-OF-RECORD-v1.1.md`; v1.0 in `docs/PLAN-OF-RECORD.md` remains an unchanged historical record |
| **Current-code reference** | `main` after the merge of PRs #170, #171, #163 and #166 (reported head: `49be4f6`) |
| **Purpose** | Allow substantial, owner-only engineering progress without pretending that external validation, a staging environment, or a commercial release has occurred |

## 1. Operating constraints

This version records the current execution constraints:

- Use the existing Supabase production project only. Do not create or reactivate projects or branches, and do not treat the existing production database as staging.
- Work with the owner as the only reviewer/operator. Do not recruit participants, conduct outreach, or ask for new drawing sets.
- Do not search for external sources. Use only existing repository material and already-available catalogue data. Do not claim that standards or rates have been independently verified where they have not.
- No production migration, production data change, or production configuration change without specific approval. Merging application code may trigger the existing Vercel deployment; new preview work must remain behind an off-by-default feature flag and must not write to production data.
- Existing drawings already used during development are not an independent benchmark. Repository fixtures and synthetic records may be used for interface and software tests only; their results must never be presented as accuracy evidence.
- Keep credentials, drawing files, measurement references, interview material and private project data out of Git.

These constraints govern execution until the owner changes them. They are not evidence that the unmet criteria have passed.

## 2. Two different outcomes — never conflate them

### A. Owner-only engineering preview

The near-term objective is to build and exercise major workflow improvements using deterministic mock data and existing test fixtures. The preview may demonstrate interaction and software behaviour only. It is **not** a claim of measured take-off accuracy, standards compliance, customer validation, commercial readiness or permission to run schema migrations.

Preview acceptance requires:
1. New work stays behind an off-by-default flag and leaves existing production paths intact.
2. New workflows can be exercised with local/mock fixtures without production reads or writes.
3. Relevant automated tests, build, typecheck and changed-file lint pass against recorded repository baselines.
4. Unknown quantities and unverified prices remain visibly provisional; no synthetic output is described as a benchmark result.
5. The owner can inspect a Vercel Preview or local preview without a new Supabase project.

### B. Commercial release

A commercial release remains blocked until the applicable evidence and operational gates in sections 4–6 pass. The engineering-preview outcome does not waive, satisfy, or relabel those gates. Nothing in v1.2 permits automatic quantity acceptance, unverified rate claims, or production database migrations without the required approval.

## 3. Current core and database safety

Statuses below reflect evidence available when this version was written. Re-check deployment-specific items against the current release commit.

| ID | Requirement | Current status and evidence |
|---|---|---|
| R1 | Exclude-instead/share-panel core fix | **DONE** — PR #161 merged; prior evidence in v1.0 |
| R2 | Ready Production deployment of the current `main` commit, with no newer failed deployment | **DONE (§8 evidence, 18 Oct 2026)** — Production deployment `7153607502` of `main` @ `e64cf6c`, status success; newest Production deployment. Re-check against the release commit |
| R3 | Deployed `workspace-share` version/date plus live pending-line share check | **PARKED (owner decision, 20 Oct 2026)**: sharing is not needed now and is set aside completely; it may be picked up later. Not done, and not to be worked on until the owner reopens it |
| R4 | Separate staging Supabase project and guarded connection | **REPLACED (owner decision, 20 Oct 2026)**: the local Postgres rehearsal (PR #177) stands in for staging; no staging project will be created |
| R5 | Apply `20260921000000_boq_review_apply.sql` on staging | **REPLACED (owner decision, 20 Oct 2026)**: the migration was applied and re-run in the local rehearsal, PR #177, 17/17 |
| R6 | Verify Apply, conflict, undo, DSR decision and rate-edit write paths on staging | **REPLACED (owner decision, 20 Oct 2026)**: write paths verified in the local rehearsal (PR #177): Apply, conflict, undo, DSR decisions, rate edits |
| R7 | Apply the change-history migration to production | **APPROVED (owner decision, 20 Oct 2026), NOT YET APPLIED**: execute per `docs/R7-PRODUCTION-MIGRATION-RUNBOOK.md` with a verified backup first. Not done until the post-checks pass |
| R8 | Decide whether to include the deferred commercial-migration chain | **DEFER FOR THIS SCOPE** — no staging environment is available and no part of the chain may be applied to production under this plan |
| R9 | Deferred migration chain on staging | **DEFERRED** under R8 |
| R10 | Click-to-Identify pre-existing Playwright failure | **DONE** — PR #169 merged; evidence recorded in v1.0 §7 |
| R11 | Deferred migration chain on production | **DEFERRED** under R8; no production approval is granted |

The R8 decision applies to the chain in `supabase/deferred-migrations/` as one unit: no migration in that chain is applied to staging or production for the owner-only engineering preview. Deferral is not completion and must be reconsidered before a commercial release.

## 4. Evidence and discovery: commercial-release gates

These criteria remain required for commercial claims, but are not prerequisites for deterministic interface work in the owner-only preview. No item below may be marked DONE without its actual evidence.

| ID | Requirement | Status under current constraints |
|---|---|---|
| E1a | First qualifying, permitted drawing set with extraction-before-reference, two independent QS sheets, adjudication and scope tags | **BLOCKED** — no new drawing set is to be acquired |
| E1 | 10–20 independent real drawing sets across the required typologies and modalities | **BLOCKED** — no qualifying set collection exists; previously used drawings cannot be counted as independent benchmark sets |
| E2 | Protocol v1.1 scoring, gates G1–G6, category metrics and raw versus human-corrected results | **NOT STARTED / BLOCKED BY E1** — existing tooling and synthetic tests are not real benchmark evidence |
| E3 | Primary-source confirmation of IS 1200, CPWD DSR basis and tender blank-versus-zero rules | **PARTIAL (§8, 19 Oct 2026)**: the DSR 2023 basis is confirmed from the owner-supplied CPWD Vol. 1 (two volumes; basis 01.04.2023; GST @18% included in item rates; cost index 107 vs PAR 2021). IS 1200 texts (all 28 parts) were read and the deduction rules confirmed, but encoding them in the app is deferred by owner decision. Location cost index and tender blank-versus-zero rules are still unverified, so E3 is **not** done |
| E4 | 10–12 contextual interviews and an evidence-based synthesis | **DROPPED FOR CLOSURE (owner decision, 20 Oct 2026: "drop unimportant things")**: no outreach under current scope. Not done |
| E5 | Positioning decision supported by real E2 and E4 evidence | **DROPPED FOR CLOSURE (owner decision, 20 Oct 2026: "drop unimportant things")**: no outreach under current scope. Not done |

Use the current repository DSR/AOR catalogue for internal development where appropriate, but label outputs as provisional and catalogue-derived. Do not claim that the catalogue itself proves official rates, source dates, code compliance or take-off accuracy.

## 5. Design and build: two lanes

### 5A. Commercial-validation lane

The original research gates remain intact:
- D1 is complete: design-system implementation merged in PR #164, with contrast and browser evidence recorded previously.
- D2-commercial still requires the qualifying E1a project and its adjudicated reference.
- D3-commercial still requires the defined multi-participant study and all four pass conditions from v1.1.
- Commercial sign-off, the external pilot and removal of old routes cannot be claimed without their evidence.

D3 is therefore **not done**. Owner review is not a replacement for its study.

### 5B. Owner-only engineering lane

The following work may proceed behind an off-by-default feature flag, using only local/mock fixtures. It does not change the commercial gate statuses.

| ID | Work | Acceptance for the engineering preview | Status |
|---|---|---|---|
| I1 | Interactive prototype shell | Implement the five named surfaces from D2 — workspace, verify queue, coverage map, sign-off sheet and revision delta — using deterministic mock records or existing test fixtures. Any rupee figures are explicitly illustrative/provisional; no accuracy metrics are presented as real | **DONE (§8 evidence, 18 Oct 2026)** — five surfaces on deterministic mock records, labelled illustrative; certification unavailable; tests 4/4 after PR #175 |
| I2 | Workspace shell (derived from B1) | One workspace frame containing drawing canvas, BOQ grid and a one-line sign-off ledger. Keyboard interactions cover Enter, Tab, F2, arrows and paste-range behaviour. Existing routes remain available | **DONE (§8 evidence, 19 Oct 2026)**: mock-only workspace frame from PR #179; not a commercial B1 acceptance |
| I3 | Drawing-context presentation (derived from B2) | Test fixtures demonstrate linked drawing regions and BOQ lines. Missing or uncertain regions are labelled unavailable/unverified, never silently represented as verified quantities. No new drawing acquisition | **DONE (§8 evidence, 19 Oct 2026)**: fixture regions only; not a commercial B2 acceptance |
| I4 | Preview quality and isolation gate | New flows operate with deterministic fixtures; test coverage demonstrates they do not write to production. Feature flag defaults off. Relevant tests, build, typecheck and changed-file lint pass against recorded baselines | **DONE (§8 evidence, 19 Oct 2026)**: for the preview as of `a4afb42`; re-run for any later preview change |

I1 is the first engineering milestone. I2 and I3 may proceed once their interfaces are clear; I4 must pass before any preview is offered. Work may use mock adapters where a real database write path is blocked. Do not build a new testing framework or database to support this lane.

B1–B12 remain the formal commercial build scope. Work on a B-series item within the preview lane is allowed only when it can be implemented safely with existing code and fixtures; it must not be marked commercially complete merely because a mock-backed version exists. Items dependent on official-source verification, a real tender file, staging migrations, independent benchmark evidence or the D3 study remain blocked for commercial acceptance.

The old workflow must not be removed or replaced in production under the preview lane. Do not change database schemas, create migrations, alter production data or perform destructive route removals as part of I1–I4.

## 6. Commercial release gate

The commercial release gate remains closed until the relevant evidence is available for:
- R2 and R3 on the actual release candidate;
- R4–R7, including staging write-path evidence and separately authorised production migration;
- E1/E2/E3/E4/E5;
- D2-commercial and a passing D3 study;
- the mandatory B-series acceptance criteria and live pilot;
- full verification and a signed release decision.

The owner-only preview gate is separate: I1–I4 may produce an internal engineering preview, but that is not a commercial release and must not be described as one.

No synthetic score, repository-only check, successful build, or owner walkthrough can satisfy a real-data or multi-participant acceptance criterion.

## 7. Standing rules

1. Unknown quantity, provenance, source or rate stays unknown.
2. No auto-accept of AI quantities until real E2 calibration and the required shadow-mode trial pass.
3. No production migration, production data change or production configuration change without explicit approval.
4. A local test never satisfies a staging or production acceptance criterion.
5. Label evidence as synthetic/mock, local, staging or production.
6. Accessibility and `en-IN` formatting remain acceptance requirements, not polish.
7. Keep the v1.0 and v1.1 documents unchanged as historical records. In this version only status cells and the evidence/change logs may be updated after acceptance criteria are met.

## 8. Evidence log

| Date | Item | Evidence | Recorded by |
|---|---|---|---|
| 18 Oct 2026 | R1 | PR #161 merged; prior evidence recorded in v1.0 | Repository record |
| 18 Oct 2026 | R10 | PR #169 merged; Click-to-Identify tests and integrated Playwright evidence recorded in v1.0 | Repository record |
| 18 Oct 2026 | D1 | PR #164 merged; design-system and contrast/browser evidence recorded in v1.0 | Repository record |
| 18 Oct 2026 | R2 | PR #171 evidence applies to `788a2c0` only; it must be refreshed for the current main/release commit | Repository record |
| 18 Oct 2026 | R3 | Deployed server implementation compared with the source at `788a2c0`; live share-link check still outstanding | Repository record |
| 18 Oct 2026 | I1 | PR #173 merged at `62daefd`; Vercel Preview READY for source commit `5caff45`; local test execution still outstanding | Repository record |
| 18 Oct 2026 | I1 | [PR #175](https://github.com/rutvijkarkhanis/cunstruct/pull/175) merged at `03d0b94`: 2 of the 4 `EngineeringPreview` tests had failed on `c5285ed` (a corrected line vanished from the demo queue; inconsistent quantity labels); after the fix 4/4 pass; full Vitest 2,953/2,953; tsc 408 (baseline, no new signatures); ESLint clean on changed files; `vite build` passes. LOCAL evidence | Claude Code |
| 18 Oct 2026 | R2 | GitHub Deployments API: Production deployment `7153607502` by `vercel[bot]` for `main` @ `e64cf6c73742d51d7a1c00493cd0b5218da0a856`, status `success` at 2026-10-18T11:02:24Z (`https://cunstruct-m9q46muh7-whistleblower.vercel.app`); newest of the 5 most recent Production deployments, so none newer failed. PRODUCTION evidence via Vercel's GitHub integration; true as of `e64cf6c` — re-check for any later `main` commit and at the release commit | Claude Code |
| 18 Oct 2026 | R7 (preparation only) | [PR #174](https://github.com/rutvijkarkhanis/cunstruct/pull/174): `docs/R7-PRODUCTION-MIGRATION-RUNBOOK.md`. PRODUCTION read-only state (test account, `select … limit 0`): `boq_line_change_log` absent; the migration's dependencies present; no table of `20261003`–`20261008` present. Nothing applied. R7 status unchanged | Claude Code |
| 18 Oct 2026 | — (release defects) | [PR #176](https://github.com/rutvijkarkhanis/cunstruct/pull/176): audit-panel "Set qty" now uses the guarded, recorded edit path (refuses a stale write, records history or shows "not recorded", leaves the finding open if nothing was written); "Add lines from JSON" is recorded. Full Vitest 2,959/2,959 on the merged head; tsc 406. LOCAL evidence | Claude Code |
| 18 Oct 2026 | R4–R6 (local rehearsal only) | [PR #177](https://github.com/rutvijkarkhanis/cunstruct/pull/177): PGlite (real Postgres) rehearsal, 17/17: full migration chain and the change-history migration apply and re-run as no-ops; deferred chain `20261003`–`20261008` applies; Apply with/without change log, edit conflict, remove → undo, exclude → undo, DSR Accept/Reject/Defer/Undo, schedule rate, manual rate edit, RLS on the change log. LOCAL evidence: it does **not** change R4–R6 under v1.2, which require staging | Claude Code |
| 19 Oct 2026 | I2 | `a4afb42` (PR #179): `src/preview/workspace/WorkspaceShell.tsx` puts the drawing canvas, BOQ grid and one-line sign-off ledger in one frame. The grid handles arrows, Tab/Shift+Tab, Enter/Shift+Enter, F2, typing to edit, Delete, Escape and paste-a-range, and rejects a malformed paste with nothing changed. Existing routes are untouched. `WorkspaceShell.test.tsx` and `model.test.ts` pass. Playwright `engineeringPreviewWorkspace.spec.ts` passes 6/6 in Chromium at 1440×900 and 390×844 (keyboard operation, focus ring, two-way region links, no page overflow). MOCK/LOCAL evidence | Claude Code |
| 19 Oct 2026 | I3 | `a4afb42`: fixture drawing regions link to BOQ lines both ways. `regionLink()` returns `none` for a line with no region and `unverified` for an uncertain link, the ledger counts both, and neither is shown as verified. No drawing was acquired. Tests are as for I2. MOCK/LOCAL evidence | Claude Code |
| 19 Oct 2026 | I4 | `a4afb42`. **Tests:** preview-lane Vitest (`src/preview`, `src/lib/{preview,measurement,priceFirst,tenderExport}`, `EngineeringPreview*`) 14 files, 138/138. `EngineeringPreview.isolation.test.tsx` passes. It covers: flag off → preview hidden; no `.env*` file turns the flag on; no Supabase call or write from any tab. **Playwright:** preview specs 8/8 on three consecutive runs. One earlier run, the first cold start straight after a fresh `npm ci`, failed once at the mobile "no console error" assertion and has not reproduced. **Static checks:** tsc 406 (baseline, no new errors); ESLint clean on preview files; `vite build` passes. `npm run build` fails at its sitemap step, which fetches from production and cannot resolve the host from this container; this is unrelated to the preview. LOCAL evidence: it says nothing about commercial gates | Claude Code |
| 19 Oct 2026 | E3 (DSR part) | CPWD *Delhi Schedule of Rates 2023* Vol. 1, a scan supplied by the owner (Supabase `project-drawings`; SHA-256 recorded in `docs/benchmarks/E3-PRIMARY-SOURCE-REGISTER.md` §2.0). **Basis facts, with page references (register §2.1, §3.1, §4.1):** two volumes; rate basis April 2023 / 01.04.2023; "GST @18% … incorporated in all items"; basic rates exclude GST, profit and overheads; cost index 107 vs PAR 2021. **Seed check, sub-heads 2–12 (register §2.5):** 1,075 of 1,076 checkable rates match; 6.44 differs (₹59.45 printed vs ₹60.85 seeded); 104 printed items are missing from the seed; 36 items unresolved because 5 pages are blank in the scan. No data corrected. PRIMARY-SOURCE evidence, owner-supplied copy | Claude Code |
| 19 Oct 2026 | — (release defect) | [PR #189](https://github.com/rutvijkarkhanis/cunstruct/pull/189) merged at `ca3880b`. GST was being added a second time on DSR-rated lines, against DSR 2023 preface §6.2; it is now added only on lines priced at the estimator's own rate. All 27 saved BOQs used the defaults: an all-DSR BOQ of ₹1,00,000 works now totals ₹1,19,180 instead of ₹1,40,632. Full Vitest 3,184/3,184; tsc 406. The `workspace-share` edge-function change is **not deployed**, so public share links still show the old total until it is. LOCAL evidence | Claude Code |
| 20 Oct 2026 | E3 (IS 1200 deductions) | **Owner decision:** "We will have to skip deductions for now." IS 1200 deduction-rule confirmation is deferred. This is not evidence: deduction rules remain unconfirmed, E3 cannot be marked DONE while they are deferred, and no deduction may be labelled as rule-verified | Owner, recorded by Claude Code |
| 20 Oct 2026 | R3 / sharing | **Owner decision:** "There is no sharing that is needed anymore. We may pick it up later on, but we need to park it completely." R3, the share-link edge-function redeploy and the share-link parts of B10 are parked. This is not evidence: R3 is not done. One existing production share link (project "Srikakulam Apartment", named "rahul") is still active and was not changed | Owner, recorded by Claude Code |
| 20 Oct 2026 | R4–R7 | **Owner decisions:** "Accept the local rehearsal in place of staging (R4–R6)" and "go" for R7. R4–R6 are marked REPLACED; their evidence is the LOCAL rehearsal (PR #177), not staging. R7 is approved but **not applied**: this environment has no database credentials, so it must be run by the owner in the SQL editor per the runbook, or by Claude Code once a database connection secret is provided | Owner, recorded by Claude Code |
| 20 Oct 2026 | Scope for closure | **Owner instruction:** "Drop unimportant things". Selected by Claude Code under that instruction, and the owner may reverse any of it. Dropped for closure: E4, E5, the D3 multi-participant study, the external pilot (P1), B10 phone surfaces and B12 removal of old surfaces. Already parked or deferred: R3 / sharing, R8, R9, R11, and IS 1200 deductions. These are **not done**; they are removed from the closure path, not passed | Owner, recorded by Claude Code |
| 20 Oct 2026 | E3 (DSR Vol. 2) | CPWD DSR 2023 Vol. 2 (owner-supplied scan, SHA-256 in register §2.6) checked against all 1,645 seed items in sub-heads 13–26. 1,627 match. Wrong rows, each checked on the page image: 5 wrong rates (including 13.114, printed 1,192.30 vs 138.10 seeded), 8 appendix coefficients stored as rates, 1 parse artefact, 4 wrong units. 262 printed items are missing from the seed. None of these items is used in the 27 saved BOQs. No data corrected. PRIMARY-SOURCE evidence, owner-supplied copy | Claude Code |
| 20 Oct 2026 | E3 (IS 1200) | Owner-supplied BIS IS 1200 parts 1–28 (29 files) catalogued with edition, completeness and SHA-256 (`docs/benchmarks/e3/is1200-register.json`). Building-BOQ measurement and deduction rules extracted with clause and page references (`docs/benchmarks/e3/is1200-rules.md`). Part 5 is superseded by a 2025 revision that was not supplied. Rules not yet encoded in the app (deferred by owner). PRIMARY-SOURCE evidence, owner-supplied copies | Claude Code |
| 20 Oct 2026 | E3 (DAR) / release defects | CPWD *Delhi Analysis of Rates 2023* civil, Vol. I and Vol. II, dated 14.09.2023 (owner-supplied; SHA-256 `90fb3402…eb3e`, `a691932e…bbc8`). **(1)** The DAR rate build-up shows DSR item rates already include 1% water, GST, 15% contractor's profit and overheads and 1% cess (item 2.1.1: 12,983.55 per 100 sqm, which is the DSR rate of 129.85 per sqm). [PR #197](https://github.com/rutvijkarkhanis/cunstruct/pull/197) merged: overhead and cess are no longer added on DSR-rated lines. An all-DSR ₹1,00,000 BOQ totals ₹1,03,000 (₹1,40,632 before #189). **(2)** 2,707 of 2,731 DAR "Say" rates agree with the DSR seed. **(3)** The coefficient seed (`dsr_coefficient`, 8,930 rows) is **unsafe for quantities**. It stores per-batch DAR quantities as per-unit (5,582 rows), and 634 rows are misattributed. 555 plant and labour rows are tagged `material`. Bricks, fasteners and mortar/concrete sub-analyses are missing, and only 446 of 2,318 items are fully clean (`docs/benchmarks/e3/dar2023-coefficient-summary.md`). The BOQ builder's material schedule now withholds figures until the table is rebuilt (PR "fix: withhold AOR material schedule"). PRIMARY-SOURCE evidence | Claude Code |

## 9. Change history

| Version | Date | Change | Reason |
|---|---|---|---|
| v1.0 | 17 Oct 2026 | Historical frozen plan | Original closure-sprint release plan |
| v1.1 | 17 Oct 2026 | Historical plan | Added first-set milestone, a defined D3 study, and a deferrable migration chain |
| v1.2 | 18 Oct 2026 | Separates an owner-only engineering preview from commercial release; adds I1–I4; keeps real evidence and production-migration gates intact; records current constraints and defers the optional migration chain | The current operating constraints exclude new Supabase projects, external drawing acquisition, outreach and external-source research. This permits material, testable engineering progress without falsely claiming validation or bypassing production safety gates |
