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
| Verified done | `is:closed reason:completed label:verified` |
| **Audit 1: closed but not verified (must be empty)** | `is:closed reason:completed label:type:pilot -label:verified` |
| **Audit 2: closed as not planned, still counted (must be empty)** | `is:closed milestone:"Orchestration pilot" -reason:completed` |
| Mine (agent) | `is:open label:agent:<name>` |
| PRs for a task | `is:pr "CC-NNN"` |

#221 links each of these views directly.

**Agents: use the repo-scoped REST equivalents.** GitHub's search API (`search/issues`) is blocked from Claude agent sessions (verified: HTTP 403, "sessions are bound to their configured repositories"). The `issues` list endpoint works:

```
R=repos/rutvijkarkhanis/cunstruct
gh api "$R/issues?state=open&labels=needs-rutvij" --jq '[.[]|select(.pull_request==null)|.number]'
gh api "$R/issues?state=open&labels=status:ready,agent:<name>" --jq '[.[]|select(.pull_request==null)|.number]'   # comma = AND
gh api "$R/issues?state=open&labels=agent:<name>" --jq '[.[]|select(.pull_request==null)|{number,title,labels:[.labels[].name]}]'
# Audit 1 (must print []):
gh api "$R/issues?state=closed&labels=type:pilot&per_page=100" --jq '[.[]|select(.state_reason=="completed")|select([.labels[].name]|index("verified")|not)|.number]'
# Audit 2 (must print []):
gh api "$R/issues?state=closed&milestone=1&per_page=100" --jq '[.[]|select(.state_reason!="completed")|.number]'
```
An agent without `gh` uses its GitHub tool's issue-list call with the same label filters.

## 3. GitHub Project, created by hand (CC-006, about 15 minutes, optional)

The board is a convenience; the label views in §2 are complete without it. The Projects (v2) API is GraphQL-only, and GraphQL is blocked in agent sessions (HTTP 403, verified 26 Oct). So **only Rutvij can create or edit the board, and agents never read or write it.**

The menu names below follow GitHub's documented Projects interface. If a label in the UI differs, use the closest equivalent and note it on #221.

1. **Create or locate the board.**
   - First check github.com → your avatar → **Your projects** for an existing *Cunstruct Agent Command Centre*, and reuse it if it is there.
   - Otherwise click **New project**, choose the **Table** layout (a board view is added in step 5), name it **Cunstruct Agent Command Centre**, and create it.
   - Keep visibility **Private** unless you want it public. Agents don't need access.
2. **Link it to the repository.** In `rutvijkarkhanis/cunstruct` → **Projects** tab → **Link a project**, pick the board. This makes it show on the repository and lets issues be added from the repository.
3. **Add the existing issues.** Auto-add only catches issues created or updated *after* it is enabled, so the current ones are added by hand:
   - In the table, click **+ Add item** → type `#` → choose the repository → add #217, #218, #219, #220 and #221;
   - or paste each issue URL into the add-item row.
4. **Turn on automation** (board menu **⋯ → Workflows**):
   - **Auto-add to project**: repository `cunstruct`, filter `is:issue label:workstream:orchestration`. Every agent task carries a workstream label, so new tasks are picked up.
   - Keep the defaults **Item closed** and **Pull request merged** (they set Status to Done).
5. **Configure the views.** Each view's filter reads **labels**, which are the source of truth and always current:

   | View (tab name) | Layout | Filter | Shown fields |
   |---|---|---|---|
   | **All tasks** | Table | `is:issue` | Title, Labels, Milestone, Linked pull requests, Parent issue, Sub-issue progress |
   | **Needs Rutvij** | Table | `is:open label:needs-rutvij` | Title, Labels, Linked pull requests |
   | **Ready** | Table | `is:open label:status:ready` | Title, Labels |
   | **In progress** | Table | `is:open label:status:in-progress` | Title, Labels, Linked pull requests |
   | **Blocked** | Table | `is:open label:status:blocked` | Title, Labels |
   | **In review** | Table | `is:open label:status:in-review` | Title, Labels, Linked pull requests |
   | **Verified done** | Table | `is:closed label:verified` | Title, Milestone |
   | **Board** | Board, column field *Status* | `is:issue` | — |

   For **Board**, edit the Status field's options to Backlog, Ready, In Progress, Blocked, In Review, Done. Agents cannot set this field, so the Board's columns lag the labels unless Rutvij drags cards. Treat the Board as a picture and the filtered tables as the truth.

   Don't create separate *Agent*, *Priority* or *Workstream* fields. Agents can't fill them, so they would always be stale. Those facts live in the Labels column, and you can sort or filter by `label:agent:codex`.
