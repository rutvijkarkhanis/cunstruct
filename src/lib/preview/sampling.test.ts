// SYNTHETIC pools only. These tests check the arithmetic of the stated method;
// they are not evidence that any real BOQ is within tolerance.
import { describe, expect, it } from "vitest";
import {
  allocateTolerable, buildPools, evaluateAttribute, evaluateMus, planAttribute, planMus, POISSON_95,
  recordSignOff, seededRandom, signOffBlockers, staleLines, widenMus, type MusItem,
} from "./sampling";
import type { EngineLine } from "./types";

const items = (n: number, book = 1000): MusItem[] => Array.from({ length: n }, (_, i) => ({ id: `L${String(i + 1).padStart(2, "0")}`, book }));

describe("seededRandom", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("planMus (monetary-unit sampling, 95%, zero expected errors)", () => {
  it("sizes the sample as ⌈BV × 3.0 / TE⌉ and selects by systematic PPS from a seeded start", () => {
    const p = planMus("accepted", items(20), 6000, 7); // BV 20,000 → n = ⌈20,000×3/6,000⌉ = 10
    expect(p).toMatchObject({ bookValue: 20000, n: 10, interval: 2000, fullReview: false });
    expect(p.start).toBeGreaterThanOrEqual(0);
    expect(p.start).toBeLessThan(2000);
    expect(p.selected).toHaveLength(10); // one hit per 2,000 over equal 1,000 items
    expect(planMus("accepted", items(20), 6000, 7)).toEqual(p); // same seed, same sample
  });

  it("always selects items at or above the interval (top stratum)", () => {
    const p = planMus("x", [{ id: "huge", book: 50000 }, ...items(10)], 30000, 1); // BV 60,000 → n 6, J 10,000
    expect(p.selected.find((s) => s.id === "huge")).toMatchObject({ topStratum: true });
  });

  it("reviews the whole pool when the sample would cover it", () => {
    const p = planMus("x", items(3), 100, 1);
    expect(p.fullReview).toBe(true);
    expect(p.selected.map((s) => s.id)).toEqual(["L01", "L02", "L03"]);
  });

  it("an empty pool needs no sample; TE must be positive", () => {
    expect(planMus("x", [], 1000, 1)).toMatchObject({ n: 0, selected: [], fullReview: true });
    expect(() => planMus("x", items(2), 0, 1)).toThrow(/tolerableError/);
  });
});

describe("evaluateMus", () => {
  const plan = planMus("accepted", items(20), 6000, 7);
  const clean = plan.selected.map((s) => ({ id: s.id, found: s.book }));

  it("is incomplete, with no UEL, until every selected item is checked", () => {
    expect(evaluateMus(plan, clean.slice(1))).toMatchObject({ complete: false, uel: null, withinTolerance: null, awaiting: [plan.selected[0].id] });
  });

  it("no errors: UEL = J × 3.0 = TE exactly by construction, within tolerance", () => {
    expect(evaluateMus(plan, clean)).toMatchObject({ complete: true, errors: 0, uel: 6000, withinTolerance: true, recommendation: "none" });
  });

  it("one error: UEL adds tainting × J × (4.75 − 3.00); over TE it recommends widening", () => {
    const f = [...clean.slice(1), { id: plan.selected[0].id, found: 900 }]; // 10% taint
    const e = evaluateMus(plan, f);
    expect(e.uel).toBe(Math.round(2000 * 3 + 0.1 * 2000 * (POISSON_95[1] - POISSON_95[0]))); // 6,350
    expect(e).toMatchObject({ errors: 1, projected: 200, withinTolerance: false, recommendation: "widen" });
  });

  it("an understatement counts as a misstatement too", () => {
    const e = evaluateMus(plan, [...clean.slice(1), { id: plan.selected[0].id, found: 1100 }]);
    expect(e.errors).toBe(1);
  });

  it("full review: the misstatement is exact, with no sampling allowance", () => {
    const p = planMus("x", items(3), 100, 1);
    expect(evaluateMus(p, [{ id: "L01", found: 1000 }, { id: "L02", found: 950 }, { id: "L03", found: 1000 }])).toMatchObject({ uel: 50, withinTolerance: true });
  });

  it("widening doubles n and draws a new deterministic sample", () => {
    const w = widenMus(plan, items(20), 7);
    expect(w.n).toBe(20);
    expect(w.fullReview).toBe(true);
  });
});

describe("attribute sampling of no-detection regions", () => {
  it("draws m = min(N, ⌈3.0 / tolerable rate⌉) regions deterministically; any miss fails", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `R${i}`);
    const p = planAttribute("regions", ids, 0.1, 9);
    expect(p.m).toBe(30);
    expect(planAttribute("regions", ids, 0.1, 9).selected).toEqual(p.selected);
    expect(new Set(p.selected).size).toBe(30);
    const none = Object.fromEntries(p.selected.map((id) => [id, false]));
    expect(evaluateAttribute(p, none)).toEqual({ complete: true, misses: 0, passed: true });
    expect(evaluateAttribute(p, { ...none, [p.selected[0]]: true }).passed).toBe(false);
    expect(evaluateAttribute(p, {}).passed).toBeNull();
    expect(planAttribute("r", ["a", "b"], 0.1, 1).m).toBe(2);
  });
});

