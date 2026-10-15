# Deferred migrations — Stage 3–6 cost estimation (not in V1)

These four migrations (DSR mapping, rate evidence, rate adoption, commercial
revisions) are deliberately kept OUT of `supabase/migrations/`, so the Supabase
GitHub integration connected to `main` cannot apply them to production on merge.

- They are deferred from V1. Until applied, the app shows each feature as
  "not set up on this database yet" and saves nothing.
- `20261005000000_boq_line_rate_adoption.sql` writes to `boq_line_change_log`,
  which production does not have until `docs/audit-history-deployment.md` is run.
- To ship them: run the audit-history runbook first, validate on staging per
  `docs/staging-validation-stage3-6.md` (`npm run staging:migrate` reads this
  directory), then move them back into `supabase/migrations/` in a reviewed PR.
