# Staging validation — Stage 3–6 commercial workflow

Status: **prepared, not run.** The four migrations below have never been
applied to any database. They parse cleanly with the PostgreSQL 17 grammar
(libpg_query), including the plain-SQL statements inside their functions, and
are covered by static tests — but PL/pgSQL bodies, RLS behaviour, grants and
data compatibility are only proven by running them on a real database.

**Never run this against the live project (`dkgjsobfljqoggalivzt`).** Use a
separate staging Supabase project.

## 0. Point the tooling at staging (and nowhere else)

1. Copy `.env.staging.example` to `.env.staging.local` (git-ignored) — or set
   the same variables as environment secrets — and fill in the STAGING
   project's ref, URL, publishable key and database connection string.
2. `npm run staging:check` — verifies, without contacting anything, that the
   target is a valid Supabase project that is **not** production (it compares
   against `supabase/config.toml` and the committed `.env`). Every staging
   command below runs the same check and refuses on any problem: missing or
   malformed values, a production ref/URL/key/database, mismatched refs, or no
   production identifiers to compare against.
3. `npm run dev:staging` / `npm run build:staging` run the app against the
   verified staging project only; in staging mode the app's Supabase values are
   pinned to it, so nothing falls back to the production `.env`. (The normal
   `npm run dev` / `npm run build` are unchanged and still use `.env`.)

## 1. Prerequisites

- A staging Supabase project whose schema already has every migration up to
  and including `20261002000000_boq_audit_finding_signal_key.sql` (the current
  `main` schema).
- Reference data: `dsr_item` populated (DSR mapping searches it). Without it,
  mapping still works but finds no candidates.
- Two users in staging:
  - **staff**: a row in `user_roles` with role `ops` or `admin` (`is_staff()` true);
  - **owner**: a non-staff user who owns the test project (`projects.owner_id`).
- A throwaway project with one BOQ of 3–5 lines (mixed units, at least one line
  with a DSR code, one excluded, one with quantity pending) and one uploaded
  project document (to link as a quotation source).
- The staging target configured as in step 0 (never edit `.env`, which is the
  production configuration).

## 2. Apply, in this exact order

| # | File | Depends on |
|---|------|-----------|
| 1 | `20261003000000_boq_line_dsr_mapping.sql` | `boq`, `boq_line`, `dsr_item`, `projects`, `is_staff()` |
| 2 | `20261004000000_boq_line_rate_evidence.sql` | 1's tables' parents, `project_document` |
| 3 | `20261005000000_boq_line_rate_adoption.sql` | **2** (`vendor_quotation` FK), `boq_line_change_log`, `dsr_item` |
| 4 | `20261006000000_boq_commercial_revision.sql` | `boq` (`status`, `discipline`, `rate_year`, `scope_id`), `boq_line`, `projects` |

Each file is purely additive (new tables, functions, triggers, policies; no
existing table altered) and re-runnable (`if not exists`, `create or replace`,
guarded policies).

```
npm run staging:migrate                                    # dry run: verify target, list the four files
node scripts/staging-migrate.mjs --apply --confirm-ref=<staging-ref>
```

The apply step re-verifies the target, requires the staging ref repeated
exactly, runs each file with `psql --single-transaction -v ON_ERROR_STOP=1`,
and stops at the first failure — that file rolls back and later files are not
run. The connection goes to psql only through `PG*` variables built from the
verified URL (never printed, never on the command line); any `PG*` variable
already in your environment (e.g. `PGSERVICE`, `PGHOSTADDR`) is dropped, and SSL
is always at least `require`. `STAGING_DB_URL` must be a direct
`db.<ref>.supabase.co` host or a `*.pooler.supabase.com` host with user
`postgres.<ref>`, and every ref in it must be the staging ref. It does not record
Supabase's migration history, so a later `supabase db push` would re-run these
files (harmless — they are re-runnable). Do **not** use `supabase link` /
`db push` for this: `supabase/config.toml` is pinned to production.

## 3. Post-apply checks (SQL editor, staging)

```sql
-- functions exist; anon cannot execute the two RPCs
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
from pg_proc p where p.proname in ('adopt_boq_line_rate','create_boq_commercial_revision');
-- expect anon_exec = false, auth_exec = true for both

-- revision tables are read-only through the API: only SELECT policies
select tablename, policyname, cmd from pg_policies
where tablename like 'boq_commercial_revision%' or tablename = 'boq_line_rate_adoption'
order by 1, 2;
-- expect: revision tables SELECT only; adoption table SELECT + INSERT only
```

## 4. Regenerate types

`src/integrations/supabase/types.ts` is stale (it does not contain `boq`,
`boq_line` or any of the new tables; the app reaches them through the untyped
helper in `src/lib/untypedDb.ts`). After applying to staging:

