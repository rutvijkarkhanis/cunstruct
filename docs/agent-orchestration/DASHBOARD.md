# Command-centre dashboard

GitHub is the dashboard. It runs on labels, issues, the milestone and saved searches, all of which work today, plus an optional Project board that Rutvij creates by hand.

## 1. What exists (created 26 Oct 2026)

- **Labels:**
  - status: `status:backlog|ready|in-progress|blocked|in-review`;
  - owner: `agent:learnator|ruthvich|codex`;
  - `needs-rutvij`, `verified`, `on-hold`, `stale`;
  - `priority:p0–p2`, `workstream:orchestration|product|assurance`, `type:pilot|plan-change`.
- **Milestone** [Orchestration pilot](https://github.com/rutvijkarkhanis/cunstruct/milestone/1): the progress bar.
- **Issues:**
  - [#221](https://github.com/rutvijkarkhanis/cunstruct/issues/221) CC-001, the tracking issue, with pilot sub-issues;
  - [#217](https://github.com/rutvijkarkhanis/cunstruct/issues/217) on hold;
  - pilot [#218](https://github.com/rutvijkarkhanis/cunstruct/issues/218), [#219](https://github.com/rutvijkarkhanis/cunstruct/issues/219), [#220](https://github.com/rutvijkarkhanis/cunstruct/issues/220).
- **Templates:** `.github/ISSUE_TEMPLATE/agent-task.yml`, `.github/ISSUE_TEMPLATE/needs-rutvij.yml` and `.github/pull_request_template.md`.

## 2. Views (saved searches: bookmark them)

Base URL: `https://github.com/rutvijkarkhanis/cunstruct/issues?q=`

| View | Query |
|---|---|
| **Needs Rutvij** | `is:open label:needs-rutvij` |
| Ready to claim | `is:open label:status:ready` |
| In progress | `is:open label:status:in-progress` |
| Blocked | `is:open label:status:blocked` |
| In review | `is:open label:status:in-review` |
| Stale | `is:open label:stale` |
| Verified done | `is:closed label:verified` |
| **Audit: closed but not verified (must be empty)** | `is:closed reason:completed label:type:pilot -label:verified` |
| Mine (agent) | `is:open label:agent:<name>` |
| PRs for a task | `is:pr "CC-NNN"` |

#221 links each of these views directly.

**Agents: use the repo-scoped REST equivalents.** GitHub's search API (`search/issues`) is blocked from Claude agent sessions (verified: HTTP 403, "sessions are bound to their configured repositories"). The `issues` list endpoint works:

```
R=repos/rutvijkarkhanis/cunstruct
gh api "$R/issues?state=open&labels=needs-rutvij" --jq '[.[]|select(.pull_request==null)|.number]'
gh api "$R/issues?state=open&labels=status:ready,agent:<name>" --jq '[.[]|select(.pull_request==null)|.number]'   # comma = AND
gh api "$R/issues?state=open&labels=agent:<name>" --jq '[.[]|select(.pull_request==null)|{number,title,labels:[.labels[].name]}]'
# Audit (must print []):
gh api "$R/issues?state=closed&labels=type:pilot&per_page=100" --jq '[.[]|select(.state_reason=="completed")|select([.labels[].name]|index("verified")|not)|.number]'
```
An agent without `gh` uses its GitHub tool's issue-list call with the same label filters.

## 3. GitHub Project, created by hand (CC-001a, about 10 minutes)

The Projects (v2) API is GraphQL-only, and GraphQL is not reachable from the agents' Claude sessions, so an agent cannot create or edit the board. Rutvij creates it once:

1. **Create the board.** Go to github.com → your profile → **Projects** → **New project** → **Board**. Name it **Cunstruct Agent Command Centre**, then link the repository `rutvijkarkhanis/cunstruct`.
2. **Status field options:** Backlog, Ready, In Progress, Blocked, In Review, Done.
3. **Custom fields:**
   - *Agent* (single select: Learnator, Ruthvich, Codex);
   - *Priority* (P0, P1, P2);
   - *Workstream* (Orchestration, Product, Assurance).

   Also turn on the built-in fields **Parent issue**, **Sub-issue progress**, **Linked pull requests** and **Milestone**.
4. **Workflows** (Project → ⋯ → Workflows):
   - **Auto-add to project**: repository `cunstruct`, filter `is:issue label:workstream:orchestration,type:pilot,needs-rutvij`;
   - **Item closed → Done**;
   - **Pull request merged → Done**.
5. **Views:**
   - **Board**, grouped by Status;
   - **Table**, with fields Title, Status, Agent, Priority, Workstream, Linked PRs, Sub-issue progress and Milestone;
   - **Needs My Input**, a table filtered by `label:needs-rutvij is:open`;
   - **Blocked**, filtered by `label:status:blocked`;
   - **By agent**, a board grouped by Agent.

The labels remain the source of truth. Agents cannot write the Project's own fields, so Status, Agent and Priority on the board may lag until Rutvij syncs them. The label-filtered views (Needs My Input, Blocked) are always correct, because filters read labels directly.

## 4. Known limitations, with the smallest viable solution for each

| Need | Limitation | Smallest viable solution |
|---|---|---|
| Notification to Rutvij | Agents act as his own account, so GitHub sends him **no notifications** for their actions | Bookmark the Needs Rutvij view and check it daily (D3). Optional: a Claude scheduled task that checks it daily and pushes to his phone, with his approval. |
| Progress bar | GitHub has no calculated custom field | The milestone percentage and sub-issue progress, guarded by the "closed but not verified" audit query |
| Board fields | Not writable by agents | Labels are authoritative, and views filter by label |
| Real approvals | Same-account PRs cannot be approved | Comment review plus the reviewer-only `verified` label (PROTOCOL §9) |
| Waking an agent | No agent can wake another | Rutvij starts sessions with the start prompt. Agents leave complete checkpoints. |

## 5. Verification of the setup (run 26 Oct 2026)

These outputs come from `gh api` against the live repository. Re-run them to check the setup:

```
gh api repos/rutvijkarkhanis/cunstruct/labels --paginate --jq '.[].name'                  # 20 new labels present
gh api repos/rutvijkarkhanis/cunstruct/milestones/1 --jq '.title,.open_issues'           # Orchestration pilot, 3
gh api repos/rutvijkarkhanis/cunstruct/issues/221/sub_issues --jq '.[].number'           # 218 219 220
gh api repos/rutvijkarkhanis/cunstruct/issues/221 --jq .sub_issues_summary                # {"completed":0,"percent_completed":0,"total":3}
gh api repos/rutvijkarkhanis/cunstruct/issues/219/dependencies/blocked_by --jq '.[].number' # 218 220
```
