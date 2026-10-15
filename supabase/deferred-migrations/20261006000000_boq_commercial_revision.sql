-- COMMERCIAL BOQ REVISIONS — an immutable snapshot of a priced BOQ exactly as
-- it stood when a user explicitly froze it ("Rev A", "Rev B" … per BOQ, the
-- same labelling convention as document_revision).
--
-- Why new tables: boq/boq_line are the WORKING BOQ — edited in place, with no
-- history beyond boq_line_change_log's field diffs, and every export is built
-- live from them. Nothing existing can answer "what exactly did Rev B say?".
-- These tables hold that record; the working BOQ is not locked, copied over or
-- otherwise changed by creating a revision.
--
-- Immutability:
--   • RLS grants SELECT only (staff; project owner). There is no insert,
--     update or delete policy, so the API cannot write these tables directly.
--   • The only write path is create_boq_commercial_revision(), a
--     SECURITY DEFINER function that checks is_staff(auth.uid()), numbers the
--     revision under a row lock on the BOQ, verifies the submitted lines are
--     exactly the BOQ's persisted lines at that moment, and inserts the header
--     and every line in ONE transaction — complete or absent, never partial.
--   • Triggers reject every UPDATE and DELETE on both tables, even from roles
--     that bypass RLS — the single exception being the header's boq_id /
--     project_id being nulled by `on delete set null`.
--   • boq_id / project_id are `on delete set null` and the names are copied in,
--     so deleting a working BOQ or project never removes an issued record.
--
-- A revision records that the BOQ was frozen ("issued") by a named user at a
-- time. It does NOT record that it was sent to a client, awarded or executed —
-- the app records none of those events today; tender/award tracking is a later,
-- separate, append-only addition.
--
-- Purely additive: no existing table or column is altered. Not applied to any
-- database by the commit that adds it.

create table if not exists public.boq_commercial_revision (
  id                      uuid primary key default gen_random_uuid(),
  boq_id                  uuid references public.boq(id) on delete set null,
  project_id              uuid references public.projects(id) on delete set null,
  boq_name                text not null,
  project_name            text,
  revision_no             int not null check (revision_no > 0),
  label                   text not null,
  boq_status_at_issue     text,                 -- boq.status when frozen (draft/finalized/sent), as recorded
  discipline              text,
  rate_year               text,
  boq_scope_id            uuid,                 -- the BOQ's project scope when frozen (soft reference)
  -- Project/BOQ context and commercial settings exactly as used for the quote.
  context                 jsonb not null default '{}'::jsonb,
  commercials             jsonb not null,       -- the computed waterfall (works … grand total)
  works_total             numeric not null,
  grand_total             numeric not null,
  line_count              int not null,
  priced_line_count       int not null,
  -- Pricing/quantity limitations present at issue, and the issuer's explicit
  -- acknowledgement of them.
  limitations             jsonb not null default '[]'::jsonb,
  limitations_acknowledged boolean not null default false,
  issue_note              text,
  issued_by               uuid not null references auth.users(id),
  issued_at               timestamptz not null default now(),
  constraint boq_commercial_revision_no_uq unique (boq_id, revision_no),
  constraint boq_commercial_revision_limitations_ack
    check (jsonb_array_length(limitations) = 0 or limitations_acknowledged)
);
create index if not exists boq_commercial_revision_boq_idx on public.boq_commercial_revision (boq_id, revision_no desc);
create index if not exists boq_commercial_revision_project_idx on public.boq_commercial_revision (project_id);

create table if not exists public.boq_commercial_revision_line (
  id                    uuid primary key default gen_random_uuid(),
  revision_id           uuid not null references public.boq_commercial_revision(id) on delete restrict,
  -- Soft reference to the working line it was copied from (no FK: the working
  -- line may later change or be deleted; this row never does).
  source_line_id        uuid,
  position              int not null,
  subhead_no            int not null,
  subhead_name          text not null,
  item_no               text not null,
  section               text,
  dsr_code              text,
  description           text,
  unit                  text,
  qty                   numeric,
  quantity_status       text,
  included              boolean not null,
  scope_id              uuid,
  external_key          text,
  rate                  numeric,              -- the rate actually in the revision (custom_rate ?? dsr_rate)
  rate_basis            text not null check (rate_basis in ('custom','dsr','none')),
  rate_provenance       text not null check (rate_provenance in ('adopted','manual_override','dsr_on_line','none')),
  dsr_rate              numeric,
  custom_rate           numeric,
  amount                numeric,              -- null when not priced (no rate / qty pending / excluded)
  source_document_id    uuid,
  source_document_name  text,
  source_page           text,
  -- Provenance of an adopted rate (boq_line_rate_adoption), copied in.
  adoption_id           uuid,
  adoption_source_kind  text,
  adoption_source_label text,
  adoption_source_unit  text,
  adoption_source_date  date,
  adoption_confirmed_by uuid,
  adoption_confirmed_at timestamptz,
  limitations           text[] not null default '{}',
  constraint boq_commercial_revision_line_pos_uq unique (revision_id, position)
);
create index if not exists boq_commercial_revision_line_rev_idx on public.boq_commercial_revision_line (revision_id);
-- Historical-rate lookup by code/description across issued revisions.
create index if not exists boq_commercial_revision_line_code_idx on public.boq_commercial_revision_line (dsr_code);

