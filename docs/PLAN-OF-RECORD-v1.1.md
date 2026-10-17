# Cunstruct plan of record: v1.1

| | |
|---|---|
| **Version** | v1.1, approved by the PO for publication on 17 Oct 2026 (§8). In force from its merge into `main`; until then v1.0 controls |
| **Supersedes** | v1.0, frozen 17 Oct 2026: `docs/PLAN-OF-RECORD.md`, SHA-256 `9051a7a7682037b136123fb1e4d4573e8fd8decde70fa99a2b57321befe76d3e`. That file is kept byte-for-byte unchanged as the historical record |
| **Baseline code** | `main` @ `6206e8c` (includes PR #160 and PR #161) |
| **Source documents** | `reports/Cunstruct redesign first principles.md` (research report, local working file, not committed; SHA-256 `bc623699e4880bdbacc4535343e7decbdd3f54a2a08215454bc7edac4d24723a` on 17 Oct 2026). No "done when" test depends on it: every test below is self-contained<br>`docs/closure/CORE-CLOSURE-REPORT.md`<br>`docs/benchmarks/BENCHMARK-EXECUTION-PLAN.md`<br>`docs/audit-history-deployment.md` |
| **Release rule** | The project is released only when **every mandatory item in sections 1–5 is DONE** with its evidence recorded (§7), and **every release-optional item is either DONE or DEFERRED** with its authorising decision recorded (§7). The only release-optional items are **R9 and R11**, and only while R8 records a "defer" decision. Every other item is mandatory. |

## How to use this document

- **Item format.** Each item has:
  - an **ID**;
  - an **owner**: PO (product owner), ENG (engineering) or OPS (authorised database/infra operator);
  - **depends on**: the IDs that must be DONE first;
  - **done when**: an objective test, not an opinion;
  - **evidence**: the artefact that proves it.
- **Status.** Statuses are `NOT STARTED`, `IN PROGRESS`, `BLOCKED (reason)`, `DONE (evidence link, date)` and `DEFERRED (decision link, date)`. Only status cells and the evidence log (§7) change while this version is in force.
- **Deferral.** `DEFERRED` may be set only on a release-optional item (see the release rule), and only when the decision that allows it is DONE and recorded in §7. A deferred item's work is not done and must not be described as done. It is reopened only by a new written decision recorded in §7; it then needs DONE before release.
- **Change control.** Adding, removing or redefining an item or a "done when" test needs a new version (v1.1, v2.0…) with a dated entry in §8 explaining why. Never edit a frozen test to make an item pass.
- **No silent claims.** An item is DONE only when its evidence exists and is linked. "Tested locally" never satisfies an item that says staging or production.

---

## 1. Release the current core safely

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| R1 | ENG | Exclude-instead and share-panel fix | — | PR #161 merged to `main` | `main` @ `6206e8c` | **DONE (17 Oct 2026)** |
| R2 | PO | Verify the Vercel production deployment | — | Vercel shows a **Ready** Production deployment of the current `main` commit, and no newer deployment is failed, errored or cancelled | Screenshot or deployment URL + commit SHA | NOT STARTED |
| R3 | PO/OPS | Verify the `workspace-share` edge-function version | — | The deployed function's version/date is recorded. If older than `main`, it is redeployed with approval, and a pending line on a share link shows "Quantity pending" with no amount | Supabase dashboard record; share-link check | NOT STARTED |
| R4 | PO | Provide staging access | — | A staging Supabase project and credentials exist, configured per `docs/staging-validation-stage3-6.md`; the staging guard refuses production | `npm run staging:migrate` dry run output (refs only, no secrets) | NOT STARTED |
| R5 | OPS | Apply the change-history migration on **staging** | R4 | `20260921000000` applied on staging, with the runbook pre- and post-checks passing | Runbook output | NOT STARTED |
| R6 | ENG | Write paths verified on staging | R5 | Each of these passes on staging, with the expected change-log rows confirmed by query:<br>Apply, with and without the change log<br>an edit conflict between two sessions<br>remove → undo<br>exclude-instead → undo<br>DSR Accept / Reject / Defer / Undo<br>schedule rate<br>manual rate edit | Test log with row counts | NOT STARTED |
| R7 | PO + OPS | Production change-history migration | R6 | Verified backup taken; read-only preflight run; `20260921000000` applied to production per `docs/audit-history-deployment.md`; post-checks pass; removal and rate edits work in production | Runbook output, backup manifest | NOT STARTED |
| R8 | PO | Decide on the deferred cost-estimation migrations | — | Written decision on the chain in `supabase/deferred-migrations/` (`20261003` DSR mapping → `20261004` rate evidence → `20261005` rate adoption → `20261006`–`20261008` commercial revisions) **as one unit**: either it is in this release's scope (→ R9 and R11 are required), or it is deferred as a whole (→ R9 and R11 are set to DEFERRED, with this decision linked in §7). No part of the chain may ship without the rest. A defer decision authorises no production change: the chain stays in `supabase/deferred-migrations/` | Decision note | NOT STARTED |
| R9 | ENG + OPS | Deferred migration chain on **staging** (release-optional: required only if R8 = ship) | R5, R8 | `npm run staging:migrate` applies `20261003`→`20261008` in order on staging. Freeze → edit → diff → freeze → export passes on staging | Staging log | NOT STARTED |
| R11 | PO + OPS | Deferred migration chain on **production** (release-optional: required only if R8 = ship) | R7, R9 | With explicit approval, `20261003`→`20261008` are applied to production in order, through the reviewed PR that moves them into `supabase/migrations/` (`supabase/deferred-migrations/README.md`). Post-checks pass | Approval record, production log | NOT STARTED |
| R10 | ENG | Pre-existing Playwright failure | — | `e2e/clickToIdentify.spec.ts` either passes, or is replaced by a spec whose purpose is stated. No test is skipped to make it pass | CI/local run output | NOT STARTED |

## 2. Evidence foundations (before any redesign is built)

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| E1a | PO | First qualifying benchmark set | — | One drawing set meets every per-set condition of E1: usage permission held; SHA-256 recorded in the input register; extractor output saved and hashed before the reference is opened (protocol v1 §2, `docs/benchmarks/extraction-acceptance-protocol.md`); two independent QS IS 1200 measurement sheets received; reconciled by adjudication; in/out-of-contract tags recorded | Input-register row for that set, with hashes; reference files kept outside Git | NOT STARTED |
| E1 | PO | Benchmark inputs | E1a | 10–20 real Indian drawing sets (residential, commercial, institutional; vector and scanned) with usage permission. Two independent experienced QS produce IS 1200 measurement sheets per set, reconciled by adjudication. In/out-of-contract tags recorded | Input register with SHA-256 per drawing; reference files kept outside Git | NOT STARTED |
| E2 | ENG | Benchmark run | E1 | `scripts/benchmark/score-set-a.test.ts` run per protocol v1.1 on every set. Gates G1–G6 reported. For each element category, **raw machine** recall, precision, quantity error and ₹-weighted error are reported **separately** from human-corrected results | `gates.json` + summary report per set | NOT STARTED |
| E3 | PO/ENG | Primary-source verification | — | BIS IS 1200 texts obtained and the deduction rules confirmed. DSR 2023 volume count, rate basis date, GST treatment and cost-index values confirmed from CPWD documents. Blank-versus-zero rules documented for each target tender portal | Source register with document references | NOT STARTED |
| E4 | PO | Discovery interviews | — | 10–12 contextual interviews done: billing engineers at small, mid-size and EPC contractors; freelance BOQ preparers; 2–3 contractor-owners. The synthesis answers each of these questions from interview evidence, stating for each how many participants of each type gave which answer, and stating plainly where the evidence is absent or conflicting:<br>1. How do they check a BOQ today?<br>2. Who signs, and what would make them sign?<br>3. How do they handle locked BoQ files and percentage-rate bids?<br>4. How do drawings and orders actually move on WhatsApp?<br>5. Would a sampling certificate mean anything to them or to their clients? | Interview synthesis document | NOT STARTED |
| E5 | PO | Positioning decision | E2, E4 | Written decision based on E2 and E4: "AI take-off" or "assisted measurement sheet", plus the primary user and the pricing hypothesis (per BOQ, per bid check, or material margin) | Decision note | NOT STARTED |

## 3. Redesign: validate before building

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| D1 | ENG | Design system | — | Tokens and components cover:<br>colour used only for meaning, with an icon and text on every status (WCAG 1.4.1)<br>tabular figures and `en-IN` lakh/crore money<br>24 px minimum targets (WCAG 2.5.8)<br>a non-drag alternative for every drag (WCAG 2.5.7)<br>light and dark themes, with drawings always rendered light | Design-system page + automated contrast checks | NOT STARTED |
| D2 | ENG | Clickable prototype | D1, E1a | Five screens on the E1a benchmark set (its drawings, extractor output and adjudicated reference, as frozen in E1a): **workspace** (canvas plus BOQ grid, linked both ways), **verify queue** (money-at-risk ordering, evidence first, one-key accept / type-over correction), **coverage map**, **sign-off sheet** (key items, sample, residual ₹ error), **revision delta**.<br>₹ figures use a **study rate table**: DSR 2023 rates from the repository seed (`supabase/migrations/20260731001000_dsr_seed_civil.sql`), given to a line only where a person has confirmed that the DSR item matches the line. Every other line shows "No DSR match: market rate needed" and is left out of ₹ figures; the number left out is shown. No cost index is applied. The table is frozen and its SHA-256 recorded with the prototype. Every ₹ figure is labelled provisional until E3 is DONE | Prototype link; study rate table with SHA-256 | NOT STARTED |
| D3 | PO + ENG | Prototype test | D2, E4 | 6–8 billing engineers per condition, each allocated at random to one condition. Three conditions: (a) today's item-by-item review, (b) money-at-risk queue with evidence first, (c) (b) plus coverage sweep and sampling sign-off. Seeded quantity errors and omissions.<br>**Study pack, frozen and hashed before the first session:** the E1a set and its adjudicated reference; the **starting BOQ** (extractor output plus the seeded errors), identical in every condition; the seed list (each seeded error's line, type and ₹ size, including a low-prevalence, high-value class); the D2 study rate table; the time limit, identical in every condition; and the scoring script.<br>**Measures:** *residual ₹ error* of a BOQ = Σ over reference lines of \|final qty − reference qty\| × rate, with a missing line counted at its full reference value and a line with no reference counted at its full value, as a % of the reference total; lines with no study rate are excluded and counted. *AI alone* = the residual ₹ error of the starting BOQ with no human change: one number, computed by the scoring script. *Within tolerance* = the line's own tolerance, else the defaults in `docs/benchmarks/reference-boq-spec.md`. *Omission catch rate* = seeded omissions restored within tolerance ÷ seeded omissions. *High-value catch rate* = seeded errors in the low-prevalence, high-value class corrected within tolerance ÷ errors in that class.<br>**Pass** (all four): (1) median residual ₹ error in (c) < median in (a); (2) median in (c) < AI alone; (3) median omission catch rate in (c) > median in (a); (4) pooled high-value catch rate in (c) ≥ pooled rate in (a) | Study report: study-pack hashes, allocation record, per-participant measures, and the scoring script's output reproduced from the frozen pack | NOT STARTED |

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
| B10 | ENG | Phone surfaces | B7, B11, E4 | Offline-first phone views for: owner sign-off approval (summary, key risks, ₹ range); call-offs against certified lines; site measurement and photos; WhatsApp share links. Indian-language-ready | Device test log | NOT STARTED |
| B11 | ENG | Procurement from the BOQ | B7 | A certified BOQ → DAR material coefficients → time-phased call-offs to the contractor's **own dealer** (or a linked supplier). Material issued is reconciled against work done | Tests + pilot use | NOT STARTED |
| B12 | ENG | Remove the old surfaces | B1–B9, B11 | The storefront is demoted to a fulfilment option reached from B11. The customer Ops console is collapsed to QA/benchmark, rate library and support. Old review screen, five tabs and warning paragraphs removed. No route is left orphaned | Route inventory diff | NOT STARTED |

