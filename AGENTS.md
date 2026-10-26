# AGENTS.md

Instructions for coding agents (OpenAI Codex and others) working in this repository.

1. **Team protocol first.** Before doing any work, read `docs/agent-orchestration/PLAN.md` and `docs/agent-orchestration/PROTOCOL.md`. When started as a team agent, work only on a GitHub issue that is `status:ready` and labelled for you (`agent:codex` for Codex); Rutvij's direct instructions in a session take precedence, and team-relevant outcomes are recorded on the relevant issue. Follow the protocol for claiming, checkpoints, branches (`agent/codex/CC-NNN-<slug>`), PRs, review and escalation (`needs-rutvij`). Sign every comment `— Codex`.
2. **Project rules.** `CLAUDE.md` holds the repository's engineering rules (commands, architecture, standing instructions). They apply to every agent, not only Claude.
3. **Never** merge to `main`, deploy, change secrets, auth, billing or repository settings, run migrations or production writes, force-push, or start anything labelled `on-hold` without Rutvij's explicit approval on the ticket (PROTOCOL §15).
4. This repository is **public**: never post secrets, production data or client data in issues, PRs or commits.
