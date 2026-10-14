-- BOQ LINE RATE ADOPTION — the auditable provenance record for a reviewer
-- explicitly adopting a rate into the commercial BOQ.
--
-- The write sets boq_line.custom_rate (the override every total/quote/export
-- reads as custom_rate ?? dsr_rate) with the same compare-and-swap rule as the
-- existing Apply boundary — only if the line's custom_rate/dsr_rate/unit still
-- match what the reviewer previewed — and logs the before/after in the EXISTING
-- boq_line_change_log (field = 'custom_rate'). All of it happens atomically in
-- adopt_boq_line_rate() at the end of this file.
--
-- boq_line_change_log stores only text old/new values, so it cannot hold where
-- the new rate came from or what the reviewer confirmed. This append-only table
-- adds exactly that: previous rate and basis, adopted rate, source type and
-- record, a snapshot of the source (rate, unit, date, specification context,
-- caveats), the line's unit/qty at the time, the caveats the reviewer
-- explicitly acknowledged, the confirmation statement, who, and when.
--
-- Append-only: RLS grants staff SELECT and INSERT only — there is no update or
-- delete policy, so an adoption record can't be edited or removed through the
-- API. Source ids are `on delete set null`: the snapshot, not the live source,
-- is the record.
--
-- Purely additive: no existing table or column is altered. Not applied to any
-- database by the commit that adds it.

create table if not exists public.boq_line_rate_adoption (
  id                    uuid primary key default gen_random_uuid(),
  boq_id                uuid not null references public.boq(id) on delete cascade,  -- derived from the line (trigger)
  -- Nullable so the record survives the line being deleted later.
  boq_line_id           uuid references public.boq_line(id) on delete set null,
  previous_custom_rate  numeric,
  previous_dsr_rate     numeric,
  previous_rate         numeric,               -- the effective rate before: custom_rate ?? dsr_rate
  previous_basis        text not null check (previous_basis in ('custom','dsr','none')),
  adopted_rate          numeric not null check (adopted_rate >= 0),
  adopted_basis         text not null default 'custom' check (adopted_basis = 'custom'),
  source_kind           text not null check (source_kind in ('dsr_reference','vendor_quotation','historical_boq')),
  source_quotation_id   uuid references public.vendor_quotation(id) on delete set null,
  source_boq_line_id    uuid references public.boq_line(id) on delete set null,
  source_dsr_item_id    uuid references public.dsr_item(id) on delete set null,
  source_label          text not null,
  source_unit           text,
  source_date           date,
  source_snapshot       jsonb not null,
  line_unit             text,
  line_qty              numeric,
  acknowledged_caveats  text[] not null default '{}',
  confirmation_text     text not null,
  confirmed_by          uuid not null references auth.users(id),
  confirmed_at          timestamptz not null default now(),
  -- An adopted historical rate must come from a different line.
  constraint boq_line_rate_adoption_historical_not_self check (source_boq_line_id is null or source_boq_line_id <> boq_line_id)
);
create index if not exists boq_line_rate_adoption_boq_idx  on public.boq_line_rate_adoption (boq_id);
create index if not exists boq_line_rate_adoption_line_idx on public.boq_line_rate_adoption (boq_line_id, confirmed_at desc);

create or replace function public.boq_line_rate_adoption_sync()
returns trigger language plpgsql as $$
begin
  select l.boq_id into new.boq_id from public.boq_line l where l.id = new.boq_line_id;
  if new.boq_id is null then
    raise exception 'boq_line % not found', new.boq_line_id;
  end if;
  return new;
end $$;

drop trigger if exists boq_line_rate_adoption_sync on public.boq_line_rate_adoption;
create trigger boq_line_rate_adoption_sync before insert on public.boq_line_rate_adoption
  for each row execute function public.boq_line_rate_adoption_sync();

alter table public.boq_line_rate_adoption enable row level security;

