
ALTER TABLE public.stage_material_mapping
  ADD CONSTRAINT stage_material_mapping_product_fk
  FOREIGN KEY (product_id) REFERENCES public.product(id) ON DELETE RESTRICT;

ALTER TABLE public.forecast_items
  ADD CONSTRAINT forecast_items_product_fk
  FOREIGN KEY (product_id) REFERENCES public.product(id) ON DELETE RESTRICT;
