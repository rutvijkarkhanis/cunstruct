import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Verify — from the migration ARTIFACTS — that every confidential, project-scoped
// table enforces isolation in the database: RLS enabled, staff-managed, and
// owner access scoped through the project's owner_id. This is what stops User A
// from reading User B's project by id. (A live DB isn't available in CI, so we
// assert the policy SQL that Postgres enforces at runtime.)

const MIG_DIR = join(__dirname, "../../../supabase/migrations");
const SQL = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
  .join("\n")
  .toLowerCase();

// Confidential, project-scoped tables that MUST be owner/staff isolated.
const PROJECT_SCOPED_TABLES = [
  "projects", "project_scope", "project_document", "document_revision",
  "boq", "boq_line", "boq_document", "boq_audit_run", "boq_audit_finding",
  "ai_operation_log", "project_rooms", "forecasts", "order_items", "catalog_gaps",
];

describe("RLS — every confidential table has row level security enabled", () => {
  it.each(PROJECT_SCOPED_TABLES)("%s enables RLS", (t) => {
    // Allow the alignment whitespace some migrations use between name and clause.
    expect(new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(SQL)).toBe(true);
  });
});

describe("RLS — staff-managed and never blanket-open", () => {
  it("no confidential project table is world-readable via using (true)", () => {
    // There should be no `using (true)` policy anywhere in the schema.
    expect(SQL.includes("using (true)")).toBe(false);
  });

  it("confidential project tables are not exposed by a bare authenticated-read policy", () => {
    // `auth.role() = 'authenticated'` is only acceptable on GLOBAL catalogues
    // (product, dsr_item, dsr_coefficient, stage_master, stage_material_mapping,
    // boq_template). Assert none of the project-scoped tables use it.
    const bareRead = /create policy[^;]*on public\.([a-z_]+)[^;]*auth\.role\(\)\s*=\s*'authenticated'/g;
    const offenders = [...SQL.matchAll(bareRead)].map((m) => m[1]);
    for (const t of PROJECT_SCOPED_TABLES) {
      expect(offenders).not.toContain(t);
    }
  });
});

describe("RLS — owner access is scoped through project ownership", () => {
  // Each owner-read policy resolves back to projects.owner_id = auth.uid(),
  // directly or via a join. Assert the concrete guard exists for each chain.
  const OWNER_GUARDS: [string, RegExp][] = [
    ["projects", /auth\.uid\(\)\s*=\s*owner_id/],
    ["boq_line", /b\.id = boq_line\.boq_id and p\.owner_id = auth\.uid\(\)/],
    ["boq_audit_run", /b\.id = boq_audit_run\.boq_id and p\.owner_id = auth\.uid\(\)/],
    ["boq_audit_finding", /b\.id = boq_audit_finding\.boq_id and p\.owner_id = auth\.uid\(\)/],
    ["project_document", /p\.id = project_document\.project_id and p\.owner_id = auth\.uid\(\)/],
    ["document_revision", /d\.id = document_revision\.document_id and p\.owner_id = auth\.uid\(\)/],
    ["ai_operation_log", /p\.id = ai_operation_log\.project_id and p\.owner_id = auth\.uid\(\)/],
  ];

  it.each(OWNER_GUARDS)("%s scopes owner access to the project owner", (_t, re) => {
    expect(re.test(SQL)).toBe(true);
  });

  it("staff management is is_staff-gated across the confidential tables", () => {
    for (const t of ["boq_audit_run", "boq_audit_finding", "ai_operation_log", "project_document"]) {
      const re = new RegExp(`on public\\.${t} for all[\\s\\S]*?public\\.is_staff\\(auth\\.uid\\(\\)\\)`);
      expect(re.test(SQL)).toBe(true);
    }
  });
});
