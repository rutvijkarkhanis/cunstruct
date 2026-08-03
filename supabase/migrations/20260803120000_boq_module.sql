-- BOQ module: a persisted Bill of Quantities per project, built from the DSR/AOR
-- knowledge bank. `spec` holds the BOQ questionnaire answers that drive which
-- DSR items are pulled in and how quantities are sized.

create table if not exists public.boq (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references public.projects(id) on delete cascade,
  name         text not null default 'BOQ',
  status       text not null default 'draft' check (status in ('draft','finalized','sent')),
  rate_year    text not null default '2023',
  spec         jsonb not null default '{}'::jsonb,   -- questionnaire answers
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists boq_project_idx on public.boq (project_id);

create table if not exists public.boq_line (
  id             uuid primary key default gen_random_uuid(),
  boq_id         uuid not null references public.boq(id) on delete cascade,
  section        text,                       -- DSR chapter / stage grouping
  dsr_code       text,                       -- ties to dsr_item.code
  description    text,
  unit           text,
  qty            numeric not null default 0,
  dsr_rate       numeric,                    -- benchmark rate from DSR
  custom_rate    numeric,                    -- ops override
  catalog_product_id text,
  catalog_price  numeric,
  included       boolean not null default true,
  source         text not null default 'auto' check (source in ('auto','manual')),
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists boq_line_boq_idx on public.boq_line (boq_id);

alter table public.boq enable row level security;
alter table public.boq_line enable row level security;

-- Staff manage all; a project owner can read their own project's BOQs.
create policy "boq staff manage" on public.boq for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "boq owner read" on public.boq for select
  using (exists (select 1 from public.projects p where p.id = boq.project_id and p.owner_id = auth.uid()));

create policy "boq_line staff manage" on public.boq_line for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "boq_line owner read" on public.boq_line for select
  using (exists (
    select 1 from public.boq b join public.projects p on p.id = b.project_id
    where b.id = boq_line.boq_id and p.owner_id = auth.uid()
  ));
