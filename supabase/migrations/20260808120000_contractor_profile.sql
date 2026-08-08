-- Contractor memory: a saved profile of a contractor's usual preferences
-- (finish tier, flooring, windows, waterproofing, etc.). Applied as visible,
-- pre-confirmed assumptions on their next BOQ — never silently. Gets a project
-- from ~12 minutes on visit 1 to ~2 minutes by visit 10.

create table if not exists public.contractor_profile (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  spec        jsonb not null default '{}'::jsonb,   -- their usual choices
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.contractor_profile enable row level security;
create policy "contractor_profile staff manage" on public.contractor_profile for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

alter table public.boq
  add column if not exists contractor_id uuid references public.contractor_profile(id) on delete set null;