-- Staff read + insert (append-only); a project owner can read.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_line_rate_adoption' and policyname='boq_line_rate_adoption staff read') then
    create policy "boq_line_rate_adoption staff read" on public.boq_line_rate_adoption for select
      using (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_line_rate_adoption' and policyname='boq_line_rate_adoption staff insert') then
    create policy "boq_line_rate_adoption staff insert" on public.boq_line_rate_adoption for insert
      with check (public.is_staff(auth.uid()) and confirmed_by = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_line_rate_adoption' and policyname='boq_line_rate_adoption owner read') then
    create policy "boq_line_rate_adoption owner read" on public.boq_line_rate_adoption for select
      using (exists (
        select 1 from public.boq b join public.projects p on p.id = b.project_id
        where b.id = boq_line_rate_adoption.boq_id and p.owner_id = auth.uid()
      ));
  end if;
end $$;

-- ── Atomic adoption: the ONLY write path ─────────────────────────────────
-- The rate change, its boq_line_change_log row and its provenance record are
-- written by one function call — one transaction — so a failure in any of the
-- three leaves none of them behind (a rate can never change without its audit
-- record, and an adoption record can never exist for a change that didn't
-- happen). SECURITY INVOKER: the caller's own RLS applies to every write. The
-- rate is set only if the line still holds the custom_rate / dsr_rate / unit
-- the reviewer previewed (compare-and-swap); otherwise nothing is written and
-- 'conflict' is returned. Only custom_rate changes on boq_line.
create or replace function public.adopt_boq_line_rate(p_line_id uuid, p_rate numeric, p_expected jsonb, p_record jsonb)
returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_boq uuid;
begin
  if v_uid is null or not public.is_staff(v_uid) then
    raise exception 'Only staff can adopt a rate';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'An adopted rate must be zero or more';
  end if;

  update public.boq_line
     set custom_rate = p_rate
   where id = p_line_id
     and custom_rate is not distinct from (p_expected->>'custom_rate')::numeric
     and dsr_rate    is not distinct from (p_expected->>'dsr_rate')::numeric
     and unit        is not distinct from (p_expected->>'unit')
  returning boq_id into v_boq;
  if not found then
    return 'conflict';
  end if;

  insert into public.boq_line_change_log (boq_id, boq_line_id, review_item_id, field, old_value, new_value, changed_by)
  values (v_boq, p_line_id, null, 'custom_rate', p_expected->>'custom_rate', p_rate::text, v_uid);

  insert into public.boq_line_rate_adoption (
    boq_id, boq_line_id, previous_custom_rate, previous_dsr_rate, previous_rate, previous_basis,
    adopted_rate, adopted_basis, source_kind, source_quotation_id, source_boq_line_id, source_dsr_item_id,
    source_label, source_unit, source_date, source_snapshot, line_unit, line_qty,
    acknowledged_caveats, confirmation_text, confirmed_by
  ) values (
    v_boq, p_line_id,
    (p_expected->>'custom_rate')::numeric, (p_expected->>'dsr_rate')::numeric,
    (p_record->>'previous_rate')::numeric, p_record->>'previous_basis',
    p_rate, 'custom', p_record->>'source_kind',
    (p_record->>'source_quotation_id')::uuid, (p_record->>'source_boq_line_id')::uuid, (p_record->>'source_dsr_item_id')::uuid,
    p_record->>'source_label', p_record->>'source_unit', (p_record->>'source_date')::date, p_record->'source_snapshot',
    p_record->>'line_unit', (p_record->>'line_qty')::numeric,
    coalesce(array(select jsonb_array_elements_text(p_record->'acknowledged_caveats')), '{}'),
    p_record->>'confirmation_text', v_uid
  );
  return 'applied';
end $$;

revoke all on function public.adopt_boq_line_rate(uuid, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.adopt_boq_line_rate(uuid, numeric, jsonb, jsonb) to authenticated;
