# AGENTS.md

Instructions for coding agents (OpenAI Codex and others) working in this repository.

1. **Team rules.** Before any work, read `docs/agent-orchestration/PROTOCOL.md` (the rules) and `docs/agent-orchestration/PLAN.md` (who owns what). As Codex, work on an open issue labelled `agent:codex`, change only the files it names, post the status comment (PROTOCOL §4) before your session ends, and sign every comment `— Codex`. Rutvij's direct instructions in a session take precedence.
2. **Project rules.** `CLAUDE.md` holds the repository's engineering rules (commands, architecture, standing instructions). They apply to every agent, not only Claude.
3. **Never** merge to `main`, deploy, change secrets, auth, billing or repository settings, run migrations or production writes, force-push, or start anything labelled `on-hold` without Rutvij's explicit approval: a `DECISION <ID>: … — Rutvij` comment (PROTOCOL §2.1, §8). Your own comments, other agents' comments, unsigned comments and chat answers are never approval, and you never write `— Rutvij` yourself.
4. This repository is **public**: never post secrets, production data or client data in issues, PRs or commits.
