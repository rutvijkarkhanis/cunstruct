-- =====================================================================
-- products_master  →  product   one-way sync layer
-- Run this in the WEBSITE Supabase project (dkgjsobfljqoggalivzt)
-- SQL editor. Safe to re-run (idempotent).
--
-- Design:
--   * products_master is the canonical PIM / admin catalog.
--   * product is the public, website-facing table the storefront reads.
--   * Only rows with status IN ('approved','published') are exposed in product.
--   * Any other status (draft, archived, rejected, ...) removes the row
--     from product, so the storefront naturally hides it.
--   * The website code keeps reading from `product` exactly as today —
--     no coupling to products_master.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Make sure `product` has every column the website expects.
--    These are all additive + nullable so existing rows keep working.
-- ---------------------------------------------------------------------
alter table public.product add column if not exists group_name     text;
alter table public.product add column if not exists variant_name   text;
alter table public.product add column if not exists main_category  text;
alter table public.product add column if not exists subcategory    text;
alter table public.product add column if not exists weight         numeric;
alter table public.product add column if not exists delivery_type  text;
alter table public.product add column if not exists description    text;
alter table public.product add column if not exists priority       text;

-- Track which master row this came from + when last synced.
alter table public.product add column if not exists source_master_id text;
alter table public.product add column if not exists synced_at        timestamptz;

create index if not exists product_source_master_id_idx
  on public.product(source_master_id);

-- ---------------------------------------------------------------------
-- 2. Statuses that should be visible on the website.
--    Centralised so future workflow states (e.g. 'moderation_passed')
--    can be added in one place.
-- ---------------------------------------------------------------------
create or replace function public.is_publishable_master_status(_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(lower(_status), '') in ('approved', 'published');
$$;

-- ---------------------------------------------------------------------
-- 3. Core upsert: copy one products_master row into product.
--    If the row is not publishable, remove it from product.
-- ---------------------------------------------------------------------
create or replace function public.sync_product_from_master(_master_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.products_master%rowtype;
begin
  select * into m from public.products_master where id = _master_id;

  if not found then
    -- master row gone → remove from public catalog
    delete from public.product where source_master_id = _master_id;
    return;
  end if;

  if not public.is_publishable_master_status(m.status) then
    delete from public.product where source_master_id = m.id;
    return;
  end if;

  insert into public.product (
    id, name, brand, group_name, variant_name,
    main_category, subcategory, category,
    selling_price, unit, weight, delivery_type,
    image_url, description, priority,
    lead_time_days,
    source_master_id, synced_at,
    created_at, updated_at
  ) values (
    m.id, m.name, m.brand, m.group_name, m.variant_name,
    m.main_category, m.subcategory, coalesce(m.main_category, m.subcategory),
    m.selling_price, m.unit, m.weight, m.delivery_type,
    m.image_url, m.description, m.priority,
    coalesce((select lead_time_days from public.product where id = m.id), 2),
    m.id, now(),
    coalesce(m.created_at, now()), now()
  )
  on conflict (id) do update set
    name           = excluded.name,
    brand          = excluded.brand,
    group_name     = excluded.group_name,
    variant_name   = excluded.variant_name,
    main_category  = excluded.main_category,
    subcategory    = excluded.subcategory,
    category       = excluded.category,
    selling_price  = excluded.selling_price,
    unit           = excluded.unit,
    weight         = excluded.weight,
    delivery_type  = excluded.delivery_type,
    image_url      = excluded.image_url,
    description    = excluded.description,
    priority       = excluded.priority,
    source_master_id = excluded.source_master_id,
    synced_at      = now(),
    updated_at     = now();
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Trigger function: react to INSERT / UPDATE / DELETE on products_master.
-- ---------------------------------------------------------------------
create or replace function public.tg_products_master_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.product where source_master_id = old.id;
    return old;
  end if;

  -- INSERT or UPDATE
  perform public.sync_product_from_master(new.id);

  -- If the id itself was changed on UPDATE, clean up the old shadow row.
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    delete from public.product where source_master_id = old.id;
  end if;

  return new;
end;
$$;

drop trigger if exists products_master_sync_aiud on public.products_master;
create trigger products_master_sync_aiud
after insert or update or delete on public.products_master
for each row execute function public.tg_products_master_sync();

-- ---------------------------------------------------------------------
-- 5. Backfill / full re-sync helper.
--    Call manually after deploying, or whenever you want to reconcile.
--      select public.sync_all_products_from_master();
-- ---------------------------------------------------------------------
create or replace function public.sync_all_products_from_master()
returns table(synced_count int, removed_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_synced  int := 0;
  v_removed int := 0;
begin
  -- Upsert all publishable masters
  with pub as (
    select id from public.products_master
    where public.is_publishable_master_status(status)
  ), s as (
    select public.sync_product_from_master(id) from pub
  )
  select count(*) into v_synced from pub;

  -- Remove product rows whose master is gone or no longer publishable
  with stale as (
    delete from public.product p
    where p.source_master_id is not null
      and not exists (
        select 1 from public.products_master m
        where m.id = p.source_master_id
          and public.is_publishable_master_status(m.status)
      )
    returning 1
  )
  select count(*) into v_removed from stale;

  return query select v_synced, v_removed;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. (Optional) lock down direct writes to `product` so only the sync
--    layer mutates it. Uncomment when you're ready.
--
-- revoke insert, update, delete on public.product from anon, authenticated;
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 7. Run the initial backfill.
-- ---------------------------------------------------------------------
select * from public.sync_all_products_from_master();