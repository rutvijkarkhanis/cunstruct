# R7: production change-history migration — owner runbook

**Status: prepared, not executed.** Nothing in this document has been run against the
database except the read-only checks in §0. One supervised session by the owner (the only
person with Supabase dashboard access). Applies **one** migration:
`supabase/migrations/20260921000000_boq_review_apply.sql` (creates
`public.boq_line_change_log`). The detailed engineering procedure, with every stop rule,
is [audit-history-deployment.md](audit-history-deployment.md); this runbook is the short
form for the SQL editor. If the two ever disagree, stop.

**Not in this session:** the deferred revisions chain `20261003`–`20261008` (only if R8
decides to ship it, under its own approval) and the identity indexes `20260929`.

## 0. Production state observed (PRODUCTION, read-only, 2026-10-18T10:46Z)

Read with the ops test account through the public API (SELECT with `limit 0` only;
nothing written). Project ref `dkgjsobfljqoggalivzt`.

| Object | State | Meaning |
|---|---|---|
| `public.boq_line_change_log` | **absent** (PGRST205) | The migration has not been applied |
| `boq`, `boq_line`, `analysis_review_item`, `projects` (columns the migration uses) | present | Prerequisites met |
| `public.is_staff(uuid)` | present | Prerequisite met |
| `boq_line.basis`, `basis_note`, `quantity_status` | present | From earlier migrations (2026-08-10, 2026-09-15) |
| Deferred chain tables (`boq_line_dsr_mapping`, `boq_line_rate_review`, `vendor_quotation`, `boq_line_rate_adoption`, `boq_commercial_revision`, `boq_commercial_revision_line`) | all **absent** | Nothing from `20261003`–`20261008` is partly applied |

Migration file SHA-256 (checked 2026-10-18): `b9fb9500df2266a29d857ff2639e82c880cc1020c488ef4a1ae08f24c9fddb53`
— the same value recorded in the engineering procedure.

The API cannot see `supabase_migrations` or `pg_policies`; step 2 checks those in the SQL editor.

## 1. Backup (required; stop if you cannot verify one)

Use **one** of:

- **A. Dashboard backup.** Supabase dashboard → *Database* → *Backups*. Confirm a backup
  exists with today's date (or, if your plan offers it, use point-in-time recovery and
  note the current time). Write down its date and time. If the page shows no backups
  (some plans have none), use B.
- **B. Full dump.** Follow [production-backup.md](production-backup.md): put the database
  connection string (dashboard → *Connect* → session pooler, port 5432) into this cloud
  environment's secrets as `PROD_BACKUP_DB_URL`, never in chat, and ask Claude Code to run
  `scripts/prod-backup.sh` then `scripts/prod-backup.sh --run`. Keep the backup folder
  until step 4 passes.

## 2. Preflight (read-only) — SQL editor

Dashboard → *SQL Editor* → new query. Paste and run:

```sql
set default_transaction_read_only = on;
select to_regclass('public.boq_line_change_log')                     as must_be_null;
select version from supabase_migrations.schema_migrations
 where version = '20260921000000'                                     ; -- must return 0 rows
select count(*) as must_be_0 from pg_policies where tablename = 'boq_line_change_log';
select count(*) as must_be_0 from pg_indexes  where indexname like 'boq_line_change_log%';
select to_regprocedure('public.is_staff(uuid)')                       as must_not_be_null;
```

**Stop and apply nothing** if any line does not show what its label says.

## 3. Apply — SQL editor

New query. Type the first two lines, then paste the **entire** contents of
`supabase/migrations/20260921000000_boq_review_apply.sql` (from GitHub, `main`), then the
last line:

```sql
begin;
set local lock_timeout = '5s';
-- paste the whole migration file here, unchanged
commit;
```

Run it once. Any error rolls everything back: stop and report the error text. Do **not**
use `supabase db push` (it would also push other pending migrations).

## 4. Post-checks — SQL editor

```sql
select to_regclass('public.boq_line_change_log');                    -- not null
select relrowsecurity from pg_class
 where oid = 'public.boq_line_change_log'::regclass;                  -- true
select policyname, cmd from pg_policies
 where tablename = 'boq_line_change_log' order by 1;
  -- exactly 2: 'boq_line_change_log owner read' SELECT; 'boq_line_change_log staff manage' ALL
select indexname from pg_indexes
 where tablename = 'boq_line_change_log' order by 1;
  -- exactly 3: boq_line_change_log_boq_idx, boq_line_change_log_line_idx, boq_line_change_log_pkey
select count(*) from public.boq_line_change_log;                      -- 0
```

Migration history will still not list `20260921000000` (the SQL editor does not write it).
That is expected and harmless: the file is re-runnable. Do not edit the history table.

## 5. In the app (R6-equivalent smoke checks, internal test project only)

Use the internal test project only, never a customer BOQ. After each action, confirm no
"change history NOT recorded" warning appears, and that the history rows exist:
`select field, old_value, new_value from public.boq_line_change_log order by changed_at desc limit 20;`

| # | Action | Expected |
|---|---|---|
| 1 | Apply one reviewed item | Success toast with no "NOT recorded" warning; rows for `qty`/`unit` (or `line_created`) |
| 2 | Remove a line, then Undo | Both allowed (removal was refused while history was missing); line restored; history rows for both |
| 3 | Exclude-instead, then Undo | Line excluded then included again; history rows |
| 4 | DSR Accept / Reject / Defer, then Undo | Each recorded; Undo restores the previous state |
| 5 | Set a schedule rate; edit a rate manually | Both allowed (they were refused while history was missing); history rows |
| 6 | Same line edited in two browser tabs | The second save is refused as a conflict, not silently overwritten |

Report which rows passed. Undo the test changes with the app's own Undo, not with SQL.

## 6. Rollback (never automatic)

- **Stopped in step 2, or step 3 errored:** nothing changed. Report.
- **Step 4 failed, the count is 0, and no real work has been applied since:** report;
  `drop table public.boq_line_change_log;` only on the owner's written decision.
- **Real history rows exist:** do not drop the table. Any fix is a separate decision;
  restoring the step-1 backup is the last resort and also reverts all data written since.

## 7. Record

Add the results (backup date/time, step 2 and 4 outputs, step 5 table) to the plan's
evidence log under R7. R7 is DONE only when steps 1–5 pass.
