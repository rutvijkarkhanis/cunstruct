// The staging guard must refuse anything it can't positively verify as a
// separate, non-production project. Fixture refs are made up; the one test that
// reads the repo's real production config never hardcodes its values.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertStaging, checkStagingTarget, parseEnv, readProduction, readStagingTarget, refFromSupabaseUrl, refsFromDbUrl,
} from "../../scripts/staging-guard.mjs";
import { listBaseMigrations, pgEnvFromUrl, psqlEnv, STAGING_MIGRATIONS } from "../../scripts/staging-migrate.mjs";

const PROD = "prodprodprodprodprod";
const STAGE = "stagestagestagestage";
const production = { refs: [PROD], publishableKey: "prod-publishable-key" };
const target = (o: Record<string, string> = {}) => ({
  projectRef: STAGE,
  supabaseUrl: `https://${STAGE}.supabase.co`,
  publishableKey: "staging-publishable-key",
  dbUrl: `postgresql://postgres:secret@db.${STAGE}.supabase.co:5432/postgres`,
  ...o,
});

describe("checkStagingTarget", () => {
  it("accepts a fully specified, different project", () => {
    expect(checkStagingTarget(target(), production, { app: true, db: true })).toEqual([]);
    expect(checkStagingTarget(target({ dbUrl: `postgresql://postgres.${STAGE}:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` }), production, { db: true })).toEqual([]);
  });

  it("refuses the production project however it is supplied", () => {
    expect(checkStagingTarget(target({ projectRef: PROD }), production).join()).toMatch(/is the PRODUCTION project/);
    expect(checkStagingTarget(target({ supabaseUrl: `https://${PROD}.supabase.co` }), production, { app: true }).join()).toMatch(/points at the PRODUCTION project/);
    expect(checkStagingTarget(target({ publishableKey: "prod-publishable-key" }), production, { app: true }).join()).toMatch(/is the PRODUCTION key/);
    expect(checkStagingTarget(target({ dbUrl: `postgresql://postgres:x@db.${PROD}.supabase.co:5432/postgres` }), production, { db: true }).join()).toMatch(/STAGING_DB_URL points at the PRODUCTION project/);
  });

  it("refuses when production can't be identified (nothing to verify against)", () => {
    expect(checkStagingTarget(target(), { refs: [] }).join()).toMatch(/Cannot identify the production project/);
  });

  it("refuses missing, malformed, unrecognisable or mismatched values instead of falling back", () => {
    expect(checkStagingTarget(target({ projectRef: "" }), production).join()).toMatch(/is not set/);
    expect(checkStagingTarget(target({ projectRef: "<staging-project-ref>" }), production).join()).toMatch(/not a valid Supabase project ref/);
    expect(checkStagingTarget(target({ supabaseUrl: "" }), production, { app: true }).join()).toMatch(/URL is not set/);
    expect(checkStagingTarget(target({ publishableKey: "" }), production, { app: true }).join()).toMatch(/publishable key is not set/);
    expect(checkStagingTarget(target({ supabaseUrl: "http://localhost:54321" }), production, { app: true }).join()).toMatch(/not a https:\/\/<ref>\.supabase\.co URL/);
    expect(checkStagingTarget(target({ supabaseUrl: "https://otherotherotherother.supabase.co" }), production, { app: true }).join()).toMatch(/doesn't match/);
    expect(checkStagingTarget(target({ dbUrl: "" }), production, { db: true }).join()).toMatch(/STAGING_DB_URL is not set/);
    expect(checkStagingTarget(target({ dbUrl: "postgresql://postgres:x@10.0.0.5:5432/postgres" }), production, { db: true }).join()).toMatch(/can't be verified/);
    expect(checkStagingTarget(target({ dbUrl: "postgresql://postgres:x@db.otherotherotherother.supabase.co:5432/postgres" }), production, { db: true }).join()).toMatch(/doesn't match/);
  });

  it("the shipped template's placeholders can never pass", () => {
    const tpl = parseEnv(fs.readFileSync(path.join(__dirname, "../../.env.staging.example"), "utf8"));
    const problems = checkStagingTarget({
      projectRef: tpl.STAGING_SUPABASE_PROJECT_REF, supabaseUrl: tpl.STAGING_SUPABASE_URL,
      publishableKey: tpl.STAGING_SUPABASE_PUBLISHABLE_KEY, dbUrl: tpl.STAGING_DB_URL,
    }, production, { app: true, db: true });
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe("database host and project are validated together", () => {
  const db = (u: string) => checkStagingTarget(target({ dbUrl: u }), production, { db: true }).join();
  const OTHER = "otherotherotherother";

  it("refuses a staging-looking user on a host that isn't Supabase's (the host decides where it connects)", () => {
    for (const host of ["10.0.0.5", "localhost", "db.example.com", `${STAGE}.supabase.co`, "pooler.supabase.com.evil.example"]) {
      expect(db(`postgresql://postgres.${STAGE}:pw@${host}:5432/postgres`)).toMatch(/can't be verified/);
    }
  });

  it("refuses a direct host of another project even when the user carries the staging ref", () => {
    expect(db(`postgresql://postgres.${STAGE}:pw@db.${OTHER}.supabase.co:5432/postgres`)).toMatch(/doesn't match/);
    expect(db(`postgresql://postgres.${PROD}:pw@db.${STAGE}.supabase.co:5432/postgres`)).toMatch(/PRODUCTION/);
  });

  it("refuses a pooler host without a project-scoped user", () => {
    expect(db("postgresql://postgres:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")).toMatch(/can't be verified/);
  });

  it("accepts the supported shapes for the staging project", () => {
    expect(db(`postgresql://postgres:pw@db.${STAGE}.supabase.co:5432/postgres`)).toBe("");
    expect(db(`postgresql://postgres.${STAGE}:pw@db.${STAGE}.supabase.co:5432/postgres`)).toBe("");
    expect(db(`postgresql://postgres.${STAGE}:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`)).toBe("");
    expect(db(`postgres://postgres.${STAGE}:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`)).toBe("");
  });
});

describe("URL parsing", () => {
  it("extracts refs from Supabase URLs and connection strings only", () => {
    expect(refFromSupabaseUrl(`https://${STAGE}.supabase.co`)).toBe(STAGE);
    expect(refFromSupabaseUrl("https://example.com")).toBeNull();
    expect(refsFromDbUrl(`postgres://postgres:p@db.${STAGE}.supabase.co:5432/postgres`)).toEqual([STAGE]);
    expect(refsFromDbUrl(`postgresql://postgres.${STAGE}:p@aws-0-eu.pooler.supabase.com:6543/postgres`)).toEqual([STAGE]);
    expect(refsFromDbUrl(`postgresql://postgres.${STAGE}:p@10.0.0.5:5432/postgres`)).toEqual([]);
    expect(refsFromDbUrl(`https://db.${STAGE}.supabase.co`)).toEqual([]);
    expect(refsFromDbUrl("not a url")).toEqual([]);
  });
});

describe("the repo's own production config", () => {
  it("is recognised, so its ref is always refused as a staging target", () => {
    const root = path.join(__dirname, "../..");
    const prod = readProduction(root);
    expect(prod.refs.length).toBeGreaterThan(0);
    for (const ref of prod.refs) {
      expect(checkStagingTarget({ projectRef: ref }, prod).join()).toMatch(/is the PRODUCTION project/);
    }
  });
});

describe("reading the staging target", () => {
  const dirs: string[] = [];
  afterEach(() => { dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });
  const fixture = (files: Record<string, string>) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "staging-guard-"));
    dirs.push(d);
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
      fs.writeFileSync(path.join(d, f), text);
    }
    return d;
  };

  it("never falls back to the production .env for staging values", () => {
    const root = fixture({
      "supabase/config.toml": `project_id = "${PROD}"\n`,
      ".env": `VITE_SUPABASE_PROJECT_ID="${PROD}"\nVITE_SUPABASE_URL="https://${PROD}.supabase.co"\nVITE_SUPABASE_PUBLISHABLE_KEY="prod-publishable-key"\n`,
    });
    expect(readStagingTarget(root, {})).toEqual({ projectRef: "", supabaseUrl: "", publishableKey: "", dbUrl: "" });
    expect(() => assertStaging(root, { app: true }, {})).toThrow(/STAGING_SUPABASE_PROJECT_REF is not set/);
  });

  it("reads .env.staging.local, lets the environment override it, and verifies", () => {
    const root = fixture({
      "supabase/config.toml": `project_id = "${PROD}"\n`,
      ".env.staging.local": `STAGING_SUPABASE_PROJECT_REF=${STAGE}\nSTAGING_SUPABASE_URL=https://${STAGE}.supabase.co\nSTAGING_SUPABASE_PUBLISHABLE_KEY=staging-key\n`,
    });
    expect(assertStaging(root, { app: true }, {}).ref).toBe(STAGE);
    expect(() => assertStaging(root, { app: true }, { STAGING_SUPABASE_PROJECT_REF: PROD })).toThrow(/is the PRODUCTION project/);
  });

  it("refuses when the repo has no production identifiers to compare against", () => {
    const root = fixture({ ".env.staging.local": `STAGING_SUPABASE_PROJECT_REF=${STAGE}\n` });
    expect(() => assertStaging(root, {}, {})).toThrow(/Cannot identify the production project/);
  });
});

describe("staging-migrate", () => {
  it("applies exactly the four Stage 3–6 migrations, in dependency order, and they exist", () => {
    expect(STAGING_MIGRATIONS).toEqual([
      "20261003000000_boq_line_dsr_mapping.sql",
      "20261004000000_boq_line_rate_evidence.sql",
      "20261005000000_boq_line_rate_adoption.sql",
      "20261006000000_boq_commercial_revision.sql",
    ]);
    for (const f of STAGING_MIGRATIONS) expect(fs.existsSync(path.join(__dirname, "../../supabase/deferred-migrations", f))).toBe(true);
  });

  it("--base lists every supabase/migrations file in version order, and none of the deferred ones", () => {
    const base = listBaseMigrations(path.join(__dirname, "../.."));
    expect(base).toEqual([...base].sort());
    expect(base).toContain("20260921000000_boq_review_apply.sql");
    expect(base).toContain("20260929000000_boq_line_identity_constraint.sql");
    expect(base.length).toBe(fs.readdirSync(path.join(__dirname, "../../supabase/migrations")).filter((f) => f.endsWith(".sql")).length);
    for (const f of STAGING_MIGRATIONS) expect(base).not.toContain(f);
  });

  it("never lets the URL weaken SSL below 'require' (keeps stricter modes)", () => {
    const mode = (q: string) => pgEnvFromUrl(`postgresql://postgres:pw@db.${STAGE}.supabase.co:5432/postgres${q}`).PGSSLMODE;
    expect(mode("?sslmode=disable")).toBe("require");
    expect(mode("?sslmode=allow")).toBe("require");
    expect(mode("?sslmode=prefer")).toBe("require");
    expect(mode("")).toBe("require");
    expect(mode("?sslmode=verify-full")).toBe("verify-full");
  });

  it("psql gets no inherited PG* variable that could redirect the connection — only the verified target's", () => {
    const env = psqlEnv({
      PATH: "/usr/bin", HOME: "/home/u",
      PGSERVICE: "prod", PGSERVICEFILE: "/etc/pg_service.conf", PGHOSTADDR: "203.0.113.9", PGOPTIONS: "-c x=y",
      PGHOST: "db.prod.example", PGPASSFILE: "/home/u/.pgpass", pgsslrootcert: "/x",
    }, `postgresql://postgres:pw@db.${STAGE}.supabase.co:5432/postgres`);
    expect(Object.keys(env).filter((k) => /^PG/i.test(k)).sort()).toEqual(["PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGSSLMODE", "PGUSER"]);
    expect(env).toMatchObject({ PATH: "/usr/bin", HOME: "/home/u", PGHOST: `db.${STAGE}.supabase.co` });
  });

  it("passes the connection through PG* variables (password off the command line), SSL required by default", () => {
    expect(pgEnvFromUrl(`postgresql://postgres.${STAGE}:p%40ss@aws-0-eu.pooler.supabase.com:6543/postgres`)).toEqual({
      PGHOST: "aws-0-eu.pooler.supabase.com", PGPORT: "6543", PGUSER: `postgres.${STAGE}`, PGPASSWORD: "p@ss", PGDATABASE: "postgres", PGSSLMODE: "require",
    });
  });
});
