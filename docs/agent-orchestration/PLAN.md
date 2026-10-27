# Cunstruct team plan: workstreams and first cycle

The rules are in `PROTOCOL.md`. This file says who owns what, and what the first cycle is. Live status is in issue #221.

## 1. Workstreams and ownership

| Workstream | Owner | Owns (may change) | Must not change without agreement |
|---|---|---|---|
| **W1: AI analysis pipeline.** Make "Analyze Project" work, or fail with a named and actionable reason, in production. Then land the LOCATION assurance work on top of it. | Learnator | `supabase/functions/**`, `src/lib/ai/**`, `src/lib/review/assurance/**`, `src/components/ops/workspace/WorkspaceAnalyzePanel*`, `src/components/review/DocumentLocation*` | UI shells and routes (W2) |
| **W2: UX revamp, charter Phase 0 then Phase 1.** Produce the architecture inventory that the approved UX/UI charter requires before any redesign. Then make its narrow trust fixes. | Ruthvich | `docs/ux/**`, `src/test/uxInventory*`; in Phase 1, the page or component named by each fix | Anything W1 owns |
| **Bounded tasks** | Codex | Only the files named on its issue | Everything else |

**Why these two.**
- W1 is the live production defect on the product's core path: Analyze Project returns HTTP 502 (PR #215). It also covers the pending assurance work, which touches the same Edge Function. Putting both under one owner means one agent owns `ai-analysis/index.ts`.
- W2 is the next step of the owner-approved charter (PR #209). Phase 0 is documentation and tests only, so it shares no files with W1.

**On hold:** #217 (BOQ provenance) stays `on-hold`. Neither workstream starts it.

## 2. First cycle

### Learnator: W1, task 1, make PR #215 mergeable

Since #215 was opened, #216 merged its web-only half into `main`. As a result:
- #215 now conflicts with `main` in `src/lib/ai/analysisClient.ts` and `src/lib/ai/analysisClient.errors.test.ts`;
- its Edge Function half is still unmerged: `_shared/stageLog.ts`, the `_shared/openaiClient.ts` error codes and the `ai-analysis/index.ts` stage logging.

**Acceptance:**
- [ ] `main` merged into the #215 branch, with no rebase or force-push. `main`'s client code is kept wherever #216 already covers the change. Any remaining client difference is explained in the PR.
- [ ] `npm run lint`, `npm run test` and `npm run build` pass. The PR shows the results.
- [ ] `deno check supabase/functions/ai-analysis/index.ts`, run on a copy of the tree that includes `src/`, reports no error that `main` does not also report. `main`'s baseline with Deno 2.9.6 is 2 errors: `openaiClient.ts` TS2322 and `index.ts` TS2345.
- [ ] The PR states exactly what a deploy changes, and the one log line Rutvij must read after it to name the cause of the 502.
- [ ] Independent review by Ruthvich (high risk: the change deploys an Edge Function).

**Next W1 tasks, in order:**
1. **Root cause of the 502.** This needs one log line after the deploy, which Rutvij must authorize and read.
2. **Publish PR A**, the assurance library. It has no runtime effect, but publishing it needs Rutvij's decision (§8: the work came from client material).
3. **Publish PR B**, the LOCATION persistence gate. It goes on top of #215 and conflicts with it in `ai-analysis/index.ts` and `analysisClient.ts`; W1 owns both sides. It needs the Deno check and an approved staging run (see docs/location-persist-gate-release.md on the PR B branch).

### Ruthvich: W2, task 1, charter Phase 0 capability inventory

The deliverable is `docs/ux/PHASE-0-INVENTORY.md`, written according to charter §8.1. The charter is in PR #209 (`docs/UX-UI-REVAMP-CHARTER.md`). Build on `docs/B12-ROUTE-INVENTORY.md` (route rows already tested by `src/lib/routeInventory.test.ts`) and `docs/UX-UI-AUDIT.md`. Do not redo them. No application code changes in this phase.

**Acceptance:**
- [ ] A shell map: which layout wraps which routes, and the signed-in landing route.
- [ ] A **canonical shell proposal**, with evidence. It is a proposal: the owner decides.
- [ ] A capability matrix covering every capability in charter §8.1 item 3. Each row gives:
  - the owning components;
  - the persistence functions or tables;
  - the tests that protect it;
  - its production status: **works**, **unavailable (migration not applied)** or **unknown — owner check needed**. Never guess this status.
- [ ] A new test, `src/test/uxInventory.test.ts`, fails if a component, function or test file named in the matrix does not exist.
- [ ] A disposition table (charter §7) and a viewport proposal, both marked as proposals.
- [ ] Verified by Codex: it re-runs the test and spot-checks five rows against the code.

**Next W2 tasks:**
- Owner review of Phase 0 (the charter gate).
- Then Phase 1: narrow trust fixes (charter §8.4), each on its own branch. A fix that touches W1's files records the dependency first.

### Codex: one bounded task, a Vercel Preview failure report

Every PR's Vercel check is red. That makes every merge need Rutvij's manual review of a hosted failure (§6.1).

**Deliverable:** `docs/bugs/VERCEL-PREVIEW-BUILD-REFUSED.md`. It is documentation only, with no code or configuration change.

**Done when the report:**
- [ ] names the `main` SHA it was tested on;
- [ ] shows `npm run build` with no Vercel variables exiting 0;
- [ ] shows `VERCEL=1 VERCEL_ENV=preview npm run build` exiting non-zero with "Vercel Preview build refused", with the exit code and output lines;
- [ ] cites the guard's condition in `scripts/staging-guard.mjs` and the commit that introduced it;
- [ ] lists the PRs whose Vercel check failed before and after that commit, from the GitHub REST check runs;
- [ ] states plainly that the hosted Vercel log was **not** read;
- [ ] gives the two options for Rutvij without choosing between them: (a) set the `STAGING_*` variables in Vercel's Preview environment; (b) stop building PRs on Vercel. Both are §8 changes.

## 3. After the first cycle

Evaluate only three things:

1. Did both leads make meaningful independent progress, measured as merged or review-ready PRs with evidence?
2. Did the agents coordinate without Rutvij, beyond §8 decisions?
3. Were quality and safety preserved: no red checks hidden, no overlap overwritten, no sensitive data published?

Change `PROTOCOL.md` only for a problem actually observed, and record the observation here.
