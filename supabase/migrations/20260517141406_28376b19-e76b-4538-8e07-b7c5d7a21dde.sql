-- supplier_reservations
CREATE TABLE public.supplier_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_item_id uuid NOT NULL REFERENCES public.forecast_items(id) ON DELETE CASCADE,
  supplier_id uuid,
  status text NOT NULL DEFAULT 'not_contacted'
    CHECK (status IN ('not_contacted','availability_confirmed','reserved','quoted','ordered','delivered')),
  notes text,
  reserved_at timestamptz,
  expected_delivery_date date,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplier_reservations_item ON public.supplier_reservations(forecast_item_id);

ALTER TABLE public.supplier_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage supplier reservations"
  ON public.supplier_reservations FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_supplier_reservations_updated_at
  BEFORE UPDATE ON public.supplier_reservations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- whatsapp_messages
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  message_type text NOT NULL
    CHECK (message_type IN ('weekly_brief','alert','confirmation')),
  content text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  sent_at timestamptz,
  contractor_reply text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_messages_project ON public.whatsapp_messages(project_id);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage whatsapp messages"
  ON public.whatsapp_messages FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Owner reads own project whatsapp messages"
  ON public.whatsapp_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = whatsapp_messages.project_id
      AND p.owner_id = auth.uid()
      AND whatsapp_messages.sent_at IS NOT NULL
  ));

CREATE TRIGGER trg_whatsapp_messages_updated_at
  BEFORE UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();