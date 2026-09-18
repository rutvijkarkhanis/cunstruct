-- ANALYSIS OBSERVATION — LOCATION mode's output (Phase 4). Construction-
-- relevant facts extracted directly from a drawing, independent of any BOQ,
-- each with exact evidence and exact document/revision provenance. BOQ
-- matching is explicitly NOT this table's job (Phase 5); there is no
-- matched_boq_item_key or boq_id column here, and none should be added
-- without a real join model that can represent zero/one/many matches.
--
-- Purely additive: a new table only, no existing table or column touched.
--
-- document_id/revision_id are nullable at the DB level ONLY so a later
-- document/revision deletion can null them out (on delete set null) while
-- preserving the observation as a historical record — mirroring the exact
-- same precedent already established by analysis_run.resolved_document_id
-- and analysis_run_source.document_id. The application (ai-analysis edge
-- function) never inserts a row without both populated; see
-- observationSource.ts's resolveObservationSource(), which pins both from
-- the SAME claimed-file record so they can never disagree.
--
-- document_id IS NULL OR revision_id IS NULL means the pinned source is no
-- longer resolvable — a future viewer must treat that as "source
-- unavailable" and must resolve by the exact pinned revision_id, never
-- silently substitute the document's current revision (see documentResolve.ts's
-- existing "never silently substitute a different document" principle,
-- extended here to revision granularity).

create table if not exists public.analysis_observation (
  id                     uuid primary key default gen_random_uuid(),
  run_id                 uuid not null references public.analysis_run(id) on delete cascade,
  project_id             uuid not null references public.projects(id) on delete cascade,
  document_id            uuid references public.project_document(id) on delete set null,
  revision_id            uuid references public.document_revision(id) on delete set null,
  -- Free text at the DB level (never enforced here — same convention as
  -- doc_type/discipline), but bounded in practice: the only writer is
  -- observationSchemaV1.ts's parser, which only ever accepts a value from
  -- OBSERVATION_TYPES, and the OpenAI-facing schema constrains it with a
  -- strict enum before that.
  observation_type       text not null,
  mark                   text,
  scope_hint             text,
  location_text          text,
  -- Bounded to {dimension, specification, material} by the parser — see
  -- ObservationAttributes in observationSchemaV1.ts. No "quantity_hint" or
  -- any other key: LOCATION mode never asserts a quantity.
  attributes             jsonb not null default '{}'::jsonb,
  -- The parsed AnalysisSource shape (documentId, page, evidence[], pageSize?)
  -- — the EXACT existing evidence/coordinate contract items already use, not
  -- a second one. documentId inside this JSON is the model's own (informal)
  -- claim; document_id/revision_id above are Cunstruct's authoritative,
  -- validated identity, resolved FROM this field (see observationSource.ts).
  evidence               jsonb not null,
  evidence_completeness  text not null default 'FULL'
                          check (evidence_completeness in ('FULL','PARTIAL','LIMITED')),
  created_at             timestamptz not null default now()
);
create index if not exists analysis_observation_run_idx on public.analysis_observation (run_id);
create index if not exists analysis_observation_doc_idx on public.analysis_observation (project_id, document_id);

-- ── RLS — mirrors analysis_review_item's exact staff-manage/owner-read pattern ─
alter table public.analysis_observation enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analysis_observation' and policyname='analysis_observation staff manage') then
    create policy "analysis_observation staff manage" on public.analysis_observation for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analysis_observation' and policyname='analysis_observation owner read') then
    create policy "analysis_observation owner read" on public.analysis_observation for select
      using (exists (select 1 from public.projects p
        where p.id = analysis_observation.project_id and p.owner_id = auth.uid()));
  end if;
end $$;
