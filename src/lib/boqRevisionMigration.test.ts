// Static checks on the commercial-revision migration (not applied in tests).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(__dirname, "../../supabase/deferred-migrations/20261006000000_boq_commercial_revision.sql"), "utf8",
).toLowerCase().replace(/--.*$/gm, "");

describe("boq_commercial_revision migration", () => {
  it("is additive: alters no existing table", () => {
    expect(SQL).not.toMatch(/alter\s+table\s+(if\s+exists\s+)?public\.(boq_line|boq|projects|boq_line_change_log|boq_line_rate_adoption)\b/);
    expect(SQL).not.toMatch(/\b(drop\s+(table|column|policy|index)|truncate|delete\s+from)\b/);
  });

  it("grants read-only API access: SELECT policies only, no insert/update/delete/all policy", () => {
    expect(SQL.match(/create policy/g)).toHaveLength(4);
    expect(SQL).not.toMatch(/create policy[^;]*\bfor (all|insert|update|delete)\b/);
  });

  it("rejects UPDATE and DELETE by trigger on both tables (header allows only the FK set-null)", () => {
    expect(SQL).toMatch(/before update or delete on public\.boq_commercial_revision\s+for each row execute function public\.boq_commercial_revision_header_immutable\(\)/);
    expect(SQL).toMatch(/before update or delete on public\.boq_commercial_revision_line\s+for each row execute function public\.boq_commercial_revision_immutable\(\)/);
    expect(SQL).toMatch(/\(to_jsonb\(new\) - 'boq_id' - 'project_id'\) = \(to_jsonb\(old\) - 'boq_id' - 'project_id'\)/);
  });

  it("survives deletion of the working BOQ/project, and lines can't be removed with their revision", () => {
    expect(SQL).toMatch(/boq_id\s+uuid references public\.boq\(id\) on delete set null/);
    expect(SQL).toMatch(/project_id\s+uuid references public\.projects\(id\) on delete set null/);
    expect(SQL).toMatch(/revision_id\s+uuid not null references public\.boq_commercial_revision\(id\) on delete restrict/);
    expect(SQL).toMatch(/boq_name\s+text not null/);
  });

  it("creates a revision atomically through one staff-only SECURITY DEFINER function that sets identity and issuer itself", () => {
    expect(SQL).toMatch(/create or replace function public\.create_boq_commercial_revision\(p_boq_id uuid, p_header jsonb, p_lines jsonb\)/);
    expect(SQL).toMatch(/security definer set search_path = public/);
    expect(SQL).toMatch(/if v_uid is null or not public\.is_staff\(v_uid\) then/);
    expect(SQL).toMatch(/from public\.boq b where b\.id = p_boq_id for update/);
    expect(SQL).toMatch(/p_header->>'issue_note', v_uid/);
    expect(SQL).toMatch(/revoke all on function public\.create_boq_commercial_revision\(uuid, jsonb, jsonb\) from public/);
  });

  it("requires acknowledgement whenever limitations are recorded", () => {
    expect(SQL).toMatch(/check \(jsonb_array_length\(limitations\) = 0 or limitations_acknowledged\)/);
  });

  it("stores rate, basis, provenance and adoption source per line for later historical lookup", () => {
    for (const col of ["rate_basis", "rate_provenance", "adoption_source_label", "adoption_source_date", "source_document_name", "dsr_code", "unit", "qty"]) {
      expect(SQL).toContain(col);
    }
  });

  it("freezes only the persisted BOQ as it is inside the transaction — a stale or fabricated snapshot freezes nothing", () => {
    const fn = SQL.slice(SQL.indexOf("create or replace function public.create_boq_commercial_revision"));
    const check = fn.indexOf("into v_stale");
    expect(check).toBeGreaterThan(fn.indexOf("for update"));               // after the BOQ row lock
    expect(check).toBeLessThan(fn.indexOf("insert into public.boq_commercial_revision ("));  // before any write
    expect(fn).toMatch(/select \* from public\.boq_line where boq_id = p_boq_id/);
    expect(fn).toMatch(/\(select count\(\*\) from snap\) <> \(select count\(\*\) from cur\)/);
    expect(fn).toMatch(/\(select count\(distinct id\) from snap\) <> \(select count\(\*\) from snap\)/);
    for (const field of ["description", "unit", "qty", "included", "custom_rate", "dsr_rate"]) {
      expect(fn).toMatch(new RegExp(`\\(s\\.l->>'${field}'\\)(::\\w+)? is distinct from c\\.${field}`));
    }
    expect(fn).toMatch(/\(s\.l->>'rate'\)::numeric is distinct from coalesce\(c\.custom_rate, c\.dsr_rate\)/);
    expect(fn).toMatch(/if v_stale then\s+raise exception/);
  });

  it("the revision function is not executable by anon", () => {
    expect(SQL).toMatch(/revoke all on function public\.create_boq_commercial_revision\(uuid, jsonb, jsonb\) from public, anon/);
  });
});

