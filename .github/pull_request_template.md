<!-- Agent PRs: docs/agent-orchestration/PROTOCOL.md §8. Public repository — no secrets, production or client data. -->
## Task
Closes #<issue> · ID: CC-NNN · Agent: <Learnator | Ruthvich | Codex | Rutvij>

## Summary
<what changed and why, 2–5 lines>

## Files
- Changed: <list>
- Owned by the ticket: <list> — any difference explained here

## Verification (actual results)
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | |
| Tests | `npm run test` | |
| Build (no `VERCEL*`/`STAGING_*` vars) | `npm run build` | exit code, last lines, commit SHA |
| Hosted checks | Vercel, Supabase Preview, … | each result; say "log not available to the agent" where true |
| Other / not run (and why) | | |

A local build is not proof that a hosted deployment succeeds. Every failing hosted check needs Rutvij's review before merge (PROTOCOL §9).

Pre-existing failures (with proof they also fail on `main`): <none | list>

## Review
Reviewer: <agent> — review summary per PROTOCOL §9. `verified` is added only by the reviewer.

## Safety
- [ ] No production, secret, auth, billing, migration or deploy change (or approval linked: <link>)
- [ ] Only owned files changed

— <signature>
