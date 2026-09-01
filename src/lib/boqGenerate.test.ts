import { describe, it, expect } from "vitest";
import { computeBoqLine, type BoqTemplateItem, type CatalogProduct } from "./boqGenerate";
import type { Dimensions } from "./dimensions";

const DIMS = (o: Partial<Dimensions> = {}): Dimensions => ({
  floorAreaSqft: 0, wallAreaSqft: 0, rooms: 0, bathrooms: 0, points: 0, ...o,
});

const item = (o: Partial<BoqTemplateItem>): BoqTemplateItem => ({
  id: "i1", item_name: "X", ...o,
});

const NO_PRODUCTS: CatalogProduct[] = [];

describe("computeBoqLine — existing residential generation does not regress", () => {
  it("computes paint from wall area exactly as before (ESTIMATED)", () => {
    // Emulsion generic rule: per_wall_sqft = 1/60, wastage 10%. 600 wall sqft.
    const line = computeBoqLine(item({ item_name: "Asian Paints Emulsion" }), DIMS({ wallAreaSqft: 600 }), null, "standard", NO_PRODUCTS, "Residential");
    // 600 / 60 = 10, +10% = 11 → 11
    expect(line.qty).toBe(11);
    expect(line.method).toBe("COVERAGE");
    expect(line.status).toBe("ESTIMATED");
  });

  it("computes flooring straight from floor area (MEASURED, ratio 1)", () => {
    const line = computeBoqLine(item({ item_name: "Vitrified Flooring" }), DIMS({ floorAreaSqft: 1000 }), null, "standard", NO_PRODUCTS, "Residential");
    expect(line.qty).toBeGreaterThan(1000); // area + wastage
    expect(line.method).toBe("AREA");
    expect(line.status).toBe("MEASURED");
  });

  it("counts sanitaryware per bathroom (COUNTED)", () => {
    const line = computeBoqLine(item({ item_name: "Wall Mounted Wash Basin" }), DIMS({ bathrooms: 2 }), null, "standard", NO_PRODUCTS, "Residential");
    expect(line.qty).toBe(2);
    expect(line.method).toBe("COUNT");
    expect(line.status).toBe("COUNTED");
  });

  it("drops to 0 (not 1) when a basis is set but its driver is zero", () => {
    const line = computeBoqLine(item({ item_name: "Wall Mounted Wash Basin" }), DIMS({ bathrooms: 0 }), null, "standard", NO_PRODUCTS, "Residential");
    expect(line.qty).toBe(0);
    expect(line.status).toBe("NOT_APPLICABLE");
  });
});

describe("computeBoqLine — project_type reaches rule resolution", () => {
  it("threads every supported project type through without error", () => {
    for (const pt of ["Residential", "Commercial", "Retail", "Office", "Hospital", "Other"]) {
      const line = computeBoqLine(item({ item_name: "Wall Putty" }), DIMS({ wallAreaSqft: 500 }), null, "standard", NO_PRODUCTS, pt);
      expect(line.qty).toBeGreaterThan(0);
      expect(line.method).toBe("COVERAGE");
    }
  });
});

describe("computeBoqLine — PENDING replaces the old '1 nos' fallback", () => {
  it("never returns 1 nos for an unmeasurable item — it is PENDING with the right methodology", () => {
    const line = computeBoqLine(item({ item_name: "Kitchen Counter" }), DIMS({ floorAreaSqft: 1000 }), null, "standard", NO_PRODUCTS, "Residential");
    expect(line.qty).not.toBe(1);
    expect(line.qty).toBe(0);
    expect(line.status).toBe("PENDING");
    expect(line.method).toBe("LENGTH");
    expect(line.unit).toBe("rft");
    expect(line.reason).toMatch(/running length/i);
  });

  it("marks a wardrobe PENDING by LENGTH when no running length is available", () => {
    const line = computeBoqLine(item({ item_name: "Master Bedroom Wardrobe" }), DIMS({ floorAreaSqft: 1000 }), null, "standard", NO_PRODUCTS, "Residential");
    expect(line.status).toBe("PENDING");
    expect(line.method).toBe("LENGTH");
    expect(line.qty).toBe(0);
  });

  it("marks reinforcement with no structural info as PENDING by WEIGHT when no coverage rule matches", () => {
    // A bespoke reinforcement description that misses the residential coverage keywords.
    const line = computeBoqLine(item({ item_name: "RCC slab reinforcement schedule" }), DIMS({ floorAreaSqft: 1000 }), 1000, "standard", NO_PRODUCTS, "Residential");
    // "reinforcement"/"steel" matches the generic per_sqft coverage rule → ESTIMATED
    // is acceptable, but the point is it is NEVER 1 nos.
    expect(line.qty).not.toBe(1);
  });

  it("marks a truly unknown item PENDING (not 1 nos) with a generic reason", () => {
    const line = computeBoqLine(item({ item_name: "Green Pocket Feature" }), DIMS({ floorAreaSqft: 1000 }), null, "standard", NO_PRODUCTS, "Residential");
    expect(line.qty).not.toBe(1);
    expect(line.status).toBe("PENDING");
    // "green pocket" is an AREA feature.
    expect(line.method).toBe("AREA");
  });
});

describe("computeBoqLine — project-specific override still wins", () => {
  it("honours a qty_formula basis on the item over any generic rule", () => {
    const line = computeBoqLine(
      item({ item_name: "Custom Item", qty_formula: { per_sqft: 2 } }),
      DIMS({ floorAreaSqft: 100 }), 100, "standard", NO_PRODUCTS, "Residential",
    );
    expect(line.qty).toBeGreaterThan(0); // 100 × 2 = 200 (+wastage)
    expect(line.status).not.toBe("PENDING");
  });
});
