# Cunstruct agent protocol: v1.0

How three coding agents, the Claude agents **Learnator** and **Ruthvich** and the OpenAI agent **Codex**, work on Cunstruct as one team through GitHub. This document is the rulebook, and `PLAN.md` is the work. If something is not written here or in a ticket, it is not agreed.

Changing this protocol follows the plan-change rule in §13.

---

## 1. Scope and authority

- **Rutvij** owns the plan, merges to `main`, and decides anything in §15's "needs authorization" list.
- **Agents** decide routine, reversible engineering matters on their own: implementation approach inside their ticket, test design, naming, refactors confined to files they own. Each records the decision in a checkpoint (§7). Silence is not a decision.
- **No agent may:**
  - silently expand a ticket's scope;
  - edit files another agent owns (§6);
  - bypass a check;
  - rewrite shared history;
  - take any action in §15 without the authorization named there.

## 2. Identity: three agents, one GitHub account

All three agents act through the same GitHub account (`rutvijkarkhanis`), so GitHub's author, assignee and review fields cannot tell them apart. Identity therefore comes from four things:

| Mechanism | Rule |
|---|---|
| Owner label | Exactly one of `agent:learnator`, `agent:ruthvich`, `agent:codex` on a claimed ticket. |
| Signature | Every comment, PR body and review **ends with** `— Learnator`, `— Ruthvich` or `— Codex`. An unsigned comment counts as Rutvij's. |
| Branch prefix | `agent/<agent>/<task-id>-<slug>`, for example `agent/codex/CC-004-capabilities`. |
| Commit trailer | `Agent: <Name>` on every commit. |

Consequences of the shared account:
- **Formal approval is impossible.** GitHub does not let an account approve its own PR, so independent review happens through a *comment review* plus the `verified` label (§9).
- **Rutvij gets no GitHub notifications for agent actions**, because they come from his own account. See `DASHBOARD.md` §4.

## 3. Plan of record

- `docs/agent-orchestration/PLAN.md` is canonical. It carries a version and a change log.
- Tickets implement plan items. A ticket that is not traceable to a plan item is out of scope.
- Status lives in GitHub (labels and open/closed), not in the plan. The plan changes only through §13.

## 4. Tickets

**Ticket system:** GitHub Issues in `rutvijkarkhanis/cunstruct`.

**Task ID:** `CC-NNN`, sequential, never reused. It is written in the title as `[CC-NNN] …` and in the body as `**ID:** CC-NNN`. Hold markers use `CC-HOLD-NNN`. The issue number is GitHub's; the task ID survives renames.

**Required ticket fields** (template: `.github/ISSUE_TEMPLATE/agent-task.yml`):
- ID, owner, depends-on, reviewer;
- branch, and the files owned (explicit paths or globs);
- goal, steps;
- acceptance criteria as checkboxes, each testable;
- the evidence required.

**Labels:**
- one `priority:p0|p1|p2`;
- one `workstream:*`;
- optional `type:pilot` or `type:plan-change`.

**Status:** exactly one `status:*` label while open.

| Status | Meaning | Enters when | Who sets it |
|---|---|---|---|
| `status:backlog` | Agreed, not claimable | Created | Anyone |
| `status:ready` | Claimable: deps met, criteria complete | Deps done and criteria written | Rutvij, or the integrator after deps merge |
| `status:in-progress` | Owner is working | Claim (§5) | Owner |
| `status:blocked` | Waiting on a named dependency or decision | Blocker found | Owner |
| `status:in-review` | PR open with evidence | PR opened (§8) | Owner |
| **Done** | Issue **closed as completed** *and* labelled `verified` | PR merged after verification (§9) | Reviewer adds `verified`; the merge closes the issue |

**Allowed transitions:**
- `backlog → ready → in-progress`
- `in-progress ⇄ blocked`
- `in-progress → in-review`
- `in-review → in-progress` (changes requested)
- `in-review → Done`

Any status can go to *closed as not planned*, with a reason, by Rutvij only.

`on-hold` means **do not start**. No status applies, and only Rutvij removes it.

## 5. Claiming

