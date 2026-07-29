-- BOQ-to-Order: line items for sales_orders, plus owner-based RLS so a
-- contractor (project owner) can place their own order from the mobile
-- BOQ builder. sales_orders already exists but was staff-write only.

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id) on delete cascade,
  product_id text not null,
  product_name text,
  stage_id uuid references public.stage_master(id),
  qty numeric not null default 0,
  unit text,
  unit_price numeric,          -- price snapshot at the moment the order was placed
  line_total numeric,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_items_order on public.order_items(order_id);
alter table public.order_items enable row level security;

create policy "Staff manage order items" on public.order_items
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "Owner reads own order items" on public.order_items
  for select using (exists (
    select 1 from public.sales_orders o
    join public.projects p on p.id = o.project_id
    where o.id = order_id and p.owner_id = auth.uid()
  ));

create policy "Owner inserts own order items" on public.order_items
  for insert with check (exists (
    select 1 from public.sales_orders o
    join public.projects p on p.id = o.project_id
    where o.id = order_id and p.owner_id = auth.uid()
  ));

-- Let a contractor create and read sales_orders for a project they own.
-- (The existing "Staff manage sales orders" policy stays; policies are OR'd.)
create policy "Owner inserts own sales order" on public.sales_orders
  for insert with check (exists (
    select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()
  ));

create policy "Owner reads own sales orders" on public.sales_orders
  for select using (exists (
    select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()
  ));
