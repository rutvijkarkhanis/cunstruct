-- ANALYSIS RUN SOURCE — BOQ-SCOPED CLAIM IDENTITY. Phase A: a single
-- document (e.g. an architectural floor plan) may legitimately feed MULTIPLE
-- disciplines' BOQs (Civil, Electrical, Plumbing, ...), each via its own
-- generateAnalysis({mode:"BOQ", boqId}) call. Before this migration, the
-- claim/dedup identity was (project_id, content_hash, contract_version,
-- provider, model, mode) — with NO boq_id component — so the FIRST BOQ to
-- claim a shared document's content hash permanently "won" it project-wide:
-- every other BOQ's later call over the identical content+mode saw it as
-- already analysed and silently got zero items from it. That is the exact
-- bug this migration fixes for BOQ-mode claims.
--
-- LOCATION stays exactly as it was: one call per DISTINCT document, reused by
-- every BOQ that references it — never multiplied by how many BOQs a
-- document feeds. So the new identity is mode-dependent:
--   BOQ / BOQ_AND_LOCATION:  (project_id, content_hash, contract_version,
--                             provider, model, mode, boq_id) — boq_id REQUIRED
--   LOCATION:                (project_id, content_hash, contract_version,
--                             provider, model, mode) — boq_id ignored, exactly
--                             the pre-migration identity
--
-- A single table-wide UNIQUE constraint can't express two different column
-- sets depending on a row's own `mode` value, so this uses two PARTIAL
-- unique indexes instead (Postgres has no partial UNIQUE CONSTRAINT syntax,
-- only partial unique INDEXES, which enforce identically).
--
-- Purely additive plus one constraint replacement, same discipline as
-- 20260925000000_analysis_mode.sql:
--   - new `boq_id` column is nullable — every existing row (BOQ or LOCATION)
--     gets NULL, never backfilled/rewritten.
--   - Dropping the old 6-column unique constraint and replacing it with two
--     NARROWER (partial, row-subset) unique indexes can never newly collide:
--     every row was already guaranteed unique on those exact 6 columns
--     project-wide; a partial index over a SUBSET of rows on the SAME (or a
--     superset of) those columns stays unique for the same reason appending
--     a column to an already-unique tuple never merges two distinct rows
--     (20260925000000's own reasoning, applied twice here: once for
--     subsetting by mode, once for appending boq_id).
--   - The new CHECK constraint is added NOT VALID: it protects every future
--     INSERT/UPDATE from this point on, but is never validated against
--     historical rows, so a pre-existing BOQ-mode row with boq_id = NULL
--     (every row before this migration) stays exactly as it is — readable,
--     never rewritten, never flagged.

alter table public.analysis_run_source
  add column if not exists boq_id uuid references public.boq(id) on delete cascade;

create index if not exists analysis_run_source_boq_idx on public.analysis_run_source (boq_id);

-- ── Replace the old project-wide (no boq_id) uniqueness with the two
-- mode-dependent partial indexes described above. ───────────────────────────
alter table public.analysis_run_source drop constraint if exists analysis_run_source_identity_key;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'analysis_run_source'
      and indexname = 'analysis_run_source_boq_identity_key'
  ) then
    create unique index analysis_run_source_boq_identity_key
      on public.analysis_run_source (project_id, content_hash, contract_version, provider, model, mode, boq_id)
      where mode in ('BOQ', 'BOQ_AND_LOCATION');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'analysis_run_source'
      and indexname = 'analysis_run_source_location_identity_key'
  ) then
    create unique index analysis_run_source_location_identity_key
      on public.analysis_run_source (project_id, content_hash, contract_version, provider, model, mode)
      where mode = 'LOCATION';
  end if;
end $$;

-- ── Defense in depth: a BOQ/BOQ_AND_LOCATION claim must always carry a real
-- boq_id — the application (ai-analysis edge function) is responsible for
-- rejecting such a request up front when boqId is missing, but this makes
-- "never silently fall back to NULL for a BOQ analysis claim" a DB-enforced
-- invariant too, for every future row, without requiring historical rows
-- (which do have boq_id = NULL) to satisfy it retroactively. ────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'analysis_run_source_boq_mode_requires_boq_id'
  ) then
    alter table public.analysis_run_source
      add constraint analysis_run_source_boq_mode_requires_boq_id
      check (mode not in ('BOQ', 'BOQ_AND_LOCATION') or boq_id is not null) not valid;
  end if;
end $$;
