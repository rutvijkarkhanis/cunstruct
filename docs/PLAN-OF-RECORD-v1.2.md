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
| R2 | Ready Production deployment of the current `main` commit, with no newer failed deployment | **NOT STARTED** — PR #171 recorded success for `788a2c0`, but subsequent PR merges changed `main`; that evidence is not proof for the new head |
| R3 | Deployed `workspace-share` version/date plus live pending-line share check | **BLOCKED** — version 33 and server-source comparison were observed for the prior code head, but no existing share URL is available to complete the live check. No link is to be created for this task |
| R4 | Separate staging Supabase project and guarded connection | **BLOCKED BY CURRENT CONSTRAINT** — only the production project is active/available; do not substitute production |
| R5 | Apply `20260921000000_boq_review_apply.sql` on staging | **BLOCKED BY R4** — not run |
| R6 | Verify Apply, conflict, undo, DSR decision and rate-edit write paths on staging | **BLOCKED BY R5** — not run |
| R7 | Apply the change-history migration to production | **BLOCKED BY R6 AND EXPLICIT APPROVAL** — do not run |
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
| E3 | Primary-source confirmation of IS 1200, CPWD DSR basis and tender blank-versus-zero rules | **BLOCKED BY CURRENT SCOPE** — no external source research is authorised; repository data alone is not proof of primary-source verification |
| E4 | 10–12 contextual interviews and an evidence-based synthesis | **BLOCKED BY CURRENT SCOPE** — no recruitment or outreach |
| E5 | Positioning decision supported by real E2 and E4 evidence | **BLOCKED BY E2 AND E4** — no claims of customer validation or proven positioning |

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
| I1 | Interactive prototype shell | Implement the five named surfaces from D2 — workspace, verify queue, coverage map, sign-off sheet and revision delta — using deterministic mock records or existing test fixtures. Any rupee figures are explicitly illustrative/provisional; no accuracy metrics are presented as real | **IN PROGRESS** — PR #173 merged; Vercel Preview READY; focused tests/typecheck/lint still need local execution |
| I2 | Workspace shell (derived from B1) | One workspace frame containing drawing canvas, BOQ grid and a one-line sign-off ledger. Keyboard interactions cover Enter, Tab, F2, arrows and paste-range behaviour. Existing routes remain available | NOT STARTED |
| I3 | Drawing-context presentation (derived from B2) | Test fixtures demonstrate linked drawing regions and BOQ lines. Missing or uncertain regions are labelled unavailable/unverified, never silently represented as verified quantities. No new drawing acquisition | NOT STARTED |
| I4 | Preview quality and isolation gate | New flows operate with deterministic fixtures; test coverage demonstrates they do not write to production. Feature flag defaults off. Relevant tests, build, typecheck and changed-file lint pass against recorded baselines | NOT STARTED |

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

## 9. Change history

| Version | Date | Change | Reason |
|---|---|---|---|
| v1.0 | 17 Oct 2026 | Historical frozen plan | Original closure-sprint release plan |
| v1.1 | 17 Oct 2026 | Historical plan | Added first-set milestone, a defined D3 study, and a deferrable migration chain |
| v1.2 | 18 Oct 2026 | Separates an owner-only engineering preview from commercial release; adds I1–I4; keeps real evidence and production-migration gates intact; records current constraints and defers the optional migration chain | The current operating constraints exclude new Supabase projects, external drawing acquisition, outreach and external-source research. This permits material, testable engineering progress without falsely claiming validation or bypassing production safety gates |
