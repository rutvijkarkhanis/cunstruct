
ALTER TABLE public.forecast_items
  ADD COLUMN IF NOT EXISTS confirmed_qty numeric,
  ADD COLUMN IF NOT EXISTS confirmed_price numeric,
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS actual_order_date date,
  ADD COLUMN IF NOT EXISTS actual_delivery_date date,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by uuid;
