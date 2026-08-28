-- PROJECT WORKSPACE (Phase 0) — make the project the primary workspace.
--
-- Adds the entities the approved architecture needs while PRESERVING the existing
-- project → boq → boq_line foundation intact:
--   project_scope       — what physical scope a BOQ represents (free string; never floors)
--   project_document    — a logical document, exists ONCE, referenced by many BOQs
--   document_revision   — a specific revision of a document; the parsed evaluation lives here
--   boq_document        — M:N drawing↔BOQ, recording which revision the BOQ analysed
-- Extends:
--   boq       — scope_id, sort, description  (status enum left unchanged; richer state machine is Phase 4)
--   boq_line  — source_document_id, source_revision_id, source_page, measurement_method, calculation, confidence
--
-- Everything is additive and non-destructive. The existing builder keeps reading
-- boq.spec unchanged; the backfill at the end MIRRORS spec drawing data into the new
-- document tables without deleting anything, and is idempotent (safe to re-run).

-- ---------------------------------------------------------------------------
-- project_scope
-- ---------------------------------------------------------------------------
create table if not exists public.project_scope (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,                 -- "Floor 2", "Terrace", "Structural" … (free)
  kind        text,                          -- floor/common/structural/external/… (free, never enforced)
  sort        int  not null default 0,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);
create index if not exists project_scope_project_idx on public.project_scope (project_id);

-- ---------------------------------------------------------------------------
-- project_document  (the logical file — one instance, many BOQ references)
-- ---------------------------------------------------------------------------
create table if not exists public.project_document (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  name                 text not null,
  doc_type             text,                 -- architectural/structural/electrical/… (free)
  discipline           text,
  current_revision_id  uuid,                 -- soft ref to document_revision (avoids circular FK)
  status               text not null default 'uploaded',
  created_at           timestamptz not null default now()
);
create index if not exists project_document_project_idx on public.project_document (project_id);

-- ---------------------------------------------------------------------------
-- document_revision  (Rev A/B/C; the parsed evaluation lives here)
-- ---------------------------------------------------------------------------
create table if not exists public.document_revision (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.project_document(id) on delete cascade,
  label         text not null default 'Rev A',
  revision_date date,
  source        text not null default 'paste' check (source in ('upload','paste','url')),
  file_path     text,
  external_url  text,
  page_count    int,
  eval_json     jsonb,                        -- the parsed evaluation for THIS revision
  analysed_at   timestamptz,
  status        text not null default 'draft',
  created_at    timestamptz not null default now()
);
create index if not exists document_revision_document_idx on public.document_revision (document_id);

-- ---------------------------------------------------------------------------
-- boq_document  (M:N drawing ↔ BOQ, revision-aware)
-- ---------------------------------------------------------------------------
create table if not exists public.boq_document (
  id                    uuid primary key default gen_random_uuid(),
  boq_id                uuid not null references public.boq(id) on delete cascade,
  document_id           uuid not null references public.project_document(id) on delete cascade,
  analyzed_revision_id  uuid,                 -- which revision this BOQ used (soft ref)
  applicability_note    text,
  created_at            timestamptz not null default now(),
  unique (boq_id, document_id)
);
create index if not exists boq_document_boq_idx on public.boq_document (boq_id);
create index if not exists boq_document_document_idx on public.boq_document (document_id);

-- ---------------------------------------------------------------------------
-- Extend boq and boq_line (all additive; existing columns untouched)
-- ---------------------------------------------------------------------------
alter table public.boq
  add column if not exists scope_id    uuid references public.project_scope(id) on delete set null,
  add column if not exists sort        int not null default 0,
  add column if not exists description text;
create index if not exists boq_scope_idx on public.boq (scope_id);

alter table public.boq_line
  add column if not exists source_document_id uuid references public.project_document(id) on delete set null,
  add column if not exists source_revision_id uuid references public.document_revision(id) on delete set null,
  add column if not exists source_page        text,
  add column if not exists measurement_method text,
  add column if not exists calculation        text,
  add column if not exists confidence         text;

