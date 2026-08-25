import { describe, it, expect } from "vitest";
import { classifyRequirements, findMissingDrawingScope, lineForRequirement } from "./boqMapping";
import { parseChatGptEvaluation, specFromEvaluation, boqBucketOf, itemBelongsToBoq } from "./chatgptEval";
import { generateForDiscipline } from "./disciplines";
import type { DrawingSummary } from "./boqDrawing";

// The Drawing Requirement → Catalogue mapping layer: every drawing requirement
// resolves to priced / drawing_item / quantity_pending, the quantity always comes
// from the drawing (never the catalogue), and nothing quantified ever disappears.

const drawItems = (spec: unknown): DrawingSummary =>
  ((spec as Record<string, unknown>)._drawing as DrawingSummary) ?? { items: [] };

function floor1Spec() {
  return specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1,
    boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
    area: 1800, area_type: "built-up",
    spaces: [{ name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 }],
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    requirements: [
      { allocation: "Floor 1", requirement: "WC", qty: 5, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Wash basin", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Kitchen platform", qty: 1, unit: "nos", basis: "Counted", note: "running length/material not established", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Wardrobe", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Flooring", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
      // Common Area — excluded from the Floor 1 spec by specFromEvaluation
      { allocation: "Common Area", requirement: "Passenger lift", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    ], confidence: {}, confirmations: [],
  })));
}

describe("classifyRequirements — three mapping states + provenance", () => {
  const spec = floor1Spec();
  const lines = generateForDiscipline("civil", spec, { area_sqft: 1800, floors: 4 });
  const map = classifyRequirements(drawItems(spec), lines);
  const by = (r: string) => map.find((m) => m.requirement === r);

  it("PRICED: WC maps to a DSR item and the drawing quantity transfers unchanged", () => {
    const wc = by("WC");
    expect(wc?.state).toBe("priced");
    expect(wc?.qty).toBe(5);                       // transferred unchanged from the drawing
    expect(wc?.dsr_code).toBe("17.2.1");
    expect(wc?.quantity_provenance).toBe("counted");
    expect(wc?.mapping_source).toBe("drawing");    // scope from the drawing, not the catalogue
    expect(wc?.specification_supported).toBe(false); // the drawing named WC, not the DSR spec
  });

  it("DRAWING_ITEM: a counted item with no reliable/compatible catalogue mapping stays unpriced", () => {
    expect(by("Wardrobe")?.state).toBe("drawing_item");     // nos, no nos-priced catalogue → not priced
    expect(by("Wardrobe")?.qty).toBe(4);
    expect(by("Kitchen platform")?.state).toBe("drawing_item"); // nos, catalogue is sqm → no conversion
    expect(by("Kitchen platform")?.qty).toBe(1);
  });

  it("QUANTITY_PENDING: an unquantifiable requirement keeps qty null", () => {
    expect(by("Flooring")?.state).toBe("quantity_pending");
    expect(by("Flooring")?.qty).toBeNull();
    expect(by("Flooring")?.quantity_provenance).toBe("none");
  });
});

describe("drawing scope survival invariant", () => {
  it("every quantified Floor-1 requirement survives as a priced or unpriced line", () => {
    const spec = floor1Spec();
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1800, floors: 4 });
    const missing = findMissingDrawingScope(drawItems(spec), lines);
    expect(missing).toEqual([]);                   // nothing quantified was dropped
    // WC priced, wardrobe/kitchen-platform survive as unpriced drawing lines
    expect(lineForRequirement({ match: "Wardrobe", qty: 4 }, lines)).toBeTruthy();
    expect(lineForRequirement({ match: "Kitchen platform", qty: 1 }, lines)).toBeTruthy();
  });

  it("Common Area scope is excluded from the Floor 1 spec, so it is not 'missing'", () => {
    const spec = floor1Spec();
    const items = drawItems(spec).items ?? [];
    expect(items.some((i) => /passenger lift/i.test(i.match))).toBe(false);  // never entered the Floor 1 bucket
  });
});

describe("quantity invariant — nos is never converted to an area/length without a measurement", () => {
  it("a 1-nos kitchen platform never becomes 1 sqm, and no granite-sqm line appears", () => {
    const spec = floor1Spec();
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1800, floors: 4 });
    const kp = lines.find((l) => /kitchen platform/i.test(l.label));
    expect(kp?.unit).toBe("nos");
    expect(kp?.qty).toBe(1);
    expect(lines.some((l) => /granite kitchen platform/i.test(l.label))).toBe(false);
  });
});

describe("bucket helper wiring (used by the survival filter across allocations)", () => {
  it("itemBelongsToBoq keeps unallocated + same-bucket, drops other buckets", () => {
    const bucket = boqBucketOf({ boqAllocation: "Floor 1", floor: 1 });
    expect(itemBelongsToBoq("Floor 1", bucket)).toBe(true);
    expect(itemBelongsToBoq("Common Area", bucket)).toBe(false);
  });
});