-- ── Immutability triggers ────────────────────────────────────────────────
create or replace function public.boq_commercial_revision_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Commercial BOQ revisions are immutable (% on %)', tg_op, tg_table_name;
end $$;

-- The header allows exactly one kind of UPDATE: the `on delete set null` of
-- boq_id/project_id when a working BOQ or project is deleted (every other
-- column unchanged), so deleting working data still works and the record stays.
create or replace function public.boq_commercial_revision_header_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'boq_id' - 'project_id') = (to_jsonb(old) - 'boq_id' - 'project_id')
     and (new.boq_id is null or new.boq_id = old.boq_id)
     and (new.project_id is null or new.project_id = old.project_id) then
    return new;
  end if;
  raise exception 'Commercial BOQ revisions are immutable (% on %)', tg_op, tg_table_name;
end $$;

drop trigger if exists boq_commercial_revision_immutable on public.boq_commercial_revision;
create trigger boq_commercial_revision_immutable before update or delete on public.boq_commercial_revision
  for each row execute function public.boq_commercial_revision_header_immutable();
drop trigger if exists boq_commercial_revision_line_immutable on public.boq_commercial_revision_line;
create trigger boq_commercial_revision_line_immutable before update or delete on public.boq_commercial_revision_line
  for each row execute function public.boq_commercial_revision_immutable();