-- ---------------------------------------------------------------------------
-- Row-level security — mirror the existing boq pattern:
--   staff manage everything; a project owner may read their own project's rows.
-- ---------------------------------------------------------------------------
alter table public.project_scope    enable row level security;
alter table public.project_document enable row level security;
alter table public.document_revision enable row level security;
alter table public.boq_document     enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_scope' and policyname='project_scope staff manage') then
    create policy "project_scope staff manage" on public.project_scope for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_scope' and policyname='project_scope owner read') then
    create policy "project_scope owner read" on public.project_scope for select
      using (exists (select 1 from public.projects p where p.id = project_scope.project_id and p.owner_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_document' and policyname='project_document staff manage') then
    create policy "project_document staff manage" on public.project_document for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_document' and policyname='project_document owner read') then
    create policy "project_document owner read" on public.project_document for select
      using (exists (select 1 from public.projects p where p.id = project_document.project_id and p.owner_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_revision' and policyname='document_revision staff manage') then
    create policy "document_revision staff manage" on public.document_revision for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_revision' and policyname='document_revision owner read') then
    create policy "document_revision owner read" on public.document_revision for select
      using (exists (
        select 1 from public.project_document d join public.projects p on p.id = d.project_id
        where d.id = document_revision.document_id and p.owner_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_document' and policyname='boq_document staff manage') then
    create policy "boq_document staff manage" on public.boq_document for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_document' and policyname='boq_document owner read') then
    create policy "boq_document owner read" on public.boq_document for select
      using (exists (
        select 1 from public.boq b join public.projects p on p.id = b.project_id
        where b.id = boq_document.boq_id and p.owner_id = auth.uid()));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- BACKFILL (idempotent, non-destructive). For every existing BOQ:
--   • ensure a project_scope exists (named from its allocation, else its name) and
--     link boq.scope_id;
--   • if the BOQ carries a drawing evaluation in spec._drawing and has no document
--     linked yet, mirror that evaluation into a project_document + document_revision
--     and link it via boq_document.
-- boq.spec is left untouched, so the existing builder keeps working exactly as before.
-- ---------------------------------------------------------------------------
do $$
declare
  b          record;
  v_scope_id uuid;
  v_doc_id   uuid;
  v_rev_id   uuid;
  scope_name text;
  doc_name   text;
begin
  for b in select id, project_id, name, spec, scope_id, sort from public.boq where project_id is not null loop
    -- 1) scope
    scope_name := coalesce(nullif(btrim(b.spec->>'_boq_allocation'), ''), nullif(btrim(b.name), ''), 'General');
    select id into v_scope_id from public.project_scope
      where project_id = b.project_id and name = scope_name limit 1;
    if v_scope_id is null then
      insert into public.project_scope (project_id, name, kind, sort)
        values (b.project_id, scope_name, nullif(btrim(b.spec->>'_floor_scope'), ''), coalesce(b.sort, 0))
        returning id into v_scope_id;
    end if;
    if b.scope_id is null then
      update public.boq set scope_id = v_scope_id where id = b.id;
    end if;

    -- 2) document + revision mirrored from the drawing evaluation (only if present
    --    and this BOQ has no document linked yet)
    if (b.spec ? '_drawing')
       and not exists (select 1 from public.boq_document bd where bd.boq_id = b.id) then
      doc_name := coalesce(nullif(btrim(b.name), ''), 'BOQ') || ' — Drawing evaluation';
      select id into v_doc_id from public.project_document
        where project_id = b.project_id and name = doc_name limit 1;
      if v_doc_id is null then
        insert into public.project_document (project_id, name, doc_type, status)
          values (b.project_id, doc_name, 'evaluation', 'analysed')
          returning id into v_doc_id;
        insert into public.document_revision (document_id, label, source, eval_json, analysed_at, status)
          values (v_doc_id, 'Rev A', 'paste',
                  jsonb_strip_nulls(jsonb_build_object(
                    'drawing',      b.spec->'_drawing',
                    'measurements', b.spec->'_measurements',
                    'excluded',     b.spec->'_excluded',
                    'spaces',       b.spec->'_spaces')),
                  now(), 'analysed')
          returning id into v_rev_id;
        update public.project_document set current_revision_id = v_rev_id where id = v_doc_id;
      else
        select id into v_rev_id from public.document_revision
          where document_id = v_doc_id order by created_at limit 1;
      end if;
      insert into public.boq_document (boq_id, document_id, analyzed_revision_id)
        values (b.id, v_doc_id, v_rev_id)
        on conflict (boq_id, document_id) do nothing;
    end if;
  end loop;
end $$;
