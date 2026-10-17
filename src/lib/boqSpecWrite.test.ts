// Guarded boq.spec writes against the in-memory database (real helper code,
// no network). Interleavings are produced two ways: two writers awaited
// together (each query is a separate await, so they read-read-write-write), and
// a write injected between a writer's read and its compare-and-swap.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));
import { readTable, resetInMemoryDb } from "@/lib/e2e/inMemorySupabase";
import { db } from "@/lib/untypedDb";
import {
  DSR_SCOPE_DECISIONS_KEY, nextUpdatedAt, readBoqSpec, reusableSpec, SpecAbort, writeBoqSpecKeys,
} from "./boqSpecWrite";
import { decisionsFromSpec, saveScopeDecision } from "./dsr/scopeStore";

const T0 = "2026-10-01T00:00:00.000Z";
const boq = () => readTable("boq")[0] as { spec: Record<string, unknown>; updated_at: string };
/** A write by someone else that commits at once (the in-memory query runs synchronously on then). */
const otherWriterNow = (spec: Record<string, unknown>, updatedAt: string | null) => {
  void db.from("boq").update(updatedAt ? { spec, updated_at: updatedAt } : { spec }).eq("id", "B").then(() => undefined);
};

beforeEach(() => resetInMemoryDb({ boq: [{ id: "B", project_id: "P", spec: { _gst_pct: 18, _firm_name: "Acme" }, updated_at: T0 }], boq_line: [] }));

describe("writeBoqSpecKeys", () => {
  it("changes only the given keys, removes undefined ones, and moves updated_at forward", async () => {
    const r = await writeBoqSpecKeys("B", () => ({ _gst_pct: 12, _firm_name: undefined, _cess_pct: 1 }));
    expect(r).toMatchObject({ status: "saved", attempts: 1, spec: { _gst_pct: 12, _cess_pct: 1 } });
    expect(boq().spec).toEqual({ _gst_pct: 12, _cess_pct: 1 });
    expect(Date.parse(boq().updated_at)).toBeGreaterThan(Date.parse(T0));
  });

  it("updated_at always moves strictly forward, even with a clock behind the database", () => {
    expect(nextUpdatedAt("2030-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00Z"))).toBe("2030-01-01T00:00:00.001Z");
    expect(nextUpdatedAt("2026-10-01T00:00:00.123456+00:00", Date.parse("2026-10-01T00:00:00.123Z"))).toBe("2026-10-01T00:00:00.124Z");
    expect(nextUpdatedAt(null, Date.parse(T0))).toBe(T0);
  });

  it("two writers at once (read, read, write, write): the loser re-reads and re-applies — both keys survive", async () => {
    const [a, b] = await Promise.all([
      writeBoqSpecKeys("B", () => ({ _contingency_pct: 5 })),
      writeBoqSpecKeys("B", () => ({ [DSR_SCOPE_DECISIONS_KEY]: { k: { decision: "deferred" } } })),
    ]);
    expect([a.status, b.status]).toEqual(["saved", "saved"]);
    expect([a, b].map((r) => (r.status === "saved" ? r.attempts : 0)).sort()).toEqual([1, 2]);
    expect(boq().spec).toEqual({ _gst_pct: 18, _firm_name: "Acme", _contingency_pct: 5, [DSR_SCOPE_DECISIONS_KEY]: { k: { decision: "deferred" } } });
  });

  it("a guarded write landing between this writer's read and write is detected, not overwritten", async () => {
    let calls = 0;
    const r = await writeBoqSpecKeys("B", (current) => {
      if (++calls === 1) otherWriterNow({ ...current, _overhead_pct: 7 }, "2026-10-01T00:00:01.000Z");
      return { _gst_pct: 5 };
    });
    expect(r).toMatchObject({ status: "saved", attempts: 2 });
    expect(boq().spec).toMatchObject({ _gst_pct: 5, _overhead_pct: 7, _firm_name: "Acme" });
  });

  it("why every writer must use it: a write that does NOT move updated_at is invisible to the guard", async () => {
    // The old builder write (whole spec, no updated_at). This documents the hole the helper closes.
    const r = await writeBoqSpecKeys("B", (current) => { otherWriterNow({ ...current, _overhead_pct: 7 }, null); return { _gst_pct: 5 }; });
    expect(r).toMatchObject({ status: "saved", attempts: 1 });
    expect(boq().spec._overhead_pct).toBeUndefined();
  });

  it("keeps losing → a conflict after the bounded attempts, and nothing of its own is written", async () => {
    let n = 0;
    const r = await writeBoqSpecKeys("B", (current) => {
      n++;
      otherWriterNow({ ...current, _tick: n }, `2026-10-01T00:00:0${n}.000Z`);
      return { _gst_pct: 5 };
    });
    expect(r).toEqual({ status: "conflict", attempts: 3 });
    expect(boq().spec).toMatchObject({ _gst_pct: 18, _tick: 3 });
  });

  it("build can decline to write; a missing BOQ is an error, not a silent no-op", async () => {
    expect(await writeBoqSpecKeys("B", () => new SpecAbort("decided elsewhere"))).toEqual({ status: "aborted", reason: "decided elsewhere", attempts: 1 });
    expect(boq().updated_at).toBe(T0);
    await expect(writeBoqSpecKeys("nope", () => ({ a: 1 }))).rejects.toThrow("This BOQ could not be found.");
    await expect(readBoqSpec("nope")).rejects.toThrow();
  });

  it("a BOQ's DSR decisions are never copied as a contractor's reusable defaults", () => {
    expect(reusableSpec({ _gst_pct: 18, quality_tier: "premium", [DSR_SCOPE_DECISIONS_KEY]: { k: { decision: "accepted", lineIds: ["l1"] } } }))
      .toEqual({ _gst_pct: 18, quality_tier: "premium" });
    expect(reusableSpec(null)).toEqual({});
  });
});

