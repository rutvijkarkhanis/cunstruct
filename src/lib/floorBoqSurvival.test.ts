import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { generateForDiscipline } from "./disciplines";
import { applyDrawing } from "./boqDrawing";
import type { DrawingItem, DrawingSummary } from "./boqDrawing";

// The Floor 1 drawing evaluation reports 61 private-apartment requirements —
// 22 quantified + 39 identified-for-review — plus separate Common Area scope.
// The downstream mapping must land ALL 61 Floor 1 requirements in the generated
// Floor 1 BOQ/Drawing rows (one combined BOQ), preserving qty = null for the
// unquantified ones (never coerced to 0), keeping allocation = Floor 1, keeping
// the Works / Equipment / Needs-confirmation distinction, and excluding Common
// Area and other floors.

const QUANTIFIED = 22;
const NEEDS_DETAIL = 39;
const TOTAL_FLOOR1 = QUANTIFIED + NEEDS_DETAIL; // 61

/** A representative Floor 1 evaluation: 22 quantified + 39 identified-for-review
 *  private requirements (mixing Works / Equipment / Needs-confirmation), plus 2
 *  Common Area items that must NOT enter this BOQ. */
function floor1EvaluationJson(): string {
  const requirements: unknown[] = [];
  for (let i = 1; i <= QUANTIFIED; i++) {
    requirements.push({
      allocation: "Floor 1", requirement: `Quantified item ${i}`, qty: i, unit: "nos",
      basis: "Counted", location: `Room ${i}`, note: "", scope: "Works", status: "Quantified",
    });
  }
  for (let i = 1; i <= NEEDS_DETAIL; i++) {
    // Vary the scope so the trichotomy is exercised across the review items.
    const scope = i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Works" : "Needs confirmation";
    requirements.push({
      allocation: "Floor 1", requirement: `Review item ${i}`, qty: null, unit: null,
      basis: "Not assessable", location: `Room ${i}`, note: "Running length not established",
      scope, status: "Identified — Needs detail",
    });
  }
  // Common Area scope — identified, but priced into the Common Area BOQ, never Floor 1.
  requirements.push({ allocation: "Common Area", requirement: "Passenger lift", qty: 2, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" });
  requirements.push({ allocation: "Common Area", requirement: "Common corridor lighting", qty: 8, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" });

  return JSON.stringify({
    project_type: "Residential",
    archetype: "Apartment",
    floor: 1,
    boq_allocation: "Floor 1",
    floor_scope: "First Floor / Floor 1 private apartment",
    area: 3960,
    area_type: "built-up",
    spaces: [
      { name: "Master Bedroom", qty: 1, basis: "Counted" },
      { name: "Bedroom", qty: 3, basis: "Counted" },
      { name: "Bathroom", qty: 4, basis: "Counted" },
      { name: "Kitchen", qty: 2, basis: "Counted" },
      { name: "Balcony", qty: 4, basis: "Counted" },
      { name: "Living", qty: 1, basis: "Counted" },
    ],
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    measurements: [],
    requirements,
    category_summary: {},
    confidence: { project_type: "High", archetype: "High", floor: "High" },
    confirmations: [],
  });
}

describe("Floor 1 requirements survive downstream into the BOQ/Drawing rows", () => {
  const e = parseChatGptEvaluation(floor1EvaluationJson());
  const spec = specFromEvaluation(e);
  const drawItems = ((spec as Record<string, unknown>)._drawing as DrawingSummary | undefined)?.items ?? [];

  it("parses quantified vs identified-for-review, keeping null quantities as null", () => {
    // parseChatGptEvaluation does not filter by allocation, so the 2 Common Area
    // quantified items sit in `requirements` alongside the 22 Floor 1 ones here.
    expect(e.requirements.length).toBe(QUANTIFIED + 2);
    expect(e.needsDetail.length).toBe(NEEDS_DETAIL);
    // Every review item is pending with a genuine null quantity — never 0/assumed —
    // and no invented basis.
    for (const d of e.needsDetail) {
      expect(d.qty).toBeNull();
      expect(d.pending).toBe(true);
      expect(d.basis).toBeUndefined();
    }
  });

  it("keeps ALL 61 Floor 1 requirements in the drawing rows and drops Common Area", () => {
    expect(drawItems.length).toBe(TOTAL_FLOOR1);
    const labels = drawItems.map((i) => i.match);
    for (let i = 1; i <= QUANTIFIED; i++) expect(labels).toContain(`Quantified item ${i}`);
    for (let i = 1; i <= NEEDS_DETAIL; i++) expect(labels).toContain(`Review item ${i}`);
    expect(labels).not.toContain("Passenger lift");
    expect(labels).not.toContain("Common corridor lighting");
    // Rule 9 — allocation = Floor 1 on every retained requirement.
    expect(drawItems.every((i) => i.allocation === "Floor 1")).toBe(true);
  });

  it("preserves null quantity + pending status on the 39, real numbers on the 22", () => {
    for (let i = 1; i <= QUANTIFIED; i++) {
      const it = drawItems.find((x) => x.match === `Quantified item ${i}`)!;
      expect(it.qty).toBe(i);
      expect(it.pending).toBeFalsy();
    }
    for (let i = 1; i <= NEEDS_DETAIL; i++) {
      const it = drawItems.find((x) => x.match === `Review item ${i}`)!;
      expect(it.qty).toBeNull();       // rule 5 — never converted to 0 / assumed
      expect(it.pending).toBe(true);   // rule 3 — identifiable as pending
      expect(it.basis).toBeUndefined();// UI must not show "Counted" for these
    }
  });

  it("keeps the Works / Equipment / Needs-confirmation distinction on the review items", () => {
    const scopes = new Set(drawItems.filter((i) => i.match.startsWith("Review item")).map((i) => i.scope));
    expect(scopes.has("works")).toBe(true);
    expect(scopes.has("equipment")).toBe(true);
    expect(scopes.has("needs_confirmation")).toBe(true);
  });

  it("derives room counts from the drawing spaces, not the Apartment template", () => {
    // Rule 6 — the generic Apartment template (6 beds / 6 baths / 3 kitchens…)
    // must never overwrite the drawing-derived counts.
    expect(spec.bedrooms).toBe(4);
    expect(spec.bathrooms).toBe(4);
    expect(spec.kitchens).toBe(2);
    expect(spec.balconies).toBe(4);
  });

  it("prices the 22 quantified as BOQ lines and never fabricates a quantity for the 39", () => {
    const lines = generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 1 });
    const byLabel = new Map(lines.map((l) => [l.label, l]));
    for (let i = 1; i <= QUANTIFIED; i++) {
      expect(byLabel.get(`Quantified item ${i}`)?.qty).toBe(i);
    }
    // The pending 39 carry no quantity, so they are NOT priced as fabricated
    // qty-0 lines — they remain in the drawing rows above for the operator to
    // quantify. Confirm none leaked in with an invented number.
    for (let i = 1; i <= NEEDS_DETAIL; i++) {
      expect(byLabel.has(`Review item ${i}`)).toBe(false);
    }
    // Common Area scope never enters this floor's BOQ.
    expect(byLabel.has("Passenger lift")).toBe(false);
  });
});

describe("applyDrawing prices only quantified rows; pending rows are left for review", () => {
  const summary: DrawingSummary = {
    items: [
      { match: "16A socket", qty: 5, unit: "nos", basis: "Counted" },
      { match: "Feature wall", qty: null, unit: "nos", pending: true, note: "Area/material not established" },
      { match: "Wardrobe", qty: null, unit: "nos", pending: true },
    ] as DrawingItem[],
  };

  it("emits a priced line for the quantified item and no fabricated line for the null ones", () => {
    const out = applyDrawing([], summary);
    const labels = out.map((l) => l.label);
    expect(labels).toContain("16A socket");
    expect(out.find((l) => l.label === "16A socket")?.qty).toBe(5);
    // No fabricated qty-0 line for a null-quantity requirement.
    expect(labels).not.toContain("Feature wall");
    expect(labels).not.toContain("Wardrobe");
  });

  it("never lets a null-quantity item overwrite a matching generated estimate", () => {
    const generated = [{ section: "Wiring", code: null, qty: 12, label: "Wardrobe", unit: "nos" }];
    const out = applyDrawing(generated, { items: [{ match: "Wardrobe", qty: null, pending: true }] as DrawingItem[] });
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe(12);   // heuristic estimate untouched
  });
});
