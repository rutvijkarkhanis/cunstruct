import { describe, it, expect } from "vitest";
import { aggregateReadiness, aggregateProjectReadiness, type BoqReadinessGroup } from "./readiness";
import type { ReconciliationStatus } from "./instanceReconciliation";

describe("aggregateReadiness — item-level aggregation", () => {
  it("counts GREEN/AMBER/RED correctly and computes readyPct from GREEN/total", () => {
    const statuses: ReconciliationStatus[] = ["GREEN", "GREEN", "AMBER", "RED"];
    expect(aggregateReadiness(statuses)).toEqual({ green: 2, amber: 1, red: 1, total: 4, readyPct: 50 });
  });

  it("rounds readyPct to the nearest whole number", () => {
    const statuses: ReconciliationStatus[] = ["GREEN", "GREEN", "AMBER"];
    expect(aggregateReadiness(statuses).readyPct).toBe(67);
  });

  it("an all-GREEN set is 100% ready", () => {
    const statuses: ReconciliationStatus[] = ["GREEN", "GREEN", "GREEN"];
    expect(aggregateReadiness(statuses)).toEqual({ green: 3, amber: 0, red: 0, total: 3, readyPct: 100 });
  });

  it("an empty list is 0 total and 0% ready, never divides by zero", () => {
    expect(aggregateReadiness([])).toEqual({ green: 0, amber: 0, red: 0, total: 0, readyPct: 0 });
  });
});

describe("aggregateProjectReadiness — BOQ-level and multi-BOQ project aggregation", () => {
  it("rolls a single BOQ's statuses into its own counts (BOQ aggregation)", () => {
    const groups: BoqReadinessGroup[] = [
      { boqId: "boq-1", boqName: "Civil BOQ", discipline: "civil", statuses: ["GREEN", "AMBER", "RED", "GREEN"] },
    ];
    const result = aggregateProjectReadiness(groups);
    expect(result.byBoq).toEqual([
      { boqId: "boq-1", boqName: "Civil BOQ", discipline: "civil", counts: { green: 2, amber: 1, red: 1, total: 4, readyPct: 50 } },
    ]);
    expect(result.overall).toEqual({ green: 2, amber: 1, red: 1, total: 4, readyPct: 50 });
  });

  it("combines multiple BOQs/disciplines into one overall total while keeping each BOQ's own counts separate (multi-BOQ project aggregation)", () => {
    const groups: BoqReadinessGroup[] = [
      { boqId: "boq-civil", boqName: "Civil BOQ", discipline: "civil", statuses: ["GREEN", "GREEN"] },
      { boqId: "boq-plumbing", boqName: "Plumbing BOQ", discipline: "plumbing", statuses: ["AMBER", "RED", "RED"] },
    ];
    const result = aggregateProjectReadiness(groups);

    expect(result.byBoq).toHaveLength(2);
    expect(result.byBoq[0]).toEqual({ boqId: "boq-civil", boqName: "Civil BOQ", discipline: "civil", counts: { green: 2, amber: 0, red: 0, total: 2, readyPct: 100 } });
    expect(result.byBoq[1]).toEqual({ boqId: "boq-plumbing", boqName: "Plumbing BOQ", discipline: "plumbing", counts: { green: 0, amber: 1, red: 2, total: 3, readyPct: 0 } });

    // Overall combines ALL groups' statuses into one total, never just the first group's.
    expect(result.overall).toEqual({ green: 2, amber: 1, red: 2, total: 5, readyPct: 40 });
  });

  it("preserves group order in byBoq, and handles zero groups as an empty, zeroed overall", () => {
    expect(aggregateProjectReadiness([])).toEqual({
      overall: { green: 0, amber: 0, red: 0, total: 0, readyPct: 0 },
      byBoq: [],
    });
  });

  it("a BOQ with no items contributes zeroed counts without affecting other BOQs' totals", () => {
    const groups: BoqReadinessGroup[] = [
      { boqId: "boq-empty", boqName: "Fire BOQ", discipline: "fire", statuses: [] },
      { boqId: "boq-full", boqName: "HVAC BOQ", discipline: "hvac", statuses: ["GREEN"] },
    ];
    const result = aggregateProjectReadiness(groups);
    expect(result.byBoq[0].counts).toEqual({ green: 0, amber: 0, red: 0, total: 0, readyPct: 0 });
    expect(result.overall).toEqual({ green: 1, amber: 0, red: 0, total: 1, readyPct: 100 });
  });
});
