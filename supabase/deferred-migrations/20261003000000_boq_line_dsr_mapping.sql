-- BOQ LINE → DSR SPECIFICATION MAPPING — a reviewed, per-line decision linking
-- a boq_line to the dsr_item it corresponds to, used ONLY as a historical
-- reference benchmark (indicative costing). It is deliberately a separate
-- table, never columns on boq_line: nothing here is read by the commercial
-- waterfall (boq_line.dsr_rate / custom_rate / computeCommercials) and nothing
-- here writes to boq_line. Clearing a decision deletes the mapping row only.
--
-- ── Identity ─────────────────────────────────────────────────────────────
-- Keyed by boq_line.id (a stable uuid), one decision per line. dsr_item is
-- referenced by its uuid, never by code: dsr_item.code is unique only per
-- (source, rate_year) (dsr_item_uq), so the same code can exist in several
-- schedules/years, and a BOQ line's external mark code is not unique either.
--
-- ── Snapshot ─────────────────────────────────────────────────────────────
-- dsr_code … dsr_rate_year are COPIES of the dsr_item row taken when the
-- reviewer made the decision. The estimate reads only these copies, so a later
-- edit or reload of dsr_item can never silently change an existing mapping or
-- estimate. dsr_item_id is `on delete set null` so the snapshot (the durable
-- record) survives the reference row being removed. Snapshot fields are stored
-- exactly as found — a missing rate/unit/year stays null, never filled in.
--
-- ── Status ───────────────────────────────────────────────────────────────
--   mapped        a DSR item was selected; snapshot required.
--   needs_review  ambiguous; may carry a tentative candidate snapshot, but is
--                 never priced.
--   unmatched     no DSR equivalent (custom item); carries no DSR reference.
-- No row at all = unmapped (no decision yet).
--
-- include_in_estimate is the reviewer's explicit opt-in to use this mapping's
-- reference rate in the indicative estimate; only a `mapped` row may set it.
-- Unit compatibility is NOT decided here: units are compared at estimate time
-- against the line's current unit, and a mismatch is never priced or
-- converted.
--
-- Purely additive: no existing table or column is altered. Not applied to any
-- database by the commit that adds it.

create table if not exists public.boq_line_dsr_mapping (
  id                   uuid primary key default gen_random_uuid(),
  -- Denormalised for RLS and per-BOQ reads; always derived from the line by the
  -- trigger below, so it can never disagree with boq_line.boq_id.
  boq_id               uuid not null references public.boq(id) on delete cascade,
  boq_line_id          uuid not null references public.boq_line(id) on delete cascade,
  status               text not null check (status in ('mapped','needs_review','unmatched')),
  dsr_item_id          uuid references public.dsr_item(id) on delete set null,
  dsr_code             text,
  dsr_description      text,
  dsr_unit             text,
  dsr_rate             numeric,
  dsr_source           text,
  dsr_rate_year        text,
  include_in_estimate  boolean not null default false,
  reviewer_note        text,
  reviewed_by          uuid references auth.users(id),
  reviewed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint boq_line_dsr_mapping_line_uq unique (boq_line_id),
  -- A mapped decision must carry the reference it was made against.
  constraint boq_line_dsr_mapping_mapped_has_snapshot
    check (status <> 'mapped' or dsr_code is not null),
  -- An unmatched (custom) item carries no DSR reference at all.
  constraint boq_line_dsr_mapping_unmatched_no_reference
    check (status <> 'unmatched' or (dsr_item_id is null and dsr_code is null and dsr_rate is null)),
  -- Only an explicit, settled match can feed the indicative estimate.
  constraint boq_line_dsr_mapping_include_requires_mapped
    check (not include_in_estimate or status = 'mapped')
);
create index if not exists boq_line_dsr_mapping_boq_idx on public.boq_line_dsr_mapping (boq_id);
create index if not exists boq_line_dsr_mapping_item_idx on public.boq_line_dsr_mapping (dsr_item_id);

create or replace function public.boq_line_dsr_mapping_sync()
returns trigger language plpgsql as $$
begin
  select l.boq_id into new.boq_id from public.boq_line l where l.id = new.boq_line_id;
  if new.boq_id is null then
    raise exception 'boq_line % not found', new.boq_line_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists boq_line_dsr_mapping_sync on public.boq_line_dsr_mapping;
create trigger boq_line_dsr_mapping_sync
  before insert or update on public.boq_line_dsr_mapping
  for each row execute function public.boq_line_dsr_mapping_sync();

alter table public.boq_line_dsr_mapping enable row level security;

-- Same access model as boq_line: staff manage; a project owner can read.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_line_dsr_mapping' and policyname='boq_line_dsr_mapping staff manage') then
    create policy "boq_line_dsr_mapping staff manage" on public.boq_line_dsr_mapping for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_line_dsr_mapping' and policyname='boq_line_dsr_mapping owner read') then
    create policy "boq_line_dsr_mapping owner read" on public.boq_line_dsr_mapping for select
      using (exists (
        select 1 from public.boq b join public.projects p on p.id = b.project_id
        where b.id = boq_line_dsr_mapping.boq_id and p.owner_id = auth.uid()
      ));
  end if;
end $$;