1. Only an issue labelled `status:ready` and with no unresolved `blocked by` relationships is claimable.
2. Check that the owner label is yours, or absent. You never take a ticket labelled for another agent.
3. Claim atomically and visibly:
   - add your `agent:*` label;
   - swap `status:ready` for `status:in-progress`;
   - post `CLAIM: <ID> — starting on <branch>. Plan: <1–3 lines>. — <Name>`.
4. **Race:** if two claims appear, the **earliest claim comment** wins. The loser posts `YIELD` and removes its label.
5. Hold at most **one** `status:in-progress` ticket at a time unless the plan says otherwise.

## 6. Branches and file ownership

- One ticket, one branch, one PR, branched from current `main`.
- **File ownership:**
  - Each ticket lists the paths it owns, and only those paths may change.
  - Files touched by a ticket that is in progress or in review belong to that ticket.
  - To change another ticket's file, comment on that ticket and wait for its owner, or Rutvij, to agree.
  - Shared files (`package.json`, lockfiles, `CLAUDE.md`, `AGENTS.md`, `docs/agent-orchestration/*.md`, `supabase/migrations/*`) change only in a ticket that names them.
- Never force-push or rebase a branch another agent has committed to, and never delete another agent's branch.
- Stay current by **merging `main` in**, never by rebasing a shared branch.

## 7. Progress updates and evidence

Post a **checkpoint comment** on the issue:
- at claim;
- at each meaningful step;
- before any long run;
- and always before ending a session.

```
CHECKPOINT <ID> <ISO-8601 UTC>
Done: <what is finished, with links/commit SHAs>
Next: <the exact next step>
Evidence: <command → result, or link>
Decisions: <reversible decisions taken, one line each>
Risks/blockers: <none | named>
— <Name>
```

- A checkpoint must let a **fresh session with no conversation history** continue the work (§14).
- **Evidence is something someone else can re-run or open:**
  - commands with their actual output summary (`npm run test → 3473 passed`);
  - commit SHAs, CI check links.
- "Done" without evidence is not done. Self-reported percentages are not used anywhere.

## 8. Pull requests

- **Title:** `[CC-NNN] <summary>`.
- **Body:** the repo template (`.github/pull_request_template.md`), including:
  - `Closes #<issue>`;
  - the files changed versus the files owned;
  - the checks run with their real results;
  - known failures, and what was not run.
- **Checks:**
  - Run the repository's own checks: `npm run lint`, `npm run test`, `npm run build`, and Playwright when UI flows change.
  - Hosted checks are Vercel and Supabase Preview.
  - A pre-existing failure is reported with proof that it also fails on `main`. It is never hidden.
- **Labels:** open the PR, then set the issue to `status:in-review` and ask the named reviewer: `REVIEW REQUEST: #<pr> — <Name>`.

## 9. Independent review, verification and integration

- **Who reviews:** the reviewer named on the ticket, never the author.
- **What the reviewer does:**
  - checks out the branch;
  - re-runs the claimed checks;
  - checks every acceptance criterion and file ownership;
  - posts a GitHub review of type *Comment*, with this summary:

```
REVIEW <ID> PR #<n>: VERIFIED | CHANGES REQUESTED
Re-ran: <commands → results>
Criteria: <each criterion → met/not met, with evidence>
Findings: <numbered; blocking marked BLOCKING>
— <Name>
```

- **VERIFIED:** the reviewer adds `verified` to the issue. **Only the reviewer may add `verified`.** An author who adds it voids the verification.
- **CHANGES REQUESTED:** the owner sets `status:in-progress`, fixes, and re-requests review.
- **Merge:** during the pilot, **Rutvij merges** (PLAN.md decision D2). A PR is mergeable only when:
  - it is `verified`;
  - hosted checks are green;
  - it has no conflicts.
- **Integration verification:** after a merge, the integrator named in the plan confirms that `main` still passes its checks and comments `INTEGRATED <ID> @ <sha>`.

## 10. Escalation: `needs-rutvij`

Escalate **only** for:
- a §15 action;
- a product or scope decision not covered by the plan;
- an irreversible choice;
- a disagreement that §13 could not settle.

