-- DOCUMENT PAGE TITLES — human-readable, per-page sheet identity.
--
-- Optional, additive map of page number -> the sheet's own printed title
-- (e.g. "DOOR/WINDOW SCHEDULE / GROUND FLOOR PLAN"), so the review
-- workstation can answer "what am I looking at" without reusing the
-- whole-document name for every page. Never required, never inferred by the
-- database — populated later by AI extraction or a reviewer override (not
-- built in this migration). Null/absent is a fully valid default state.
alter table public.document_revision
  add column if not exists page_titles jsonb;
