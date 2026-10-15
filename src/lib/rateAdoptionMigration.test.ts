// Static checks on the rate-adoption migration (not applied in tests).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(__dirname, "../../supabase/deferred-migrations/20261005000000_boq_line_rate_adoption.sql"), "utf8",
).toLowerCase().replace(/--.*$/gm, "");

describe("boq_line_rate_adoption migration", () => {
  it("is additive: alters no existing table", () => {
    expect(SQL).not.toMatch(/alter\s+table\s+(if\s+exists\s+)?public\.(boq_line|boq|boq_line_change_log|vendor_quotation|dsr_item)\b/);
    expect(SQL).not.toMatch(/\b(drop\s+(table|column|policy|index)|truncate|delete\s+from)\b/);
  });

  it("records previous and adopted rate/basis, source type/record/snapshot, line context, acknowledgements and confirmation", () => {
    for (const col of [
      "previous_custom_rate", "previous_dsr_rate", "previous_rate", "previous_basis", "adopted_rate", "adopted_basis",
      "source_kind", "source_quotation_id", "source_boq_line_id", "source_dsr_item_id", "source_label", "source_unit",
      "source_date", "source_snapshot", "line_unit", "line_qty", "acknowledged_caveats", "confirmation_text", "confirmed_by", "confirmed_at",
    ]) expect(SQL).toContain(col);
    expect(SQL).toMatch(/confirmation_text\s+text not null/);
    expect(SQL).toMatch(/confirmed_by\s+uuid not null references auth\.users\(id\)/);
    expect(SQL).toMatch(/source_kind\s+text not null check \(source_kind in \('dsr_reference','vendor_quotation','historical_boq'\)\)/);
  });

  it("is append-only: staff may read and insert (as themselves) but there is no update or delete policy", () => {
    expect(SQL).toMatch(/for select\s+using \(public\.is_staff\(auth\.uid\(\)\)\)/);
    expect(SQL).toMatch(/for insert\s+with check \(public\.is_staff\(auth\.uid\(\)\) and confirmed_by = auth\.uid\(\)\)/);
    expect(SQL).not.toMatch(/for (all|update|delete)\b/);
  });

  it("derives boq_id from the line", () => {
    expect(SQL).toMatch(/select l\.boq_id into new\.boq_id from public\.boq_line l where l\.id = new\.boq_line_id/);
  });

  it("adopts atomically: one SECURITY INVOKER function does the guarded rate update, change-log row and record", () => {
    const fn = SQL.slice(SQL.indexOf("create or replace function public.adopt_boq_line_rate"));
    expect(fn).toMatch(/language plpgsql security invoker set search_path = public/);
    expect(fn).toMatch(/if v_uid is null or not public\.is_staff\(v_uid\) then/);
    // Only custom_rate is set, and only if the previewed values still hold.
    expect(fn).toMatch(/update public\.boq_line\s+set custom_rate = p_rate\s+where id = p_line_id/);
    expect(fn).toMatch(/custom_rate is not distinct from \(p_expected->>'custom_rate'\)::numeric/);
    expect(fn).toMatch(/dsr_rate\s+is not distinct from \(p_expected->>'dsr_rate'\)::numeric/);
    expect(fn).toMatch(/unit\s+is not distinct from \(p_expected->>'unit'\)/);
    expect(fn).toMatch(/if not found then\s+return 'conflict';/);
    expect(fn).toMatch(/insert into public\.boq_line_change_log/);
    expect(fn).toMatch(/insert into public\.boq_line_rate_adoption/);
    // The reviewer is the session user, never a value from the caller.
    expect(fn).toMatch(/p_record->>'confirmation_text', v_uid/);
    expect(fn).not.toMatch(/p_record->>'confirmed_by'/);
    expect(fn).not.toMatch(/\b(qty|description)\s*=/);
  });

  it("the adoption function is not executable by anon", () => {
    expect(SQL).toMatch(/revoke all on function public\.adopt_boq_line_rate\(uuid, numeric, jsonb, jsonb\) from public, anon/);
    expect(SQL).toMatch(/grant execute on function public\.adopt_boq_line_rate\(uuid, numeric, jsonb, jsonb\) to authenticated/);
  });
});

