-- ANALYSIS MODE — plumbing only (Phase 3). Adds `mode` to analysis_run and
-- analysis_run_source so a run can be tagged BOQ / LOCATION / BOQ_AND_LOCATION
-- and so the SAME file, under the SAME contract/provider/model, can be
-- claimed independently once per mode instead of colliding with a run of a
-- different mode. This migration does not change what any mode actually
-- extracts (still identical BOQ extraction for all three today) — see
-- supabase/functions/_shared/contract.ts.
--
-- Purely additive plus one constraint replacement. Existing rows in both
-- tables get mode = 'BOQ' via the column default — no backfill statement is
-- needed (ADD COLUMN ... NOT NULL DEFAULT is a fast, no-rewrite metadata
-- change in Postgres 11+, and every pre-existing row reads the same literal
-- default value).

alter table public.analysis_run
  add column if not exists mode text not null default 'BOQ'
    check (mode in ('BOQ','LOCATION','BOQ_AND_LOCATION'));

alter table public.analysis_run_source
  add column if not exists mode text not null default 'BOQ'
    check (mode in ('BOQ','LOCATION','BOQ_AND_LOCATION'));

-- ── Replace the 5-column uniqueness with a 6-column one that also scopes by
-- mode. Safety: the existing constraint already guarantees no two current
-- rows collide on (project_id, content_hash, contract_version, provider,
-- model); every existing row gets the IDENTICAL new `mode` value ('BOQ') from
-- the column default above; appending an identical constant to every row of
-- an already-unique tuple can never create a new collision — two rows
-- distinct in the original 5 columns remain distinct in the expanded
-- 6-tuple. This holds for any existing data, regardless of row count or
-- content, so no data inspection or backfill is required for correctness.
--
-- The existing constraint's name is discovered from Postgres's own catalog
-- by its exact column set rather than hardcoded — `unique(...)` was declared
-- inline in the original migration, so Postgres auto-named it, and that
-- generated name is not guaranteed here without querying it (and could in
-- principle be silently truncated to fit the 63-byte identifier limit).
do $$
declare
  old_constraint text;
begin
  -- Column-SET comparison (both sides sorted by attnum), not an exact-array
  -- match: conkey stores columns in the constraint's DECLARATION order, which
  -- is not guaranteed to match physical column order, so an unsorted
  -- comparison could miss the real constraint depending on how it was
  -- originally written. Sorting both sides makes this robust either way.
  select con.conname into old_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'analysis_run_source'
    and con.contype = 'u'
    and (select array_agg(k order by k) from unnest(con.conkey) as k) = (
      select array_agg(attnum order by attnum)
      from pg_attribute
      where attrelid = rel.oid
        and attname in ('project_id', 'content_hash', 'contract_version', 'provider', 'model')
    );
  if old_constraint is not null then
    execute format('alter table public.analysis_run_source drop constraint %I', old_constraint);
  end if;
end $$;

-- If the old constraint wasn't found (e.g. this migration re-runs after the
-- new one already exists), this simply no-ops via IF NOT EXISTS-equivalent
-- guard below rather than erroring on a duplicate constraint name.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'analysis_run_source_identity_key'
  ) then
    alter table public.analysis_run_source
      add constraint analysis_run_source_identity_key
      unique (project_id, content_hash, contract_version, provider, model, mode);
  end if;
end $$;
