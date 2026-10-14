#!/usr/bin/env bash
# PRODUCTION BACKUP (read-only) — Cunstruct's Supabase project.
#
#   scripts/prod-backup.sh            # default: check config/tooling/destination; contacts NOTHING
#   scripts/prod-backup.sh --run      # take the backup (read-only connection to production)
#
# Inputs (environment; the URL is a secret and is never printed or put on argv):
#   PROD_BACKUP_DB_URL  postgresql://… for THIS production project only — direct host
#                       db.<ref>.supabase.co:5432, or a *.pooler.supabase.com host with user
#                       postgres.<ref> in SESSION mode (port 5432; transaction mode 6543 is refused)
#   BACKUP_DIR          optional; default $HOME/cunstruct-backups. Must be outside any Git work tree.
#   PG_BIN              optional; directory with pg_dump/psql/pg_restore matching the server's major version
#
# Safety: refuses any URL whose project isn't the production ref in supabase/config.toml; the
# password goes only into a temporary 0600 .pgpass removed on exit; every session runs with
# default_transaction_read_only=on; any failure stops the script (set -euo pipefail).
# A dump file existing is NOT proof it restores — see docs/production-backup.md.

set -euo pipefail
umask 077

MODE="${1:-check}"
[[ "$MODE" == "check" || "$MODE" == "--run" ]] || { echo "usage: $0 [--run]" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_REF="$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"\([a-z0-9]*\)".*/\1/p' "$ROOT/supabase/config.toml" | head -1)"
[[ "$EXPECTED_REF" =~ ^[a-z0-9]{20}$ ]] || { echo "Cannot read the production project ref from supabase/config.toml." >&2; exit 1; }

BIN="${PG_BIN:+$PG_BIN/}"
for t in pg_dump psql pg_restore; do command -v "${BIN}$t" >/dev/null || { echo "$t not found${PG_BIN:+ in PG_BIN}." >&2; exit 1; }; done
command -v node >/dev/null && command -v sha256sum >/dev/null || { echo "node and sha256sum are required." >&2; exit 1; }

# ── destination: outside Git and outside the application directory ──────
# Resolved and checked BEFORE anything is created.
BACKUP_DIR="$(realpath -m "${BACKUP_DIR:-$HOME/cunstruct-backups}")"
case "$BACKUP_DIR/" in "$(cd "$ROOT" && pwd -P)/"*) echo "BACKUP_DIR is inside the application directory. Choose a location outside it." >&2; exit 1 ;; esac
EXISTING="$BACKUP_DIR"; while [[ ! -d "$EXISTING" ]]; do EXISTING="$(dirname "$EXISTING")"; done
if git -C "$EXISTING" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "BACKUP_DIR is inside a Git work tree. Choose a location outside Git." >&2; exit 1
fi
mkdir -p -m 700 "$BACKUP_DIR"

