import { describe, it, expect } from "vitest";
import { auditBoq, auditCountsLine } from "./boqAudit";
import type { DrawingSummary } from "./boqDrawing";
import type { GeneratedLine } from "./boqDsrGenerate";

const line = (p: Partial<GeneratedLine>): GeneratedLine => ({
  section: "S", code: null, qty: 1, label: "x", unit: "nos", ...p,
});

describe("auditBoq — counts", () => {
  it("buckets requirements by measurement method, mapping state, equipment and excluded", () => {
    const summary: DrawingSummary = {
      items: [
        { match: "WC", qty: 5, basis: "Counted", status: "Quantified" },                 // counted, priced
        { match: "Kitchen flooring", qty: 126, basis: "Derived", calculation: "12' × 10.5' = 126 sqft" }, // derived
        { match: "Wardrobe", qty: 3, basis: "Counted" },                                  // counted, rate-pending
        { match: "Feature wall", qty: null, pending: true },                              // pending
        { match: "Television", qty: 1, scope: "equipment" },                              // equipment (counted)
      ],
    };
    const lines: GeneratedLine[] = [
      line({ label: "European WC with cistern", code: "17.2.1", qty: 5, drawing: { basis: "Counted", scope: "works" } }),
      line({ label: "Wardrobe", code: null, qty: 3, drawing: { basis: "Counted", scope: "works" } }),
      line({ label: "Kitchen flooring", code: null, qty: 126, drawing: { basis: "Derived", scope: "works" } }),
    ];
    const { counts } = auditBoq(summary, null, lines);
    expect(counts.requirements).toBe(5);
    expect(counts.priced).toBe(1);        // WC → coded line
    expect(counts.ratePending).toBe(2);   // Wardrobe + Kitchen flooring (no code)
    expect(counts.counted).toBe(3);       // WC, Wardrobe, Television
    expect(counts.derived).toBe(1);       // Kitchen flooring
    expect(counts.pending).toBe(1);       // Feature wall
    expect(counts.equipment).toBe(1);     // Television
    expect(auditCountsLine(counts)).toContain("5 requirements");
  });
});

describe("auditBoq — findings (conflicts are flagged, not resolved)", () => {
  it("flags a duplicate (same requirement, same quantity)", () => {
    const summary: DrawingSummary = { items: [
      { match: "Ceiling fan point", qty: 2, allocation: "Floor 1" },
      { match: "Ceiling fan point", qty: 2, allocation: "Floor 1" },
    ] };
    const f = auditBoq(summary, null, []).findings.find((x) => x.kind === "duplicate");
    expect(f).toBeDefined();
  });

  it("flags a quantity conflict (same requirement, different quantities)", () => {
    const summary: DrawingSummary = { items: [
      { match: "15A socket", qty: 25, allocation: "Floor 1" },
      { match: "15A socket", qty: 20, allocation: "Floor 1" },
    ] };
    const f = auditBoq(summary, null, []).findings.find((x) => x.kind === "quantity_conflict");
    expect(f).toBeDefined();
    expect(f!.detail).toContain("25");
    expect(f!.detail).toContain("20");
  });

  it("flags potential double-counting of a composite and its component", () => {
    const summary: DrawingSummary = { items: [
      { match: "European WC with cistern, complete", qty: 5 },
      { match: "Flush cistern", qty: 5 },
    ] };
    const f = auditBoq(summary, null, []).findings.find((x) => x.kind === "double_count");
    expect(f).toBeDefined();
    expect(f!.items).toContain("Flush cistern");
  });

  it("flags a priced quantity with no drawing evidence (gate leak)", () => {
    const lines: GeneratedLine[] = [
      line({ label: "Flooring (area heuristic)", qty: 900, basis: "HEURISTIC" }),
    ];
    const f = auditBoq({ items: [] }, null, lines).findings.find((x) => x.kind === "unjustified_quantity");
    expect(f).toBeDefined();
  });

  it("flags a quantified requirement that did not survive into a line", () => {
    const summary: DrawingSummary = { items: [{ match: "Tube light", qty: 9, allocation: "Floor 1" }] };
    const f = auditBoq(summary, null, []).findings.find((x) => x.kind === "missing_from_boq");
    expect(f).toBeDefined();
    expect(f!.items).toContain("Tube light");
  });

  it("a clean drawing-driven BOQ produces no findings", () => {
    const summary: DrawingSummary = { items: [{ match: "WC", qty: 5 }] };
    const lines: GeneratedLine[] = [
      line({ label: "WC", code: "17.2.1", qty: 5, drawing: { basis: "Counted", scope: "works" } }),
    ];
    expect(auditBoq(summary, null, lines).findings).toHaveLength(0);
  });
});
