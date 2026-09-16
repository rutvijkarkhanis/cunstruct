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