Everything else is decided by the agent and recorded.

Open, or comment on, an issue labelled `needs-rutvij`:

```
DECISION NEEDED <ID>
Question: <one sentence>
Why it is yours: <which rule above>
Options: A) … (consequence)  B) … (consequence)
Default if no answer: <option> — applied after <date/time, or "never: blocking">
Blocks: #<issues>
— <Name>
```

- Set the blocked ticket to `status:blocked`, with a link to the decision.
- Keep working on anything unblocked.
- When Rutvij answers, the asker removes `needs-rutvij`, quotes the decision in the ticket, and resumes.

## 11. Agent capabilities and the wake model

The verified-versus-assumed table, kept current by the pilot, is in `PLAN.md` §6.

**Wake model:**
- No agent runs continuously, and no agent can wake another.
- Agents work when Rutvij starts a session, or a scheduled session he approved starts one, using the start prompt in `PLAN.md` §7.
- **GitHub is the only shared channel. Private chats, local files and session memory are not part of the record.**

## 12. Dependencies and conflicts

- **Recording dependencies:**
  - Use GitHub's native **"blocked by"** relationship on the issue.
  - Mirror it in the body as `Depends on: CC-NNN`.
  - A ticket with an open blocker is never `status:ready`.
- **Overlap:** if two tickets need the same file, the later one is `status:blocked` until the earlier merges, or Rutvij splits the work.
- **Discovered conflict:** stop, checkpoint, comment on both tickets naming the files, and wait. Never resolve a conflict by overwriting.

## 13. Disagreements and plan changes

- **Technical disagreement on a PR:**
  - The reviewer's BLOCKING finding stands until the author either fixes it or answers with evidence.
  - After two rounds without agreement, either side escalates under §10 with both positions stated neutrally.
- **Plan change:**
  - Open an issue labelled `type:plan-change`, with the proposed diff to `PLAN.md`, the reason and the impact.
  - Only Rutvij approves.
  - An approved change bumps the version (v1.0 → v1.1) and adds a dated entry to the change log.
  - Never edit an acceptance criterion to make a ticket pass.

## 14. Recovery

- **Every session starts the same way:**
  1. Read `PLAN.md` and this protocol.
  2. Run the dashboard queries in `DASHBOARD.md` §2.
  3. Read your own open tickets **from their latest checkpoint**.
- **Interrupted session:** the next session of the same agent resumes from the last checkpoint. It then posts `RESUMED <ID> from checkpoint <link> — no prior context used. — <Name>`. If the branch has commits after the last checkpoint, it reconciles them first and says so.
- **Failed task:**
  - Set `status:blocked`.
  - Post a checkpoint with the failure and its evidence, and what was tried.
  - Escalate only if §10 applies.
- **Stale ticket:**
  - A ticket is stale when it is `status:in-progress` with no checkpoint for **72 hours** (pilot: 24 hours). Any agent labels it `stale` and comments.
  - If the owner does not resume within 24 hours of that comment, Rutvij may reassign it.
  - The new owner continues from the branch. They never discard it, and their first checkpoint states what they inherited.
- **Abandoned branch:** never deleted by an agent. Rutvij decides.

## 15. Safety: needs authorization

These need **Rutvij's explicit approval for the specific action**, recorded on the ticket:
- merging to `main`; any production deployment, Supabase function deploy or release promotion;
- changing secrets, environment variables, authentication, billing, repository settings or branch protection;
- migrations, or any production database write;
- paid API calls beyond what the ticket's budget states;
- force-push, history rewrite, or deleting a branch, tag or issue;
- adding a dependency, an external service or a new GitHub workflow;
- starting anything labelled `on-hold`.

## 16. Public-repository hygiene

`rutvijkarkhanis/cunstruct` is **public**. Issues, PRs, comments and branches are world-readable. Never post:
- secrets, tokens or keys;
- production user data or production identifiers beyond what the code already exposes;
- client drawings, or names and data taken from them;
- the contents of private conversations.

Summarize sensitive findings and link to where an authorized person can read them.
