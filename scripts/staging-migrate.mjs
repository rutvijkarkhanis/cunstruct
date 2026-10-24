// STAGING MIGRATIONS — applies migrations to the verified STAGING project only,
// in order, one transaction per file, stopping at the first error.
//
//   node scripts/staging-migrate.mjs                         # dry run: verify target, list plan
//   node scripts/staging-migrate.mjs --apply --confirm-ref=<staging ref>
//   node scripts/staging-migrate.mjs --base [--apply --confirm-ref=<staging ref>]
//
// Default: the Stage 3–6 migrations in supabase/deferred-migrations/.
// --base: every file in supabase/migrations/ (the base schema), for a NEW,
// empty staging project only — refused if public.boq already exists, because
// not every base file is re-runnable. Run --base first, then the default set.
//
// Refuses unless scripts/staging-guard.mjs verifies the target is a different
// project from production. --apply additionally requires --confirm-ref to
// repeat the staging ref exactly. Uses `psql`; the connection string is passed
// through PG* environment variables, never printed or put on the command line.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStaging } from "./staging-guard.mjs";

export const STAGING_MIGRATIONS = [
  "20261003000000_boq_line_dsr_mapping.sql",
  "20261004000000_boq_line_rate_evidence.sql",
  "20261005000000_boq_line_rate_adoption.sql",
  "20261006000000_boq_commercial_revision.sql",
  // Follow-ups to 20261006 — strictly in this order (re-applying 07 after 08 drops 08's checks).
  "20261007000000_boq_commercial_revision_provenance.sql",
  "20261008000000_boq_commercial_revision_line_identity.sql",
];

/** The base-schema migrations in supabase/migrations/, in version order. */
export function listBaseMigrations(root) {
  const dir = path.join(root, "supabase", "migrations");
  return fs.readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
}

/** libpq environment for a postgres:// URL (keeps the password off argv). */
export function pgEnvFromUrl(dbUrl) {
  const u = new URL(dbUrl);
  const env = {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
  };
  // Never weaker than "require": disable/allow/prefer could send the password
  // unencrypted. Stricter modes from the URL are kept.
  const ssl = u.searchParams.get("sslmode");
  env.PGSSLMODE = ssl === "verify-ca" || ssl === "verify-full" ? ssl : "require";
  return env;
}

/**
 * The environment psql runs with: the caller's environment WITHOUT any
 * inherited PG* variable (PGSERVICE, PGSERVICEFILE, PGHOSTADDR, PGOPTIONS …
 * could redirect or alter the connection), plus only the verified target's.
 */
export function psqlEnv(baseEnv, dbUrl) {
  const clean = Object.fromEntries(Object.entries(baseEnv).filter(([k]) => !/^PG/i.test(k)));
  return { ...clean, ...pgEnvFromUrl(dbUrl) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const confirm = args.find((a) => a.startsWith("--confirm-ref="))?.split("=")[1] ?? "";
  const base = args.includes("--base");

  let verified;
  try {
    verified = assertStaging(root, { db: true });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const names = base ? listBaseMigrations(root) : STAGING_MIGRATIONS;
  const files = names.map((f) => path.join(root, "supabase", base ? "migrations" : "deferred-migrations", f));
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    console.error(`Missing migration file(s):\n  - ${missing.map((f) => path.basename(f)).join("\n  - ")}`);
    process.exit(1);
  }

  console.log(`Staging target verified: ${verified.ref} (not production).`);
  console.log(`${base ? "Base-schema" : "Stage 3–6"} migrations, in order:`);
  names.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

  if (!apply) {
    console.log("\nDry run — nothing applied. To apply to staging:\n" +
      `  node scripts/staging-migrate.mjs${base ? " --base" : ""} --apply --confirm-ref=${verified.ref}`);
    process.exit(0);
  }
  if (confirm !== verified.ref) {
    console.error("\n--apply needs --confirm-ref=<the staging project ref> repeated exactly. Nothing applied.");
    process.exit(1);
  }
  const psql = spawnSync("psql", ["--version"], { encoding: "utf8" });
  if (psql.status !== 0) {
    console.error("psql is not available. Nothing applied.");
    process.exit(1);
  }

  const env = psqlEnv(process.env, verified.target.dbUrl);
  if (base) {
    const probe = spawnSync("psql", ["-X", "-tA", "-c", "select to_regclass('public.boq') is not null"], { env, encoding: "utf8" });
    if (probe.status !== 0 || probe.stdout.trim() !== "f") {
      console.error("\n--base is only for a new, empty staging project: public.boq already exists (or the check failed). Nothing applied.");
      process.exit(1);
    }
  }
  for (const file of files) {
    console.log(`\nApplying ${path.basename(file)} …`);
    const r = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-X", "-q", "-f", file], { env, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`\nFAILED on ${path.basename(file)} — that file was rolled back; later files were NOT run. Stop and investigate.`);
      process.exit(r.status ?? 1);
    }
    console.log(`  ✓ ${path.basename(file)}`);
  }
  console.log(base
    ? `\nAll ${files.length} base migrations applied to staging. Next: the Stage 3–6 set (run without --base), if needed.`
    : `\nAll ${files.length} Stage 3–6 migrations applied to staging. Next: the post-apply checks in docs/staging-validation-stage3-6.md.`);
}