6. **Progress.** The Project cannot calculate a percentage. Progress is the **Orchestration pilot milestone** percentage and #221's sub-issue progress (`PLAN.md` §3), both visible as fields in **All tasks**. They are trustworthy only while both audit queries in §2 are empty.
7. **Link the board to #221.** Copy the Project URL into a comment on #221: `Project board: <URL> — Rutvij`. Also add #221 to the board (step 3).

Agents keep working entirely from labels and issues. If the board is never created, nothing in the protocol breaks.

## 4. Known limitations, with the smallest viable solution for each

| Need | Limitation | Smallest viable solution |
|---|---|---|
| Notification to Rutvij | Agents act as his own account, so GitHub sends him **no notifications** for their actions | Bookmark the Needs Rutvij view and check it daily (D3). Optional: a Claude scheduled task that checks it daily and pushes to his phone, with his approval. |
| Progress bar | GitHub has no calculated custom field. Milestone and sub-issue counts include *every* closed issue. | The milestone percentage and sub-issue progress, guarded by closing rules and both audit queries (§2) |
| Board fields | Not writable by agents | Labels are authoritative, and views filter by label |
| Real approvals | Same-account PRs cannot be approved, and every label change shows as the same account | Signed comment review before `verified`, checked by Rutvij at merge (PROTOCOL §9) |
| Waking an agent | No agent can wake another | Rutvij starts sessions with the start prompt. Agents leave complete checkpoints. |

## 5. Operator quick reference (Rutvij)

| To… | Do |
|---|---|
| Start an agent | Paste the start prompt from `PLAN.md` §7 into a new session of that agent. Use the relay schedule in `PILOT.md` §3 during the pilot. |
| See what needs you | Open **Needs Rutvij** (§2) or the Project's Needs Rutvij view |
| Answer a question | Reply **on the issue** as `DECISION <ID>: <option and the action it authorizes>` ending `— Rutvij` (PROTOCOL §2.1). Then restart the asking agent. A chat answer relayed by an agent is a record only, never authorization. |
| Make a ticket claimable | Swap `status:backlog` for `status:ready`, and only if its "blocked by" issues are closed as completed and `verified` |
| Merge | Run the PROTOCOL §9 merge checklist. Read the log of every failing hosted check yourself; no failure is accepted by rule. A Vercel Preview failure is caused by the staging guard only if its log shows "Vercel Preview build refused". Record the outcome as `DECISION <ID>: merge despite … — Rutvij`. |
| Recover interrupted work | Start the owning agent with the start prompt. It resumes from its last `CHECKPOINT` (PROTOCOL §14). If an owner is gone for over 24 hours after a `stale` comment, reassign by swapping the `agent:*` label and commenting. |
| Change the plan | Approve or reject a `type:plan-change` issue. Approved changes bump `PLAN.md`'s version and change log. |
| Check progress | Open the milestone. Confirm both audit queries (§2) are empty. |
| Review the decision log | Search the repository's issues for `"DECISION"`. Every hit must be a comment you wrote. An agent-written `DECISION` or `— Rutvij` is a protocol breach (PROTOCOL §2.1). |

## 6. Verification of the setup (run 26 Oct 2026)

These outputs come from `gh api` against the live repository. Re-run them to check the setup:

```
gh api repos/rutvijkarkhanis/cunstruct/labels --paginate --jq '.[].name'                  # 20 new labels present
gh api repos/rutvijkarkhanis/cunstruct/milestones/1 --jq '.title,.open_issues'           # Orchestration pilot, 3
gh api repos/rutvijkarkhanis/cunstruct/issues/221/sub_issues --jq '.[].number'           # 218 219 220
gh api repos/rutvijkarkhanis/cunstruct/issues/221 --jq .sub_issues_summary                # {"completed":0,"percent_completed":0,"total":3}
gh api repos/rutvijkarkhanis/cunstruct/issues/219/dependencies/blocked_by --jq '.[].number' # 218 220
```
