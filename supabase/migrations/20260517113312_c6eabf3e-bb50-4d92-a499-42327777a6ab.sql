
-- ============ ROLES ============
create type public.app_role as enum ('contractor', 'site_engineer', 'ops', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('ops','admin')
  )
$$;

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: profiles
create policy "Users view own profile" on public.profiles
  for select using (auth.uid() = id or public.is_staff(auth.uid()));
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);

-- RLS: user_roles
create policy "Users view own roles" on public.user_roles
  for select using (auth.uid() = user_id or public.is_staff(auth.uid()));
create policy "Admin manages roles" on public.user_roles
  for all using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ STAGE MASTER ============
create table public.stage_master (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sequence int not null unique,
  description text,
  typical_duration_days int,
  created_at timestamptz not null default now()
);
alter table public.stage_master enable row level security;
create policy "Auth read stages" on public.stage_master
  for select using (auth.role() = 'authenticated');
create policy "Staff write stages" on public.stage_master
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

insert into public.stage_master (name, sequence, typical_duration_days, description) values
  ('Pre-Construction', 1, 14, 'Permits, site prep, surveys'),
  ('Excavation', 2, 10, 'Site digging and earthwork'),
  ('Foundation', 3, 21, 'Footings, columns, plinth'),
  ('RCC Structure', 4, 60, 'Reinforced concrete frame, slabs'),
  ('Masonry', 5, 30, 'Block/brick walls'),
  ('Plumbing Rough-In', 6, 14, 'In-wall plumbing lines'),
  ('Electrical Rough-In', 7, 14, 'In-wall conduits, wiring'),
  ('Waterproofing', 8, 10, 'Roof, bathroom, wet area treatment'),
  ('Plastering', 9, 21, 'Internal and external plaster'),
  ('Ceiling Works', 10, 14, 'False ceiling, gypsum'),
  ('Flooring & Tiling', 11, 21, 'Floor and wall tiles, stone'),
  ('Painting', 12, 14, 'Primer and finish coats'),
  ('Doors & Windows', 13, 10, 'Frames and shutters installation'),
  ('Fixtures & Fittings', 14, 10, 'Sanitary, electrical fixtures'),
  ('Final Finishing', 15, 7, 'Polish, touch-ups, cleaning'),
  ('Handover', 16, 3, 'Client walkthrough and handover');

-- ============ PROJECTS ============
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  location text,
  project_type text check (project_type in ('Residential','Commercial','Retail','Office','Hospital','Other')),
  scope text check (scope in ('Civil','MEP','Finishing','Turnkey')),
  floors int,
  area_sqft numeric,
  current_stage_id uuid references public.stage_master(id),
  progress_pct numeric not null default 0,
  velocity_days_per_pct numeric,
  estimated_completion date,
  account_manager_id uuid references public.profiles(id),
  owner_id uuid references auth.users(id),
  onboarded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;

create policy "Staff manage all projects" on public.projects
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));
create policy "Owner views own project" on public.projects
  for select using (auth.uid() = owner_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ============ PROJECT STAGES ============
create table public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_id uuid not null references public.stage_master(id),
  started_at timestamptz,
  completed_at timestamptz,
  velocity numeric,
  created_at timestamptz not null default now(),
  unique (project_id, stage_id)
);
alter table public.project_stages enable row level security;
create policy "Staff manage project stages" on public.project_stages
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "Owner views own project stages" on public.project_stages
  for select using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

-- ============ STAGE UPDATES ============
create table public.stage_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_id uuid not null references public.stage_master(id),
  progress_pct numeric not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'app' check (source in ('app','whatsapp','call','voice','photo')),
  note text,
  created_by uuid references auth.users(id)
);
alter table public.stage_updates enable row level security;
create policy "Staff manage updates" on public.stage_updates
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "Owner reads own updates" on public.stage_updates
  for select using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy "Owner inserts updates" on public.stage_updates
  for insert with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create index on public.stage_updates (project_id, recorded_at desc);

-- ============ STAGE -> MATERIAL MAPPING ============
create table public.stage_material_mapping (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stage_master(id) on delete cascade,
  product_id text not null,
  product_name text,
  priority text not null default 'Recommended' check (priority in ('Critical','Recommended','Optional')),
  qty_formula jsonb,
  unit text,
  lead_time_days int default 3,
  reliability_score numeric default 0.9,
  trigger_offset_days int default 5,
  buffer_pct numeric default 10,
  preferred_brands text[],
  alternate_product_ids text[],
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.stage_material_mapping enable row level security;
create policy "Auth read mappings" on public.stage_material_mapping
  for select using (auth.role() = 'authenticated');
create policy "Staff write mappings" on public.stage_material_mapping
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create trigger mapping_touch before update on public.stage_material_mapping
  for each row execute function public.touch_updated_at();

create index on public.stage_material_mapping (stage_id);
