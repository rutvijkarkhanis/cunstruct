-- ANALYSIS RUN DOCUMENT MAPPING — optional override for unresolved analysis sources.
--
-- When importing an analysis JSON whose source.document doesn't match a stored
-- drawing, the user can select a drawing to use. This column stores that choice
-- without modifying the immutable ai_json. RLS unchanged; project_id still gates access.

alter table public.analysis_run
  add column if not exists resolved_document_id uuid references public.project_document(id) on delete set null;
