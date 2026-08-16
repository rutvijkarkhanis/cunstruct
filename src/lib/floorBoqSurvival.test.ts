import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { generateForDiscipline } from "./disciplines";
import { applyDrawing } from "./boqDrawing";
import type { DrawingSummary } from "./boqDrawing";

// The Floor 1 drawing evaluation reports 61 private-apartment requirements —
// some quantified, some identified-for-review — plus separate Common Area scope.
// The pipeline must land ALL 61 Floor 1 requirements in the generated BOQ (one
// combined BOQ), price the ones with a defensible quantity, retain the rest as
// pending/unpriced lines, and keep Common Area and other floors out.

const QUANTIFIED = 22;
const NEEDS_DETAIL = 39;
const TOTAL_FLOOR1 = QUANTIFIED + NEEDS_DETAIL; // 61

/** A representative Floor 1 evaluation: 22 quantified + 39 identified-for-review
 *  private requirements, plus 2 Common Area items that must NOT enter this BOQ. */
function floor1EvaluationJson(): string {
  const requirements: unknown[] = [];
  for (let i = 1; i <= QUANTIFIED; i++) {
    requirements.push({
      allocation: "Floor 1", requirement: `Quantified item ${i}`, qty: i, unit: "nos",
      basis: "Counted", location: `Room ${i}`, note: "", scope: "Works", status: "Quantified",
    });
  }
  for (let i = 1; i <= NEEDS_DETAIL; i++) {
    requirements.push({
      allocation: "Floor 1", requirement: `Review item ${i}`, qty: null, unit: null,
      basis: "Not assessable", location: `Room ${i}`, note: "Running length not established",
      scope: "Works", status: "Identified — Needs detail",
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

describe("Floor 1 requirements survive into the generated BOQ", () => {
  const e = parseChatGptEvaluation(floor1EvaluationJson());
  const spec = specFromEvaluation(e);
  const drawItems = ((spec as Record<string, unknown>)._drawing as DrawingSummary | undefined)?.items ?? [];

  it("parses every Floor 1 requirement (quantified + identified-for-review)", () => {
    // parseChatGptEvaluation does not filter by allocation, so the Common Area
    // quantified items sit in `requirements` alongside the Floor 1 ones here.
    expect(e.requirements.length).toBe(QUANTIFIED + 2);
    expect(e.needsDetail.length).toBe(NEEDS_DETAIL);
  });

  it("keeps all 61 Floor 1 requirements in the spec and drops Common Area", () => {
    expect(drawItems.length).toBe(TOTAL_FLOOR1);
    const labels = drawItems.map((i) => i.match);
    for (let i = 1; i <= QUANTIFIED; i++) expect(labels).toContain(`Quantified item ${i}`);
    for (let i = 1; i <= NEEDS_DETAIL; i++) expect(labels).toContain(`Review item ${i}`);
    expect(labels).not.toContain("Passenger lift");
    expect(labels).not.toContain("Common corridor lighting");
  });

  it("lands every Floor 1 requirement as a line in the generated BOQ", () => {
    const lines = generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 1 });
    const labels = new Set(lines.map((l) => l.label));
    for (let i = 1; i <= QUANTIFIED; i++) expect(labels.has(`Quantified item ${i}`)).toBe(true);
    for (let i = 1; i <= NEEDS_DETAIL; i++) expect(labels.has(`Review item ${i}`)).toBe(true);
    // Common Area scope never enters this floor's BOQ.
    expect(labels.has("Passenger lift")).toBe(false);
    expect(labels.has("Common corridor lighting")).toBe(false);
  });

  it("prices the quantified requirements and retains the rest as pending, unpriced lines", () => {
    const lines = generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 1 });
    for (let i = 1; i <= QUANTIFIED; i++) {
      const l = lines.find((x) => x.label === `Quantified item ${i}`);
      expect(l?.qty).toBe(i);
    }
    for (let i = 1; i <= NEEDS_DETAIL; i++) {
      const l = lines.find((x) => x.label === `Review item ${i}`);
      expect(l).toBeTruthy();
      expect(l?.qty).toBe(0);          // no defensible quantity → not invented
      expect(l?.included).toBe(false); // retained, but never priced until quantified
    }
  });
});

describe("applyDrawing retains identified-but-unquantified requirements", () => {
  const summary: DrawingSummary = {
    items: [
      { match: "16A socket", qty: 5, unit: "nos", basis: "Counted" },
      { match: "Feature wall", qty: 0, unit: "nos", basis: "Counted", note: "Area/material not established" },
      { match: "Wardrobe", qty: 0, unit: "nos", basis: "Counted" },
    ],
  };

  it("adds pending (qty 0) items as their own unpriced lines rather than dropping them", () => {
    const out = applyDrawing([], summary);
    const labels = out.map((l) => l.label);
    expect(labels).toContain("16A socket");
    expect(labels).toContain("Feature wall");
    expect(labels).toContain("Wardrobe");

    const priced = out.find((l) => l.label === "16A socket");
    expect(priced?.qty).toBe(5);

    const pending = out.find((l) => l.label === "Feature wall");
    expect(pending?.qty).toBe(0);
    expect(pending?.included).toBe(false);
    expect(pending?.note).toMatch(/quantity to be confirmed/i);
  });

  it("never lets a pending item zero out a matching generated estimate", () => {
    const generated = [{ section: "Wiring", code: null, qty: 12, label: "Wardrobe", unit: "nos" }];
    const out = applyDrawing(generated, { items: [{ match: "Wardrobe", qty: 0, basis: "Counted" }] });
    // The heuristic line keeps its quantity; the pending item is appended separately.
    const wardrobes = out.filter((l) => l.label === "Wardrobe");
    expect(wardrobes.some((l) => l.qty === 12)).toBe(true);
    expect(wardrobes.some((l) => l.qty === 0 && l.included === false)).toBe(true);
  });
});
