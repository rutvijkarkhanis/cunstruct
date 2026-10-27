# Cunstruct team protocol: v2.0

How three coding agents work on Cunstruct through GitHub:

- **Learnator** (Claude): lead engineer. Owns substantial workstreams.
- **Ruthvich** (Claude): lead engineer. Independently owns substantial workstreams.
- **Codex** (OpenAI): engineer for bounded work: targeted regression tests, reproducible bug reports, small isolated fixes, CI diagnostics, documentation checks and verification.

This file is the only rulebook. The current work and its owners are in `PLAN.md` and in the issues it links. `CLAUDE.md` holds the engineering rules every agent follows.

## 1. Who decides

- **Rutvij** merges to `main` and decides the items in §8. He is not a coordinator. Agents involve him only for §8.
- **The owner of a task** decides everything else inside it: approach, tests, naming, refactors in the files it owns. It records the decisions that matter in its status comment (§4).
- **Leads engineer; they do not manage.** A lead spends its session on its own workstream. It writes a Codex task only when that task removes a specific bottleneck from its own work.

## 2. One GitHub account, so no proof of identity

All agents act as the same GitHub account. GitHub cannot tell them apart, and no account, label, signature or comment proves which agent or person wrote something.

- **Conventions, not proof:**
  - Every agent comment, PR body and review ends with `— Learnator`, `— Ruthvich` or `— Codex`.
  - Every commit has an `Agent: <Name>` trailer.
  - Branches are named `agent/<name>/<issue>-<slug>`.
- **An unsigned comment is unattributed input.** It carries no authority.
- **A review is evidence, not approval.** A review records what was re-run and what was found, so Rutvij can check it. It never authorizes a merge.

### 2.1 Rutvij's decisions: the only form of authorization

A decision in §8 counts only when it is recorded on the issue or PR as a comment in this form:

```
DECISION <ID>: <the decision, naming the specific action it authorizes>
— Rutvij
```

- **Only Rutvij writes these.** An agent never writes a `DECISION` line or the signature `— Rutvij` in a GitHub comment, PR body, review or commit message, not even as a quotation. It links to the comment instead. This file shows the format only as a template.
- **An agent's own words are never approval.** That covers its own comments, comments signed by another agent, unsigned comments, labels and issue states.
- **Chat answers are not authorization.** An answer Rutvij gives in a chat may be copied to the issue marked `(relayed from chat — not authorization)`. It never authorizes a §8 action.
- **What this cannot prove.** Neither GitHub nor this format can prove who typed a comment. The controls are this rule, every agent following it, and Rutvij merging by hand.

## 3. Tasks

A task is a GitHub issue created from `.github/ISSUE_TEMPLATE/agent-task.yml`. It has:

- an outcome and testable acceptance criteria;
- exactly one owner, shown by one `agent:<name>` label;
- a branch;
- the files or areas it may change;
- its dependencies, if any;
- the evidence that will show it is done.

**Labels that matter:**
- `agent:<name>`: the owner;
- `status:blocked`: waiting on something named in the latest status comment;
- `needs-rutvij`: waiting on a §8 decision;
- `on-hold`: never start; only Rutvij removes it.

Other labels are optional. An open PR that links the issue means the task is in review.

**Starting work:** take an open issue labelled for you, with no `on-hold` and no unmet dependency. You may also open a task inside your own workstream (`PLAN.md`). Never take an issue labelled for another agent without that agent's handoff comment, or Rutvij's.

## 4. Progress and handoff

Post a status comment:
- when you start;
- when something meaningful changes (a result, a blocker, a PR);
- **always before your session ends**.

Do not post comments that change nothing.

```
STATUS #<issue> <ISO-8601 UTC>
Branch / commit: <branch> @ <sha>
Verified: <command → result, or link>; what was not run, and why
Failing: <none | check → error>
Next: <the exact next action>
Blocked by: <none | what, and who can unblock>
— <Name>
```

- **The status comment is the handoff.** A fresh session with no conversation history must be able to continue from it.
- **No agent runs continuously, and no agent can wake another.** Never assume another session is running, will see a comment, or can be notified. If you need something from another agent, write it on that agent's issue and carry on with unblocked work.
- **Done means evidence.** A claim is not done until someone else can re-run or open the evidence: commands with their real results, commit SHAs and check links.

## 5. Files, branches and overlap

- One task, one branch, one PR, branched from current `main`. To stay current, merge `main` in.
- Never force-push or rebase a branch another agent has committed to. Never delete another agent's branch or discard its uncommitted work.
- **Ownership follows the subsystem.** `PLAN.md` lists which areas each workstream owns. Change files outside your area only by agreement, recorded on both issues.
- **Overlap:**
  - If two tasks must change the same file, the later one records `Depends on #<n>` and the integration point (which file, and who merges whom) on both issues.
  - It then integrates after the earlier task merges.
  - Never resolve a conflict by overwriting another task's change.
