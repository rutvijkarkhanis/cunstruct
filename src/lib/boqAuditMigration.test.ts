import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Validate the audit migration ARTIFACT: additive, idempotent, non-destructive,
// mirrors the existing boq RLS pattern, and introduces no parallel taxonomy.
const SQL = readFileSync(join(__dirname, "../../supabase/migrations/20260915000000_boq_audit.sql"), "utf8");
const sql = SQL.toLowerCase();

describe("boq audit migration — additive & idempotent", () => {
  it("adds methodology/status/external_key to boq_line without altering existing columns", () => {
    expect(sql).toMatch(/alter table public\.boq_line\s+add column if not exists measurement_method text/);
    expect(sql).toContain("add column if not exists quantity_status");
    expect(sql).toContain("add column if not exists external_key");
    // It must NOT touch qty / basis (existing behaviour must be preserved).
    expect(sql).not.toMatch(/alter column\s+qty/);
    expect(sql).not.toMatch(/drop column/);
  });

  it("creates the audit run and finding tables idempotently", () => {
    expect(sql).toContain("create table if not exists public.boq_audit_run");
    expect(sql).toContain("create table if not exists public.boq_audit_finding");
  });

  it("scopes a run to a BOQ and a finding to a run + optional line", () => {
    expect(sql).toMatch(/boq_id\s+uuid not null references public\.boq\(id\)/);
    expect(sql).toMatch(/run_id\s+uuid not null references public\.boq_audit_run\(id\)/);
    // The line link is nullable so a MISSING_ITEM (no line yet) is representable.
    expect(sql).toMatch(/boq_line_id\s+uuid references public\.boq_line\(id\) on delete set null/);
  });

  it("constrains finding_type and finding state to the documented enums", () => {
    for (const t of ["missing_item", "methodology_error", "quantity_pending", "duplicate_item", "other"]) {
      expect(sql).toContain(t);
    }
    expect(sql).toMatch(/state\s+text not null default 'open' check \(state in \('open','accepted','dismissed','resolved','kept_pending'\)\)/);
  });

  it("is provider-agnostic — no vendor names baked into the schema", () => {
    expect(sql).not.toContain("chatgpt");
    expect(sql).not.toContain("openai");
  });

  it("enables RLS and mirrors the existing boq staff-manage / owner-read pattern", () => {
    expect(sql).toContain("alter table public.boq_audit_run     enable row level security");
    expect(sql).toContain("alter table public.boq_audit_finding enable row level security");
    expect(sql).toContain("boq_audit_run staff manage");
    expect(sql).toContain("boq_audit_finding owner read");
    expect(sql).toContain("public.is_staff(auth.uid())");
  });

  it("does not create a parallel scope taxonomy", () => {
    expect(sql).not.toMatch(/create table[^;]*scope_tree/);
    expect(sql).not.toMatch(/project_type_scope/);
  });
});
