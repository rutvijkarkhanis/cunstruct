import { describe, it, expect } from "vitest";
import { buildIndicativeEstimate, canInclude, classifyIndicativeLine, type IndicativeLine } from "./indicativeCosting";
import type { DsrMappingRow } from "./dsrMapping";

const line = (o: Partial<IndicativeLine> & { id: string }): IndicativeLine => ({
  description: o.id, unit: "cum", qty: 10, included: true, quantity_status: null, ...o,
});
const mapping = (o: Partial<DsrMappingRow> & { boq_line_id: string }): DsrMappingRow => ({
  id: `m-${o.boq_line_id}`, boq_id: "boq-1", status: "mapped", include_in_estimate: true,
  dsr_item_id: "dsr-1", dsr_code: "4.1.3", dsr_description: "PCC 1:2:4", dsr_unit: "cum", dsr_rate: 100,
  dsr_source: "DSR", dsr_rate_year: "2023", reviewer_note: null, reviewed_by: null, reviewed_at: null, ...o,
});

describe("classifyIndicativeLine", () => {
  it("prices an included, mapped, unit-matched line from qty × SNAPSHOT rate", () => {
    const row = classifyIndicativeLine(line({ id: "a", qty: 12.5 }), mapping({ boq_line_id: "a", dsr_rate: 80 }));
    expect(row).toMatchObject({ status: "priced", rate: 80, amount: 1000, unitCheck: "match" });
  });

  it("ignores the line's commercial rates entirely", () => {
    const withCommercial = { ...line({ id: "a" }), dsr_rate: 999, custom_rate: 555 } as IndicativeLine;
    expect(classifyIndicativeLine(withCommercial, mapping({ boq_line_id: "a", dsr_rate: 100 })).amount).toBe(1000);
  });

  it("does not price an eligible line the reviewer has not included", () => {
    const row = classifyIndicativeLine(line({ id: "a" }), mapping({ boq_line_id: "a", include_in_estimate: false }));
    expect(row).toMatchObject({ status: "eligible", amount: null });
    expect(canInclude(row)).toBe(true);
  });

  it.each([
    ["unmapped", line({ id: "a" }), null],
    ["unmatched", line({ id: "a" }), mapping({ boq_line_id: "a", status: "unmatched", dsr_code: null, dsr_rate: null })],
    ["needs_review", line({ id: "a" }), mapping({ boq_line_id: "a", status: "needs_review" })],
    ["missing_rate", line({ id: "a" }), mapping({ boq_line_id: "a", dsr_rate: null })],
    ["missing_rate", line({ id: "a" }), mapping({ boq_line_id: "a", dsr_rate: 0 })],
    ["unit_mismatch", line({ id: "a", unit: "sqm" }), mapping({ boq_line_id: "a", dsr_unit: "cum" })],
    ["unit_unknown", line({ id: "a", unit: null }), mapping({ boq_line_id: "a" })],
    ["missing_quantity", line({ id: "a", qty: 0, quantity_status: "PENDING" }), mapping({ boq_line_id: "a" })],
    ["missing_quantity", line({ id: "a", qty: null }), mapping({ boq_line_id: "a" })],
    ["excluded", line({ id: "a", included: false }), mapping({ boq_line_id: "a" })],
  ] as const)("blocks %s — no amount, even when include_in_estimate is set", (status, l, m) => {
    const row = classifyIndicativeLine(l, m);
    expect(row.status).toBe(status);
    expect(row.amount).toBeNull();
    expect(row.rate).toBeNull();
    expect(canInclude(row)).toBe(false);
  });

  // P2-4: the same pending rule as every BOQ total and export (lib/quantity).
  it("uses the shared pending rule — basis PENDING, an unconfirmed zero and a negative are never priced", () => {
    for (const l of [
      line({ id: "a", qty: 7, basis: "PENDING" }),
      line({ id: "a", qty: 0, quantity_status: null }),
      line({ id: "a", qty: -1 }),
      line({ id: "a", qty: Number.NaN }),
    ]) {
      const row = classifyIndicativeLine(l, mapping({ boq_line_id: "a" }));
      expect(row).toMatchObject({ status: "missing_quantity", amount: null, rate: null });
    }
  });

  it("a confirmed zero (MEASURED/COUNTED) is an established quantity and prices at a real ₹0, distinct from pending", () => {
    for (const st of ["MEASURED", "COUNTED"]) {
      const row = classifyIndicativeLine(line({ id: "a", qty: 0, quantity_status: st }), mapping({ boq_line_id: "a" }));
      expect(row).toMatchObject({ status: "priced", rate: 100, amount: 0 });
    }
  });

  it("reports the unit mismatch alongside a different headline blocker", () => {
    const row = classifyIndicativeLine(line({ id: "a", unit: "sqm" }), mapping({ boq_line_id: "a", dsr_rate: null }));
    expect(row.status).toBe("missing_rate");
    expect(row.unitCheck).toBe("mismatch");
  });
});

describe("buildIndicativeEstimate", () => {
  const lines = [
    line({ id: "priced-1", qty: 10 }),
    line({ id: "priced-2", qty: 2, unit: "sqm" }),
    line({ id: "eligible", qty: 5 }),
    line({ id: "unmapped" }),
    line({ id: "review" }),
    line({ id: "mismatch", unit: "rmt" }),
    line({ id: "excluded", included: false }),
  ];
  const mappings = [
    mapping({ boq_line_id: "priced-1", dsr_rate: 100 }),
    mapping({ boq_line_id: "priced-2", dsr_rate: 250, dsr_unit: "sqm" }),
    mapping({ boq_line_id: "eligible", include_in_estimate: false }),
    mapping({ boq_line_id: "review", status: "needs_review", include_in_estimate: false }),
    mapping({ boq_line_id: "mismatch", dsr_unit: "sqm" }),
    mapping({ boq_line_id: "excluded" }),
  ];

  it("sums only priced amounts and flags the total as partial", () => {
    const est = buildIndicativeEstimate(lines, mappings);
    expect(est.total).toBe(1000 + 500);
    expect(est.partial).toBe(true);
    expect(est.counts).toMatchObject({
      inScope: 6, priced: 2, unpriced: 4, eligible: 1, unmapped: 1, needsReview: 1, unitMismatch: 1, excluded: 1,
    });
  });

  it("is not partial once every in-scope line is priced (excluded lines don't count)", () => {
    const est = buildIndicativeEstimate(
      [line({ id: "a" }), line({ id: "x", included: false })],
      [mapping({ boq_line_id: "a" })],
    );
    expect(est).toMatchObject({ total: 1000, partial: false });
  });

  it("keeps line-level traceability to the BOQ line and its DSR snapshot", () => {
    const row = buildIndicativeEstimate(lines, mappings).rows.find((r) => r.line.id === "priced-1")!;
    expect(row.line.id).toBe("priced-1");
    expect(row.mapping).toMatchObject({ dsr_item_id: "dsr-1", dsr_code: "4.1.3", dsr_source: "DSR", dsr_rate_year: "2023" });
  });

  it("an empty BOQ yields a zero, non-partial estimate", () => {
    expect(buildIndicativeEstimate([], [])).toMatchObject({ total: 0, partial: false });
  });
});
