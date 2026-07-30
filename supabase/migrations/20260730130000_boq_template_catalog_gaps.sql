-- Standalone BOQ: a catalog-INDEPENDENT standard-materials checklist per stage,
-- so a bill of quantities can be generated whether or not Cunstruct stocks each
-- item. Items optionally link to a catalog SKU (product_id) or match by keyword.
-- Items with no catalog match become entries in catalog_gaps (onboarding queue).

create table if not exists public.boq_template (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stage_master(id) on delete cascade,
  project_type text,                 -- null = applies to all project types
  item_name text not null,
  match_keyword text,                -- used to resolve against the catalog by name
  unit text,
  qty_formula jsonb,
  product_id text,                   -- optional explicit catalog link
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_boq_template_stage on public.boq_template(stage_id);
alter table public.boq_template enable row level security;

create policy "Auth read boq template" on public.boq_template
  for select using (auth.role() = 'authenticated');
create policy "Staff manage boq template" on public.boq_template
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- Onboarding queue: materials a contractor needs that aren't in the catalog yet.
create table if not exists public.catalog_gaps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  stage_id uuid references public.stage_master(id),
  item_name text not null,
  requested_qty numeric,
  unit text,
  status text not null default 'open' check (status in ('open','onboarded','dismissed')),
  source text not null default 'boq',
  created_at timestamptz not null default now()
);
create index if not exists idx_catalog_gaps_status on public.catalog_gaps(status);
alter table public.catalog_gaps enable row level security;

create policy "Staff manage catalog gaps" on public.catalog_gaps
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "Owner logs gaps for own project" on public.catalog_gaps
  for insert with check (exists (
    select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()
  ));

-- ---- Seed a starter checklist for a few stages -----------------------------
insert into public.boq_template (stage_id, item_name, match_keyword, unit, qty_formula, sort)
select s.id, v.item_name, v.match_keyword, v.unit, v.qty_formula::jsonb, v.sort
from (values
  -- Electrical Rough-In
  ('Electrical Rough-In', 'Electrical Wire',   'wire',      'm',  '{"per_point":15}',        1),
  ('Electrical Rough-In', 'Modular Switch',    'switch',    'pc', '{"per_point":1}',         2),
  ('Electrical Rough-In', 'Modular Socket',    'socket',    'pc', '{"per_point":1}',         3),
  ('Electrical Rough-In', 'PVC Conduit',       'conduit',   'm',  '{"per_point":3}',         4),
  ('Electrical Rough-In', 'Modular Box',       'modular box','pc','{"per_point":1}',         5),
  ('Electrical Rough-In', 'MCB Distribution Board','db box','pc', '{"per_room":0.2,"pack_size":1}', 6),
  -- Flooring & Tiling
  ('Flooring & Tiling', 'Floor Tiles',   'tile',     'sq.ft', '{"per_floor_sqft":1.0}',            1),
  ('Flooring & Tiling', 'Tile Adhesive', 'adhesive', 'bag',   '{"per_floor_sqft":0.025,"pack_size":1}', 2),
  ('Flooring & Tiling', 'Tile Grout',    'grout',    'kg',    '{"per_floor_sqft":0.01,"pack_size":1}',  3),
  ('Flooring & Tiling', 'Tile Spacers',  'spacer',   'pack',  '{"per_floor_sqft":0.02}',           4),
  -- Painting
  ('Painting', 'Wall Putty',     'putty',    'bag', '{"per_wall_sqft":0.033,"pack_size":1}', 1),
  ('Painting', 'Primer',         'primer',   'L',   '{"per_wall_sqft":0.011}',               2),
  ('Painting', 'Emulsion Paint', 'emulsion', 'L',   '{"per_wall_sqft":0.018}',               3),
  ('Painting', 'Painters Tape',  'tape',     'roll','{"per_room":1}',                        4)
) as v(stage_name, item_name, match_keyword, unit, qty_formula, sort)
join public.stage_master s on s.name = v.stage_name
where not exists (select 1 from public.boq_template t where t.stage_id = s.id and t.item_name = v.item_name);
