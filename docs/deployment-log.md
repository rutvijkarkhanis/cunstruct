# Deployment log

Records commits pushed to `main` solely to trigger the Supabase GitHub
production integration's webhook — not application changes. Each entry
here corresponds to exactly one such commit; the application/code baseline
for a given deployment is the most recent non-trigger commit before it,
never the trigger commit itself.

## 2026-09-15 — initial production deploy trigger

The Supabase GitHub integration (repo `rutvijkarkhanis/cunstruct`, production
environment `main`) was connected *after* commit `ee98fa086db129c95c753bfb065bf8adda9b8101`
already existed on `main`. Webhook-based deploy integrations trigger on new
push events, not retroactively on the commit that was HEAD at connection
time, so a new push was needed to initiate the first automated deploy of:

- `supabase/migrations/20260922000000_document_folders.sql`
- `supabase/migrations/20260923000000_ai_analysis_pipeline.sql`
- `supabase/functions/ai-analysis`

This file's addition is that trigger commit. It changes no application
behavior, no SQL migration content, no Edge Function code, no package
dependency, and no configuration. The application/code baseline for this
deploy is `ee98fa086db129c95c753bfb065bf8adda9b8101`.

## 2026-09-16 — root cause found: empty migration-history table, plus PR-merge test

Root cause of the stalled deploy: production's `supabase_migrations.schema_migrations`
table had zero rows despite the database already containing the schema from
36 of the repo's 38 migrations (applied outside migration tracking, prior to
this integration ever existing) — see the investigation in this session for
the full evidence chain. `20260922000000_document_folders.sql` and
`20260923000000_ai_analysis_pipeline.sql` remain genuinely pending; the
history-baseline repair is being applied separately, directly via the
Supabase SQL Editor (a metadata-only operation on that tracking table, no
schema DDL), not through this repo.

Separately, PR #115 (`deploy-supabase-production`, comment-only change to
`supabase/config.toml`) was merged to test whether the Supabase GitHub App's
documented "migrations run on PR merge" behavior fires here — see that PR
and its merge commit for the result.

This entry, and the harmless documentation-only commit that carries it, is
a further direct-push deploy-trigger test on top of the merge above. It
changes no application code, no migration file, no Edge Function code, no
Supabase configuration semantics, and nothing database-related — only this
log. The application/code baseline remains
`ee98fa086db129c95c753bfb065bf8adda9b8101`.

## 2026-10-21 — R7 attempt stopped before any write: history/schema mismatch; no backup path

Read-only findings against production (Management API SQL, SELECT only; nothing written):

- `supabase_migrations.schema_migrations` lists `20260921000000_boq_review_apply` (empty
  `statements`), but none of its objects exist: no `boq_line_change_log` in any schema, no
  policies, no indexes, no functions/triggers referencing it. Nothing is partially applied.
- `20260910000000_scope_taxonomy` is in the same state: listed (empty `statements`), but
  `scope_module`, `scope_module_suggestion`, their index and 4 policies are absent. No later
  migration drops them.
- All other 43 history rows match the schema (every table, index and added column each file
  creates is present). History and `supabase/migrations/` hold the same 45 versions.
- The 36 rows with empty `statements` are exactly the 36 repo migrations before `20260922`,
  consistent with the 2026-09-16 history-baseline entry above having marked all of them applied
  although 0910 and 0921 had never run. Suspected, not proven: the history table has no
  timestamps and no repair log exists.
- `20260929000000_boq_line_identity_constraint` IS applied: its row stores both statements and
  both unique indexes exist with the file's exact definitions; 0 duplicate identities in `boq_line`.
  It does not reference `boq_line_change_log`.
- R7 file SHA-256 `b9fb9500df2266a29d857ff2639e82c880cc1020c488ef4a1ae08f24c9fddb53` (unchanged on
  `main`); all its prerequisites are present. Applying it unchanged would make history and schema
  agree without any history edit.

Pre-change snapshot (committed, not a backup): `docs/benchmarks/e3/snapshots/` — `dsr_item`
(2,758 rows, SHA-256 `9dd8f87d…f205ce`) and count/md5 of `projects`, `boq`, `boq_line`,
`dsr_coefficient`. Re-verified unchanged at the end of this session.

**Not applied — blocker:** the required full backup (`scripts/prod-backup.sh`) could not be taken:
`PROD_BACKUP_DB_URL` is not configured, and this cloud container cannot resolve or reach the
database host on port 5432 (egress is HTTPS-proxy only). No R7 apply, no DSR correction, no
migration-history change was made.

**Separate follow-up — `20260910000000_scope_taxonomy` (not part of R7):** its absence does not
block R7 (the R7 file does not reference `scope_module*`) or the DSR correction (touches only
`dsr_item`). It needs its own decision: confirm whether the app reads `scope_module` /
`scope_module_suggestion` at runtime, then — after a backup and owner approval — apply the file
unchanged (it also inserts seed rows). Do not edit migration history for it.
