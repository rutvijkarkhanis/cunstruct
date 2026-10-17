import { describe, it, expect } from "vitest";
import { lineStats, statsByBoq, type OverviewLine } from "./overview";

const line = (p: Partial<OverviewLine>): OverviewLine => ({
  boq_id: "b1", qty: 10, quantity_status: null, dsr_rate: 100, custom_rate: null, included: true, source_document_id: null, ...p,
});

describe("lineStats", () => {
  it("classifies included lines as pending, unpriced or complete, and ignores excluded ones", () => {
    const s = lineStats([
      line({}),                                            // complete
      line({ qty: 0 }),                                    // pending: unmeasured zero
      line({ qty: 0, quantity_status: "MEASURED" }),       // complete: confirmed zero
      line({ quantity_status: "PENDING" }),                // pending even with qty
      line({ dsr_rate: null }),                            // unpriced
      line({ dsr_rate: null, custom_rate: 50 }),           // complete via custom rate
      line({ included: false, qty: 0 }),                   // excluded: not counted
      line({ source_document_id: "d1" }),                  // complete, sourced
    ]);
    expect(s).toEqual({ total: 8, included: 7, pendingQty: 2, unpriced: 1, complete: 4, withSource: 1 });
  });
  it("groups by BOQ", () => {
    const m = statsByBoq([line({ boq_id: "a" }), line({ boq_id: "b", qty: 0 }), line({ boq_id: "a" })]);
    expect(m.get("a")?.complete).toBe(2);
    expect(m.get("b")?.pendingQty).toBe(1);
  });
});
