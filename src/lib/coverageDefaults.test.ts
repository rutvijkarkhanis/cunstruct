import { describe, it, expect } from "vitest";
import { resolveCoverage, hasBasis } from "./coverageDefaults";

describe("resolveCoverage", () => {
  it("matches finishes to wall-area basis", () => {
    expect(resolveCoverage("Asian Paints Emulsion 10L")?.per_wall_sqft).toBeGreaterThan(0);
    expect(resolveCoverage("Birla Wall Putty 40kg")?.per_wall_sqft).toBeGreaterThan(0);
  });

  it("matches flooring to floor-area basis", () => {
    expect(resolveCoverage("Vitrified Floor Tile 600x600")?.per_floor_sqft).toBeGreaterThan(0);
    expect(resolveCoverage("Tile Adhesive 20kg")?.per_floor_sqft).toBeGreaterThan(0);
  });

  it("matches electrical to per-point basis", () => {
    expect(resolveCoverage("Finolex Wire 1.5mm")?.per_point).toBeGreaterThan(0);
    expect(resolveCoverage("Modular Switch 6A")?.per_point).toBe(1);
  });

  it("matches sanitaryware to per-bathroom basis", () => {
    expect(resolveCoverage("Wall Mounted Wash Basin")?.per_bathroom).toBe(1);
  });

  it("matches cement to built-up (per_sqft) basis", () => {
    expect(resolveCoverage("UltraTech Cement PPC 50kg")?.per_sqft).toBeGreaterThan(0);
  });

  it("returns null when nothing matches", () => {
    expect(resolveCoverage("Mystery Widget")).toBeNull();
  });
});

describe("hasBasis", () => {
  it("is true when any basis is present", () => {
    expect(hasBasis({ per_floor_sqft: 0.02 })).toBe(true);
    expect(hasBasis({ fixed: 3 })).toBe(true);
  });
  it("is false for empty / price-only formulas", () => {
    expect(hasBasis(null)).toBe(false);
    expect(hasBasis({})).toBe(false);
    expect(hasBasis({ unit_price: 100 })).toBe(false);
  });
});
