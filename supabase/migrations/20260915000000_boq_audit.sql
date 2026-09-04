-- BOQ external-audit ingestion + quantity methodology persistence.
--
-- Supports the manual, provider-agnostic workflow:
--   Cunstruct BOQ  →  (audited externally)  →  Audit JSON  →  pasted back here
--   →  findings shown in the BOQ dashboard for the user to act on.
-- The schema names no external provider; the JSON contract is the only boundary.
--
-- Purely additive and idempotent. It does NOT modify or drop any existing entity,
-- create a parallel scope taxonomy, or mutate any BOQ. Findings are a review
-- layer: nothing here changes a boq_line's quantity.

-- ── 1) Quantity methodology/status + a stable external key on each BOQ line ──
-- These let an ingested analysis carry its measurement methodology and status,
-- and give audit findings a durable key to match a line even if ids change.
-- boq_line already has `basis`/`basis_note` (provenance) and `qty` (NOT NULL);
-- we only ADD, never change those.
alter table public.boq_line
  add column if not exists measurement_method text,  -- COUNT|AREA|LENGTH|VOLUME|WEIGHT|COVERAGE|DERIVED|SPECIFICATION|PENDING
  add column if not exists quantity_status    text,  -- MEASURED|COUNTED|DERIVED|ESTIMATED|PENDING|NOT_APPLICABLE
  add column if not exists external_key        text; -- stable key from the external analysis, for audit matching
create index if not exists boq_line_external_key_idx on public.boq_line (external_key);

-- ── 2) An audit run — one pasted external audit for a BOQ ─────────────────────
create table if not exists public.boq_audit_run (
  id          uuid primary key default gen_random_uuid(),
  boq_id      uuid not null references public.boq(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,
  -- PASS = no issues; ISSUES_FOUND = findings present. Free of any provider name.
  status      text not null default 'ISSUES_FOUND' check (status in ('PASS','ISSUES_FOUND')),
  source      text not null default 'external',   -- provenance label; NOT a provider lock-in
  raw_json    jsonb,                               -- the pasted payload, kept for traceability
  finding_count int not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists boq_audit_run_boq_idx on public.boq_audit_run (boq_id);

-- ── 3) A finding within a run ────────────────────────────────────────────────
create table if not exists public.boq_audit_finding (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.boq_audit_run(id) on delete cascade,
  boq_id        uuid not null references public.boq(id) on delete cascade,
  -- Nullable: an audit can flag something that has no BOQ line yet (a MISSING_ITEM).
  boq_line_id   uuid references public.boq_line(id) on delete set null,
  external_key  text,                              -- matches boq_line.external_key when a line couldn't be pinned
  finding_type  text not null check (finding_type in (
                  'MISSING_ITEM','MISSING_SCOPE','QUANTITY_PENDING','QUANTITY_ERROR',
                  'METHODOLOGY_ERROR','UNIT_ERROR','DUPLICATE_ITEM','MISSING_SPECIFICATION',
                  'INSUFFICIENT_EVIDENCE','OTHER')),
  action        text,                              -- recommended remediation (advisory)
  scope         text,
  category      text,
  item          text,
  location      text,
  current_value       text,
  recommended_value   text,
  recommended_method  text,
  recommended_unit    text,
  reason        text,
  evidence      text,
  -- User-driven lifecycle. The finding never edits the BOQ; the user decides.
  state         text not null default 'open' check (state in ('open','accepted','dismissed','resolved','kept_pending')),
  resolved_by   uuid references auth.users(id),
  resolved_at   timestamptz,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists boq_audit_finding_run_idx  on public.boq_audit_finding (run_id);
create index if not exists boq_audit_finding_line_idx on public.boq_audit_finding (boq_line_id);

-- ── RLS — mirrors the existing boq / boq_line pattern exactly ────────────────
alter table public.boq_audit_run     enable row level security;
alter table public.boq_audit_finding enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_audit_run' and policyname='boq_audit_run staff manage') then
    create policy "boq_audit_run staff manage" on public.boq_audit_run for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_audit_run' and policyname='boq_audit_run owner read') then
    create policy "boq_audit_run owner read" on public.boq_audit_run for select
      using (exists (
        select 1 from public.boq b join public.projects p on p.id = b.project_id
        where b.id = boq_audit_run.boq_id and p.owner_id = auth.uid()
      ));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_audit_finding' and policyname='boq_audit_finding staff manage') then
    create policy "boq_audit_finding staff manage" on public.boq_audit_finding for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_audit_finding' and policyname='boq_audit_finding owner read') then
    create policy "boq_audit_finding owner read" on public.boq_audit_finding for select
      using (exists (
        select 1 from public.boq b join public.projects p on p.id = b.project_id
        where b.id = boq_audit_finding.boq_id and p.owner_id = auth.uid()
      ));
  end if;
end $$;
