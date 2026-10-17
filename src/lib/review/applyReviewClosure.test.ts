// Review → Apply closure: quantities and their meaning stay consistent from a
// reviewer's decision, through Apply (including retries and part-way
// failures), into the BOQ line — and a failure is never reported as success.
// Runs the REAL applyReviewPlan / applyFinding writes against the in-memory
// database (lib/e2e/inMemorySupabase). Limitation: the in-memory database
// emulates only the boq_line identity indexes — no RLS, triggers or other
// constraints — so this is not verification against a real Postgres.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));
import { dropInMemoryTable, failInMemoryWrite, readTable, resetInMemoryDb } from "@/lib/e2e/inMemorySupabase";
import { ApplyInterruptedError, applyReviewPlan, buildApplyPlan, type BoqLineForApply } from "./applyReview";
import type { StoredReviewItem } from "./reviewStore";
import { quantityProvenance, quantityState } from "@/lib/quantity";
import { setLineQty } from "@/lib/applyFinding";

type Line = Record<string, unknown>;
const BOQ = { id: "boq-1", project_id: null };
const line = (id: string, key: string, extra: Line = {}): Line => ({
  id, boq_id: "boq-1", description: `Item ${key}`, unit: "nos", qty: 0, quantity_status: "PENDING", basis: "PENDING", external_key: key, scope_id: null, ...extra,
});
const item = (id: string, key: string, status: StoredReviewItem["reviewStatus"], extra: Partial<Omit<StoredReviewItem, "ai">> & { ai?: Partial<StoredReviewItem["ai"]> } = {}): StoredReviewItem => {
  const { ai, ...rest } = extra;
  return {
    id, reviewStatus: status,
    ai: { key, item: `Item ${key}`, quantity: 4, unit: "nos", confidence: 0.9, aiStatus: "MEASURED", source: { document: "GF Plan", page: 1, evidence: [] }, ...ai } as StoredReviewItem["ai"],
    ...rest,
  };
};
const currentLines = () => readTable("boq_line") as unknown as BoqLineForApply[];
const planFor = (items: StoredReviewItem[], lines: BoqLineForApply[] = currentLines()) => buildApplyPlan(items, lines);
const applyAll = (items: StoredReviewItem[], plan = planFor(items)) =>
  applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(items.map((i) => i.id)) });
const lineById = (id: string) => readTable("boq_line").find((l) => l.id === id)!;
const linesByKey = (key: string) => readTable("boq_line").filter((l) => l.external_key === key);

beforeEach(() => resetInMemoryDb({ boq: [BOQ], boq_line: [] }));

