// Static checks on the boq_line_dsr_mapping migration (it is not applied in
// tests): the guarantees the mapping/costing code relies on must be enforced
// by the database too, and the migration must leave boq_line untouched.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(__dirname, "../../supabase/migrations/20261003000000_boq_line_dsr_mapping.sql"), "utf8",
).toLowerCase().replace(/--.*$/gm, "");

describe("boq_line_dsr_mapping migration", () => {
  it("is additive: never alters boq_line, dsr_item or their commercial columns", () => {
    expect(SQL).not.toMatch(/alter\s+table\s+(if\s+exists\s+)?public\.(boq_line|dsr_item|boq)\b/);
    // (`drop trigger if exists` only re-creates this table's own trigger.)
    expect(SQL).not.toMatch(/\b(drop\s+(table|column|policy|index)|truncate|delete\s+from)\b/);
    expect(SQL.match(/drop trigger if exists (\w+) on public\.(\w+)/)?.slice(1)).toEqual(["boq_line_dsr_mapping_sync", "boq_line_dsr_mapping"]);
    expect(SQL).not.toMatch(/custom_rate/);
  });

  it("keys the decision by the stable line id, one per line, and references dsr_item by id", () => {
    expect(SQL).toMatch(/boq_line_id\s+uuid not null references public\.boq_line\(id\) on delete cascade/);
    expect(SQL).toMatch(/unique \(boq_line_id\)/);
    expect(SQL).toMatch(/dsr_item_id\s+uuid references public\.dsr_item\(id\) on delete set null/);
    expect(SQL).not.toMatch(/unique \([^)]*dsr_code/);
  });

  it("stores the full reference snapshot", () => {
    for (const col of ["dsr_code", "dsr_description", "dsr_unit", "dsr_rate", "dsr_source", "dsr_rate_year"]) {
      expect(SQL).toContain(col);
    }
  });

  it("enforces the status rules in the database", () => {
    expect(SQL).toMatch(/check \(status in \('mapped','needs_review','unmatched'\)\)/);
    expect(SQL).toMatch(/check \(status <> 'mapped' or dsr_code is not null\)/);
    expect(SQL).toMatch(/check \(not include_in_estimate or status = 'mapped'\)/);
  });

  it("derives boq_id from the line and applies the boq_line access model", () => {
    expect(SQL).toMatch(/select l\.boq_id into new\.boq_id from public\.boq_line l where l\.id = new\.boq_line_id/);
    expect(SQL).toMatch(/enable row level security/);
    expect(SQL).toMatch(/public\.is_staff\(auth\.uid\(\)\)/);
    expect(SQL).toMatch(/p\.owner_id = auth\.uid\(\)/);
  });
});
