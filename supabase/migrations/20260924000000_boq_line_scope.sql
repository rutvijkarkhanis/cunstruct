-- BOQ LINE SCOPE — a per-line override so a bare `external_key` match can be
-- disambiguated when the same mark code is reused across floors within ONE
-- consolidated BOQ (e.g. "W1" on Stilt, Ground, and a Typical floor). Most
-- BOQs are already effectively scoped as a whole via boq.scope_id
-- (20260901000000_project_workspace.sql); this is only for the rarer case
-- where a single boq_id spans more than one scope and individual lines need
-- their own.
--
-- Purely additive: nullable, no backfill, no constraint. A line with
-- scope_id = null behaves in applyReview.ts exactly as it does today — this
-- column is consulted ONLY when a review item's external_key matches more
-- than one line in the same BOQ (see classifyReviewItem), which no existing
-- data triggers until this feature starts writing/reading it.
--
-- Deliberately NOT the existing boq_line.drawing jsonb `location` field:
-- that field is an established display/PDF/Excel value (a room-level string
-- like "Living / TV area", paired with a Works-vs-Equipment `scope`) with
-- its own meaning already in production use. Reusing it here would silently
-- overload a display field with an identity meaning it was never designed
-- to carry. scope_id is a distinct, dedicated column for exactly one job.

alter table public.boq_line
  add column if not exists scope_id uuid references public.project_scope(id) on delete set null;
create index if not exists boq_line_scope_idx on public.boq_line (scope_id);