describe("pending / confirmed-zero / unavailable semantics through Apply", () => {
  it("a reviewer-confirmed 0 on a line whose 0 nobody confirmed is applied as a confirmed zero, not 'no change'", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { qty: 0, quantity_status: null, basis: null })] });
    expect(quantityState(lineById("l1") as { qty: number })).toBe("pending");
    const items = [item("ri-1", "D1", "EDITED", { reviewer: { quantity: 0 } })];
    const plan = planFor(items);
    expect(plan[0]).toMatchObject({ classification: "APPLY", changes: [{ field: "qty", from: "pending", to: "0" }] });
    const res = await applyAll(items, plan);
    expect(res.appliedCount).toBe(1);
    const l = lineById("l1") as { qty: number; quantity_status: string; basis: string };
    expect(l).toMatchObject({ qty: 0, quantity_status: "COUNTED", basis: "REVIEW_CORRECTED" });
    expect(quantityState(l)).toBe("confirmed_zero");
  });

  it("a line marked pending only by its basis is still 'pending' in the diff — verifying its number establishes it", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { qty: 4, quantity_status: "MEASURED", basis: "PENDING" })] });
    const items = [item("ri-1", "D1", "VERIFIED")];
    const plan = planFor(items);
    expect(plan[0]).toMatchObject({ classification: "APPLY", changes: [{ field: "qty", from: "pending", to: "4" }] });
    await applyAll(items, plan);
    const l = lineById("l1") as { qty: number; quantity_status: string; basis: string };
    expect(l).toMatchObject({ qty: 4, quantity_status: "COUNTED", basis: "REVIEW_VERIFIED" });
    expect(quantityState(l)).toBe("established");
  });

  it("an item the AI marked PENDING, verified without a reviewer quantity, is never applied as an established number", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1")] });
    const items = [
      item("ri-1", "D1", "VERIFIED", { ai: { quantity: 7, aiStatus: "PENDING" } }), // existing pending line
      item("ri-2", "W9", "VERIFIED", { ai: { quantity: 3, aiStatus: "PENDING" } }), // would be a new line
    ];
    const plan = planFor(items);
    expect(plan[0].classification).toBe("NO_CHANGE"); // pending stays pending
    expect(plan[1]).toMatchObject({ classification: "NEW_LINE", newLine: { qty: 0, pending: true } });
    await applyAll(items, plan);
    expect(lineById("l1")).toMatchObject({ qty: 0, quantity_status: "PENDING", basis: "PENDING" });
    const added = linesByKey("W9")[0] as { qty: number; quantity_status: string; basis: string };
    expect(added).toMatchObject({ qty: 0, quantity_status: "PENDING", basis: "PENDING" });
    expect(quantityState(added)).toBe("pending");
  });

  it("…but a quantity the reviewer supplied for it is applied, as a correction", async () => {
    const items = [item("ri-2", "W9", "EDITED", { ai: { quantity: 3, aiStatus: "PENDING" }, reviewer: { quantity: 5 } })];
    await applyAll(items);
    expect(linesByKey("W9")[0]).toMatchObject({ qty: 5, quantity_status: "COUNTED", basis: "REVIEW_CORRECTED" });
  });

  it("a negative quantity is refused (CANNOT_APPLY) and nothing is written", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { qty: 4, quantity_status: "COUNTED", basis: "HEURISTIC" })] });
    const items = [
      item("ri-1", "D1", "EDITED", { reviewer: { quantity: -2 } }),
      item("ri-2", "W9", "VERIFIED", { ai: { quantity: -1 } }),
    ];
    const plan = planFor(items);
    expect(plan.map((c) => c.classification)).toEqual(["CANNOT_APPLY", "CANNOT_APPLY"]);
    const res = await applyAll(items, plan);
    expect(res).toMatchObject({ appliedCount: 0, unresolvedCount: 2 });
    expect(lineById("l1")).toMatchObject({ qty: 4, quantity_status: "COUNTED", basis: "HEURISTIC" });
    expect(readTable("boq_line")).toHaveLength(1);
    expect(readTable("boq_line_change_log")).toHaveLength(0);
  });

  it("a reviewer who sets a quantity pending on an established line records PENDING (normal path, unchanged)", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { qty: 3, quantity_status: "COUNTED", basis: "HEURISTIC" })] });
    await applyAll([item("ri-1", "D1", "EDITED", { reviewer: { quantity: null } })]);
    expect(lineById("l1")).toMatchObject({ qty: 0, quantity_status: "PENDING", basis: "PENDING" });
  });
});

describe("a unit-only correction records what the quantity now means", () => {
  it("unit changed, number unchanged: the line records the review basis and method, not the old basis", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { qty: 4, unit: "sqm", quantity_status: "MEASURED", basis: "HEURISTIC" })] });
    const items = [item("ri-1", "D1", "EDITED", { reviewer: { unit: "nos" } })];
    const plan = planFor(items);
    expect(plan[0].changes).toEqual([{ field: "unit", from: "sqm", to: "nos" }]);
    await applyAll(items, plan);
    const l = lineById("l1") as { qty: number; unit: string; quantity_status: string; basis: string };
    expect(l).toMatchObject({ qty: 4, unit: "nos", quantity_status: "COUNTED", basis: "REVIEW_CORRECTED" });
    expect(quantityProvenance(l).label).toBe("Counted on drawing, corrected in review");
  });

  it("a pending quantity keeps its pending marker when only the unit is corrected", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { unit: "sqm" })] });
    await applyAll([item("ri-1", "D1", "EDITED", { reviewer: { unit: "nos", quantity: null } })]);
    expect(lineById("l1")).toMatchObject({ qty: 0, unit: "nos", quantity_status: "PENDING", basis: "PENDING" });
  });
});

