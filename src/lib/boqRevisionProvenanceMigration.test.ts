// Static checks on the deferred revision-provenance migration (not applied in
// tests). Its behaviour was also exercised in real Postgres (PGlite) — see
// docs/MAJOR-MILESTONE-RESULT.md; that harness is not part of this suite.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAW = readFileSync(join(__dirname, "../../supabase/deferred-migrations/20261007000000_boq_commercial_revision_provenance.sql"), "utf8");
const SQL = RAW.toLowerCase().replace(/--.*$/gm, "");
const PARENT = readFileSync(join(__dirname, "../../supabase/deferred-migrations/20261006000000_boq_commercial_revision.sql"), "utf8").toLowerCase();

describe("boq_commercial_revision provenance migration", () => {
  it("is deferred (kept out of supabase/migrations) and additive", () => {
    expect(() => readFileSync(join(__dirname, "../../supabase/migrations/20261007000000_boq_commercial_revision_provenance.sql"))).toThrow();
    expect(SQL).toMatch(/alter table public\.boq_commercial_revision_line\s+add column if not exists basis\s+text,\s+add column if not exists basis_note text;/);
    expect(SQL).not.toMatch(/\b(drop\s+(table|column|policy|index|function)|truncate|delete\s+from|alter\s+table\s+public\.boq_line\b)/);
  });
  it("copies basis/basis_note onto every frozen line", () => {
    expect(SQL).toMatch(/adoption_confirmed_at, limitations,\s+basis, basis_note\s+\)/);
    expect(SQL).toMatch(/l->>'basis', l->>'basis_note'\s+from jsonb_array_elements\(p_lines\) as l;/);
  });
  it("treats a status or basis change after preparation as a stale snapshot", () => {
    expect(SQL).toMatch(/\(s\.l->>'quantity_status'\) is distinct from c\.quantity_status/);
    expect(SQL).toMatch(/\(s\.l \? 'basis' and \(s\.l->>'basis'\) is distinct from c\.basis\)/);
  });
  it("keeps the parent function's checks and permissions", () => {
    for (const must of ["for update", "the boq changed after this revision was prepared", "security definer set search_path = public"]) {
      expect(PARENT).toContain(must);
      expect(SQL).toContain(must);
    }
    expect(SQL).toMatch(/revoke all on function public\.create_boq_commercial_revision\(uuid, jsonb, jsonb\) from public, anon;/);
    expect(SQL).toMatch(/grant execute on function public\.create_boq_commercial_revision\(uuid, jsonb, jsonb\) to authenticated;/);
  });
});

describe("boq_commercial_revision line-identity follow-up (20261008000000)", () => {
  const FILE = "20261008000000_boq_commercial_revision_line_identity.sql";
  const NEXT = readFileSync(join(__dirname, "../../supabase/deferred-migrations/", FILE), "utf8").toLowerCase().replace(/--.*$/gm, "");
  const fnOf = (sql: string) => sql.slice(sql.indexOf("create or replace function public.create_boq_commercial_revision"));

  it("is deferred, function-only and additive", () => {
    expect(() => readFileSync(join(__dirname, "../../supabase/migrations/", FILE))).toThrow();
    expect(NEXT).not.toMatch(/\b(alter\s+table|create\s+table|drop\s+|truncate|delete\s+from)/);
  });
  it("refuses a snapshot whose code, section, basis note or stated source differ from the persisted line", () => {
    expect(NEXT).toMatch(/or \(s\.l->>'dsr_code'\) is distinct from c\.dsr_code/);
    expect(NEXT).toMatch(/or \(s\.l->>'section'\) is distinct from c\.section/);
    expect(NEXT).toMatch(/or \(s\.l \? 'basis_note' and \(s\.l->>'basis_note'\) is distinct from c\.basis_note\)/);
    expect(NEXT).toMatch(/or \(\(s\.l->>'source_document_id'\) is not null and \(s\.l->>'source_document_id'\)::uuid is distinct from c\.source_document_id\)/);
    expect(NEXT).toMatch(/or \(\(s\.l->>'source_page'\) is not null and \(s\.l->>'source_page'\) is distinct from c\.source_page\)/);
  });
  it("is otherwise the 20261007 function unchanged (checks, inserts, permissions)", () => {
    const strip = (s: string) => fnOf(s).split("\n").filter((l) => !/^\s*or \((\(s\.l->>'(source_document_id|source_page)'\)|s\.l->>'(dsr_code|section)'\)|s\.l \? 'basis_note')/.test(l)).map((l) => l.trim()).filter(Boolean).join("\n");
    expect(strip(NEXT)).toBe(strip(SQL));
  });
});
