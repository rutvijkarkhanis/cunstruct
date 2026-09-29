-- BOQ LINE IDENTITY CONSTRAINT — makes (boq_id, external_key, resolved scope)
-- a real, database-enforced identity for boq_line rows, closing a race that
-- let two independent operations both insert a "new" line for the exact same
-- mark: applyReviewPlan's in-memory createdNewLineIdentities Set (added to
-- stop this within a single call) is recreated fresh on every invocation, so
-- it cannot see an insert made by a SEPARATE, independent applyReviewPlan()
-- call — two reviewers, two tabs, or any apply that ran in between, each
-- classifying the same review item against a "no existing line yet"
-- snapshot. The result was two boq_line rows for the same identity, silently
-- doubling the quantity, with the second insert reported as a success.
--
-- This mirrors the existing precedent in this codebase for exactly this
-- class of problem: analysis_run_source's
-- `unique (project_id, content_hash, contract_version, provider, model)`
-- (20260923000000_ai_analysis_pipeline.sql) plus insert-then-catch-23505
-- (supabase/functions/_shared/claiming.ts, ai-analysis/index.ts). The
-- application side (src/lib/applyFinding.ts) is updated in the same commit
-- to catch the resulting 23505 here and treat it as a conflict — never a
-- fabricated success — reusing the existing conflictedReviewItemIds/
-- unresolvedCount mechanism from #133/#134/#135.
--
-- ── NULL semantics ───────────────────────────────────────────────────────
-- scope_id is nullable (20260924000000_boq_line_scope.sql): most BOQs are a
-- single scope as a whole, so most lines are never individually scoped. A
-- naive `unique (boq_id, external_key, scope_id)` would NOT prevent two
-- duplicate rows that are BOTH unscoped (scope_id IS NULL) sharing the same
-- external_key — Postgres treats NULL as distinct from NULL in a unique
-- index — which is exactly the common case this bug reproduces in (a review
-- item with no location). Two partial unique indexes correctly cover both
-- cases without inventing a sentinel value for NULL:
--   1. Scoped rows: unique per (boq_id, external_key, scope_id) whenever a
--      real scope is set.
--   2. Unscoped rows: unique per (boq_id, external_key) whenever scope_id is
--      NULL — the identity IS the (boq_id, external_key) pair in that case,
--      matching classifyReviewItem's own single-candidate-matches-
--      unconditionally-when-unscoped semantics (src/lib/review/applyReview.ts).
-- A row with external_key IS NULL (e.g. a manually-added BOQ line with no
-- mark code, or the deterministic template-generated lines that never set
-- external_key at all) has no identity to protect and is correctly excluded
-- from both indexes — any number of such rows may still coexist, exactly as
-- today. Different external_keys, and the same external_key resolved to
-- genuinely different scopes, are never constrained against each other by
-- either index.
--
-- Purely additive: no existing column changed or dropped, no data migrated
-- or deleted, both indexes are IF NOT EXISTS. Deployment note: if any
-- deployment's boq_line already holds duplicate rows for the same identity
-- (a preexisting instance of the exact bug this migration closes),
-- CREATE UNIQUE INDEX will fail until those rows are manually reconciled —
-- documented here rather than silently deleting or merging data.

create unique index if not exists boq_line_identity_scoped_idx
  on public.boq_line (boq_id, external_key, scope_id)
  where external_key is not null and scope_id is not null;

create unique index if not exists boq_line_identity_unscoped_idx
  on public.boq_line (boq_id, external_key)
  where external_key is not null and scope_id is null;
