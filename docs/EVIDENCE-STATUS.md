# Evidence status: E1, E2, E4

**Last updated:** 18 Oct 2026 · **Updated by:** Claude Code (from the repository; no set or interview exists)

The plan of record ([PLAN-OF-RECORD.md](PLAN-OF-RECORD.md), v1.0) decides when an item is DONE. This page only counts progress towards it, and never changes a plan status. Rules:

- **Counts and fingerprints only.** No names, contacts, project names, drawings or quantities. Those stay in the ignored local registers (`benchmark-inputs/E1/REGISTER.local.md`, `research-inputs/E4/`).
- **A stage counts only with its evidence.** A drafted or sent message is not a request answered; a received file is not a complete set; a scheduled interview is not an interview.
- **Where the numbers come from:** E1 from the intake check's `e1-intake.json` ([handout](benchmarks/E1-FIRST-SET-HANDOUT.md) Part 9, step 8); E2 from each scored set's output folder; E4 from `research-inputs/E4/tracker.csv` ([recruitment kit](research/E4-RECRUITMENT-KIT.md) §4).

## E1: benchmark sets (plan: 10–20 complete sets)

| Stage | Sets | Evidence |
|---|---|---|
| Requested (owner asked, by the approved message) | 0 | — |
| Received (files on the encrypted disk, fingerprinted on receipt) | 0 | — |
| Permission verified (signed letter filed; `permission` check passes) | 0 | — |
| QS-A complete (measurement sheet + valid reference BOQ) | 0 | — |
| QS-B complete | 0 | — |
| Adjudication complete (adjudicated sheet, gold BOQ, both logs) | 0 | — |
| Eligible for scoring (intake check: **complete**) | 0 | — |

**Spread of complete sets:** residential 0 · commercial 0 · institutional 0 · vector 0 · scanned 0 · Set A eligible 0.

**Per set** (add a row per set; set id and fingerprints only):

| Set | Typology | Modality | Drawing SHA-256 | Gold SHA-256 | Intake check | Notes |
|---|---|---|---|---|---|---|
| — | | | | | | No set requested yet |

## E2: benchmark run (plan: every E1 set scored; gates G1–G6; raw machine and human-corrected reported separately)

| Status | Sets |
|---|---|
| Not run | all (there are no sets) |
| Eligible (complete, not yet scored) | 0 |
| Running | 0 |
| Scored | 0 |

**Per scored set** (fill only from real output):

| Set | Role | Repository commit | Frozen hashes (v1.1) | Gates (G1–G6) | Output folder | Date |
|---|---|---|---|---|---|---|
| — | | | | | | No set scored |

**Software state today:** runner and metrics on `main`, frozen-hash check passing. Each scored set must record the commit it ran on, because the DSR matcher changed with PRs #167 and #168. ₹-weighted figures from different matcher versions are not comparable.

## E4: discovery interviews (plan: 10–12 interviews + synthesis)

| Segment | Target | Recruited | Scheduled | Interviewed | Synthesised |
|---|---|---|---|---|---|
| Billing / QS engineer, small contractor | 2 | 0 | 0 | 0 | 0 |
| Billing / QS engineer, mid-size contractor | 2 | 0 | 0 | 0 | 0 |
| Billing / QS engineer, EPC or large contractor | 2 | 0 | 0 | 0 | 0 |
| Freelance BOQ preparer | 2–3 | 0 | 0 | 0 | 0 |
| Contractor-owner who approves bids | 2–3 | 0 | 0 | 0 | 0 |
| **Total** | **10–12** | **0** | **0** | **0** | **0** |

Also tracked: government / private spread (none yet); percentage-rate bidders, at least 2 (0 so far). Synthesis document `docs/research/E4-SYNTHESIS.md`: not started.

## Blockers and who resolves them

| # | Blocker | Blocks | Owner |
|---|---|---|---|
| 1 | Legal review of the owner permission letter ([handout](benchmarks/E1-FIRST-SET-HANDOUT.md) Part 2) and the surveyor briefs (Part 4) | Requesting any set | PO + PO's legal adviser |
| 2 | Legal review of the E4 information note and consent ([recruitment kit](research/E4-RECRUITMENT-KIT.md) §3) | Scheduling any interview | PO + PO's legal adviser |
| 3 | Choose the first candidate set from the local shortlist, and fill the handout's brackets (entity name, contact, secure-transfer route, retention, deadlines) | Requesting the first set | PO |
| 4 | Three written quotations per surveyor role, and a budget for QS-A, QS-B and the adjudicator | Measuring any received set | PO |
| 5 | Incentive amount and budget for 10–12 interviews (guide §1.4) | Recruiting | PO |
| 6 | People to recruit through (contacts in contracting firms; freelance preparers) | Recruiting | PO |
| 7 | 9 or more further sets after the first, across typologies and both modalities | E1 DONE | PO |

No engineering blocker remains for receiving, checking and scoring a set (`scripts/benchmark/e1Intake.ts`, the `BENCH_E1_ROOT` mode of `score-set-a`).