# ── target: must be exactly the production project; secret never printed ──
[[ -n "${PROD_BACKUP_DB_URL:-}" ]] || { echo "PROD_BACKUP_DB_URL is not set." >&2; exit 1; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
PGPASS_FILE="$WORK/pgpass"
CONN="$(GUARD="$ROOT/scripts/staging-guard.mjs" EXPECTED_REF="$EXPECTED_REF" PGPASS_FILE="$PGPASS_FILE" node --input-type=module -e '
  import fs from "node:fs";
  const { refsFromDbUrl } = await import(process.env.GUARD);
  const url = process.env.PROD_BACKUP_DB_URL, want = process.env.EXPECTED_REF;
  const fail = (m) => { console.error(m); process.exit(1); };
  const refs = refsFromDbUrl(url);
  if (refs.length === 0) fail("PROD_BACKUP_DB_URL is not a recognisable Supabase connection string (direct db.<ref>.supabase.co, or *.pooler.supabase.com with user postgres.<ref>).");
  if (refs.some((r) => r !== want)) fail("PROD_BACKUP_DB_URL does not point at the production project in supabase/config.toml. Refusing.");
  const u = new URL(url);
  const port = u.port || "5432";
  if (port === "6543") fail("Port 6543 is the transaction pooler, which pg_dump cannot use. Use the direct host or session pooler on 5432.");
  const db = decodeURIComponent(u.pathname.slice(1)) || "postgres", user = decodeURIComponent(u.username);
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  fs.writeFileSync(process.env.PGPASS_FILE, `${esc(u.hostname)}:${port}:${esc(db)}:${esc(user)}:${esc(decodeURIComponent(u.password))}\n`, { mode: 0o600 });
  console.log([u.hostname, port, db, user, want].join("\t"));
')" || exit 1
IFS=$'\t' read -r H P D U REF <<<"$CONN"
echo "Target verified: production project $REF (host $H, port $P, database $D, user $U)."
echo "Destination: $BACKUP_DIR"
echo "Client: $("${BIN}pg_dump" --version)"

if [[ "$MODE" == "check" ]]; then
  echo "Check only — nothing contacted. To take the backup: $0 --run"
  exit 0
fi

# ── connection: only these PG* variables; read-only sessions ──────────────
for v in $(compgen -e | grep '^PG' || true); do unset "$v"; done
export PGHOST="$H" PGPORT="$P" PGDATABASE="$D" PGUSER="$U" PGPASSFILE="$PGPASS_FILE" PGSSLMODE=require \
       PGOPTIONS="-c default_transaction_read_only=on" PGCONNECT_TIMEOUT=15
q() { "${BIN}psql" -X -v ON_ERROR_STOP=1 -At -c "$1"; }

[[ "$(q 'show transaction_read_only')" == "on" ]] || { echo "Session is not read-only. Refusing." >&2; exit 1; }
SERVER_NUM="$(q "select current_setting('server_version_num')")"
SERVER_MAJOR=$(( SERVER_NUM / 10000 ))
CLIENT_MAJOR="$("${BIN}pg_dump" --version | sed -E 's/.* ([0-9]+)\..*/\1/')"
(( CLIENT_MAJOR >= SERVER_MAJOR )) || { echo "pg_dump $CLIENT_MAJOR is older than server $SERVER_MAJOR. Set PG_BIN to a $SERVER_MAJOR+ client." >&2; exit 1; }
HAS_MIG="$(q "select count(*) from information_schema.tables where table_schema='supabase_migrations' and table_name='schema_migrations'")"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
# Written under a ".incomplete" name and renamed only after every check below
# passes, so a failed run can never be mistaken for a backup.
FINAL="$BACKUP_DIR/$STAMP-$REF"
OUT="$FINAL.incomplete"
mkdir -m 700 "$OUT"
trap 'rm -rf "$WORK"; [[ -d "$OUT" ]] && echo "FAILED — partial output left at $OUT (not a usable backup)." >&2' EXIT
echo "Writing to $OUT"

APP_SCHEMAS=(--schema=public); [[ "$HAS_MIG" == "1" ]] && APP_SCHEMAS+=(--schema=supabase_migrations)
# 1. Application schema + data (tables, constraints, indexes, functions, triggers, RLS policies, grants).
"${BIN}pg_dump" -Fc "${APP_SCHEMAS[@]}" -f "$OUT/app_schema_data.dump"
# 2. Auth and storage DATA (their DDL is managed by Supabase). Storage FILE CONTENTS are not in the DB.
"${BIN}pg_dump" -Fc --data-only --schema=auth --schema=storage -f "$OUT/auth_storage_data.dump"
# 3. Human-readable schema of the application, for inspection and diffing.
"${BIN}pg_dump" -Fp --schema-only "${APP_SCHEMAS[@]}" -f "$OUT/app_schema.sql"
# 4. Exact row counts at backup time, for restore validation.
q "select format('select %L, count(*) from %I.%I;', table_schema||'.'||table_name, table_schema, table_name)
     from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','supabase_migrations','auth','storage')
     order by 1" > "$WORK/counts.sql"
"${BIN}psql" -X -v ON_ERROR_STOP=1 -At -F $'\t' -f "$WORK/counts.sql" > "$OUT/row_counts.tsv"
[[ "$HAS_MIG" == "1" ]] && q "select version, coalesce(name,'') from supabase_migrations.schema_migrations order by version" > "$OUT/migration_history.tsv"

# ── verify: non-empty, readable archives, expected contents ───────────────
for f in app_schema_data.dump auth_storage_data.dump app_schema.sql row_counts.tsv; do
  [[ -s "$OUT/$f" ]] || { echo "Backup file $f is missing or empty." >&2; exit 1; }
done
"${BIN}pg_restore" --list "$OUT/app_schema_data.dump" > "$OUT/app_schema_data.list"
"${BIN}pg_restore" --list "$OUT/auth_storage_data.dump" > "$OUT/auth_storage_data.list"
for want in "TABLE public boq " "TABLE public boq_line " "TABLE DATA public boq_line " "TABLE DATA public projects "; do
  grep -q "$want" "$OUT/app_schema_data.list" || { echo "Archive does not contain '$want'." >&2; exit 1; }
done
[[ "$HAS_MIG" == "1" ]] && { grep -q "TABLE DATA supabase_migrations schema_migrations" "$OUT/app_schema_data.list" || { echo "Archive lacks migration history." >&2; exit 1; }; }

# ── checksums + manifest ──────────────────────────────────────────────────
( cd "$OUT" && sha256sum app_schema_data.dump auth_storage_data.dump app_schema.sql row_counts.tsv $( [[ "$HAS_MIG" == "1" ]] && echo migration_history.tsv ) > SHA256SUMS )
{
  echo "backup_utc=$STAMP"
  echo "project_ref=$REF"
  echo "server_version_num=$SERVER_NUM"
  echo "pg_dump=$("${BIN}pg_dump" --version)"
  echo "schemas_with_ddl=public$( [[ "$HAS_MIG" == "1" ]] && echo ",supabase_migrations" )"
  echo "schemas_data_only=auth,storage"
  echo "table_data_entries=$(grep -c 'TABLE DATA' "$OUT/app_schema_data.list") (app) $(grep -c 'TABLE DATA' "$OUT/auth_storage_data.list") (auth/storage)"
  echo "not_included=roles/role passwords, Supabase-managed schemas' DDL, storage file contents, edge function secrets, project settings"
} > "$OUT/MANIFEST.txt"
chmod 600 "$OUT"/*
( cd "$OUT" && sha256sum --quiet -c SHA256SUMS ) || { echo "Checksum verification failed." >&2; exit 1; }
mv "$OUT" "$FINAL"
echo
cat "$FINAL/MANIFEST.txt"
echo
cat "$FINAL/SHA256SUMS"
echo
echo "Backup written to $FINAL. It is NOT yet proven restorable — run the restore validation in docs/production-backup.md."
