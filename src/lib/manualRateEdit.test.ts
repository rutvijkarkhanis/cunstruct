import { describe, it, expect, vi, beforeEach } from "vitest";

const io = vi.hoisted(() => ({
  writes: [] as unknown[][],
  results: [] as (boolean | Error)[],
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  insertError: null as null | { message: string },
  probes: [] as string[],
  probeError: null as null | { message: string; code?: string },
}));
vi.mock("@/lib/applyFinding", () => ({
  applyManualRate: (...args: unknown[]) => {
    io.writes.push(args);
    const r = io.results.shift() ?? true;
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  },
}));
vi.mock("@/lib/untypedDb", async (importOriginal) => ({
  isMissingTable: (await importOriginal<typeof import("@/lib/untypedDb")>()).isMissingTable,
  db: { from: (table: string) => ({
    insert: (payload: Record<string, unknown>) => { io.inserts.push({ table, payload }); return Promise.resolve({ data: null, error: io.insertError }); },
    select: () => ({ limit: () => { io.probes.push(table); return Promise.resolve({ data: [], error: io.probeError }); } }),
  }) },
}));

import { adoptionStateFor, applyManualRateEdit, manualRateFailureMessage, type AdoptionSummary } from "./manualRateEdit";

const LINE = { id: "l1", custom_rate: 1150, dsr_rate: 900, unit: "sqm" };
const edit = (newRate: number | null = 1200) => applyManualRateEdit({ boqId: "boq-1", line: LINE, newRate, changedBy: "user-1" });

beforeEach(() => { io.writes = []; io.results = []; io.inserts = []; io.insertError = null; io.probes = []; io.probeError = null; });

describe("applyManualRateEdit", () => {
  it("writes the rate through the guarded update, then logs before/after with actor", async () => {
    await expect(edit()).resolves.toEqual({ status: "applied" });
    expect(io.writes).toEqual([["l1", 1200, { custom_rate: 1150, dsr_rate: 900, unit: "sqm" }]]);
    expect(io.inserts).toEqual([{ table: "boq_line_change_log", payload: {
      boq_id: "boq-1", boq_line_id: "l1", review_item_id: null, field: "custom_rate", old_value: "1150", new_value: "1200", changed_by: "user-1",
    } }]);
  });

  it("checks the audit table (read-only) before writing anything", async () => {
    await edit();
    expect(io.probes).toEqual(["boq_line_change_log"]);
  });

  it.each([
    ["PostgREST schema cache", { code: "PGRST205", message: "Could not find the table 'public.boq_line_change_log' in the schema cache" }],
    ["Postgres undefined table", { code: "42P01", message: 'relation "public.boq_line_change_log" does not exist' }],
  ])("writes NOTHING when the audit table is missing (%s) and says why", async (_n, err) => {
    io.probeError = err;
    const r = await edit();
    expect(r).toEqual({ status: "audit_unavailable" });
    expect(io.writes).toHaveLength(0);
    expect(io.inserts).toHaveLength(0);
    expect(manualRateFailureMessage(r as Exclude<typeof r, { status: "applied" }>, 1200))
      .toBe("Rate not changed: rate edits are audited, and audit history is not set up on this database yet (migration 20260921000000_boq_review_apply.sql has not been applied). Nothing was saved.");
  });

  it("any other probe error falls through to the guarded write + audit path (never a silent unaudited save)", async () => {
    io.probeError = { message: "network" };
    io.insertError = { message: "network" };
    io.results = [true, true];
    await expect(edit()).resolves.toEqual({ status: "audit_failed", reverted: true, message: "network" });
  });

  it("logs clearing the override (back to the DSR rate) as new_value null", async () => {
    await edit(null);
    expect(io.inserts[0].payload).toMatchObject({ old_value: "1150", new_value: null });
  });

  it("on a stale rate (compare-and-swap miss) writes no audit row", async () => {
    io.results = [false];
    await expect(edit()).resolves.toEqual({ status: "conflict" });
    expect(io.inserts).toHaveLength(0);
  });

  it("if the audit row fails, puts the previous rate back (guarded on the new value) and reports it", async () => {
    io.insertError = { message: "permission denied for table boq_line_change_log" };
    io.results = [true, true];
    const r = await edit();
    expect(r).toEqual({ status: "audit_failed", reverted: true, message: "permission denied for table boq_line_change_log" });
    expect(io.writes[1]).toEqual(["l1", 1150, { custom_rate: 1200, dsr_rate: 900, unit: "sqm" }]);
    expect(manualRateFailureMessage(r as Exclude<typeof r, { status: "applied" }>, 1200))
      .toBe("Rate not changed: its audit record couldn't be saved (permission denied for table boq_line_change_log). The previous rate was kept.");
  });

  it.each([
    ["the rollback finds the line changed again", false],
    ["the rollback itself errors", new Error("network")],
  ])("never claims success when %s", async (_n, rollback) => {
    io.insertError = { message: "timeout" };
    io.results = [true, rollback];
    const r = await edit();
    expect(r).toEqual({ status: "audit_failed", reverted: false, message: "timeout" });
    expect(manualRateFailureMessage(r as Exclude<typeof r, { status: "applied" }>, 1200))
      .toBe("The rate was changed to ₹1,200 but its audit record couldn't be saved (timeout), and restoring the previous rate failed. Check this line.");
  });
});

describe("adoptionStateFor", () => {
  const rec = (adopted_rate: number, confirmed_at: string, boq_line_id = "l1"): AdoptionSummary =>
    ({ boq_line_id, adopted_rate, source_label: "Quotation — Vendor A", confirmed_at });

  it("is 'adopted' only while the line's rate equals its LATEST adoption", () => {
    const records = [rec(1000, "2026-10-01T00:00:00Z"), rec(1150, "2026-10-10T00:00:00Z"), rec(5, "2026-10-11T00:00:00Z", "other")];
    expect(adoptionStateFor({ id: "l1", custom_rate: 1150 }, records)).toMatchObject({ kind: "adopted", record: { adopted_rate: 1150 } });
    expect(adoptionStateFor({ id: "l1", custom_rate: 1000 }, records)).toMatchObject({ kind: "changed_after_adoption", record: { adopted_rate: 1150 } });
    expect(adoptionStateFor({ id: "l1", custom_rate: null }, records).kind).toBe("changed_after_adoption");
    expect(adoptionStateFor({ id: "l2", custom_rate: 1150 }, records).kind).toBe("none");
  });

  it("compares numerically (the database may return numeric as text)", () => {
    expect(adoptionStateFor({ id: "l1", custom_rate: 1150 }, [{ ...rec(0, "2026-10-10T00:00:00Z"), adopted_rate: "1150" as unknown as number }]).kind).toBe("adopted");
  });
});
