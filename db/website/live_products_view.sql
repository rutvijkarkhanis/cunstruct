-- =====================================================================
-- live_products  —  public, website-facing view over products_master
-- Run this in the WEBSITE Supabase project (dkgjsobfljqoggalivzt)
-- SQL editor. Safe to re-run.
--
-- Design:
--   * products_master is the canonical PIM / admin catalog.
--   * The website reads ONLY from `live_products`.
--   * Only rows with status = 'published' are exposed publicly.
--     draft / review / approved / archived rows are never visible.
-- =====================================================================

create or replace view public.live_products as
select *
from public.products_master
where status = 'published';

-- Expose to the API roles used by the website (anon + signed-in users).
grant select on public.live_products to anon, authenticated;

-- The underlying products_master table should remain locked down so that
-- only the PIM/admin project can write to it. The website only needs
-- SELECT on this view.