const line = (id: string, over: Partial<EngineLine> = {}): EngineLine => ({
  id, description: id, unit: "m³", quantity: 10, quantityState: "established", rate: 100, reviewState: "accepted", ...over,
});

describe("pools, the sign-off record and resets", () => {
  it("key items, pending and no-rate lines never enter a monetary pool", () => {
    const p = buildPools([
      line("acc"), line("cor", { reviewState: "corrected" }), line("ver", { reviewState: "verified" }),
      line("key", { quantity: 1000 }), line("pend", { quantityState: "pending" }), line("norate", { rate: null }),
      line("todo", { reviewState: "needs_review" }),
    ], 50000);
    expect(p.acceptedNonKey.map((i) => i.id)).toEqual(["acc", "cor"]);
    expect(p.verified.map((i) => i.id)).toEqual(["ver"]);
    expect(p.keyIds).toEqual(["key"]);
    expect(p.blocked).toEqual({ pending: ["pend"], noRate: ["norate"] });
  });

  it("allocates TE between pools in proportion to book value", () => {
    expect(allocateTolerable(9000, [items(2), items(1)])).toEqual([6000, 3000]);
    expect(allocateTolerable(9000, [[], []])).toEqual([0, 0]);
  });

  it("records reviewer, time and drawing revision; a changed input or revision resets that line only", () => {
    const ls = [line("a"), line("b")];
    const rec = recordSignOff("Owner (demo)", "2026-10-18T10:00:00Z", "REV-B", ls);
    expect(rec).toMatchObject({ reviewer: "Owner (demo)", drawingRevision: "REV-B" });
    expect(staleLines(rec, ls, "REV-B")).toEqual([]);
    expect(staleLines(rec, [line("a", { quantity: 11 }), line("b")], "REV-B")).toEqual(["a"]);
    expect(staleLines(rec, ls, "REV-C")).toEqual(["a", "b"]);
    expect(() => recordSignOff(" ", "t", "r", ls)).toThrow(/reviewer/);
  });

  it("lists every blocker; the preview always blocks certification", () => {
    const ok = { keyItemsUnverified: 0, pendingQuantities: 0, linesWithoutRate: 0, coverageCleared: true, sampling: { evaluated: true, withinTolerance: true } };
    expect(signOffBlockers({ ...ok, previewMode: false })).toEqual([]);
    expect(signOffBlockers({ ...ok, previewMode: true })).toEqual(["Engineering preview: certification is never issued here"]);
    expect(signOffBlockers({ keyItemsUnverified: 2, pendingQuantities: 1, linesWithoutRate: 1, coverageCleared: false, sampling: { evaluated: true, withinTolerance: false }, previewMode: false })).toHaveLength(5);
  });
});
