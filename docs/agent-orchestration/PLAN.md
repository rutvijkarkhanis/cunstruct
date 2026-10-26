# Cunstruct agent command centre: plan of record v1.0

| | |
|---|---|
| **Version** | v1.0. Draft until the setup PR merges, then frozen. |
| **Date** | 26 Oct 2026 |
| **Owner** | Rutvij. Only he approves changes (PROTOCOL §13). |
| **Baseline** | `main` @ `1c47814` |
| **Scope** | The multi-agent orchestration system and its pilot. **Nothing else.** No Cunstruct product feature is planned here. |
| **Tracking issue** | [#221](https://github.com/rutvijkarkhanis/cunstruct/issues/221) (CC-001) |
| **Rules** | `PROTOCOL.md`. Dashboard: `DASHBOARD.md`. Pilot: `PILOT.md`. |

This plan follows the conventions of `docs/PLAN-OF-RECORD.md`:
- every item has an ID, owner, dependencies, a "done when" test and evidence;
- frozen tests are never edited to pass;
- changes need a new version with a change-log entry.

Live status is GitHub's (labels and open/closed state), not this file's.

---

## 1. Team

| Agent | Kind | Instruction file it reads | Branch prefix | Label |
|---|---|---|---|---|
| Learnator | Claude Code (Claude account) | `CLAUDE.md` → this folder | `agent/learnator/` | `agent:learnator` |
| Ruthvich | Claude Code (Claude account) | `CLAUDE.md` → this folder | `agent/ruthvich/` | `agent:ruthvich` |
| Codex | OpenAI Codex | `AGENTS.md` → this folder | `agent/codex/` | `agent:codex` |
| Rutvij | Human owner | — | — | `needs-rutvij` is his queue |

## 2. Items

| ID | Owner | Item | Depends on | Done when | Evidence |
|---|---|---|---|---|---|
| CC-001 | Learnator (setup) | Command-centre setup: labels, milestone, tracking issue, protocol, plan, pilot, templates, agent entry points | — | Setup PR merged by Rutvij. Labels, milestone 1 and issues #217–#221 exist as described in `DASHBOARD.md`. | PR link; `DASHBOARD.md` §6 verification output |
| CC-006 | **Rutvij** | Create the GitHub Project *Cunstruct Agent Command Centre* (optional; the label views work without it) | CC-001 | The Project exists with the items, views and link to #221 in `DASHBOARD.md` §3 | Project URL in a comment on #221 |
| CC-002 | Learnator | Pilot: capability check-in and interruption drill | CC-001 | #218 closed as completed and `verified` | #218 |
| CC-003 | Ruthvich | Pilot: capability check-in and capability matrix (integrator) | CC-002, CC-004 | #219 closed as completed and `verified` | #219 |
| CC-004 | Codex | Pilot: capability check-in and simulated escalation | CC-001 | #220 closed as completed and `verified` | #220 |
| CC-005 | Rutvij | Pilot retrospective: accept or revise this plan and protocol | CC-002–004 | `PILOT.md` §5 completed, and either v1.1 published or v1.0 confirmed | Comment on #221 |

## 3. Progress measure

**Progress = verified completed items ÷ planned items.** It is measured by GitHub, never self-reported:
- **Milestone "Orchestration pilot"** ([milestone 1](https://github.com/rutvijkarkhanis/cunstruct/milestone/1)): GitHub's own percentage of closed issues.
- **Sub-issue progress on #221:** GitHub's own "n of m".

Both count **every closed issue, whatever the close reason**. They therefore measure verified work only because of three rules:
- **Closing is gated:** a task issue closes only through Rutvij's merge of a verified PR (PROTOCOL §4, §9).
- **Not planned leaves the counts:** a ticket closed as not planned is first removed from the milestone and from #221's sub-issues (PROTOCOL §4).
- **Two audit queries must stay empty** (`DASHBOARD.md` §2): "closed, completed, pilot, **not** `verified`" and "closed as not planned, still in the milestone".

Any result from either query makes the bar wrong and is a P0 defect. The `verified` label alone proves nothing on a shared account. It counts only with the signed review that precedes it (PROTOCOL §9).

## 4. On hold: do not start

| ID | Item | Status |
|---|---|---|
| CC-HOLD-001 ([#217](https://github.com/rutvijkarkhanis/cunstruct/issues/217)) | BOQ-line provenance contract: scope state, evidence, formula, assumptions and revision per BOQ line | **ON HOLD — DO NOT START.** No agent may claim, branch, or open a PR for it. Only Rutvij removes `on-hold`. |

The unpushed LOCATION-assurance work on `claude/gifted-lamport-geu7ff` also waits for Rutvij. The repository is public, and that work's fixtures contain client-drawing data.

## 5. Decisions

| # | Decision | Default in force | Alternatives |
|---|---|---|---|
| D1 | Shared GitHub account: identity by label, signature, branch prefix and commit trailer (PROTOCOL §2) | In force | Separate GitHub accounts or apps per agent. This would allow real approvals and notifications, but needs account and billing changes by Rutvij. |
| D2 | Who merges pilot PRs | **Rutvij merges** after the PROTOCOL §9 merge checklist. That list accepts the known, by-design Vercel Preview failure. | The reviewing agent merges docs-only pilot PRs. Fewer escalations, but every merge to `main` triggers a Vercel production deploy. |
| D3 | How Rutvij learns of `needs-rutvij` | **He checks the Needs Rutvij view** (bookmark) at least daily during the pilot | A daily Claude scheduled task that checks the view and sends a phone push. It needs his approval because it creates a scheduled task and spends usage. |
| D4 | Project board | **Created manually by Rutvij** (CC-006). The agent sessions cannot reach the Projects API. | Labels and saved searches only. These already work without the board. |

## 6. Capabilities: verified versus assumed

Verified on 26 Oct 2026 by the setup session: Claude Code on the web, presumed Learnator, not yet confirmed by Rutvij, acting on GitHub as `rutvijkarkhanis`.

| Capability | Learnator (setup session) | Ruthvich | Codex |
|---|---|---|---|
| Read and write issues, comments, labels and milestones (REST) | **Verified**: created labels, milestone 1, #217–#221 | Assumed | Assumed |
| Sub-issues and native "blocked by" dependencies (REST) | **Verified**: #221 has 3 sub-issues; #219 blocked by #218 and #220 | Assumed | Assumed |
| Create branches, push (fast-forward) and open PRs | **Verified** (this PR; earlier #211–#216) | Assumed | Assumed |
| Force-push or rewrite history | **Not permitted** (blocked by the session's permission policy) | Unknown | Unknown |
| GitHub GraphQL, Projects v2, pinning issues | **Not available**: the proxy returns 403 for GraphQL | Unknown | Unknown |
| Read branch-protection settings | **Not available** (403). The API reports `main` as unprotected. | Unknown | Unknown |
| Formally approve a PR | **Impossible for all three** (same account as the author; GitHub rule, not tested) | Same | Same |
| Woken by GitHub events | PR comments, reviews and CI only, when subscribed; **issue comments do not wake it** | Assumed similar | **Unknown** |
| Schedule its own check-ins | Available (Claude scheduled tasks), but costs usage, so it needs D3-style approval | Assumed | **Unknown** |
| Message another agent directly | **No**: only same-account Claude sessions are reachable, and none of the others is | No | No |
| Run continuously | **No** | Assumed no | Assumed no |
| Run `npm run lint/test/build` locally | **Verified** in previous sessions | Assumed | Assumed |

The pilot replaces every "Assumed" or "Unknown" with "Verified" or "Not available" (`PILOT.md`).

## 7. Start prompt (Rutvij uses this to start any agent)

> You are **<Name>** on the Cunstruct team. Before anything else, read `docs/agent-orchestration/PLAN.md` and `PROTOCOL.md` on `main`, or on branch `claude/agent-command-centre` until it merges. Run the dashboard queries in `DASHBOARD.md` §2. Resume your own `status:in-progress` or `status:blocked` tickets from their latest checkpoint. Then do any review requested of you (a `REVIEW REQUEST` naming you on an open ticket; PROTOCOL §9). Otherwise claim one `status:ready` ticket labelled `agent:<name>`. Never start anything labelled `on-hold`. Follow PROTOCOL exactly. Sign every comment `— <Name>`. Stop after posting a checkpoint when your ticket is in review, blocked, or your session must end.

## 8. Change log

| Version | Date | Change | Approved by |
|---|---|---|---|
| v1.0 | 26 Oct 2026 | Initial plan, protocol and pilot | Pending: setup PR |
