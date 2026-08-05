import { describe, it, expect } from "vitest";
import { suggestQty, suggestQtyDetailed } from "./boq";
import type { Dimensions } from "./dimensions";

const dims = (over: Partial<Dimensions> = {}): Dimensions => ({
  floorAreaSqft: 0, wallAreaSqft: 0, rooms: 0, bathrooms: 0, points: 0, ...over,
});

describe("suggestQty", () => {
  it("scales per_floor_sqft by floor area with wastage, rounding up", () => {
    // 1000 floor × 0.025 = 25, +10% = 27.5 -> 28
    expect(suggestQty({ product_id: "x", qty_formula: { per_floor_sqft: 0.025 }, buffer_pct: 10 }, dims({ floorAreaSqft: 1000 }))).toBe(28);
  });

  it("scales per_wall_sqft by wall area", () => {
    // 340 wall × 0.02 = 6.8, +0% -> 7
    expect(suggestQty({ product_id: "x", qty_formula: { per_wall_sqft: 0.02 }, buffer_pct: 0 }, dims({ wallAreaSqft: 340 }))).toBe(7);
  });

  it("scales per_point by electrical points", () => {
    expect(suggestQty({ product_id: "x", qty_formula: { per_point: 15 }, buffer_pct: 0 }, dims({ points: 10 }))).toBe(150);
  });

  it("scales per_bathroom and per_room", () => {
    expect(suggestQty({ product_id: "x", qty_formula: { per_bathroom: 1 }, buffer_pct: 0 }, dims({ bathrooms: 3 }))).toBe(3);
    expect(suggestQty({ product_id: "x", qty_formula: { per_room: 2 }, buffer_pct: 0 }, dims({ rooms: 4 }))).toBe(8);
  });

  it("uses built-up area for per_sqft when provided, else floor area", () => {
    expect(suggestQty({ product_id: "x", qty_formula: { per_sqft: 0.4 }, buffer_pct: 0 }, dims({ floorAreaSqft: 100 }), 1000)).toBe(400);
    expect(suggestQty({ product_id: "x", qty_formula: { per_sqft: 0.4 }, buffer_pct: 0 }, dims({ floorAreaSqft: 100 }))).toBe(40);
  });

  it("rounds up to pack size", () => {
    // 1000 floor × 0.025 = 25, +10% = 27.5, pack 5 -> 30
    expect(suggestQty({ product_id: "x", qty_formula: { per_floor_sqft: 0.025, pack_size: 5 }, buffer_pct: 10 }, dims({ floorAreaSqft: 1000 }))).toBe(30);
  });

  it("guards against float artifacts on clean results", () => {
    // 1000 × 0.05 = 50, +10% = 55.00000001 without the guard
    expect(suggestQty({ product_id: "x", qty_formula: { per_sqft: 0.05 }, buffer_pct: 10 }, dims(), 1000)).toBe(55);
  });

  it("falls back to 1 with no formula", () => {
    const r = suggestQtyDetailed({ product_id: "x" }, dims({ floorAreaSqft: 1000 }));
    expect(r.qty).toBe(1);
    expect(r.isFallback).toBe(true);
  });

  it("drops to 0 (not 1) when a basis is set but its driver is zero", () => {
    // per_bathroom item with no bathrooms → genuinely nothing needed
    const r = suggestQtyDetailed({ product_id: "x", qty_formula: { per_bathroom: 1 } }, dims({ bathrooms: 0 }));
    expect(r.qty).toBe(0);
    expect(r.isFallback).toBe(false);
  });

  it("explains the derivation", () => {
    const r = suggestQtyDetailed({ product_id: "x", qty_formula: { per_wall_sqft: 0.02 }, buffer_pct: 10 }, dims({ wallAreaSqft: 340 }));
    expect(r.explanation).toContain("wall sq.ft");
    expect(r.explanation).toContain("0.02");
  });
});
