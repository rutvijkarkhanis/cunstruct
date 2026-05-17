-- 1) Lead time additions
alter table public.stage_material_mapping
  add column if not exists buffer_days integer not null default 1,
  add column if not exists stock_reliability_score integer not null default 70;

-- 2) Project velocity history
alter table public.projects
  add column if not exists historical_avg_velocity numeric,
  add column if not exists projected_completion_date date;

-- 3) Forecasts
create table if not exists public.forecasts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  generated_at timestamptz not null default now(),
  horizon_days integer not null check (horizon_days in (7,14,30)),
  status text not null default 'draft' check (status in ('draft','approved','sent')),
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_forecasts_project on public.forecasts(project_id);

alter table public.forecasts enable row level security;

create policy "Staff manage forecasts" on public.forecasts
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "Owner reads approved forecasts" on public.forecasts
  for select using (
    status in ('approved','sent') and exists (
      select 1 from public.projects p where p.id = forecasts.project_id and p.owner_id = auth.uid()
    )
  );

-- 4) Forecast items
create table if not exists public.forecast_items (
  id uuid primary key default gen_random_uuid(),
  forecast_id uuid not null references public.forecasts(id) on delete cascade,
  product_id text not null,
  product_name text,
  stage_id uuid references public.stage_master(id),
  qty_estimated numeric not null default 0,
  unit text,
  unit_price numeric,
  budget_estimated numeric,
  order_by_date date,
  delivery_date date,
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  risk_flag boolean not null default false,
  initiated_by text not null default 'cunstruct' check (initiated_by in ('cunstruct','contractor')),
  status text not null default 'pending' check (status in ('pending','ordered','dismissed')),
  ordered_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_forecast_items_forecast on public.forecast_items(forecast_id);

alter table public.forecast_items enable row level security;

create policy "Staff manage forecast items" on public.forecast_items
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "Owner reads approved forecast items" on public.forecast_items
  for select using (
    confidence in ('high','medium') and exists (
      select 1 from public.forecasts f
      join public.projects p on p.id = f.project_id
      where f.id = forecast_items.forecast_id
        and f.status in ('approved','sent')
        and p.owner_id = auth.uid()
    )
  );

-- 5) Forecast accuracy
create table if not exists public.forecast_accuracy (
  id uuid primary key default gen_random_uuid(),
  forecast_item_id uuid not null references public.forecast_items(id) on delete cascade,
  predicted_qty numeric not null,
  actual_qty numeric not null,
  variance_pct numeric not null,
  recorded_at timestamptz not null default now()
);

alter table public.forecast_accuracy enable row level security;
create policy "Staff manage accuracy" on public.forecast_accuracy
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- 6) Project alerts (anomaly flags)
create table if not exists public.project_alerts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('stale','overdue_order','pace_drop')),
  message text not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  resolved boolean not null default false,
  resolved_at timestamptz,
  related_item_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_alerts_project on public.project_alerts(project_id);
create index if not exists idx_project_alerts_open on public.project_alerts(resolved) where resolved = false;

alter table public.project_alerts enable row level security;
create policy "Staff manage alerts" on public.project_alerts
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));