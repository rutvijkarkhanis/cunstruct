import { describe, it, expect } from "vitest";
import { resolveQuantityRule } from "./quantityRules";

describe("resolveQuantityRule — backwards compatibility", () => {
  it("still resolves the existing residential coverage rules (generic item)", () => {
    const paint = resolveQuantityRule({ itemName: "Asian Paints Emulsion 10L" });
    expect(paint.precedence).toBe("generic-item");
    expect(paint.formula?.per_wall_sqft).toBeGreaterThan(0);

    const tile = resolveQuantityRule({ itemName: "Vitrified Floor Tile 600x600" });
    expect(tile.formula?.per_floor_sqft).toBeGreaterThan(0);

    const cement = resolveQuantityRule({ itemName: "UltraTech Cement PPC 50kg" });
    expect(cement.formula?.per_sqft).toBeCloseTo(0.45, 2);
  });
});

describe("resolveQuantityRule — project type is accepted and threaded", () => {
  const TYPES = ["Residential", "Commercial", "Retail", "Office", "Hospital", "Other"];
  it("accepts all supported project types without error", () => {
    for (const projectType of TYPES) {
      const r = resolveQuantityRule({ itemName: "Wall Putty", projectType });
      expect(r).toBeTruthy();
      expect(r.method).toBe("COVERAGE");
    }
  });

  it("does not invent a project-type ratio where none is configured", () => {
    // Kitchen counter has no coverage rule and no project-type rule → no formula.
    const r = resolveQuantityRule({ itemName: "Kitchen Counter", projectType: "Residential" });
    expect(r.formula).toBeNull();
    expect(r.precedence).toBe("none");
    expect(r.method).toBe("LENGTH");
  });
});

describe("resolveQuantityRule — precedence", () => {
  it("a project-specific override (item qty_formula) beats the generic rule", () => {
    const r = resolveQuantityRule({
      itemName: "Asian Paints Emulsion 10L", // would otherwise be per_wall_sqft
      override: { per_floor_sqft: 0.02 },
    });
    expect(r.precedence).toBe("project-override");
    expect(r.formula?.per_floor_sqft).toBe(0.02);
    expect(r.formula?.per_wall_sqft).toBeUndefined();
  });

  it("an override without a real basis does NOT win (price-only is not a basis)", () => {
    const r = resolveQuantityRule({
      itemName: "Asian Paints Emulsion 10L",
      override: { unit_price: 250 },
    });
    expect(r.precedence).toBe("generic-item");
    expect(r.formula?.per_wall_sqft).toBeGreaterThan(0);
  });

  it("falls through to PENDING (no rule) when nothing matches, keeping methodology", () => {
    const r = resolveQuantityRule({ itemName: "Wardrobe", projectType: "Residential" });
    expect(r.precedence).toBe("none");
    expect(r.formula).toBeNull();
    expect(r.method).toBe("LENGTH");
    expect(r.unit).toBe("rft");
  });
});
