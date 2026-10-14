// Static checks on the rate-evidence migration (not applied in tests).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(__dirname, "../../supabase/migrations/20261004000000_boq_line_rate_evidence.sql"), "utf8",
).toLowerCase().replace(/--.*$/gm, "");

describe("boq_line_rate_evidence migration", () => {
  it("is additive and never touches boq_line, the DSR mapping, or commercial rate columns", () => {
    expect(SQL).not.toMatch(/alter\s+table\s+(if\s+exists\s+)?public\.(boq_line|boq|dsr_item|boq_line_dsr_mapping)\b/);
    expect(SQL).not.toMatch(/\b(drop\s+(table|column|policy|index)|truncate|delete\s+from)\b/);
    expect(SQL).not.toMatch(/custom_rate|dsr_rate/);
  });

  it("keeps quotation values honest: unavailable carries no rate, zero allowed, negatives rejected, dates ordered", () => {
    expect(SQL).toMatch(/check \(status <> 'unavailable' or quoted_rate is null\)/);
    expect(SQL).toMatch(/quoted_rate\s+numeric check \(quoted_rate is null or quoted_rate >= 0\)/);
    expect(SQL).toMatch(/check \(valid_until is null or quotation_date is null or valid_until >= quotation_date\)/);
    for (const col of ["tax_treatment", "freight", "installation"]) {
      expect(SQL).toMatch(new RegExp(`${col}\\s+text not null default 'not_stated'`));
    }
  });

  it("links quotation sources to the existing project_document store", () => {
    expect(SQL).toMatch(/source_document_id\s+uuid references public\.project_document\(id\) on delete set null/);
  });

  it("stores one rate review per line with a snapshotted preferred candidate that names its source", () => {
    expect(SQL).toMatch(/unique \(boq_line_id\)/);
    for (const col of ["preferred_rate", "preferred_unit", "preferred_source_label", "preferred_rate_date"]) expect(SQL).toContain(col);
    expect(SQL).toMatch(/check \(preferred_kind is null or preferred_source_label is not null\)/);
    expect(SQL).toMatch(/check \(preferred_boq_line_id is null or preferred_boq_line_id <> boq_line_id\)/);
  });

  it("derives boq_id from the line and applies the boq_line access model to both tables", () => {
    expect(SQL).toMatch(/select l\.boq_id into new\.boq_id from public\.boq_line l where l\.id = new\.boq_line_id/);
    expect(SQL).toMatch(/alter table public\.vendor_quotation enable row level security/);
    expect(SQL).toMatch(/alter table public\.boq_line_rate_review enable row level security/);
    expect(SQL).toMatch(/public\.is_staff\(auth\.uid\(\)\)/);
    expect(SQL).toMatch(/p\.owner_id = auth\.uid\(\)/);
  });
});
