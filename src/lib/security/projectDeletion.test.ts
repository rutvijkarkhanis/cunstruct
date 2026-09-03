import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_CASCADE_TABLES } from "./projectDeletion";

// Project deletion is project-scoped BECAUSE the schema cascades from the project
// row. Assert (from the migration artifacts) that each table we claim cascades
// actually declares `on delete cascade` back to the project chain — so deleting a
// project removes ITS data and nothing belonging to another project.

const MIG_DIR = join(__dirname, "../../../supabase/migrations");
const SQL = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
  .join("\n")
  .toLowerCase();

describe("project deletion cascade integrity", () => {
  it("every directly project-owned table cascades from projects(id)", () => {
    // These reference projects(id) directly and must cascade.
    for (const t of ["project_scope", "project_document", "project_rooms", "boq", "forecasts", "catalog_gaps", "ai_operation_log"]) {
      const re = new RegExp(`create table (if not exists )?public\\.${t}[\\s\\S]*?references public\\.projects\\(id\\) on delete cascade`);
      expect(re.test(SQL)).toBe(true);
    }
  });

  it("BOQ children cascade so a project delete reaches them transitively", () => {
    // boq_line, boq_audit_run, boq_document → boq(id) cascade; findings → run cascade.
    expect(/references public\.boq\(id\) on delete cascade/.test(SQL)).toBe(true);
    expect(/references public\.boq_audit_run\(id\) on delete cascade/.test(SQL)).toBe(true);
    expect(/references public\.project_document\(id\) on delete cascade/.test(SQL)).toBe(true);
  });

  it("the documented cascade list stays in sync with what actually cascades", () => {
    // Guard against the helper's doc drifting from the schema.
    for (const t of PROJECT_CASCADE_TABLES) {
      expect(SQL).toContain(`public.${t}`);
    }
  });
});
