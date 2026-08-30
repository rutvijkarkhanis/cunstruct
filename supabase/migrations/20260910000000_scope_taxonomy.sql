-- Phase A — Scope Taxonomy foundation (deterministic; no AI, no auto-detection).
--
-- Adds two GLOBAL, data-driven catalogs:
--   * scope_module              — reusable scope categories "for consideration"
--   * scope_module_suggestion   — per project-type SUGGESTED modules (hints only)
--
-- These are reference data the applicability screen (Phase B) will read. This
-- migration is purely additive, non-destructive and idempotent. It does NOT create
-- or populate project_module / boq_module, does NOT touch existing projects,
-- project_scope, boq, boq_line, documents, revisions, quantities, pricing or PDFs,
-- and makes NO applicability or coverage decisions for any project.
--
-- Extensibility: a new module is an INSERT into scope_module; a new project type is
-- simply a new project_type string in scope_module_suggestion (or none — an unknown
-- type just gets no suggestions). No enum, no code change.

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists public.scope_module (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,          -- stable machine key, e.g. "electrical"
  name       text not null,                 -- human label, e.g. "Electrical"
  sort       int  not null default 0,
  active     boolean not null default true, -- soft-retire via false; never hard-delete
  created_at timestamptz not null default now()
);

create table if not exists public.scope_module_suggestion (
  id           uuid primary key default gen_random_uuid(),
  project_type text not null,               -- free text; matches projects.project_type; extensible
  module_key   text not null references public.scope_module(key) on delete cascade,
  sort         int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (project_type, module_key)         -- a suggestion is unique per (type, module)
);
create index if not exists scope_module_suggestion_type_idx on public.scope_module_suggestion (project_type);

-- ── Seed: the initial module catalogue ───────────────────────────────────────
-- Idempotent: re-running never duplicates or overwrites (ON CONFLICT DO NOTHING).
insert into public.scope_module (key, name, sort) values
  ('civil_structural',   'Civil / Structural',   10),
  ('architectural',      'Architectural',        20),
  ('electrical',         'Electrical',           30),
  ('plumbing',           'Plumbing',             40),
  ('hvac',               'HVAC',                 50),
  ('fire_fighting',      'Fire Fighting',        60),
  ('fire_alarm',         'Fire Alarm',           70),
  ('elv_data_it',        'ELV / Data / IT',      80),
  ('interior_joinery',   'Interior / Joinery',   90),
  ('finishes',           'Finishes',            100),
  ('external_works',     'External Works',      110),
  ('landscape',          'Landscape',           120),
  ('specialist_systems', 'Specialist Systems',  130),
  ('equipment_ffe',      'Equipment / FF&E',    140)
on conflict (key) do nothing;

-- ── Seed: common project-type suggestions (HINTS ONLY — never applicability) ──
-- A type absent here (e.g. "Other") simply gets no pre-checks; the user picks
-- modules manually. These never mark anything applicable.
insert into public.scope_module_suggestion (project_type, module_key, sort) values
  -- Residential
  ('Residential','civil_structural',10),('Residential','architectural',20),('Residential','electrical',30),
  ('Residential','plumbing',40),('Residential','finishes',50),('Residential','interior_joinery',60),
  ('Residential','external_works',70),('Residential','landscape',80),
  -- Commercial
  ('Commercial','civil_structural',10),('Commercial','architectural',20),('Commercial','electrical',30),
  ('Commercial','plumbing',40),('Commercial','hvac',50),('Commercial','fire_fighting',60),
  ('Commercial','fire_alarm',70),('Commercial','elv_data_it',80),('Commercial','finishes',90),
  ('Commercial','external_works',100),
  -- Office
  ('Office','civil_structural',10),('Office','architectural',20),('Office','electrical',30),
  ('Office','hvac',40),('Office','fire_fighting',50),('Office','fire_alarm',60),
  ('Office','elv_data_it',70),('Office','interior_joinery',80),('Office','finishes',90),
  -- Retail
  ('Retail','civil_structural',10),('Retail','architectural',20),('Retail','electrical',30),
  ('Retail','hvac',40),('Retail','fire_fighting',50),('Retail','elv_data_it',60),
  ('Retail','interior_joinery',70),('Retail','finishes',80),
  -- Hospitality
  ('Hospitality','civil_structural',10),('Hospitality','architectural',20),('Hospitality','electrical',30),
  ('Hospitality','plumbing',40),('Hospitality','hvac',50),('Hospitality','fire_fighting',60),
  ('Hospitality','fire_alarm',70),('Hospitality','elv_data_it',80),('Hospitality','interior_joinery',90),
  ('Hospitality','finishes',100),('Hospitality','equipment_ffe',110),('Hospitality','landscape',120),
  -- Healthcare
  ('Healthcare','civil_structural',10),('Healthcare','architectural',20),('Healthcare','electrical',30),
  ('Healthcare','plumbing',40),('Healthcare','hvac',50),('Healthcare','fire_fighting',60),
  ('Healthcare','fire_alarm',70),('Healthcare','elv_data_it',80),('Healthcare','specialist_systems',90),
  ('Healthcare','finishes',100),('Healthcare','equipment_ffe',110),
  -- Institutional
  ('Institutional','civil_structural',10),('Institutional','architectural',20),('Institutional','electrical',30),
  ('Institutional','plumbing',40),('Institutional','hvac',50),('Institutional','fire_fighting',60),
  ('Institutional','fire_alarm',70),('Institutional','elv_data_it',80),('Institutional','finishes',90),
  ('Institutional','external_works',100),
  -- Industrial
  ('Industrial','civil_structural',10),('Industrial','architectural',20),('Industrial','electrical',30),
  ('Industrial','plumbing',40),('Industrial','hvac',50),('Industrial','fire_fighting',60),
  ('Industrial','fire_alarm',70),('Industrial','specialist_systems',80),('Industrial','external_works',90),
  -- Warehouse
  ('Warehouse','civil_structural',10),('Warehouse','architectural',20),('Warehouse','electrical',30),
  ('Warehouse','fire_fighting',40),('Warehouse','fire_alarm',50),('Warehouse','hvac',60),
  ('Warehouse','external_works',70),
  -- Infrastructure/External
  ('Infrastructure/External','civil_structural',10),('Infrastructure/External','external_works',20),
  ('Infrastructure/External','electrical',30),('Infrastructure/External','plumbing',40),
  ('Infrastructure/External','landscape',50),('Infrastructure/External','specialist_systems',60)
on conflict (project_type, module_key) do nothing;

-- ── RLS (mirrors the existing project/BOQ pattern) ───────────────────────────
alter table public.scope_module            enable row level security;
alter table public.scope_module_suggestion enable row level security;

do $$
begin
  -- scope_module: staff manage, any authenticated user may read the catalogue.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='scope_module' and policyname='scope_module staff manage') then
    create policy "scope_module staff manage" on public.scope_module for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='scope_module' and policyname='scope_module read') then
    create policy "scope_module read" on public.scope_module for select
      using (auth.uid() is not null);
  end if;

  -- scope_module_suggestion: staff manage, any authenticated user may read.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='scope_module_suggestion' and policyname='scope_module_suggestion staff manage') then
    create policy "scope_module_suggestion staff manage" on public.scope_module_suggestion for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='scope_module_suggestion' and policyname='scope_module_suggestion read') then
    create policy "scope_module_suggestion read" on public.scope_module_suggestion for select
      using (auth.uid() is not null);
  end if;
end $$;