describe("stale decisions: the line's quantity meaning changed after the plan was built", () => {
  it("a pending line confirmed as zero elsewhere (same qty 0) is not overwritten by a plan built when it was pending", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1")] });
    const items = [item("ri-1", "D1", "VERIFIED")];
    const plan = planFor(items); // "pending → 4"
    // Meanwhile someone confirms "none required" in the BOQ editor.
    await setLineQty("l1", 0, "COUNT");
    const confirmed = { ...lineById("l1") };
    const res = await applyAll(items, plan);
    expect(res).toMatchObject({ appliedCount: 0, conflictedReviewItemIds: ["ri-1"], unresolvedCount: 1 });
    expect(lineById("l1")).toEqual(confirmed);
    expect(readTable("boq_line_change_log")).toHaveLength(0);
  });

  it("a confirmed zero re-marked pending elsewhere is not overwritten by a plan built when it was confirmed", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { qty: 0, quantity_status: "COUNTED", basis: "MANUAL" })] });
    const items = [item("ri-1", "D1", "VERIFIED")];
    const plan = planFor(items); // "0 → 4"
    const { markLinePending } = await import("@/lib/applyFinding");
    await markLinePending("l1");
    const res = await applyAll(items, plan);
    expect(res.conflictedReviewItemIds).toEqual(["ri-1"]);
    expect(lineById("l1")).toMatchObject({ qty: 0, quantity_status: "PENDING", basis: "PENDING" });
  });
});

describe("retries never double-apply", () => {
  const items = () => [
    item("ri-1", "D1", "EDITED", { reviewer: { quantity: 6 } }),
    item("ri-2", "W1", "VERIFIED"),
    item("ri-3", "W2", "VERIFIED", { ai: { quantity: 9, unit: "sqm" } }),
  ];
  beforeEach(() => resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1")] }));

  it("re-running Apply after a full success against reloaded lines: everything is 'no change', nothing written again", async () => {
    const first = await applyAll(items());
    expect(first.appliedCount).toBe(3);
    const logAfterFirst = readTable("boq_line_change_log").length;
    const plan = planFor(items());
    expect(plan.map((c) => c.classification)).toEqual(["NO_CHANGE", "NO_CHANGE", "NO_CHANGE"]);
    const second = await applyAll(items(), plan);
    expect(second).toMatchObject({ appliedCount: 0, skippedNoChange: 3, unresolvedCount: 0 });
    expect(readTable("boq_line")).toHaveLength(3);
    expect(readTable("boq_line_change_log")).toHaveLength(logAfterFirst);
  });

  it("re-running the SAME stale plan (lines not reloaded): every item is refused as a conflict, no duplicate line, no double quantity", async () => {
    const plan = planFor(items());
    await applyAll(items(), plan);
    const before = readTable("boq_line");
    const again = await applyAll(items(), plan);
    expect(again.appliedCount).toBe(0);
    expect(again.conflictedReviewItemIds.sort()).toEqual(["ri-1", "ri-2", "ri-3"]);
    expect(readTable("boq_line")).toEqual(before);
    expect(linesByKey("W1")).toHaveLength(1);
  });

  it("history table absent: lines saved and reported unaudited; a retry is 'no change', never a second write", async () => {
    dropInMemoryTable("boq_line_change_log");
    const first = await applyAll(items());
    expect(first.appliedCount).toBe(3);
    expect(first.auditLogFailedReviewItemIds.sort()).toEqual(["ri-1", "ri-2", "ri-3"]);
    const second = await applyAll(items(), planFor(items()));
    expect(second).toMatchObject({ appliedCount: 0, skippedNoChange: 3, auditLogFailedReviewItemIds: [] });
    expect(lineById("l1")).toMatchObject({ qty: 6, basis: "REVIEW_CORRECTED" });
  });
});

describe("a failure part-way through Apply is never reported as success — or as 'nothing applied'", () => {
  const items = () => [
    item("ri-1", "W1", "VERIFIED"),
    item("ri-2", "W2", "VERIFIED", { ai: { quantity: 5 } }),
    item("ri-3", "W3", "EDITED", { reviewer: { quantity: 2 } }),
  ];

  it("the first write fails: the original error, nothing written", async () => {
    failInMemoryWrite("boq_line", "insert", 1);
    await expect(applyAll(items())).rejects.toMatchObject({ message: "connection failure (injected)" });
    expect(readTable("boq_line")).toHaveLength(0);
    expect(readTable("boq_line_change_log")).toHaveLength(0);
  });

  it("the second write fails: ApplyInterruptedError says exactly what was and was not written; nothing after it is attempted", async () => {
    failInMemoryWrite("boq_line", "insert", 2);
    const err = await applyAll(items()).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApplyInterruptedError);
    const e = err as ApplyInterruptedError;
    expect(e.partial).toMatchObject({ appliedCount: 1, conflictedReviewItemIds: [], auditLogFailedReviewItemIds: [] });
    expect(e.failedReviewItemId).toBe("ri-2");
    expect(e.notAttemptedReviewItemIds).toEqual(["ri-3"]);
    expect(e.message).toMatch(/1 item was written to the BOQ, 2 were not \(connection failure \(injected\)\)/);
    expect(readTable("boq_line").map((l) => l.external_key)).toEqual(["W1"]);

    // Retry against the reloaded lines: finishes the rest, W1 is not applied twice.
    const plan = planFor(items());
    expect(plan.map((c) => c.classification)).toEqual(["NO_CHANGE", "NEW_LINE", "NEW_LINE"]);
    const retry = await applyAll(items(), plan);
    expect(retry).toMatchObject({ appliedCount: 2, conflictedReviewItemIds: [] });
    expect(readTable("boq_line").map((l) => [l.external_key, l.qty, l.basis]).sort()).toEqual([
      ["W1", 4, "REVIEW_VERIFIED"], ["W2", 5, "REVIEW_VERIFIED"], ["W3", 2, "REVIEW_CORRECTED"],
    ]);
  });

  it("the line is written but recording its history throws: counted as applied (unaudited), never as not written", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [] });
    const its = items();
    // Make the 2nd history insert throw (not just return an error).
    const mod = await import("@/lib/e2e/inMemorySupabase");
    const realFrom = mod.supabase.from;
    let logInserts = 0;
    const spy = vi.spyOn(mod.supabase, "from").mockImplementation((table: string) => {
      const q = realFrom(table);
      if (table !== "boq_line_change_log") return q;
      return { ...q, insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => { if (++logInserts === 2) throw new Error("socket hang up"); return q.insert(rows); } };
    });
    try {
      const err = await applyAll(its).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ApplyInterruptedError);
      const e = err as ApplyInterruptedError;
      expect(e.partial.appliedCount).toBe(2);
      expect(e.partial.auditLogFailedReviewItemIds).toEqual(["ri-2"]);
      expect(e.failedReviewItemId).toBeNull();
      expect(e.notAttemptedReviewItemIds).toEqual(["ri-3"]);
      expect(readTable("boq_line").map((l) => l.external_key)).toEqual(["W1", "W2"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("an existing-line update fails after a new line was written: partial result, the matched line untouched", async () => {
    resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { qty: 3, quantity_status: "COUNTED", basis: "HEURISTIC" })] });
    failInMemoryWrite("boq_line", "update", 1);
    const its = [item("ri-1", "W1", "VERIFIED"), item("ri-2", "D1", "EDITED", { reviewer: { quantity: 8 } })];
    const err = await applyAll(its).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApplyInterruptedError);
    expect((err as ApplyInterruptedError).partial.appliedCount).toBe(1);
    expect((err as ApplyInterruptedError).failedReviewItemId).toBe("ri-2");
    expect(lineById("l1")).toMatchObject({ qty: 3, quantity_status: "COUNTED", basis: "HEURISTIC" });
  });
});

