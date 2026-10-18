# Cunstruct plan of record: v1.0 (frozen)

| | |
|---|---|
| **Frozen** | 17 Oct 2026 |
| **Baseline code** | `main` @ `6206e8c` (includes PR #160 and PR #161) |
| **Source documents** | `reports/Cunstruct redesign first principles.md` (research report, local working file, not committed)<br>`docs/closure/CORE-CLOSURE-REPORT.md`<br>`docs/benchmarks/BENCHMARK-EXECUTION-PLAN.md`<br>`docs/audit-history-deployment.md` |
| **Release rule** | The project is released only when **every item in sections 1–5 is DONE** with its evidence recorded (§7). |

## How to use this document

- **Item format.** Each item has:
  - an **ID**;
  - an **owner**: PO (product owner), ENG (engineering) or OPS (authorised database/infra operator);
  - **depends on**: the IDs that must be DONE first;
  - **done when**: an objective test, not an opinion;
  - **evidence**: the artefact that proves it.
- **Status.** Statuses are `NOT STARTED`, `IN PROGRESS`, `BLOCKED (reason)` and `DONE (evidence link, date)`. Only status cells and the evidence log (§7) change while this version is in force.
- **Change control.** Adding, removing or redefining an item or a "done when" test needs a new version (v1.1, v2.0…) with a dated entry in §8 explaining why. Never edit a frozen test to make an item pass.
- **No silent claims.** An item is DONE only when its evidence exists and is linked. "Tested locally" never satisfies an item that says staging or production.

---

## 1. Release the current core safely

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| R1 | ENG | Exclude-instead and share-panel fix | — | PR #161 merged to `main` | `main` @ `6206e8c` | **DONE (17 Oct 2026)** |
| R2 | PO | Verify the Vercel production deployment | — | Vercel shows a **Ready** Production deployment of the current `main` commit, and no newer deployment is failed, errored or cancelled | Screenshot or deployment URL + commit SHA | **DONE (§7 evidence, 18 Oct 2026)** |
| R3 | PO/OPS | Verify the `workspace-share` edge-function version | — | The deployed function's version/date is recorded. If older than `main`, it is redeployed with approval, and a pending line on a share link shows "Quantity pending" with no amount | Supabase dashboard record; share-link check | NOT STARTED |
| R4 | PO | Provide staging access | — | A staging Supabase project and credentials exist, configured per `docs/staging-validation-stage3-6.md`; the staging guard refuses production | `npm run staging:migrate` dry run output (refs only, no secrets) | NOT STARTED |
| R5 | OPS | Apply the change-history migration on **staging** | R4 | `20260921000000` applied on staging, with the runbook pre- and post-checks passing | Runbook output | NOT STARTED |
| R6 | ENG | Write paths verified on staging | R5 | Each of these passes on staging, with the expected change-log rows confirmed by query:<br>Apply, with and without the change log<br>an edit conflict between two sessions<br>remove → undo<br>exclude-instead → undo<br>DSR Accept / Reject / Defer / Undo<br>schedule rate<br>manual rate edit | Test log with row counts | NOT STARTED |
| R7 | PO + OPS | Production change-history migration | R6 | Verified backup taken; read-only preflight run; `20260921000000` applied to production per `docs/audit-history-deployment.md`; post-checks pass; removal and rate edits work in production | Runbook output, backup manifest | NOT STARTED |
| R8 | PO | Decide on commercial revisions | — | Written decision: ship revisions in this release (→ R9) or defer (record it in §8) | Decision note | NOT STARTED |
| R9 | ENG + OPS | Revisions migration chain (only if R8 = ship) | R5, R8 | `npm run staging:migrate` applies `20261003`→`20261008` in order on staging. Freeze → edit → diff → freeze → export passes on staging. The chain is then applied to production with approval | Staging and production logs | NOT STARTED |
| R10 | ENG | Pre-existing Playwright failure | — | `e2e/clickToIdentify.spec.ts` either passes, or is replaced by a spec whose purpose is stated. No test is skipped to make it pass | CI/local run output | **DONE (§7 evidence, 18 Oct 2026)** |

## 2. Evidence foundations (before any redesign is built)

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| E1 | PO | Benchmark inputs | — | 10–20 real Indian drawing sets (residential, commercial, institutional; vector and scanned) with usage permission. Two independent experienced QS produce IS 1200 measurement sheets per set, reconciled by adjudication. In/out-of-contract tags recorded | Input register with SHA-256 per drawing; reference files kept outside Git | NOT STARTED |
| E2 | ENG | Benchmark run | E1 | `scripts/benchmark/score-set-a.test.ts` run per protocol v1.1 on every set. Gates G1–G6 reported. For each element category, **raw machine** recall, precision, quantity error and ₹-weighted error are reported **separately** from human-corrected results | `gates.json` + summary report per set | NOT STARTED |
| E3 | PO/ENG | Primary-source verification | — | BIS IS 1200 texts obtained and the deduction rules confirmed. DSR 2023 volume count, rate basis date, GST treatment and cost-index values confirmed from CPWD documents. Blank-versus-zero rules documented for each target tender portal | Source register with document references | NOT STARTED |
| E4 | PO | Discovery interviews | — | 10–12 contextual interviews done: billing engineers at small, mid-size and EPC contractors; freelance BOQ preparers; 2–3 contractor-owners. The report's questions are answered (how a BOQ is checked, who signs, locked BoQ files, percentage-rate bids, WhatsApp flow, sampling certificate) | Interview synthesis document | NOT STARTED |
| E5 | PO | Positioning decision | E2, E4 | Written decision based on E2 and E4: "AI take-off" or "assisted measurement sheet", plus the primary user and the pricing hypothesis (per BOQ, per bid check, or material margin) | Decision note | NOT STARTED |

## 3. Redesign: validate before building

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| D1 | ENG | Design system | — | Tokens and components cover:<br>colour used only for meaning, with an icon and text on every status (WCAG 1.4.1)<br>tabular figures and `en-IN` lakh/crore money<br>24 px minimum targets (WCAG 2.5.8)<br>a non-drag alternative for every drag (WCAG 2.5.7)<br>light and dark themes, with drawings always rendered light | Design-system page + automated contrast checks | **DONE (§7 evidence, 18 Oct 2026)** |
| D2 | ENG | Clickable prototype | D1 | Five screens on a real benchmark project: **workspace** (canvas plus BOQ grid, linked both ways), **verify queue** (money-at-risk ordering, evidence first, one-key accept / type-over correction), **coverage map**, **sign-off sheet** (key items, sample, residual ₹ error), **revision delta** | Prototype link | NOT STARTED |
| D3 | PO + ENG | Prototype test | D2, E4 | 6–8 billing engineers per condition. Three conditions: (a) today's item-by-item review, (b) money-at-risk queue with evidence first, (c) (b) plus coverage sweep and sampling sign-off. Seeded quantity errors and omissions. **Pass:** condition (c) has lower residual ₹ error than (a) and than AI alone, a higher omission catch rate, and no collapse on rare high-value errors | Study report with metrics | NOT STARTED |

## 4. Build: one workspace, price first, verify by rupees, certify by sampling

Building starts only after D3 passes. Every item ships behind a flag until §5 passes.

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| B1 | ENG | Workspace shell | D3 | One project workspace (canvas + Excel-like grid + one-line sign-off ledger) replaces the five tabs behind a flag. Grid keyboard behaviour matches Excel (Enter, Tab, F2, arrows, paste a range) | Tests + demo | NOT STARTED |
| B2 | ENG | Drawing everywhere | B1 | Every reviewable quantity renders its drawing region. A line with no region is shown as *unavailable*, never as a bare number. Every sheet has a scale badge; quantities on an inferred-scale sheet stay unverified until the scale is confirmed | Tests + demo | NOT STARTED |
| B3 | ENG | IS 1200 measurement rows | E3, B1 | Every quantity is stored and shown as No × L × B × D rows with deductions, a drawing reference and a rule citation. The existing quantity states are preserved | Tests | NOT STARTED |
| B4 | ENG | Price first | B3 | Every line has a provisional DSR 2023 rate (with cost index) or an explicit "no DSR match: market rate needed" **before** verification starts | Tests | NOT STARTED |
| B5 | ENG | Money-at-risk verify queue | B4 | Queue ordered by uncertainty × rate. Key items above a project materiality threshold are reviewed 100%. Reason codes are shown. Correction takes no more effort than accepting. No auto-accept. Optional "your figure first" on the top lines by value | Tests + D3-style check | NOT STARTED |
| B6 | ENG | Coverage sweep | B4 | Lists legend and note items with no line, regions with no detections, and expected scope that is missing (built from the schedule-exclusion suggestions). Each must be resolved or excluded with a reason before certification | Tests | NOT STARTED |
| B7 | ENG | Sampling sign-off | B5, B6 | Draws samples from three pools (accepted non-key lines, verified lines, no-detection regions). Reports residual ₹ error against tolerable error and widens the sample if exceeded. Records reviewer, time and drawing revision. Verification resets automatically when a line's inputs change | Tests + sign-off sample | NOT STARTED |
| B8 | ENG | Locked tender BoQ export | E3, B3 | The department's BoQ file is filled with rates only (order, descriptions and units untouched). Blank-versus-zero is a per-tender setting. Unmatched tender items are shown as gaps. The mapped file, measurement sheet and abstracts always agree | Round-trip test on real tender files | NOT STARTED |
| B9 | ENG | Revision delta | B3 | A new drawing revision gives old → new quantity and Δ₹ per line, sorted by \|Δ₹\|. Only affected lines reset to unverified | Tests + demo | NOT STARTED |
| B10 | ENG | Phone surfaces | B7, E4 | Offline-first phone views for: owner sign-off approval (summary, key risks, ₹ range); call-offs against certified lines; site measurement and photos; WhatsApp share links. Indian-language-ready | Device test log | NOT STARTED |
| B11 | ENG | Procurement from the BOQ | B7 | A certified BOQ → DAR material coefficients → time-phased call-offs to the contractor's **own dealer** (or a linked supplier). Material issued is reconciled against work done | Tests + pilot use | NOT STARTED |
| B12 | ENG | Remove the old surfaces | B1–B9 | The storefront is demoted to a fulfilment option reached from B11. The customer Ops console is collapsed to QA/benchmark, rate library and support. Old review screen, five tabs and warning paragraphs removed. No route is left orphaned | Route inventory diff | NOT STARTED |

## 5. Pilot and release gate

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| P1 | PO + ENG | Live pilot | §4 | 3–5 real bids with committed contractors, using the full flow. Measured: time to signed BOQ, residual ₹ error where a reference exists, repeat use, reuse of the BOQ for RA bills or call-offs, willingness to pay | Pilot report | NOT STARTED |
| P2 | ENG | Full verification on the release commit | P1 | Full test suite passes. Build passes. Type errors and lint are not above the frozen baseline (tsc 408, ESLint 180 errors / 22 warnings) with no new signatures. Migrations are applied in order on staging and production | CI/run log with commit SHA | NOT STARTED |
| P3 | PO | Release decision | All above | Every item in §1–§5 is DONE with linked evidence. The release commit SHA and the Vercel deployment are recorded. A rollback target is recorded | Signed release note | NOT STARTED |

## 6. Standing rules (apply to every item)

1. Never invent quantities, evidence, provenance or rates. Unknown stays unknown.
2. No auto-accept of AI quantities until E2 shows calibrated reliability for that category **and** a shadow-mode trial has passed. Any change to this rule requires a new version of this plan.
3. No production migration, deployment or data change without explicit approval. Staging comes first.
4. Every claim is labelled: mocked/local, staging, or production.
5. Accessibility (WCAG 2.2 AA) and `en-IN` money formatting are part of "done", not polish.

## 7. Evidence log

| Date | Item | Evidence | Recorded by |
|---|---|---|---|
| 17 Oct 2026 | R1 | PR #161 merged; `main` @ `6206e8c` | Claude Code |
| 18 Oct 2026 | R10 | [PR #169](https://github.com/rutvijkarkhanis/cunstruct/pull/169) merged to `main`; `e2e/clickToIdentify.spec.ts` passed 4/4 on three consecutive local Chromium runs; integrated Playwright suite passed 48/48 on the verified candidate. Local/mock-network evidence; repository has no GitHub test CI. | ChatGPT / GitHub |
| 18 Oct 2026 | D1 | [PR #164](https://github.com/rutvijkarkhanis/cunstruct/pull/164) merged to `main`; design-system reference page present; automated contrast test covers 106 colour pairs in both themes; real Chromium design-system spec passed 36/36 on each of three runs. Local evidence; not a production usability study. | ChatGPT / GitHub |
| 18 Oct 2026 | R2 | GitHub Deployments API, read 18 Oct 2026: deployment `7151081399`, environment **Production**, created by `vercel[bot]` for `main` @ `788a2c06f4c0aeed2995ae068ea4860b9b814497`; its deployment status is `success` (Vercel's Ready) at 2026-10-18T06:45:25Z, URL `https://cunstruct-195a9iwlu-whistleblower.vercel.app`. It is the newest Production deployment listed (the 8 most recent, back to `6206e8c`), so no newer deployment is failed, errored or cancelled. Production evidence via Vercel's GitHub integration, not a dashboard screenshot; true as of `788a2c0` and must be re-checked for any later `main` commit. | Claude Code |

## 8. Change history

| Version | Date | Change | Reason |
|---|---|---|---|
| v1.0 | 17 Oct 2026 | Frozen | Plan of record from the closure sprint, release status and redesign research |
