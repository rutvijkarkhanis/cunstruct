-- AI SECURITY FOUNDATION (provider-agnostic; NO AI is integrated here).
--
-- Prepares Cunstruct to later run AI-assisted analysis/audit through a SERVER-SIDE
-- boundary, without choosing or wiring any AI provider. It adds only:
--   1) a per-project switch recording whether AI processing is authorised, and
--   2) an application-level audit trail for sensitive/AI operations.
--
-- It stores NO provider API keys (those live only in server-side env), NO prompts
-- and NO AI responses. Purely additive, idempotent, non-destructive; mirrors the
-- existing staff-manage / owner-read RLS pattern. It grants no new access and
-- changes no existing behaviour.

-- ── 1) Per-project AI processing control ─────────────────────────────────────
-- Default FALSE: confidential project data is NOT eligible to be sent to any
-- external provider until this is explicitly turned on for the project. This is
-- the domain flag a future, authorised AI path must check — never a UI consent
-- claim (the product is not customer-facing yet).
alter table public.projects
  add column if not exists ai_processing_enabled boolean not null default false;

-- ── 2) Application-level audit trail for sensitive / future-AI operations ─────
-- Records WHO did WHAT to WHICH project/resource, WHEN, with WHICH (abstract)
-- provider/model and the result STATUS + a correlation id. It deliberately holds
-- NO document contents, NO prompts and NO responses — only safe metadata.
create table if not exists public.ai_operation_log (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references public.projects(id) on delete cascade,
  user_id        uuid references auth.users(id),
  operation      text not null,          -- e.g. 'analysis.request', 'audit.import', 'document.signed_url'
  resource_type  text,                   -- e.g. 'document', 'boq', 'boq_line'
  resource_id    text,                   -- id of the resource (no content)
  provider       text,                   -- ABSTRACT provider label, chosen later; never a key
  model          text,                   -- model/config label, chosen later
  status         text not null default 'ok' check (status in ('ok','error','denied','pending')),
  correlation_id text,                   -- ties related log lines / a request together
  created_at     timestamptz not null default now()
);
create index if not exists ai_operation_log_project_idx on public.ai_operation_log (project_id, created_at desc);

-- ── RLS — mirrors the existing project-data pattern exactly ───────────────────
alter table public.ai_operation_log enable row level security;

do $$
begin
  -- Staff (ops/admin) manage all log rows.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ai_operation_log' and policyname='ai_operation_log staff manage') then
    create policy "ai_operation_log staff manage" on public.ai_operation_log for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  -- A project owner may READ their own project's audit trail (transparency), but
  -- never write it — the trail is written server-side / by staff.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ai_operation_log' and policyname='ai_operation_log owner read') then
    create policy "ai_operation_log owner read" on public.ai_operation_log for select
      using (exists (
        select 1 from public.projects p
        where p.id = ai_operation_log.project_id and p.owner_id = auth.uid()
      ));
  end if;
end $$;
