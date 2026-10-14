# Audit-history deployment — production

Status: **prepared, not executed.** Applies one migration,
`supabase/migrations/20260921000000_boq_review_apply.sql`, which creates
`public.boq_line_change_log` (field-level history written by every review Apply).
Requires explicit authorization, a backup, and a database connection string supplied
by the operator — never pasted into chat, a ticket or shell history.

Out of scope here (separate decisions, not applied by this procedure):
`20260910000000_scope_taxonomy.sql` and the Stage 3–6 migrations `20261003`–`20261006`
(`docs/staging-validation-stage3-6.md`).

## Why it is needed
Production currently has no `boq_line_change_log` (`GET /rest/v1/boq_line_change_log`
→ 404, read-only probe 2026-10-14). Apply saves quantities but records no history and
says so in the UI ("change history NOT recorded for N items"). Lines applied before
this migration have no history; it is not reconstructed or backfilled.

## 0. Checksums (verify before anything else; stop on mismatch)
```bash
sha256sum supabase/migrations/20260921000000_boq_review_apply.sql
# b9fb9500df2266a29d857ff2639e82c880cc1020c488ef4a1ae08f24c9fddb53
sha256sum supabase/migrations/20260929000000_boq_line_identity_constraint.sql   # only for section 4
# 602c414083ae9f978cb76be3a63679b90d92835f0fbc9fae31492a498892594b
```
Both files are unchanged from commit `f6b5c45`. Every statement in them and in this
document parses with PostgreSQL's parser (libpg_query); none has been executed against
a database.

Migration content: 39 lines, additive and re-runnable — `create table if not exists
public.boq_line_change_log` (FKs → `boq` on delete cascade, `boq_line` set null,
`analysis_review_item` set null, `auth.users`), two `create index if not exists`,
`enable row level security`, and two policies created only if absent: "staff manage"
(`is_staff(auth.uid())`, all) and "owner read" (via `boq` → `projects.owner_id`).
It alters no existing table.

## 1. Backup prerequisites
Follow `docs/production-backup.md` (`scripts/prod-backup.sh`): a trusted machine,
a `pg_dump` client of the server's major version or newer, network access to the
direct host or session pooler (port 5432), a role that can read `public`,
`supabase_migrations`, `auth` and `storage`, and the connection string supplied as
`PROD_BACKUP_DB_URL` without echoing it. Run the check step, then `--run`; keep the
completed backup directory (with its `SHA256SUMS`) until section 3 passes.

## 2. Read-only preflight (read-only session: `set default_transaction_read_only = on;`)
```sql
-- 2a. Migration history around the gap
select version, name from supabase_migrations.schema_migrations
 where version between '20260900000000' and '20261099999999' order by version;
-- 2b. The table is absent (expect NULL)
select to_regclass('public.boq_line_change_log');
-- 2c. Everything the migration references exists (expect 4 non-NULL values, then non-NULL)
select to_regclass('public.boq'), to_regclass('public.boq_line'),
       to_regclass('public.analysis_review_item'), to_regclass('auth.users');
select to_regprocedure('public.is_staff(uuid)');
-- 2d. Duplicate-backstop indexes from 20260929 (expect 2 rows; if 0, see section 4)
select indexname, indexdef from pg_indexes
 where schemaname = 'public' and tablename = 'boq_line' and indexname like 'boq_line_identity_%';
```
Stop if 2b is not NULL (already applied — go to section 5) or anything in 2c is NULL.
Record the 2a and 2d results with the deployment.

## 3. Apply (authorized, after the backup)
One file, one transaction, stop on first error:
```bash
psql --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260921000000_boq_review_apply.sql
```
Connect through `PG*` environment variables (as `scripts/staging-migrate.mjs` does),
not a URL on the command line. Do **not** use `supabase db push`: `supabase/config.toml`
is pinned to production and it would also push the other pending migrations.
psql does not write migration history; a later `db push` would re-run this file
harmlessly (`if not exists` throughout).

## 4. Identity indexes (only if 2d returned 0 rows — separate decision)
Creating them fails if duplicate lines already exist. Check first (read-only, as the
database owner; returns only BOQ ids and keys, no line content):
```sql
select boq_id, external_key, scope_id, count(*) from public.boq_line
 where external_key is not null and scope_id is not null
 group by 1,2,3 having count(*) > 1;
select boq_id, external_key, count(*) from public.boq_line
 where external_key is not null and scope_id is null
 group by 1,2 having count(*) > 1;
```
Zero rows → apply `20260929000000_boq_line_identity_constraint.sql` as in section 3.
Any rows → stop; those duplicates are resolved by their owners first.

## 5. Post-apply verification
```sql
select to_regclass('public.boq_line_change_log');                                        -- not NULL
select relrowsecurity from pg_class where oid = 'public.boq_line_change_log'::regclass;  -- true
select policyname from pg_policies where tablename = 'boq_line_change_log' order by 1;   -- 2 rows
select count(*) from public.boq_line_change_log;                                         -- 0
```
App side, as a staff user: `GET /rest/v1/boq_line_change_log?select=id&limit=0` → 200.

**Functional proof (needs its own authorization):** apply one reviewed item in the
designated internal test BOQ (never a customer BOQ; its id is supplied by the operator) and confirm (a) the success toast has no
"NOT recorded" warning and (b) `boq_line_change_log` gains that item's rows (`qty`,
`unit`, `line_created`). Audit history is operational only after this passes.

Rollback (only if section 5 fails and no rows matter):
`drop table public.boq_line_change_log;`
