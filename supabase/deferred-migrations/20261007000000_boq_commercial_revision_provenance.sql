-- Commercial revision — quantity provenance (follow-up to 20261006000000).
-- DEFERRED like its parent: kept out of supabase/migrations until the Stage 3–6
-- rollout (see README). Additive only.
--
-- A frozen revision kept each line's quantity_status and source drawing, but
-- not the quantity's recorded basis, so a re-exported revision could not
-- state where each quantity came from. This adds the two columns and has the
-- freeze function copy them from the snapshot the client already sends
-- (lib/boqRevision.buildRevisionLines includes basis/basis_note when the
-- working line has them). Revisions frozen before this keep NULL — their
-- exports say the document does not state the basis; nothing is backfilled.
--
-- Requires 20261006000000_boq_commercial_revision.sql. The line table's
-- immutability trigger is unaffected: it blocks UPDATE/DELETE of rows, not
-- adding nullable columns.

alter table public.boq_commercial_revision_line
  add column if not exists basis      text,
  add column if not exists basis_note text;

-- Same function as 20261006000000 plus: basis/basis_note copied onto each
-- frozen line, and quantity_status/basis included in the stale-snapshot check.
create or replace function public.create_boq_commercial_revision(p_boq_id uuid, p_header jsonb, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_project uuid;
  v_status text;
  v_discipline text;
  v_rate_year text;
  v_scope uuid;
  v_no int;
  v_id uuid;
  v_stale boolean;
begin
  if v_uid is null or not public.is_staff(v_uid) then
    raise exception 'Only staff can create a commercial revision';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A commercial revision needs at least one line';
  end if;

  -- Lock the BOQ row so concurrent creations number sequentially.
  select b.project_id, b.status, b.discipline, b.rate_year, b.scope_id
    into v_project, v_status, v_discipline, v_rate_year, v_scope
    from public.boq b where b.id = p_boq_id for update;
  if not found then
    raise exception 'BOQ % not found', p_boq_id;
  end if;
  -- The submitted lines must be exactly the BOQ's persisted lines as they are
  -- now, inside this transaction: the same set of lines (each once), with
  -- unchanged description, quantity, unit, inclusion and rates. Anything else —
  -- an edit that landed after the caller read the BOQ, or a fabricated line —
  -- freezes nothing.
  with snap as (
    select (l->>'source_line_id')::uuid as id, l from jsonb_array_elements(p_lines) as l
  ), cur as (
    select * from public.boq_line where boq_id = p_boq_id
  )
  select (select count(*) from snap) <> (select count(*) from cur)
      or (select count(distinct id) from snap) <> (select count(*) from snap)
      or exists (
        select 1 from cur c left join snap s on s.id = c.id
        where s.id is null
           or (s.l->>'description') is distinct from c.description
           or (s.l->>'unit') is distinct from c.unit
           or (s.l->>'qty')::numeric is distinct from c.qty
           or (s.l->>'included')::boolean is distinct from c.included
           or (s.l->>'custom_rate')::numeric is distinct from c.custom_rate
           or (s.l->>'dsr_rate')::numeric is distinct from c.dsr_rate
           or (s.l->>'rate')::numeric is distinct from coalesce(c.custom_rate, c.dsr_rate)
           -- Added here: a status or basis change after the revision was
           -- prepared is also a stale snapshot (basis only when the snapshot
           -- carries it — older clients send none).
           or (s.l->>'quantity_status') is distinct from c.quantity_status
           or (s.l ? 'basis' and (s.l->>'basis') is distinct from c.basis)
      )
    into v_stale;
  if v_stale then
    raise exception 'The BOQ changed after this revision was prepared, so nothing was frozen. Prepare the revision again.';
  end if;

  select coalesce(max(r.revision_no), 0) + 1 into v_no from public.boq_commercial_revision r where r.boq_id = p_boq_id;

  insert into public.boq_commercial_revision (
    boq_id, project_id, boq_name, project_name, revision_no, label, boq_status_at_issue, discipline, rate_year, boq_scope_id,
    context, commercials, works_total, grand_total, line_count, priced_line_count,
    limitations, limitations_acknowledged, issue_note, issued_by
  ) values (
    p_boq_id, v_project, p_header->>'boq_name', p_header->>'project_name', v_no,
    'Rev ' || case when v_no <= 26 then chr(64 + v_no) else v_no::text end,
    v_status, v_discipline, v_rate_year, v_scope,
    coalesce(p_header->'context', '{}'::jsonb), p_header->'commercials',
    (p_header->>'works_total')::numeric, (p_header->>'grand_total')::numeric,
    jsonb_array_length(p_lines), (p_header->>'priced_line_count')::int,
    coalesce(p_header->'limitations', '[]'::jsonb), coalesce((p_header->>'limitations_acknowledged')::boolean, false),
    p_header->>'issue_note', v_uid
  ) returning id into v_id;

  insert into public.boq_commercial_revision_line (
    revision_id, source_line_id, position, subhead_no, subhead_name, item_no, section, dsr_code, description, unit,
    qty, quantity_status, included, scope_id, external_key, rate, rate_basis, rate_provenance, dsr_rate, custom_rate,
    amount, source_document_id, source_document_name, source_page, adoption_id, adoption_source_kind,
    adoption_source_label, adoption_source_unit, adoption_source_date, adoption_confirmed_by, adoption_confirmed_at, limitations,
    basis, basis_note
  )
  select v_id, (l->>'source_line_id')::uuid, (l->>'position')::int, (l->>'subhead_no')::int, l->>'subhead_name',
    l->>'item_no', l->>'section', l->>'dsr_code', l->>'description', l->>'unit',
    (l->>'qty')::numeric, l->>'quantity_status', (l->>'included')::boolean, (l->>'scope_id')::uuid, l->>'external_key',
    (l->>'rate')::numeric, l->>'rate_basis', l->>'rate_provenance', (l->>'dsr_rate')::numeric, (l->>'custom_rate')::numeric,
    (l->>'amount')::numeric, (l->>'source_document_id')::uuid, l->>'source_document_name', l->>'source_page',
    (l->>'adoption_id')::uuid, l->>'adoption_source_kind', l->>'adoption_source_label', l->>'adoption_source_unit',
    (l->>'adoption_source_date')::date, (l->>'adoption_confirmed_by')::uuid, (l->>'adoption_confirmed_at')::timestamptz,
    coalesce(array(select jsonb_array_elements_text(l->'limitations')), '{}'),
    l->>'basis', l->>'basis_note'
  from jsonb_array_elements(p_lines) as l;

  return v_id;
end $$;
revoke all on function public.create_boq_commercial_revision(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_boq_commercial_revision(uuid, jsonb, jsonb) to authenticated;
