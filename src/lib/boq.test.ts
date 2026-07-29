import { describe, it, expect } from "vitest";
import { suggestQty } from "./boq";

describe("suggestQty", () => {
  it("scales per_sqft by area and applies the wastage buffer, rounding up", () => {
    // 0.05 bags/sqft × 1000 sqft = 50, +10% buffer = 55
    expect(suggestQty({ product_id: "x", qty_formula: { per_sqft: 0.05 }, buffer_pct: 10 }, 1000)).toBe(55);
  });

  it("uses a fixed quantity when there is no per_sqft", () => {
    expect(suggestQty({ product_id: "x", qty_formula: { fixed: 4 }, buffer_pct: 0 }, 1000)).toBe(4);
  });

  it("falls back to 1 when there is no formula", () => {
    expect(suggestQty({ product_id: "x" }, 1000)).toBe(1);
  });

  it("ignores per_sqft when area is missing", () => {
    expect(suggestQty({ product_id: "x", qty_formula: { per_sqft: 0.05 }, buffer_pct: 0 }, null)).toBe(1);
  });

  it("rounds fractional results up", () => {
    // 0.03 × 1000 = 30, +10% = 33 exactly; 0.031 × 1000 = 31, +10% = 34.1 -> 35
    expect(suggestQty({ product_id: "x", qty_formula: { per_sqft: 0.031 }, buffer_pct: 10 }, 1000)).toBe(35);
  });
});
