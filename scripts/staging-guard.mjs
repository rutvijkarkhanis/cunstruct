// STAGING GUARD — refuses any staging operation whose target is missing, is the
// production project, or can't be positively verified as a different project.
//
// Used by:
//   • vite.config.ts in `--mode staging` (npm run dev:staging / build:staging)
//   • scripts/staging-migrate.mjs (before listing or applying migrations)
//   • `npm run staging:check` (this file as a CLI)
//
// Production is identified from files already in the repo — supabase/config.toml
// (`project_id`) and the committed `.env` (VITE_SUPABASE_PROJECT_ID / URL). If
// neither can be read, nothing can be verified and every check fails.
//
// Staging values come from the process environment or `.env.staging.local`
// (git-ignored; see `.env.staging.example`). Secret values are never printed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_ENV_FILE = ".env.staging.local";
const REF_RE = /^[a-z0-9]{20}$/;

/** Minimal dotenv parser: KEY=value lines, optional quotes, # comments. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const readIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/** `<ref>` from https://<ref>.supabase.co, else null. */
export function refFromSupabaseUrl(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Project ref(s) a Postgres connection string points at. Only two shapes are
 * recognised, because only for these does the HOST determine the project:
 *   • direct:  db.<ref>.supabase.co            (the host's ref; a user ref, if any, too)
 *   • pooler:  <region>.pooler.supabase.com with user <role>.<ref>
 *              (Supavisor routes by the user's ref)
 * Any other host — IP, localhost, custom domain — returns [] (unverifiable),
 * whatever the username says.
 */
export function refsFromDbUrl(dbUrl) {
  try {
    const u = new URL(dbUrl);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return [];
    const userRef = decodeURIComponent(u.username).match(/^[a-z_]+\.([a-z0-9]{20})$/)?.[1] ?? null;
    const direct = u.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.(co|in)$/);
    if (direct) return [...new Set([direct[1], ...(userRef ? [userRef] : [])])];
    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) && userRef) return [userRef];
    return [];
  } catch {
    return [];
  }
}

/** The production project ref(s) and publishable key, from files in the repo. */
export function readProduction(root) {
  const refs = new Set();
  const toml = readIfExists(path.join(root, "supabase", "config.toml"));
  const tomlRef = toml?.match(/^\s*project_id\s*=\s*"([a-z0-9]+)"/m)?.[1];
  if (tomlRef) refs.add(tomlRef);
  const envText = readIfExists(path.join(root, ".env"));
  const env = envText ? parseEnv(envText) : {};
  if (env.VITE_SUPABASE_PROJECT_ID) refs.add(env.VITE_SUPABASE_PROJECT_ID);
  const urlRef = env.VITE_SUPABASE_URL ? refFromSupabaseUrl(env.VITE_SUPABASE_URL) : null;
  if (urlRef) refs.add(urlRef);
  return { refs: [...refs], publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY || null };
}

/**
 * Every reason this staging target must NOT be used ([] = verified).
 * target: { projectRef, supabaseUrl?, publishableKey?, dbUrl? }
 * need:   { app?: boolean, db?: boolean } — which values are required.
 */
export function checkStagingTarget(target, production, need = {}) {
  const problems = [];
  const prodRefs = production.refs ?? [];
  const ref = (target.projectRef ?? "").trim();

  if (prodRefs.length === 0) {
    problems.push("Cannot identify the production project (no supabase/config.toml project_id or .env project), so staging can't be verified as different.");
  }
  if (!ref) problems.push("STAGING_SUPABASE_PROJECT_REF is not set.");
  else if (!REF_RE.test(ref)) problems.push("STAGING_SUPABASE_PROJECT_REF is not a valid Supabase project ref (20 lowercase letters/digits).");
  else if (prodRefs.includes(ref)) problems.push(`STAGING_SUPABASE_PROJECT_REF is the PRODUCTION project (${ref}).`);

  if (need.app) {
    if (!target.supabaseUrl) problems.push("The staging Supabase URL is not set.");
    else {
      const urlRef = refFromSupabaseUrl(target.supabaseUrl);
      if (!urlRef) problems.push("The staging Supabase URL is not a https://<ref>.supabase.co URL.");
      else if (prodRefs.includes(urlRef)) problems.push(`The staging Supabase URL points at the PRODUCTION project (${urlRef}).`);
      else if (ref && urlRef !== ref) problems.push("The staging Supabase URL's project doesn't match STAGING_SUPABASE_PROJECT_REF.");
    }
    if (!target.publishableKey) problems.push("The staging publishable key is not set.");
    else if (production.publishableKey && target.publishableKey === production.publishableKey) {
      problems.push("The staging publishable key is the PRODUCTION key.");
    }
  }

  if (need.db) {
    if (!target.dbUrl) problems.push("STAGING_DB_URL is not set.");
    else {
      const dbRefs = refsFromDbUrl(target.dbUrl);
      if (dbRefs.length === 0) problems.push("STAGING_DB_URL is not a recognisable Supabase Postgres connection string (host db.<ref>.supabase.co, or a *.pooler.supabase.com host with user postgres.<ref>), so its project can't be verified.");
      else if (dbRefs.some((r) => prodRefs.includes(r))) problems.push("STAGING_DB_URL points at the PRODUCTION project.");
      // EVERY ref in the URL (host and user) must be the staging ref.
      else if (ref && dbRefs.some((r) => r !== ref)) problems.push("STAGING_DB_URL's project doesn't match STAGING_SUPABASE_PROJECT_REF.");
    }
  }
  return problems;
}

/** Staging values from the environment, falling back to `.env.staging.local`. */
export function readStagingTarget(root, env = process.env) {
  const fileText = readIfExists(path.join(root, STAGING_ENV_FILE));
  const file = fileText ? parseEnv(fileText) : {};
  const pick = (k) => env[k] || file[k] || "";
  return {
    projectRef: pick("STAGING_SUPABASE_PROJECT_REF"),
    supabaseUrl: pick("STAGING_SUPABASE_URL"),
    publishableKey: pick("STAGING_SUPABASE_PUBLISHABLE_KEY"),
    dbUrl: pick("STAGING_DB_URL"),
  };
}

/** Throws with every problem listed, or returns the verified staging ref. */
export function assertStaging(root, need, env = process.env) {
  const target = readStagingTarget(root, env);
  const problems = checkStagingTarget(target, readProduction(root), need);
  if (problems.length) {
    const err = new Error(`Refusing to use the staging target:\n  - ${problems.join("\n  - ")}\nSee docs/staging-validation-stage3-6.md.`);
    err.problems = problems;
    throw err;
  }
  return { ref: target.projectRef, target };
}

// ── CLI: node scripts/staging-guard.mjs [--app] [--db] ───────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const args = new Set(process.argv.slice(2));
  const need = { app: args.has("--app"), db: args.has("--db") };
  try {
    const { ref } = assertStaging(root, need);
    console.log(`Staging target verified: ${ref} (not production)${need.app ? " · app config OK" : ""}${need.db ? " · database URL OK" : ""}.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
