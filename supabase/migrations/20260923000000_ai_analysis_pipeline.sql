-- AI ANALYSIS PIPELINE — content-hash identity, contract versioning, and a
-- DB-enforced claim ledger so a real OpenAI analysis call can never be sent
-- twice for the same (project, file content, contract, model).
--
-- Purely additive. Existing analysis_run/analysis_review_item rows are
-- unaffected (new columns are nullable / defaulted); the JSON-import path
-- (createAnalysisRun in reviewStore.ts) keeps working exactly as today —
-- it simply leaves the new columns null, same as before this migration.

-- ── 1) Content identity on the existing revision row ─────────────────────────
-- SHA-256 of the actual uploaded bytes, computed SERVER-SIDE (by the
-- ai-analysis edge function, on demand — never trusted from the client).
-- Nullable: a revision has no hash until something needs one; JSON-import-only
-- projects may never compute it at all.
alter table public.document_revision
  add column if not exists content_hash text;
create index if not exists document_revision_content_hash_idx on public.document_revision (content_hash);

-- ── 2) Provenance + billing metadata on the existing run row ─────────────────
-- contract_version identifies the exact prompt+schema+extraction-rules version
-- that produced this run (distinct from schema_version, which is the JSON
-- shape). Token/cost columns are internal bookkeeping only — never shown in
-- the normal reviewer UI; the ops/admin-only panel reads them directly.
alter table public.analysis_run
  add column if not exists contract_version text,
  add column if not exists input_tokens int,
  add column if not exists output_tokens int,
  add column if not exists total_tokens int,
  add column if not exists estimated_cost_usd numeric,
  add column if not exists actual_cost_usd numeric,
  add column if not exists cost_currency text not null default 'USD';

-- ── 3) The source-file ledger + idempotent claim ──────────────────────────────
-- One row per (project, file content, contract, provider, model) that was ever
-- claimed for analysis. This is the SAME row that answers three different
-- questions, deliberately unified rather than split into three tables:
--   * "has this exact file content already been analysed under this exact
--     contract/model?" (duplicate/cost protection — the unique constraint)
--   * "is a worker already processing this file right now?" (concurrency —
--     PROCESSING blocks a second claim; two tabs / a double-click / a retry
--     race on the unique constraint and only one wins the insert)
--   * "which stored file (document/revision/filename) produced which run?"
--     (source provenance for evidence)
--
-- Status lifecycle: no row = ELIGIBLE (never claimed). A row is inserted as
-- PROCESSING (the claim). It becomes SUCCEEDED once the run+review items are
-- persisted, or FAILED on any error — FAILED is retryable (a later request
-- may re-claim it by flipping FAILED -> PROCESSING), SUCCEEDED never is.
create table if not exists public.analysis_run_source (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references public.projects(id) on delete cascade,
  content_hash                text not null,
  contract_version            text not null,
  provider                    text not null,
  model                       text not null,
  status                      text not null default 'PROCESSING'
                               check (status in ('PROCESSING','SUCCEEDED','FAILED')),
  document_id                 uuid references public.project_document(id) on delete set null,
  document_revision_id        uuid references public.document_revision(id) on delete set null,
  -- The filename as it was at the moment this claim was made — kept even if
  -- the document/revision is later renamed, moved, or deleted, since this
  -- row is the durable provenance record, not a live pointer.
  filename_at_time_of_analysis text,
  analysis_run_id             uuid references public.analysis_run(id) on delete set null,
  claimed_by                  uuid references auth.users(id),
  error                       text,
  claimed_at                  timestamptz not null default now(),
  completed_at                timestamptz,
  -- The identity that must never be double-sent to the provider: same
  -- project + same bytes + same contract + same provider/model = same
  -- logical analysis request, regardless of filename/folder/document id.
  unique (project_id, content_hash, contract_version, provider, model)
);
create index if not exists analysis_run_source_project_idx on public.analysis_run_source (project_id);
create index if not exists analysis_run_source_run_idx on public.analysis_run_source (analysis_run_id);
create index if not exists analysis_run_source_hash_idx on public.analysis_run_source (project_id, content_hash);

-- ── RLS — identical shape to every other project-scoped table ────────────────
alter table public.analysis_run_source enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analysis_run_source' and policyname='analysis_run_source staff manage') then
    create policy "analysis_run_source staff manage" on public.analysis_run_source for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analysis_run_source' and policyname='analysis_run_source owner read') then
    create policy "analysis_run_source owner read" on public.analysis_run_source for select
      using (exists (select 1 from public.projects p where p.id = analysis_run_source.project_id and p.owner_id = auth.uid()));
  end if;
end $$;