## 5. Pilot and release gate

| ID | Owner | Item | Depends on | Done when | Evidence | Status |
|---|---|---|---|---|---|---|
| P1 | PO + ENG | Live pilot | §4 | 3–5 real bids with committed contractors, using the full flow. Measured: time to signed BOQ, residual ₹ error where a reference exists, repeat use, reuse of the BOQ for RA bills or call-offs, willingness to pay | Pilot report | NOT STARTED |
| P2 | ENG | Full verification on the release commit | P1 | Full test suite passes. Build passes. Type errors and lint are not above the frozen baseline (tsc 408, ESLint 180 errors / 22 warnings) with no new signatures. Every migration in `supabase/migrations/` is applied in order on staging and production; the chain in `supabase/deferred-migrations/` is applied as well unless R9 and R11 are DEFERRED, in which case it is applied to neither production nor the release | CI/run log with commit SHA | NOT STARTED |
| P3 | PO | Release decision | All above | The release rule is met: every mandatory item in §1–§5 is DONE with linked evidence, and R9 and R11 are DONE or DEFERRED under R8. The release commit SHA and the Vercel deployment are recorded. A rollback target is recorded | Signed release note | NOT STARTED |

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

## 8. Change history

| Version | Date | Change | Reason |
|---|---|---|---|
| v1.0 | 17 Oct 2026 | Frozen | Plan of record from the closure sprint, release status and redesign research |
| v1.1 | 17 Oct 2026 (approved by the PO for publication; in force on merge into `main`) | (1) Release rule, status list, R8, P2 and P3: adds `DEFERRED` for release-optional items (R9, R11 only); R8 decides the deferred chain as one unit, and deferral authorises no production change. (2) R9 split into R9 (staging) and new R11 (production), which depends on R7. (3) New E1a; E1 and D2 depend on it. (4) D2: names the benchmark set and the study rate table. (5) D3: defines the study pack, allocation, measures, "AI alone" and the pass rule. (6) E4: questions written out. (7) B10 and B12 depend on B11 | (1) Under v1.0 a "defer" decision made release impossible and had to be written into §8. (2) `20261005` writes to `boq_line_change_log`, which production gets only from R7 (`supabase/deferred-migrations/README.md`). (3)–(4) D2 required "a real benchmark project" and ₹ figures but depended only on D1. (5) "AI alone" was undefined and the design unstated. (6) E4 relied on an uncommitted report. (7) Both items' tests name B11 features |
