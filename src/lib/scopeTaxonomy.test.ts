import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Phase A validates the migration ARTIFACT itself — schema, seeds, uniqueness,
// idempotency, extensibility and that it is additive/non-destructive.
const SQL = readFileSync(join(__dirname, "../../supabase/migrations/20260910000000_scope_taxonomy.sql"), "utf8");
const sql = SQL.toLowerCase();

// Pull the VALUES rows out of one `insert into public.<table> ( ... ) values <rows> on conflict`.
function insertRows(table: string): string[] {
  const re = new RegExp(`insert into public\\.${table}\\s*\\([^)]*\\)\\s*values([\\s\\S]*?)on conflict`, "i");
  const m = re.exec(SQL);
  if (!m) return [];
  return [...m[1].matchAll(/\(([^()]*)\)/g)].map((r) => r[1].trim());
}
const cell = (row: string, i: number) => {
  const parts = row.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  return parts[i];
};

const EXPECTED_MODULES = [
  "civil_structural", "architectural", "electrical", "plumbing", "hvac", "fire_fighting",
  "fire_alarm", "elv_data_it", "interior_joinery", "finishes", "external_works", "landscape",
  "specialist_systems", "equipment_ffe",
];

describe("scope taxonomy migration — schema", () => {
  it("creates both catalog tables idempotently", () => {
    expect(sql).toContain("create table if not exists public.scope_module");
    expect(sql).toContain("create table if not exists public.scope_module_suggestion");
  });
  it("scope_module has a unique key, a name, and an active flag (soft-retire)", () => {
    expect(sql).toMatch(/key\s+text\s+not null\s+unique/);
    expect(sql).toMatch(/active\s+boolean\s+not null\s+default\s+true/);
  });
  it("suggestions reference a module and are unique per (project_type, module_key)", () => {
    expect(sql).toMatch(/module_key\s+text\s+not null\s+references public\.scope_module\(key\)/);
    expect(sql).toContain("unique (project_type, module_key)");
  });
});

describe("scope taxonomy migration — module seeds", () => {
  const rows = insertRows("scope_module");
  const keys = rows.map((r) => cell(r, 0));
  it("seeds exactly the proposed catalogue", () => {
    expect(keys.sort()).toEqual([...EXPECTED_MODULES].sort());
  });
  it("module keys are unique (no duplicates)", () => {
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("every module has a human name", () => {
    expect(rows.every((r) => (cell(r, 1) ?? "").length > 0)).toBe(true);
  });
});

describe("scope taxonomy migration — suggestion seeds", () => {
  const rows = insertRows("scope_module_suggestion");
  const pairs = rows.map((r) => `${cell(r, 0)}::${cell(r, 1)}`);
  it("every suggested module_key references a real module in the catalogue", () => {
    const bad = rows.map((r) => cell(r, 1)).filter((k) => !EXPECTED_MODULES.includes(k));
    expect(bad).toEqual([]);
  });
  it("suggestions are unique per (project_type, module_key)", () => {
    expect(new Set(pairs).size).toBe(pairs.length);
  });
  it("seeds suggestions for the common project types (each a superset hint, never applicability)", () => {
    const types = new Set(rows.map((r) => cell(r, 0)));
    for (const t of ["Residential", "Office", "Commercial", "Retail", "Hospitality", "Healthcare", "Institutional", "Industrial", "Warehouse", "Infrastructure/External"]) {
      expect(types.has(t)).toBe(true);
    }
  });
});

describe("scope taxonomy migration — idempotency & non-destructiveness", () => {
  it("seeds use ON CONFLICT DO NOTHING so re-running never duplicates", () => {
    expect((sql.match(/on conflict[\s\S]*?do nothing/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("tables and index are guarded with IF NOT EXISTS", () => {
    expect(sql).toContain("create index if not exists scope_module_suggestion_type_idx");
  });
  it("RLS policies are guarded against re-creation via pg_policies", () => {
    expect((sql.match(/if not exists \(select 1 from pg_policies/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("is additive only — never drops, deletes, truncates or updates", () => {
    expect(sql).not.toMatch(/drop table|drop column|delete from|truncate|update\s+public\./);
  });
  it("touches no existing entity (no alter of boq/boq_line/project_scope/documents/projects)", () => {
    expect(sql).not.toMatch(/alter table public\.(boq|boq_line|project_scope|project_document|document_revision|boq_document|projects)\b/);
  });
});

describe("scope taxonomy migration — RLS follows the project/BOQ pattern", () => {
  it("enables RLS on both catalogs", () => {
    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toContain("alter table public.scope_module enable row level security");
    expect(flat).toContain("alter table public.scope_module_suggestion enable row level security");
  });
  it("staff manage + authenticated read on each catalog", () => {
    expect(sql).toContain("scope_module staff manage");
    expect(sql).toContain("scope_module read");
    expect(sql).toContain("scope_module_suggestion staff manage");
    expect(sql).toContain("scope_module_suggestion read");
    expect(sql).toContain("public.is_staff(auth.uid())");
  });
});

describe("scope taxonomy migration — extensibility (no code change needed)", () => {
  it("module keys and project types are free text (no enum/CHECK constraining them)", () => {
    // Extensibility guarantee: adding a module = INSERT a row; a new project type =
    // a new project_type string. There must be no enum/CHECK pinning either.
    expect(sql).not.toMatch(/key\s+text[^,]*check\s*\(/);
    expect(sql).not.toMatch(/project_type\s+text[^,]*check\s*\(/);
    expect(sql).not.toMatch(/create type .*scope_module/);
  });
  it("does not create project_module or boq_module tables (Phase B/C, not now)", () => {
    // Only guard against actually creating them; the header comment may name them.
    expect(sql).not.toMatch(/create table[\s\S]*?public\.(project_module|boq_module)\b/);
  });
});
