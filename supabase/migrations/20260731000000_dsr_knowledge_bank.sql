-- DSR / AOR knowledge bank ----------------------------------------------------
-- The reference data the BOQ engine builds each client BOQ from:
--   * dsr_item        — the rate schedule: code, description, unit, rate
--   * dsr_coefficient — the Analysis of Rates: materials/labour per unit of a
--                       DSR item (loaded later, when the AOR is available)
--
-- The source PDF stays in storage as the archive; these tables ARE the usable
-- knowledge bank. Reference data: any signed-in user may read, staff manage.

create table if not exists public.dsr_item (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'DSR',        -- DSR / state SOR name
  rate_year   text,                               -- e.g. '2023'
  code        text not null,                      -- 4.2.2, 9.15.1.1
  chapter     text,                               -- derived (subhead or code prefix)
  subhead     text,                               -- 'SUB HEAD : 4.0 CONCRETE WORK'
  description text,                               -- parent-stitched full description
  unit        text,                               -- cum, sqm, rmt, kg, nos ...
  rate        numeric,                            -- composite unit rate (INR)
  billable    boolean not null default true,      -- false for header/parent rows
  -- how this DSR item maps into our world (filled in after load):
  stage_id    uuid references public.stage_master(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists dsr_item_uq on public.dsr_item (source, coalesce(rate_year,''), code);
create index if not exists dsr_item_code_idx on public.dsr_item (code);
create index if not exists dsr_item_chapter_idx on public.dsr_item (chapter);

create table if not exists public.dsr_coefficient (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'AOR',
  rate_year   text,
  item_code   text not null,                      -- ties to dsr_item.code
  kind        text not null default 'material'    check (kind in ('material','labour','plant')),
  resource    text not null,                      -- 'cement', 'TMT steel', 'mason'
  qty         numeric not null,                   -- consumption per 1 unit of the item
  unit        text,                               -- bag, kg, cum, day ...
  -- optional link to a catalog product once matched:
  product_id  text,
  created_at  timestamptz not null default now()
);
create index if not exists dsr_coeff_item_idx on public.dsr_coefficient (item_code);

alter table public.dsr_item enable row level security;
alter table public.dsr_coefficient enable row level security;

-- Reference data: readable by any authenticated user, managed by staff.
create policy "dsr_item read"   on public.dsr_item        for select using (auth.role() = 'authenticated');
create policy "dsr_item manage" on public.dsr_item        for all    using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "dsr_coeff read"  on public.dsr_coefficient for select using (auth.role() = 'authenticated');
create policy "dsr_coeff manage" on public.dsr_coefficient for all   using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
