# R7 + DSR correction — targeted recovery point and backup-gate override (2026-10-21)

**Status: APPROVED by the owner (verbatim approval in ../../deployment-log.md, 2026-10-21) and EXECUTED 2026-10-21T06:01–06:02Z.** Rollback files were not used.
Scope: this deployment only — migration `20260921000000_boq_review_apply.sql` and
`docs/benchmarks/e3/proposed-dsr-correction.sql`. It does not change the standing rule in
[R7 runbook §1](../../R7-PRODUCTION-MIGRATION-RUNBOOK.md) or
[audit-history-deployment.md](../../audit-history-deployment.md) for any other change.

## 1. Why an override is needed

Both documents require a full backup and name its absence as a stop condition (runbook §1
"required; stop if you cannot verify one"; procedure §"stop rules": "missing/unverified backup").
Neither route is available: the project is on the Supabase Free plan (no dashboard backups), and
`scripts/prod-backup.sh` needs a direct Postgres connection (port 5432) that this cloud environment
cannot reach, and no local machine is available to run it. Only the HTTPS Management API is
available. **What follows is a targeted recovery point, not a full database backup.**

The procedure's second stop condition ("history lists `20260921000000` while the table is
missing") also applies; see [deployment-log.md](../../deployment-log.md) 2026-10-21. The override
covers it on these terms: the migration is applied unchanged and migration history is not edited.

## 2. What will change, exactly

| Change | Statements | Touches |
|---|---|---|
| R7 | `create table if not exists public.boq_line_change_log` (+2 indexes, RLS on, 2 policies) | New objects only. Adds FKs **from** the new table to `boq`, `boq_line`, `analysis_review_item`, `auth.users`; no existing row or column is changed |
| DSR correction | 19 `UPDATE`s (each asserts exactly 1 row, matched on its current wrong value) + 1 `INSERT` of 363 rows (asserts 363), one transaction | `public.dsr_item` only. No FK references `dsr_item`; it has no triggers |

The exact 19-row diff (id, code, old → new rate/unit/description) and the 363 inserted codes are
in `dsr-correction-diff.json`. Every UPDATE predicate matches exactly one row of the snapshot;
none of the 363 codes exists today (unique key `source, rate_year, code`).

## 3. Recovery point (captured over HTTPS, before any write)

| Evidence | File | Verification |
|---|---|---|
| Full `dsr_item` (2,758 rows, all columns) | `../../benchmarks/e3/snapshots/dsr_item-before-20261021.json` (commit `b2b76df`) | SHA-256 `9dd8f87d…f205ce`; re-exported from production on 2026-10-21 just before the schema capture: identical bytes. Canonical row md5 `d04e67312c6b7fcf4ad63aa286f24edf` |
| Count + md5 of `projects`, `boq`, `boq_line`, `dsr_coefficient` | `../../benchmarks/e3/snapshots/checksums-before-20261021.json` | Re-checked: identical |
| Columns, constraints, indexes, policies, RLS, triggers of `dsr_item`, `boq`, `boq_line`, `analysis_review_item`, `projects`; `is_staff(uuid)` definition; `dsr_item` grants; full migration history (45 rows, md5 `87f16a52…313947`) | `recovery-point-schema-20261021.json` | Captured 2026-10-21T05:55:36Z, server 17.6 |
| DSR rollback | `dsr-correction-rollback.sql` | See §4 |

`SHA256SUMS` in this folder covers the three files above.

## 4. Rollback (owner decision only; never automatic)

- **R7.** Applied in one transaction with `lock_timeout = 5s`: any error rolls back completely and
  nothing changes. After a successful apply, the only undo is
  `drop table public.boq_line_change_log;` — and only while it has 0 rows (runbook §6). It leaves
  every other table as it was.
- **DSR correction.** Its own `begin … commit` with row-count assertions: any mismatch aborts with
  nothing changed. After it commits, `dsr-correction-rollback.sql` restores the 19 rows to their
  snapshot `rate/unit/description` (only if they still hold the corrected values) and deletes the
  363 inserted codes, asserting 1/363/2,758.
- **Rehearsed** on a local PostgreSQL 16 loaded from the snapshot (its canonical md5 equalled
  production's `d04e6731…`): correction file unchanged → 3,121 rows, `6.44` 59.45, `13.114` 1192.30,
  `26.74.1` 20928.70, `26.82` sqm 2293.30; rollback → md5 back to `d04e6731…` exactly; re-running
  either file aborts on its guard instead of double-applying.
- `scripts/migration-rehearsal` (PGlite, Postgres 16) with the unchanged R7 file: 17/17 passed.

## 5. Residual risk (what this does NOT cover)

- **Not a full backup.** Data in every other table, `auth` and `storage` has no restorable copy. If
  production were lost or corrupted for reasons unrelated to this change, nothing here restores it.
- Unintended changes to `projects`, `boq`, `boq_line`, `dsr_coefficient` are **detected**
  (checksums) but **not restorable** from this recovery point. Neither SQL file writes them.
- Rows written to `boq_line_change_log` after R7 are new data with no copy.
- The smoke tests write to the ZZ-TEST BOQ through the app; they are reversed with the app's
  own Undo, not from this recovery point.

## 6. Approval

The owner approves by replying, verbatim:
**"Override approved for R7 + DSR 2026-10-21: targeted recovery point instead of full backup."**
Without that, nothing in §2 runs.
