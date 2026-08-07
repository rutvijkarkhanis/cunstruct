-- Multi-discipline BOQ: a project can have several BOQs — Civil, Electrical,
-- Plumbing, HVAC, Fire — each generated from its own discipline catalogue and
-- rolled up into a project-level grand abstract. Existing BOQs are Civil.

alter table public.boq
  add column if not exists discipline text not null default 'civil';

create index if not exists boq_discipline_idx on public.boq (project_id, discipline);
