# Deferred migrations — Stage 3–6 cost estimation (not in V1)

These four migrations (DSR mapping, rate evidence, rate adoption, commercial
revisions) are deliberately kept OUT of `supabase/migrations/`, so the Supabase
GitHub integration connected to `main` cannot apply them to production on merge.

- They are deferred from V1. Until applied, the app shows each feature as
  "not set up on this database yet" and saves nothing.
- `20261005000000_boq_line_rate_adoption.sql` writes to `boq_line_change_log`,
  which production does not have until `docs/audit-history-deployment.md` is run.
- To ship them: run the audit-history runbook first, validate on staging per
  `docs/staging-validation-stage3-6.md` (`npm run staging:migrate` applies the list in
  `scripts/staging-migrate.mjs`, in order), then move them back into `supabase/migrations/` in a reviewed PR.
- `20261007000000_boq_commercial_revision_provenance.sql` is a follow-up to
  `20261006000000` (not an edit of it): it adds `basis`/`basis_note` to frozen
  revision lines and refuses a freeze whose snapshot status or basis is stale.
  Apply it together with, and immediately after, `20261006000000`. Verified
  only on PGlite (real Postgres, stub auth/RLS) — not on Supabase.
- `20261008000000_boq_commercial_revision_line_identity.sql` is a follow-up to
  `20261007000000` (function-only; no table changes): the freeze also refuses a
  snapshot whose `dsr_code`, `section`, `basis_note` (when sent), or stated
  source drawing/page differs from the persisted line. Apply strictly in
  timestamp order, after `20261007000000` — re-running `20261007000000` after
  it silently restores the weaker check (re-run `20261008000000` to fix).
  Chain 20260921 → 20261003…20261008, its re-run, and the freeze → edit → diff
  → freeze → export lifecycle were run on PGlite (real Postgres, stub
  auth/RLS) — not on Supabase.