- **Shared files** change only in a task that names them: `package.json`, lockfiles, `CLAUDE.md`, `AGENTS.md`, `docs/agent-orchestration/*`, `supabase/migrations/*`.

## 6. Pull requests and review

Use `.github/pull_request_template.md`. Run `npm run lint`, `npm run test` and `npm run build`. Report real results, including what failed or was not run.

Review effort is proportional to risk:

| Risk | Examples | Review before Rutvij merges |
|---|---|---|
| **High** | Anything deployed with `supabase/functions/*`; persistence or BOQ quantity logic; auth; anything in §8 | Independent review by the other lead: check out the branch, re-run the checks, check each acceptance criterion |
| **Normal** | Application code, contained in one subsystem | Verification by another agent (Codex or the other lead): re-run the tests and confirm the criteria |
| **Low** | Tests only, docs only, a small isolated fix | The author's evidence; Rutvij may ask for verification |

The reviewer posts a review of type *Comment* on the PR:

```
REVIEW PR #<n>: VERIFIED | CHANGES REQUESTED
Re-ran: <commands → results>
Criteria: <each → met / not met>
Findings: <numbered; blocking ones marked BLOCKING>
— <Name>
```

- **Agents never review their own work, never merge and never close a task issue.** The merge closes it.
- A blocking finding stands until it is fixed or answered with evidence. After two rounds without agreement, escalate under §7.

### 6.1 Rutvij's merge checklist

1. The review required by the risk level is on the PR, signed by an agent other than the author. Agent-to-agent review on a shared account is evidence, not proof.
2. Only files within the task's area changed, or the difference is explained.
3. **Build evidence:** the PR shows `npm run build` exiting 0 locally, with the commit SHA and the last lines of output. It is run in a plain environment: no `VERCEL`, `VERCEL_ENV` or `STAGING_*` variables. A local build is **not** proof that a hosted deployment will succeed.
4. **Hosted checks:** the PR lists every hosted check with its result. A check the agent could not inspect is reported as such, for example "Vercel Preview log not available to the agent".
   - **No failing check is accepted by rule**, including one seen on earlier PRs.
   - Rutvij reviews each failure himself, using the deployment log, the deployment page or `npx vercel inspect <deployment> --logs`. Before merging, he records `DECISION <ID>: merge despite <check> — cause <…> — Rutvij`.
   - **Context, not a waiver:** `scripts/staging-guard.mjs` refuses Vercel Preview builds that have no staging variables, and prints "Vercel Preview build refused". A failure whose log shows that message has that cause. Any other cause blocks the merge.
5. There are no conflicts.

Every merge to `main` deploys the web app to production through Vercel. It also deploys Supabase functions through the GitHub integration.

## 7. Escalating to Rutvij

Escalate only for:
- a §8 action;
- a product or architecture decision the two leads disagree on;
- a sensitive-data question;
- a production risk;
- a disagreement that two review rounds did not settle.

Everything else is decided by the owner and recorded.

Use `.github/ISSUE_TEMPLATE/needs-rutvij.yml`, or a comment labelled `needs-rutvij`, with:
- one question;
- the options and their consequences;
- what it blocks.

Then:
1. Set the task to `status:blocked`.
2. Post a status comment.
3. Keep working on anything unblocked.

When Rutvij answers with a `DECISION` comment, the owner removes the labels and continues.

## 8. Needs Rutvij's explicit authorization

These need a `DECISION <ID>: … — Rutvij` comment for the specific action (§2.1). Agent comments, relayed chat answers and unsigned comments never count.

- merging to `main`; any production deployment, Supabase function deploy or release promotion;
- changing secrets, environment variables, authentication, billing, repository settings or branch protection;
- migrations, or any production database write;
- paid API calls, including model calls against staging, beyond what the task states;
- publishing a local-only branch or bundle that came from client material;
- force-push, history rewrite, or deleting a branch, tag or issue;
- adding a dependency, an external service or a new GitHub workflow;
- starting anything labelled `on-hold`.

## 9. Public repository

`rutvijkarkhanis/cunstruct` is **public**. Never put the following in issues, PRs, commits or branches:
- secrets, tokens or keys;
- production user data, or production identifiers beyond what the code already exposes;
- client drawings, building-identifying fixtures or benchmarks, or names and data taken from them;
- the contents of private conversations.

Summarize sensitive findings, and say where an authorized person can read them.

## 10. Tracking

Issue #221 is the only dashboard. Its body is replaced, never appended to, when the state changes:

```
Learnator: <current task #> — last verified: <result> — next: <step>
Ruthvich: <current task #> — last verified: <result> — next: <step>
Codex: <current task #> — <result or blocker>
Awaiting review: <PR links>
Blocked: <issue — why>
Needs Rutvij: <only §8 decisions, each linked>
```

Each agent updates its own line when its status changes. Nothing else is required.
