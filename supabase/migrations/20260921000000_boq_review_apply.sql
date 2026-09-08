-- Apply reviewed drawing-analysis decisions to the BOQ — explicit, human-driven
-- only. Verify/Edit/Flag/Mark-Pending on a review item NEVER touches boq_line by
-- itself (unchanged; enforced by reviewInfra.test.ts). This migration adds ONLY
-- the durable, field-level audit trail an explicit "Apply to BOQ" action needs —
-- distinct from ai_operation_log, which records safe operation metadata but no
-- before/after values. Purely additive; no existing table/column is altered.

create table if not exists public.boq_line_change_log (
  id             uuid primary key default gen_random_uuid(),
  boq_id         uuid not null references public.boq(id) on delete cascade,
  -- Nullable so the row survives if the line is later deleted; the log itself
  -- (what changed, from what, to what, by whom, when) is the durable record.
  boq_line_id    uuid references public.boq_line(id) on delete set null,
  review_item_id uuid references public.analysis_review_item(id) on delete set null,
  field          text not null,      -- 'qty' | 'unit' | 'line_created'
  old_value      text,
  new_value      text,
  changed_by     uuid references auth.users(id),
  changed_at     timestamptz not null default now()
);
create index if not exists boq_line_change_log_boq_idx  on public.boq_line_change_log (boq_id);
create index if not exists boq_line_change_log_line_idx on public.boq_line_change_log (boq_line_id);

alter table public.boq_line_change_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_line_change_log' and policyname='boq_line_change_log staff manage') then
    create policy "boq_line_change_log staff manage" on public.boq_line_change_log for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='boq_line_change_log' and policyname='boq_line_change_log owner read') then
    create policy "boq_line_change_log owner read" on public.boq_line_change_log for select
      using (exists (
        select 1 from public.boq b join public.projects p on p.id = b.project_id
        where b.id = boq_line_change_log.boq_id and p.owner_id = auth.uid()
      ));
  end if;
end $$;