describe("DSR decisions and builder spec keys, interleaved", () => {
  const decide = (key: string, decision: "rejected" | "deferred" | null, expected = null as Parameters<typeof saveScopeDecision>[0]["expected"], by = "u1") =>
    saveScopeDecision({ boqId: "B", key, decision, expected, schedule: "DSR 2023", changedBy: by });

  it("a builder commercial change and a decision saved at the same moment both persist", async () => {
    const [d] = await Promise.all([decide("excluded_formwork:5", "deferred"), writeBoqSpecKeys("B", () => ({ _contingency_pct: 3 }))]);
    expect(d).toMatchObject({ status: "saved", historyRecorded: true });
    expect(boq().spec).toMatchObject({ _contingency_pct: 3, _gst_pct: 18 });
    expect(decisionsFromSpec(boq().spec)["excluded_formwork:5"]).toMatchObject({ decision: "deferred" });
  });

  it("a builder change between the decision's read and write: the decision retries and keeps it", async () => {
    let first = true;
    // The builder's guarded write commits (spec key + a newer updated_at) exactly then.
    const builder = () => { if (first) { first = false; otherWriterNow({ ...boq().spec, _overhead_pct: 9 }, "2026-10-01T00:00:05.000Z"); } };
    // inject the builder's write right after the decision's first read
    const from = db.from.bind(db);
    const spy = vi.spyOn(db, "from").mockImplementation((t: string) => {
      const q = from(t);
      if (t !== "boq") return q;
      return { ...q, update: (v: object) => { builder(); return q.update(v); } } as typeof q;
    });
    try {
      expect(await decide("excluded_reinforcement:5", "rejected")).toMatchObject({ status: "saved" });
    } finally { spy.mockRestore(); }
    expect(boq().spec._overhead_pct).toBe(9);
    expect(decisionsFromSpec(boq().spec)["excluded_reinforcement:5"]?.decision).toBe("rejected");
  });

  it("two people deciding the same suggestion at once: one wins, the other is told — never overwritten", async () => {
    const [a, b] = await Promise.all([decide("k", "rejected", null, "alice"), decide("k", "deferred", null, "bob")]);
    expect([a.status, b.status].sort()).toEqual(["conflict", "saved"]);
    const winner = a.status === "saved" ? "alice" : "bob";
    expect(decisionsFromSpec(boq().spec).k).toMatchObject({ by: winner });
    expect(readTable("boq_line_change_log")).toHaveLength(1);
  });

  it("the same person's repeated click (or a retry after a lost reply) is a no-op, not a conflict or a second history row", async () => {
    const [a, b] = await Promise.all([decide("k", "rejected"), decide("k", "rejected")]);
    expect(a).toMatchObject({ status: "saved" });
    expect(b).toMatchObject({ status: "saved", unchanged: true, record: { decision: "rejected", by: "u1" } });
    expect(readTable("boq_line_change_log")).toHaveLength(1);
    // Undo twice: the second finds it already undone.
    const saved = decisionsFromSpec(boq().spec).k;
    expect(await decide("k", null, saved)).toMatchObject({ status: "saved", record: null });
    expect(await decide("k", null, saved)).toMatchObject({ status: "saved", record: null, unchanged: true });
    expect(readTable("boq_line_change_log")).toHaveLength(2);
  });
});
