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

  // Regression guards for the coverage-rate corrections validated against real
  // Indian thumb-rules. These caught genuine over-estimation bugs (putty ~16x,
  // plaster ~3x) — keep the sane ranges pinned so they can't quietly return.
  it("uses realistic putty coverage (~1 bag per 500 wall-sqft, not per 30)", () => {
    const putty = resolveCoverage("Birla Wall Putty 40kg")!;
    // 1200 wall-sqft should need ~2–3 bags, never dozens.
    const bags = 1200 * (putty.per_wall_sqft as number);
    expect(bags).toBeLessThan(4);
    expect(bags).toBeGreaterThan(1);
  });

  it("uses realistic plaster cement (~1 bag per ~110 wall-sqft)", () => {
    const plaster = resolveCoverage("Internal Cement Plaster")!;
    const bagsPer100 = 100 * (plaster.per_wall_sqft as number);
    expect(bagsPer100).toBeLessThan(1.3); // internal 12mm 1:6 ≈ 0.65–0.9 bag/100 sqft
  });

  it("keeps structural rates in the real thumb-rule range", () => {
    expect(resolveCoverage("TMT Steel Fe550")?.per_sqft).toBeGreaterThanOrEqual(4.0); // residential norm
    expect(resolveCoverage("AAC Block 600x200")?.per_sqft).toBeLessThanOrEqual(6); // per built-up sqft
    expect(resolveCoverage("UltraTech Cement PPC 50kg")?.per_sqft).toBeCloseTo(0.45, 2);
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