describe("audit-finding 'Set qty' (setLineQty) records a MANUAL basis", () => {
  beforeEach(() => resetInMemoryDb({ boq: [BOQ], boq_line: [line("l1", "D1", { qty: 4, quantity_status: "MEASURED", basis: "HEURISTIC", unit: "sqm" })] }));

  it("records MANUAL with MEASURED for a measured method", async () => {
    await setLineQty("l1", 12.5, "AREA");
    const l = lineById("l1") as { qty: number; quantity_status: string; basis: string };
    expect(l).toMatchObject({ qty: 12.5, quantity_status: "MEASURED", basis: "MANUAL" });
    expect(quantityProvenance(l).label).toBe("Changed manually");
  });

  it("records COUNTED for a count method, and an explicit 0 is a confirmed zero", async () => {
    await setLineQty("l1", 0, "count");
    const l = lineById("l1") as { qty: number; quantity_status: string; basis: string };
    expect(l).toMatchObject({ qty: 0, quantity_status: "COUNTED", basis: "MANUAL" });
    expect(quantityState(l)).toBe("confirmed_zero");
  });

  it("refuses a negative or non-numeric quantity and writes nothing", async () => {
    await expect(setLineQty("l1", -1)).rejects.toThrow(/valid quantity/);
    await expect(setLineQty("l1", Number.NaN)).rejects.toThrow(/valid quantity/);
    expect(lineById("l1")).toMatchObject({ qty: 4, quantity_status: "MEASURED", basis: "HEURISTIC" });
  });
});
