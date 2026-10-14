-- BOQ LINE RATE EVIDENCE — current market-rate sourcing for a BOQ line:
--   • vendor_quotation        quotations recorded against a line (or the fact
--                             that one is unavailable / incomplete);
--   • boq_line_rate_review    the estimator's notes and PREFERRED CANDIDATE for
--                             further review, with a snapshot of that rate.
-- Historical firm rates are NOT copied into a table here: they are read live
-- from other BOQs' boq_line rows, and only snapshotted when chosen as the
-- preferred candidate.
--
-- Pricing boundary: this is evidence, not pricing. Nothing here is read by the
-- commercial waterfall (boq_line.dsr_rate / custom_rate / computeCommercials),
-- nothing here writes to boq_line, and choosing a preferred candidate does not
-- adopt it — adopting a rate into the priced BOQ is a separate, later step.
--
-- Values are stored exactly as stated on the quotation. Anything not stated
-- stays null (or 'not_stated' for an inclusion), never filled in; a genuine
-- zero rate is 0, distinct from null (not available).
--
-- Source documents reuse the existing project_document store (uploaded through
-- the project's Documents workspace); a quotation links to one by id, plus an
-- optional free-text reference (quotation number, email, etc.).
--
-- Purely additive: no existing table or column is altered. Not applied to any
-- database by the commit that adds it.

create table if not exists public.vendor_quotation (
  id                    uuid primary key default gen_random_uuid(),
  boq_id                uuid not null references public.boq(id) on delete cascade,  -- derived from the line (trigger)
  boq_line_id           uuid not null references public.boq_line(id) on delete cascade,
  status                text not null default 'received'
                          check (status in ('received','incomplete','unavailable')),
  vendor_name           text not null,
  vendor_contact        text,
  quoted_description    text,
  quoted_unit           text,
  quoted_rate           numeric check (quoted_rate is null or quoted_rate >= 0),
  -- The estimator's reading of whether the quoted item is the same scope/spec
  -- as the BOQ line. Only 'matches' allows a numeric comparison.
  spec_match            text not null default 'unclear'
                          check (spec_match in ('matches','differs','unclear')),
  tax_treatment         text not null default 'not_stated'
                          check (tax_treatment in ('included','excluded','not_stated')),
  tax_pct               numeric check (tax_pct is null or tax_pct >= 0),
  freight               text not null default 'not_stated'
                          check (freight in ('included','excluded','not_stated')),
  freight_amount        numeric check (freight_amount is null or freight_amount >= 0),
  installation          text not null default 'not_stated'
                          check (installation in ('included','excluded','not_stated')),
  installation_amount   numeric check (installation_amount is null or installation_amount >= 0),
  other_charges         text,
  quotation_date        date,
  valid_until           date,
  quotation_ref         text,
  source_document_id    uuid references public.project_document(id) on delete set null,
  exclusions            text,
  conditions            text,
  notes                 text,
  recorded_by           uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- "Unavailable" records that no usable quote exists — it carries no rate.
  constraint vendor_quotation_unavailable_no_rate check (status <> 'unavailable' or quoted_rate is null),
  constraint vendor_quotation_validity_order check (valid_until is null or quotation_date is null or valid_until >= quotation_date)
);
create index if not exists vendor_quotation_boq_idx  on public.vendor_quotation (boq_id);
create index if not exists vendor_quotation_line_idx on public.vendor_quotation (boq_line_id);

create table if not exists public.boq_line_rate_review (
  id                       uuid primary key default gen_random_uuid(),
  boq_id                   uuid not null references public.boq(id) on delete cascade,  -- derived from the line (trigger)
  boq_line_id              uuid not null references public.boq_line(id) on delete cascade,
  notes                    text,
  -- Preferred candidate for further review (NOT the adopted rate). Null kind =
  -- no preference recorded, notes only.
  preferred_kind           text check (preferred_kind in ('dsr_reference','vendor_quotation','historical_boq')),
  preferred_quotation_id   uuid references public.vendor_quotation(id) on delete set null,
  preferred_boq_line_id    uuid references public.boq_line(id) on delete set null,
  -- Snapshot of the preferred rate as it stood when chosen, so a later edit to
  -- the quotation or historical BOQ cannot silently change the recommendation.
  preferred_rate           numeric,
  preferred_unit           text,
  preferred_source_label   text,
  preferred_rate_date      date,
  reviewed_by              uuid references auth.users(id),
  reviewed_at              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint boq_line_rate_review_line_uq unique (boq_line_id),
  -- A preference always names its source. (The quotation/line ids may later
  -- become null via `on delete set null`; the snapshot remains the record.)
  constraint boq_line_rate_review_preferred_has_source
    check (preferred_kind is null or preferred_source_label is not null),
  -- A historical rate must come from a DIFFERENT line than the one under review.
  constraint boq_line_rate_review_historical_not_self check (preferred_boq_line_id is null or preferred_boq_line_id <> boq_line_id)
);
create index if not exists boq_line_rate_review_boq_idx on public.boq_line_rate_review (boq_id);

-- Keep boq_id consistent with the line (never trusted from the client).
create or replace function public.rate_evidence_sync_boq()
returns trigger language plpgsql as $$
begin
  select l.boq_id into new.boq_id from public.boq_line l where l.id = new.boq_line_id;
  if new.boq_id is null then
    raise exception 'boq_line % not found', new.boq_line_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists vendor_quotation_sync on public.vendor_quotation;
create trigger vendor_quotation_sync before insert or update on public.vendor_quotation
  for each row execute function public.rate_evidence_sync_boq();
drop trigger if exists boq_line_rate_review_sync on public.boq_line_rate_review;
create trigger boq_line_rate_review_sync before insert or update on public.boq_line_rate_review
  for each row execute function public.rate_evidence_sync_boq();

alter table public.vendor_quotation enable row level security;
alter table public.boq_line_rate_review enable row level security;

-- Same access model as boq_line: staff manage; a project owner can read.
do $$
declare t text;
begin
  foreach t in array array['vendor_quotation','boq_line_rate_review'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||' staff manage') then
      execute format('create policy %I on public.%I for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()))', t||' staff manage', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||' owner read') then
      execute format('create policy %I on public.%I for select using (exists (select 1 from public.boq b join public.projects p on p.id = b.project_id where b.id = %I.boq_id and p.owner_id = auth.uid()))', t||' owner read', t, t);
    end if;
  end loop;
end $$;