-- ── RLS: read-only through the API ──────────────────────────────────────
alter table public.boq_commercial_revision enable row level security;
alter table public.boq_commercial_revision_line enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_commercial_revision' and policyname='boq_commercial_revision staff read') then
    create policy "boq_commercial_revision staff read" on public.boq_commercial_revision for select
      using (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_commercial_revision' and policyname='boq_commercial_revision owner read') then
    create policy "boq_commercial_revision owner read" on public.boq_commercial_revision for select
      using (exists (select 1 from public.projects p where p.id = boq_commercial_revision.project_id and p.owner_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_commercial_revision_line' and policyname='boq_commercial_revision_line staff read') then
    create policy "boq_commercial_revision_line staff read" on public.boq_commercial_revision_line for select
      using (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_commercial_revision_line' and policyname='boq_commercial_revision_line owner read') then
    create policy "boq_commercial_revision_line owner read" on public.boq_commercial_revision_line for select
      using (exists (
        select 1 from public.boq_commercial_revision r join public.projects p on p.id = r.project_id
        where r.id = boq_commercial_revision_line.revision_id and p.owner_id = auth.uid()
      ));
  end if;
end $$;

-- ── The only write path ─────────────────────────────────────────────────
-- p_header: the revision's content columns (boq_name, project_name, context,
-- commercials, totals, limitations, note). BOQ identity, project, status,
-- discipline, rate year, scope, numbering, issuer and time are read/set here,
-- never trusted from the caller.
-- p_lines: array of line objects (boq_commercial_revision_line columns).
create or replace function public.create_boq_commercial_revision(p_boq_id uuid, p_header jsonb, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_project uuid;
  v_status text;
  v_discipline text;
  v_rate_year text;
  v_scope uuid;
  v_no int;
  v_id uuid;
  v_stale boolean;
begin
  if v_uid is null or not public.is_staff(v_uid) then
    raise exception 'Only staff can create a commercial revision';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A commercial revision needs at least one line';
  end if;

  -- Lock the BOQ row so concurrent creations number sequentially.
  select b.project_id, b.status, b.discipline, b.rate_year, b.scope_id
    into v_project, v_status, v_discipline, v_rate_year, v_scope
    from public.boq b where b.id = p_boq_id for update;
  if not found then
    raise exception 'BOQ % not found', p_boq_id;
  end if;
  -- The submitted lines must be exactly the BOQ's persisted lines as they are
  -- now, inside this transaction: the same set of lines (each once), with
  -- unchanged description, quantity, unit, inclusion and rates. Anything else —
  -- an edit that landed after the caller read the BOQ, or a fabricated line —
  -- freezes nothing.
  with snap as (
    select (l->>'source_line_id')::uuid as id, l from jsonb_array_elements(p_lines) as l
  ), cur as (
    select * from public.boq_line where boq_id = p_boq_id
  )
  select (select count(*) from snap) <> (select count(*) from cur)
      or (select count(distinct id) from snap) <> (select count(*) from snap)
      or exists (
        select 1 from cur c left join snap s on s.id = c.id
        where s.id is null
           or (s.l->>'description') is distinct from c.description
           or (s.l->>'unit') is distinct from c.unit
           or (s.l->>'qty')::numeric is distinct from c.qty
           or (s.l->>'included')::boolean is distinct from c.included
           or (s.l->>'custom_rate')::numeric is distinct from c.custom_rate
           or (s.l->>'dsr_rate')::numeric is distinct from c.dsr_rate
           or (s.l->>'rate')::numeric is distinct from coalesce(c.custom_rate, c.dsr_rate)
      )
    into v_stale;
  if v_stale then
    raise exception 'The BOQ changed after this revision was prepared, so nothing was frozen. Prepare the revision again.';
  end if;

  select coalesce(max(r.revision_no), 0) + 1 into v_no from public.boq_commercial_revision r where r.boq_id = p_boq_id;

  insert into public.boq_commercial_revision (
    boq_id, project_id, boq_name, project_name, revision_no, label, boq_status_at_issue, discipline, rate_year, boq_scope_id,
    context, commercials, works_total, grand_total, line_count, priced_line_count,
    limitations, limitations_acknowledged, issue_note, issued_by
  ) values (
    p_boq_id, v_project, p_header->>'boq_name', p_header->>'project_name', v_no,
    'Rev ' || case when v_no <= 26 then chr(64 + v_no) else v_no::text end,
    v_status, v_discipline, v_rate_year, v_scope,
    coalesce(p_header->'context', '{}'::jsonb), p_header->'commercials',
    (p_header->>'works_total')::numeric, (p_header->>'grand_total')::numeric,
    jsonb_array_length(p_lines), (p_header->>'priced_line_count')::int,
    coalesce(p_header->'limitations', '[]'::jsonb), coalesce((p_header->>'limitations_acknowledged')::boolean, false),
    p_header->>'issue_note', v_uid
  ) returning id into v_id;

  insert into public.boq_commercial_revision_line (
    revision_id, source_line_id, position, subhead_no, subhead_name, item_no, section, dsr_code, description, unit,
    qty, quantity_status, included, scope_id, external_key, rate, rate_basis, rate_provenance, dsr_rate, custom_rate,
    amount, source_document_id, source_document_name, source_page, adoption_id, adoption_source_kind,
    adoption_source_label, adoption_source_unit, adoption_source_date, adoption_confirmed_by, adoption_confirmed_at, limitations
  )
  select v_id, (l->>'source_line_id')::uuid, (l->>'position')::int, (l->>'subhead_no')::int, l->>'subhead_name',
    l->>'item_no', l->>'section', l->>'dsr_code', l->>'description', l->>'unit',
    (l->>'qty')::numeric, l->>'quantity_status', (l->>'included')::boolean, (l->>'scope_id')::uuid, l->>'external_key',
    (l->>'rate')::numeric, l->>'rate_basis', l->>'rate_provenance', (l->>'dsr_rate')::numeric, (l->>'custom_rate')::numeric,
    (l->>'amount')::numeric, (l->>'source_document_id')::uuid, l->>'source_document_name', l->>'source_page',
    (l->>'adoption_id')::uuid, l->>'adoption_source_kind', l->>'adoption_source_label', l->>'adoption_source_unit',
    (l->>'adoption_source_date')::date, (l->>'adoption_confirmed_by')::uuid, (l->>'adoption_confirmed_at')::timestamptz,
    coalesce(array(select jsonb_array_elements_text(l->'limitations')), '{}')
  from jsonb_array_elements(p_lines) as l;

  return v_id;
end $$;

revoke all on function public.create_boq_commercial_revision(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_boq_commercial_revision(uuid, jsonb, jsonb) to authenticated;