```
npm run staging:check   # confirm the ref is staging first
npx supabase gen types typescript --project-id <staging-ref> > /tmp/staging-types.ts   # needs SUPABASE_ACCESS_TOKEN
diff src/integrations/supabase/types.ts /tmp/staging-types.ts   # review before copying over
```

Review the diff before committing it; regeneration will change the
pre-existing type-error baseline (currently 463 errors, mostly from the stale
types).

## 5. Manual workflow (staff user, staging)

| Step | Do | Expect |
|------|----|--------|
| 1. Edit | Open the BOQ, change one line's rate inline | Rate saves; a `boq_line_change_log` row with field `custom_rate`, old/new values, your user id |
| 2. Map | More → DSR mapping…; select a candidate for a line; mark one unmatched; flag one | Rows in `boq_line_dsr_mapping` with the DSR snapshot; `boq_line` untouched |
| 3. Estimate | Indicative estimate tab; include the mapped line | Total shows "Partial — …"; unit-mismatched lines can't be included |
| 3. Evidence | Rate comparison tab; record a quotation linked to the uploaded document; prefer it | `vendor_quotation` and `boq_line_rate_review` rows; BOQ rates unchanged |
| 4. Adopt | Adopt… → tick caveats → Confirm | In ONE transaction: `boq_line.custom_rate` changes, one change-log row, one `boq_line_rate_adoption` row with `confirmed_by` = you; line shows "adopted rate" |
| 4. Conflict | Open Adopt… in two tabs; change the rate in tab A; confirm in tab B | Tab B: "changed since this preview — nothing was written"; no new rows |
| 4. Manual after adoption | Edit an adopted line's rate inline | Confirmation dialog; after confirming, label "manual rate — changed after adoption"; adoption row still present |
| 5. Finalize | Header → Mark finalized | `boq.status = 'finalized'`; nothing else changes |
| 6. Freeze | More → Commercial revisions → Prepare → acknowledge → Freeze | "Rev A" with `boq_status_at_issue = 'finalized'`; one revision line per BOQ line |
| 6. Stale freeze | Prepare; change a rate; Freeze | "The BOQ changed after you prepared this revision…"; nothing frozen; confirm again to freeze |
| 7. Reopen/export | Change a working line; Open Rev A; export PDF and CSV | Viewer shows saved values plus "Since this revision" changes; exports show the saved values, not the edit |

Negative checks:

- **Owner (non-staff) user.** The `/ops` pages are staff-only (`OpsLayout`), so
  test this through the database as that user, not the UI. In the SQL editor:

  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<owner-user-uuid>","role":"authenticated"}', true);
  select count(*) from public.boq_commercial_revision;   -- owner can read their project's rows
  select public.adopt_boq_line_rate('<line-uuid>', 1, '{}', '{}');            -- error: Only staff can adopt a rate
  rollback;
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<owner-user-uuid>","role":"authenticated"}', true);
  select public.create_boq_commercial_revision('<boq-uuid>', '{}', '[{}]');   -- error: Only staff can create a commercial revision
  rollback;
  ```
- **Revisions are immutable.** In the SQL editor's default (`postgres`) role,
  which bypasses RLS but not triggers:
  `update public.boq_commercial_revision set grand_total = 0` → error
  "Commercial BOQ revisions are immutable"; the same for `delete`, and for
  `boq_commercial_revision_line`. (As `authenticated` the same `update` simply
  affects 0 rows — there is no update policy — which is also correct.)
- **Delete the working BOQ** (throwaway only): its revisions remain, with `boq_id` null.
- **Revision status is preserved:** set the BOQ back to Draft; Rev A still shows "BOQ status then: Finalized (internal)".

## 6. Rollback (staging only)

All objects are new, so rollback is dropping them in reverse order:

```sql
drop function if exists public.create_boq_commercial_revision(uuid, jsonb, jsonb);
drop table if exists public.boq_commercial_revision_line, public.boq_commercial_revision;
drop function if exists public.boq_commercial_revision_immutable(), public.boq_commercial_revision_header_immutable();
drop function if exists public.adopt_boq_line_rate(uuid, numeric, jsonb, jsonb);
drop table if exists public.boq_line_rate_adoption;
drop function if exists public.boq_line_rate_adoption_sync();
drop table if exists public.boq_line_rate_review, public.vendor_quotation;
drop function if exists public.rate_evidence_sync_boq();
drop table if exists public.boq_line_dsr_mapping;
drop function if exists public.boq_line_dsr_mapping_sync();
```

## Known limitations (not defects to fix before staging)

- Inline manual rate edits are audited with a compensating rollback, not one
  transaction (`boq_line_change_log` is already live; an atomic version needs a
  new function). A failure there is always reported, never shown as success.
- The revision function verifies every line against the persisted BOQ, but the
  header's commercial percentages and quote context come from the client.
- Quantities and rates are compared exactly; a value with more than ~15
  significant digits (beyond JavaScript number precision) would make a freeze
  be rejected as stale.
