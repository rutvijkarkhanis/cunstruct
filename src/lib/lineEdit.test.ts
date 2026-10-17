// saveLineEdit / addLineRecorded against a small in-memory PostgREST stand-in:
// compare-and-swap, history rows, compensation when history fails, and the
// "took effect" outcome the editors use to keep undo in step with the database.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  missing: new Set<string>(),
  failInsert: new Set<string>(),
  /** Fail the Nth guarded boq_line update (1-based); 0 = never. */
  failUpdateNo: 0,
  updates: 0,
}));

vi.mock("@/lib/untypedDb", async (orig) => {
  const actual = await orig<typeof import("@/lib/untypedDb")>();
  const from = (table: string) => {
    let op = "select"; let payload: Row | Row[] = {}; let returning = false;
    const filters: ((r: Row) => boolean)[] = [];
    const run = () => {
      if (mem.missing.has(table)) return { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
      const rows = (mem.tables[table] ??= []);
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "select") return { data: hit.map((r) => ({ ...r })), error: null };
      if (op === "insert") {
        if (mem.failInsert.has(table)) return { data: null, error: { message: `insert into ${table} failed` } };
        const list = (Array.isArray(payload) ? payload : [payload]).map((p, i) => ({ id: p.id ?? `${table}-${rows.length + i + 1}`, ...p }));
        rows.push(...list);
        return { data: returning ? list.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "update") {
        mem.updates++;
        if (mem.failUpdateNo && mem.updates === mem.failUpdateNo) return { data: null, error: { message: "network down" } };
        hit.forEach((r) => Object.assign(r, payload));
        return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      const ids = new Set(hit.map((r) => r.id));
      mem.tables[table] = rows.filter((r) => !ids.has(r.id));
      return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => { if (op !== "select") returning = true; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      limit: () => q,
      insert: (v: Row | Row[]) => { op = "insert"; payload = v; return q; },
      update: (v: Row) => { op = "update"; payload = v; return q; },
      delete: () => { op = "delete"; return q; },
      then: (res: (r: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { ...actual, db: { from } };
});

import { addLineRecorded, editTookEffect, lineAddMessage, lineEditMessage, saveLineEdit } from "./lineEdit";

const LINE = { id: "l1", qty: 10, unit: "sqm", basis: "DRAWING_DERIVED", quantity_status: "MEASURED", description: "Plaster", section: "Finishes", included: true, cost: 100 };

beforeEach(() => {
  mem.tables = { boq_line: [{ ...LINE }], boq_line_change_log: [] };
  mem.missing = new Set(); mem.failInsert = new Set(); mem.failUpdateNo = 0; mem.updates = 0;
});

describe("saveLineEdit", () => {
  it("normal: guarded write plus one history row per changed field", async () => {
    const r = await saveLineEdit({ boqId: "b1", line: LINE, patch: { qty: 12, basis: "MANUAL" }, changedBy: "u1" });
    expect(r).toEqual({ status: "saved", recorded: true });
    expect(editTookEffect(r)).toBe(true);
    expect(mem.tables.boq_line[0]).toMatchObject({ qty: 12, basis: "MANUAL" });
    expect(mem.tables.boq_line_change_log).toEqual([expect.objectContaining({ boq_id: "b1", boq_line_id: "l1", field: "qty", old_value: "10", new_value: "12", changed_by: "u1" })]);
  });

  it("conflict: a value changed elsewhere is never overwritten, and nothing is recorded", async () => {
    mem.tables.boq_line[0].qty = 11;
    const r = await saveLineEdit({ boqId: "b1", line: LINE, patch: { qty: 12 }, changedBy: "u1" });
    expect(r).toEqual({ status: "conflict" });
    expect(editTookEffect(r)).toBe(false);
    expect(mem.tables.boq_line[0].qty).toBe(11);
    expect(mem.tables.boq_line_change_log).toEqual([]);
  });

  it("edge: a cost edit is guarded on the cost shown, not just the quantity", async () => {
    mem.tables.boq_line[0].cost = 150;
    const r = await saveLineEdit({ boqId: "b1", line: LINE, patch: { cost: 120 }, changedBy: "u1" });
    expect(r.status).toBe("conflict");
    expect(mem.tables.boq_line[0].cost).toBe(150);
  });

  it("history table absent: saved and disclosed as not recorded (D1-b fail open with disclosure)", async () => {
    mem.missing.add("boq_line_change_log");
    const r = await saveLineEdit({ boqId: "b1", line: LINE, patch: { description: "Plaster 12 mm" }, changedBy: "u1" });
    expect(r).toEqual({ status: "saved", recorded: false });
    expect(lineEditMessage(r)).toMatch(/Change saved\. Change history is not set up/);
  });

  it("failure: history insert fails → edit put back (every patched field), reported as not saved", async () => {
    mem.failInsert.add("boq_line_change_log");
    const r = await saveLineEdit({ boqId: "b1", line: LINE, patch: { qty: 12, basis: "MANUAL" }, changedBy: "u1" });
    expect(r).toMatchObject({ status: "history_failed", reverted: true });
    expect(editTookEffect(r)).toBe(false);
    expect(mem.tables.boq_line[0]).toMatchObject({ qty: 10, basis: "DRAWING_DERIVED" });
    expect(lineEditMessage(r)).toMatch(/^Change not saved: its history record couldn't be saved/);
  });

  it("failure: history fails and putting it back fails too → reported as saved-but-unrecorded, and it took effect", async () => {
    mem.failInsert.add("boq_line_change_log");
    mem.failUpdateNo = 2;   // the compensating update
    const r = await saveLineEdit({ boqId: "b1", line: LINE, patch: { qty: 12 }, changedBy: "u1" });
    expect(r).toMatchObject({ status: "history_failed", reverted: false });
    expect(editTookEffect(r)).toBe(true);
    expect(mem.tables.boq_line[0].qty).toBe(12);
    expect(lineEditMessage(r)).toMatch(/was saved, but its history record couldn't be saved.*Check this line/);
  });

  it("undo is guarded on the values the edit left: a later change by someone else is never reversed", async () => {
    await saveLineEdit({ boqId: "b1", line: LINE, patch: { qty: 12 }, changedBy: "u1" });
    mem.tables.boq_line[0].qty = 15;   // someone else, later
    const undo = await saveLineEdit({ boqId: "b1", line: { ...LINE, qty: 12 }, patch: { qty: 10 }, changedBy: "u1" });
    expect(undo).toEqual({ status: "conflict" });
    expect(mem.tables.boq_line[0].qty).toBe(15);
  });

  it("retry: after a failed history write, the same edit succeeds once history works", async () => {
    mem.failInsert.add("boq_line_change_log");
    expect((await saveLineEdit({ boqId: "b1", line: LINE, patch: { qty: 12 }, changedBy: "u1" })).status).toBe("history_failed");
    mem.failInsert.clear();
    expect(await saveLineEdit({ boqId: "b1", line: LINE, patch: { qty: 12 }, changedBy: "u1" })).toEqual({ status: "saved", recorded: true });
    expect(mem.tables.boq_line_change_log).toHaveLength(1);
  });
});

describe("addLineRecorded", () => {
  const row = { boq_id: "b1", section: "Other", description: "New item", unit: "nos", qty: 1 };

  it("normal: adds the line and records line_created, qty and unit", async () => {
    const r = await addLineRecorded({ boqId: "b1", row, changedBy: "u1" });
    expect(r).toMatchObject({ status: "added", recorded: true });
    expect(mem.tables.boq_line).toHaveLength(2);
    expect(mem.tables.boq_line_change_log.map((x) => [x.field, x.old_value, x.new_value, x.boq_line_id])).toEqual([
      ["line_created", null, "New item", (r as { id: string }).id], ["qty", null, "1", (r as { id: string }).id], ["unit", null, "nos", (r as { id: string }).id],
    ]);
    expect(lineAddMessage(r)).toBeNull();
  });

  it("history table absent: added, and says it is not recorded", async () => {
    mem.missing.add("boq_line_change_log");
    const r = await addLineRecorded({ boqId: "b1", row, changedBy: "u1" });
    expect(r).toMatchObject({ status: "added", recorded: false });
    expect(lineAddMessage(r)).toMatch(/Line added\. Change history is not set up/);
  });

  it("failure: history fails → the new line is taken out again and reported as not added", async () => {
    mem.failInsert.add("boq_line_change_log");
    const r = await addLineRecorded({ boqId: "b1", row, changedBy: "u1" });
    expect(r).toMatchObject({ status: "history_failed", removed: true });
    expect(mem.tables.boq_line).toEqual([LINE]);
    expect(lineAddMessage(r)).toMatch(/^Line not added: its history record couldn't be saved/);
  });

  it("an insert error throws — nothing is reported as added", async () => {
    mem.failInsert.add("boq_line");
    await expect(addLineRecorded({ boqId: "b1", row, changedBy: "u1" })).rejects.toBeTruthy();
    expect(mem.tables.boq_line).toEqual([LINE]);
  });
});
