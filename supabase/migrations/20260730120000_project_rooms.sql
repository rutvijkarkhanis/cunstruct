-- Room-by-room dimensions for accurate BOQ generation. A project owner
-- (contractor) manages their own rooms; staff can manage all.

create table if not exists public.project_rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text,
  room_type text not null default 'room',
  length_ft numeric not null default 0,
  width_ft numeric not null default 0,
  height_ft numeric not null default 10,
  count int not null default 1,
  electrical_points int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_rooms_project on public.project_rooms(project_id);
alter table public.project_rooms enable row level security;

create policy "Staff manage project rooms" on public.project_rooms
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "Owner manages own project rooms" on public.project_rooms
  for all using (exists (
    select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()
  ));
