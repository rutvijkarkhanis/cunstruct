# Orchestration pilot v1.0

The pilot tests coordination, not Cunstruct features. Each agent gets one small task that touches **only its own new file** under `docs/agent-orchestration/pilot/`, so no two tasks can conflict. No application code, configuration or production system is touched.

**Not launched.** All pilot issues are `status:backlog` until the launch steps in §3 are done.

## 1. Tasks

| ID | Issue | Owner | Depends on | Reviewer | Owned files |
|---|---|---|---|---|---|
| CC-002 | [#218](https://github.com/rutvijkarkhanis/cunstruct/issues/218) | Learnator | — | Ruthvich | `pilot/capabilities-learnator.md` |
| CC-004 | [#220](https://github.com/rutvijkarkhanis/cunstruct/issues/220) | Codex | — | Learnator | `pilot/capabilities-codex.md` |
| CC-003 | [#219](https://github.com/rutvijkarkhanis/cunstruct/issues/219) | Ruthvich | CC-002, CC-004 (native "blocked by" set) | Codex | `pilot/capabilities-ruthvich.md`, `pilot/CAPABILITY-MATRIX.md` |

- **Review ring:** Ruthvich reviews Learnator, Learnator reviews Codex, and Codex reviews Ruthvich. Each agent reviews once and is reviewed once.
- **Capability file format:** one table row per capability in `PLAN.md` §6. Columns:
  - `Capability`;
  - `Result` (`Verified` / `Not available` / `Not tested`);
  - `How` (a command, a link, or the exact error).

  Never "Verified" without the "How".

## 2. What the pilot must demonstrate

| # | Test | How it is exercised | Pass when (evidence) |
|---|---|---|---|
| T1 | Each agent discovers and claims its ticket | Every agent starts from the start prompt (`PLAN.md` §7) with no other context | Each of #218–#220 has a signed `CLAIM` comment, an `agent:*` label, and a `status:in-progress` transition |
| T2 | Agents read each other's updates | Ruthvich reviews CC-002 and builds the matrix from the CC-002 and CC-004 files. Learnator reviews CC-004. | The matrix cites the merged SHAs. Each review quotes the reviewed PR's evidence. |
| T3 | Dependencies and conflicts are recorded in GitHub | #219 is natively blocked by #218 and #220 | #219 shows a `status:blocked` period with a comment naming the dependencies, and becomes `ready` only after both merge |
| T4 | Work happens on separate branches | Branch prefixes `agent/<name>/CC-NNN-…` | Three branches, each changing only its owned files (`git diff --name-only main...<branch>`) |
| T5 | PRs link tickets and contain verification evidence | PR template | Each PR has `Closes #`, checks with real results, and files changed versus files owned |
| T6 | At least one independent review | The review ring | Each PR has a `REVIEW … VERIFIED` comment review signed by a **different** agent. `verified` was added after that review (issue timeline). |
| T7 | A simulated user-input blocker appears in the right view | CC-004 opens `[CC-004] SIMULATION — needs Rutvij: …` | It is listed by the Needs Rutvij query (and Project view, if created) while open, and drops out once answered. CC-004 shows `blocked` → `in-progress`. |
| T8 | Progress reflects verified completion only | Milestone 1 and #221 sub-issues | After each merge the milestone percentage equals the verified-and-closed count ÷ 3, and the audit query (closed, not `verified`) returns nothing |
| T9 | Interrupted work resumes from GitHub state alone | CC-002's interruption drill: end the session after the first checkpoint; a fresh session gets only "resume CC-002" | A `RESUMED … no prior context used` comment, and the task completes correctly |

## 3. Launch (Rutvij)

1. Review and merge the setup PR. This is a docs and templates change only, but merging to `main` triggers a Vercel production deploy of unchanged application code.
2. Optional: create the Project (`DASHBOARD.md` §3).
3. Relabel #218 and #220 from `status:backlog` to `status:ready`. #219 stays in backlog and becomes ready once #218 and #220 merge; Rutvij or Ruthvich relabels it.
4. Start Learnator, then Codex, each with the start prompt (`PLAN.md` §7). Start Ruthvich when the review of CC-002 is requested.
5. Answer the CC-004 simulation question on its issue.

## 4. Pilot exit criteria

- The pilot **passes** when T1–T9 all pass, with links recorded in a comment on #221.
- The pilot **fails** on any of:
  - an agent edits a file it does not own;
  - `verified` is added by the author;
  - a closed issue lacks `verified`;
  - an agent acts without a ticket;
  - an action from PROTOCOL §15 is taken without approval;
  - work is lost on interruption.

A failure is recorded in the retrospective with its cause. Gates are never relaxed silently.

## 5. Retrospective (CC-005, Rutvij)

Answer on #221:
1. Which tests passed, with links?
2. Which capabilities moved from Assumed to Verified or Not available? Update `PLAN.md` §6 in v1.1.
3. How many escalations reached Rutvij, and which were unnecessary?
4. How much time did Rutvij spend relaying between agents?
5. Keep, change or drop D1–D4?
