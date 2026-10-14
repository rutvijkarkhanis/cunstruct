# Production backup — before applying the Stage 3–6 migrations

Script: `scripts/prod-backup.sh`. **Prepared, not yet run.** It is read-only:
every session runs with `default_transaction_read_only=on`, and `pg_dump` only
reads. It refuses any connection string that isn't the production project in
`supabase/config.toml`.

## Prerequisites

1. **Where to run it.** Prefer a trusted machine you control. If you run it in
   an ephemeral cloud session, the backup disappears with the container unless
   you copy it off (step 5).
2. **Client version.** `pg_dump` must be the **same or newer major version** as
   the server (the script checks and stops otherwise). This environment has
   16.15; if production is Postgres 17, point `PG_BIN` at a 17 client — e.g.
   install `postgresql-client-17`, or use the `postgres:17` Docker image's
   binaries.
3. **Network access** to the database host (`db.<ref>.supabase.co`, or the
   project's `*.pooler.supabase.com` session pooler).
4. **A connection string** for a role that can read `public`,
   `supabase_migrations`, `auth` and `storage`. The project's `postgres` role
   can; a narrower read-only role must be granted `SELECT` on those schemas or
   the script stops at the first failing dump. Use the **direct host** or the
   **session pooler on port 5432** — the transaction pooler (6543) is refused.
5. Provide it without putting it in shell history or chat — either as an
   environment secret named `PROD_BACKUP_DB_URL`, or interactively:

   ```bash
   read -rs PROD_BACKUP_DB_URL && export PROD_BACKUP_DB_URL
   ```

## Run

```bash
export BACKUP_DIR="$HOME/cunstruct-backups"      # outside the repo and outside Git
scripts/prod-backup.sh                            # 1. check only: verifies target, tools, destination; contacts nothing
scripts/prod-backup.sh --run                      # 2. the backup (read-only)
```

The check step prints the verified project ref, host, port, database and user
(never the password). `--run` then:

- confirms the session is read-only and the client is new enough;
- writes `$BACKUP_DIR/<UTC timestamp>-<ref>/` (mode 700, files 600):

  | File | Contents |
  |------|----------|
  | `app_schema_data.dump` | `public` (+ `supabase_migrations`): tables, data, constraints, indexes, functions, triggers, RLS policies, grants — custom format |
  | `auth_storage_data.dump` | `auth` and `storage` **data only** (their DDL is managed by Supabase) |
  | `app_schema.sql` | readable schema of the same application schemas |
  | `row_counts.tsv` | exact row count per table at backup time |
  | `migration_history.tsv` | `supabase_migrations.schema_migrations`, if present |
  | `*.list` | `pg_restore --list` of each archive (proves it can be read) |
  | `SHA256SUMS`, `MANIFEST.txt` | checksums; timestamp, ref, server/client versions, what is and isn't included |

- writes into `<timestamp>-<ref>.incomplete/` and renames it only after every
  check passes, so a failed run is never mistaken for a backup;
- stops on the first error (`set -euo pipefail`), and fails if any file is
  empty or an archive lacks `boq`, `boq_line`, `projects` data or (when
  present) the migration history.

The connection string is never printed or passed on a command line: the
password goes only into a temporary `0600` `.pgpass` file deleted on exit, and
inherited `PG*` variables are cleared first.

## Protect and keep it

```bash
cd "$BACKUP_DIR/<timestamp>-<ref>" && sha256sum -c SHA256SUMS
tar -C "$BACKUP_DIR" -cf - "<timestamp>-<ref>" | gpg --symmetric --cipher-algo AES256 -o "<timestamp>-<ref>.tar.gpg"
```

Keep the encrypted file somewhere outside Git and outside the application
directory (e.g. an encrypted drive or private cloud storage). It contains user
emails and auth data — treat it as a secret.

## Restore validation (never against production)

A dump that exists is not proof it restores. Validate it in a disposable
database:

1. Start a disposable **local Supabase stack** (it provides the `auth` and
   `storage` schemas the application references), in an empty temporary folder —
   **not** this repo, whose `supabase/config.toml` points at production:

   ```bash
   mkdir /tmp/cunstruct-restore && cd /tmp/cunstruct-restore
   npx supabase init && npx supabase start        # Docker required; local DB on 127.0.0.1:54322
   export PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres
   ```
2. Restore auth/storage data first (application tables reference `auth.users`),
   then the application schema and data, stopping on any error:

   ```bash
   pg_restore --data-only --disable-triggers --no-owner --exit-on-error -d postgres auth_storage_data.dump
   pg_restore --no-owner --exit-on-error -d postgres app_schema_data.dump
   ```
3. Compare exact row counts with `row_counts.tsv`, and spot-check a BOQ.
4. `npx supabase stop --no-backup` and delete the folder.

If the local stack's `auth` schema version differs from production's, step 2
can fail on column differences — that is a validation finding to resolve (match
the CLI/stack version), not something to bypass.

## Limitations

- **Not included:** database roles and role passwords (`pg_dumpall` needs a
  superuser, which Supabase doesn't provide); DDL of Supabase-managed schemas
  (`auth`, `storage`, `extensions`, `realtime`, `vault`, …); **Storage file
  contents** — uploaded drawings and documents live in object storage, not the
  database, so they need a separate download; Edge Function secrets (e.g.
  `OPENAI_API_KEY`), Auth provider/SMTP settings and other project settings.
- **Free Plan:** managed daily backups and point-in-time recovery aren't
  available to restore from on the Free plan (confirm under Database → Backups
  in the dashboard). For this one-off migration the manual dump above is the
  backup of record; no upgrade is required for it.
