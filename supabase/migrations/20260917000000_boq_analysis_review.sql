-- BOQ ANALYSIS REVIEW WORKSTATION (deterministic; NO AI integrated here).
--
-- Stores an imported/validated drawing-analysis run and the per-item review the
-- human performs against it. The AI value is kept IMMUTABLE (ai_json); the
-- reviewer's corrections are stored separately (reviewer_json) so both are always
-- retained — importing an analysis NEVER changes a boq_line. Purely additive,
-- idempotent; mirrors the existing staff-manage / owner-read RLS pattern.

-- ── An analysis run — one validated analysis loaded for review ────────────────
create table if not exists public.analysis_run (
  id             uuid primary key default gen_random_uuid(),
  boq_id         uuid references public.boq(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete cascade,
  schema_version text not null default 'cunstruct.analysis.v1',
  source         text not null default 'json_import' check (source in ('json_import','ai_api')),
  provider       text,                    -- abstract provider label (ai_api only); never a key
  model          text,
  item_count     int not null default 0,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
create index if not exists analysis_run_boq_idx on public.analysis_run (boq_id);
create index if not exists analysis_run_project_idx on public.analysis_run (project_id);

-- ── A review item — the immutable AI value + the reviewer's decision ──────────
create table if not exists public.analysis_review_item (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.analysis_run(id) on delete cascade,
  boq_id        uuid references public.boq(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete cascade,
  item_key      text,                     -- stable analysis key (e.g. "W1")
  item_name     text,
  -- The AI analysis for this item, verbatim. NEVER overwritten by a review.
  ai_json       jsonb not null,
  -- Reviewer overrides (quantity/unit/dimension/spec/location/notes). Null until edited.
  reviewer_json jsonb,
  review_status text not null default 'PENDING_REVIEW'
                 check (review_status in ('PENDING_REVIEW','VERIFIED','EDITED','FLAGGED','MARKED_PENDING')),
  flag_reason   text,
  review_note   text,
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists analysis_review_item_run_idx on public.analysis_review_item (run_id);

-- ── RLS — mirrors the existing project-data pattern exactly ───────────────────
alter table public.analysis_run         enable row level security;
alter table public.analysis_review_item enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analysis_run' and policyname='analysis_run staff manage') then
    create policy "analysis_run staff manage" on public.analysis_run for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analysis_run' and policyname='analysis_run owner read') then
    create policy "analysis_run owner read" on public.analysis_run for select
      using (exists (select 1 from public.projects p
        where p.id = analysis_run.project_id and p.owner_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analysis_review_item' and policyname='analysis_review_item staff manage') then
    create policy "analysis_review_item staff manage" on public.analysis_review_item for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analysis_review_item' and policyname='analysis_review_item owner read') then
    create policy "analysis_review_item owner read" on public.analysis_review_item for select
      using (exists (select 1 from public.projects p
        where p.id = analysis_review_item.project_id and p.owner_id = auth.uid()));
  end if;
end $$;
