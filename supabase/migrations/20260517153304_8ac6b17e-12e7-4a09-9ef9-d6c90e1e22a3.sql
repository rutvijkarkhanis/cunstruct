
CREATE TABLE IF NOT EXISTS public.product (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  unit TEXT,
  selling_price NUMERIC,
  image_url TEXT,
  lead_time_days INTEGER DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read product" ON public.product
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Staff write product" ON public.product
  FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

CREATE TRIGGER product_touch_updated
  BEFORE UPDATE ON public.product
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
