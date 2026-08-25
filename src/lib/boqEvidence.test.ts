import { describe, it, expect } from "vitest";
import { hasQuantityEvidence, withQuantityEvidence } from "./boqEvidence";
import { generateForDiscipline } from "./disciplines";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { defaultSpec, type Spec } from "./boqSpec";
import type { GeneratedLine } from "./boqDsrGenerate";

// Quantity provenance gate: in a drawing-driven BOQ the catalogue supplies the
// item + rate but NEVER a fabricated quantity. Only drawing-counted/measured
// quantities (or derivations from entered measurements) may be priced. Coefficient
// / area-heuristic quantities are withheld — no matter the item, discipline or
// allocation. Questionnaire BOQs (explicit operator input) are unaffected.

// The catalogue coefficients the PDF exposed as fabricated (room-count / area
// derived), none of which the drawing measured.
const FABRICATED = /window grills|ceramic|wall tiling|soil pipe|CPVC|waterproofing|door shutters|door frames|granite kitchen platform|UPVC windows|dado|skirting|internal plaster|emulsion|primer|putty/i;

function drawingSpec(requirements: unknown[] = []): Spec {
  return specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1,
    boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
    area: 1800, area_type: "built-up",
    spaces: [{ name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 }],
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    requirements, confidence: {}, confirmations: [],
  })));
}

describe("hasQuantityEvidence — provenance of a line's quantity", () => {
  const mk = (over: Partial<GeneratedLine>): GeneratedLine => ({ section: "X", code: null, qty: 1, label: "x", unit: "nos", ...over });
  it("accepts drawing-counted / measured / derived quantities", () => {
    expect(hasQuantityEvidence(mk({ basis: "DRAWING_INPUT" }))).toBe(true);
    expect(hasQuantityEvidence(mk({ basis: "DRAWING_DERIVED" }))).toBe(true);
    expect(hasQuantityEvidence(mk({ drawing: { basis: "Counted", scope: "works" } }))).toBe(true);
  });
  it("rejects catalogue-coefficient and area-heuristic quantities", () => {
    expect(hasQuantityEvidence(mk({ basis: "DSR_AOR" }))).toBe(false);
    expect(hasQuantityEvidence(mk({ basis: "HEURISTIC" }))).toBe(false);
  });
});

describe("withQuantityEvidence — only drawing-driven BOQs are gated", () => {
  const lines: GeneratedLine[] = [
    { section: "RCC", code: "5.3", qty: 40, label: "RCC", unit: "cum", basis: "DSR_AOR" },
    { section: "Sanitary", code: "17.2.1", qty: 4, label: "WC", unit: "each", basis: "DRAWING_INPUT", drawing: { basis: "Counted", scope: "works" } },
  ];
  it("drops fabricated-quantity lines when the BOQ is drawing-driven", () => {
    const out = withQuantityEvidence(lines, { _source: "chatgpt" } as unknown as Spec);
    expect(out.map((l) => l.label)).toEqual(["WC"]);
  });
  it("keeps everything for a questionnaire/archetype BOQ (explicit input)", () => {
    expect(withQuantityEvidence(lines, defaultSpec())).toHaveLength(2);
  });
});

describe("unsupported catalogue quantities cannot enter a drawing-driven BOQ", () => {
  it("withholds every coefficient/heuristic quantity the PDF exposed as fabricated", () => {
    // Drawing identifies scope (some counted, some pending) but never measures the
    // template quantities (tiling area, pipe length, grill weight, door/window area…).
    const spec = drawingSpec([
      { allocation: "Floor 1", requirement: "WC", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Wash basin", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Kitchen platform", qty: 1, unit: "nos", basis: "Counted", note: "running length/material not established", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Windows", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "Doors", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "Wall finishes", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
    ]);
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1800, floors: 4 });
    // NONE of the fabricated catalogue quantities survive…
    expect(lines.some((l) => FABRICATED.test(l.label))).toBe(false);
    // …and specifically the ones flagged in the PDF are gone.
    for (const re of [/window grills/i, /ceramic|wall tiling/i, /soil pipe/i, /CPVC/i, /waterproofing/i, /door shutters/i, /door frames/i, /granite kitchen platform/i, /UPVC windows/i])
      expect(lines.some((l) => re.test(l.label)), `${re} should be withheld`).toBe(false);
    // every surviving priced line is drawing-derived, and quantities are real
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => !!l.drawing)).toBe(true);
  });

  it("keeps the drawing-derived quantities and never fabricates a kitchen-platform area", () => {
    const spec = drawingSpec([
      { allocation: "Floor 1", requirement: "WC", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Kitchen platform", qty: 1, unit: "nos", basis: "Counted", note: "running length/material not established", scope: "Works", status: "Quantified" },
    ]);
    const lines = generateForDiscipline("civil", spec, { area_sqft: 1800, floors: 4 });
    // the drawing WC count is priced…
    expect(lines.find((l) => /\bWC\b/i.test(l.label))?.qty).toBe(4);
    // …the kitchen platform survives as the drawing's own counted item (1 nos)…
    const kp = lines.find((l) => /kitchen platform/i.test(l.label));
    expect(kp?.qty).toBe(1);
    expect(kp?.unit).toBe("nos");
    // …and the generic "Granite kitchen platform — N sqm" catalogue line is NOT emitted.
    expect(lines.some((l) => /granite kitchen platform/i.test(l.label))).toBe(false);
  });

  it("does not gate a questionnaire/archetype BOQ (its quantities are explicit input)", () => {
    const lines = generateForDiscipline("civil", defaultSpec({ bathrooms: 2, kitchens: 1 }), { area_sqft: 1500, floors: 1 });
    // the questionnaire flow still prices catalogue coefficients (operator intent)
    expect(lines.some((l) => FABRICATED.test(l.label))).toBe(true);
  });
});
