import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { generateForDiscipline } from "./disciplines";
import { applyDrawing } from "./boqDrawing";
import type { DrawingItem, DrawingSummary } from "./boqDrawing";

// The Floor 1 drawing evaluation reports 61 private-apartment requirements —
// 22 quantified + 39 identified-for-review — plus separate Common Area scope.
// The downstream mapping must land ALL 61 in the generated Floor 1 BOQ/Drawing
// rows (one combined BOQ), preserve qty = null on the unquantified ones (never
// coerced to 0), keep allocation = Floor 1, keep the Works / Equipment /
// Needs-confirmation distinction, exclude Common Area and other floors, and never
// let the generic Apartment template fabricate quantities for drawing scope.

const QUANTIFIED = 22;
const PENDING = 39;
const TOTAL_FLOOR1 = QUANTIFIED + PENDING; // 61

function floor1EvaluationJson(): string {
  const requirements: unknown[] = [];
  for (let i = 1; i <= QUANTIFIED; i++) {
    requirements.push({
      allocation: "Floor 1", requirement: `Quantified item ${i}`, qty: i, unit: "nos",
      basis: "Counted", location: `Room ${i}`, note: "", scope: "Works", status: "Quantified",
    });
  }
  for (let i = 1; i <= PENDING; i++) {
    const scope = i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Works" : "Needs confirmation";
    requirements.push({
      allocation: "Floor 1", requirement: `Review item ${i}`, qty: null, unit: null,
      basis: "Not assessable", location: `Room ${i}`, note: "Running length not established",
      scope, status: "Identified — Needs detail",
    });
  }
  requirements.push({ allocation: "Common Area", requirement: "Passenger lift", qty: 2, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" });
  requirements.push({ allocation: "Common Area", requirement: "Common corridor lighting", qty: 8, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" });

  return JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1,
    boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
    area: 3960, area_type: "built-up",
    spaces: [
      { name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 4 },
      { name: "Kitchen", qty: 2 }, { name: "Balcony", qty: 4 }, { name: "Living", qty: 1 },
    ],
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    measurements: [], requirements, category_summary: {},
    confidence: { project_type: "High" }, confirmations: [],
  });
}

describe("Floor 1: all 61 drawing requirements survive downstream", () => {
  const e = parseChatGptEvaluation(floor1EvaluationJson());
  const spec = specFromEvaluation(e);
  const drawItems = ((spec as Record<string, unknown>)._drawing as DrawingSummary | undefined)?.items ?? [];
  const quantified = drawItems.filter((d) => d.qty != null && (d.qty as number) > 0);
  const pending = drawItems.filter((d) => d.qty == null);

  it("keeps 22 quantified + 39 pending = 61 drawing items (Common Area excluded)", () => {
    expect(quantified.length).toBe(QUANTIFIED);
    expect(pending.length).toBe(PENDING);
    expect(drawItems.length).toBe(TOTAL_FLOOR1);
    const labels = drawItems.map((d) => d.match);
    expect(labels).not.toContain("Passenger lift");
    expect(labels).not.toContain("Common corridor lighting");
  });

  it("pending items keep qty null + pending true; every item stays allocation Floor 1", () => {
    expect(pending.every((x) => x.qty === null && x.pending === true)).toBe(true);
    expect(drawItems.every((x) => x.allocation === "Floor 1")).toBe(true);
  });

  it("does NOT reduce the 61 drawing items to 22 when the BOQ is generated", () => {
    const before = drawItems.length;
    const lines = generateForDiscipline("civil", spec, { area_sqft: 3960, floors: 1 });
    // Generation writes BOQ lines; it must not mutate/shrink the drawing rows.
    const after = ((spec as Record<string, unknown>)._drawing as DrawingSummary).items!.length;
    expect(before).toBe(TOTAL_FLOOR1);
    expect(after).toBe(TOTAL_FLOOR1);
    // Exactly the 22 quantified drawing items flow into priced drawing lines.
    const drawingPriced = lines.filter((l) => l.drawing && l.qty > 0);
    expect(drawingPriced.length).toBe(QUANTIFIED);
    // No pending requirement is fabricated into a priced line.
    expect(lines.some((l) => /^Review item /.test(l.label))).toBe(false);
  });

  it("no pending drawing item receives a quantity from the Apartment template", () => {
    generateForDiscipline("civil", spec, { area_sqft: 3960, floors: 1 });
    const stillPending = ((spec as Record<string, unknown>)._drawing as DrawingSummary).items!.filter((d) => d.match.startsWith("Review item"));
    expect(stillPending.length).toBe(PENDING);
    expect(stillPending.every((d) => d.qty === null && d.pending === true)).toBe(true);
  });

  it("keeps the Works / Equipment / Needs-confirmation distinction on the review items", () => {
    const scopes = new Set(pending.map((d) => d.scope));
    expect(scopes.has("works")).toBe(true);
    expect(scopes.has("equipment")).toBe(true);
    expect(scopes.has("needs_confirmation")).toBe(true);
  });

  it("derives room counts from the drawing spaces, not the Apartment template", () => {
    expect(spec.bedrooms).toBe(4);
    expect(spec.bathrooms).toBe(4);
    expect(spec.kitchens).toBe(2);
    expect(spec.balconies).toBe(4);
  });
});

describe("Template electrical heuristics never overwrite drawing-identified scope", () => {
  const template = [
    { section: "Electrical", code: null, qty: 90, label: "Concealed electrical wiring with light/fan/socket points, incl. switches & accessories", unit: "point" },
    { section: "Electrical", code: null, qty: 1, label: "MCB distribution board with MCBs/RCCB, complete", unit: "nos" },
    { section: "Electrical", code: null, qty: 4, label: "Geyser power points (15A) with wiring", unit: "point" },
    { section: "Structure", code: "5.22.6", qty: 800, label: "TMT reinforcement steel", unit: "kg" },
  ];

  it("withholds template electrical defaults when the drawing itemises electrical, even as pending", () => {
    const out = applyDrawing(template, { items: [
      { match: "5A socket", qty: null, pending: true },
      { match: "Switchboard", qty: null, pending: true },
      { match: "Distribution board", qty: null, pending: true },
      { match: "Ceiling fan", qty: null, pending: true },
      { match: "Geyser point", qty: null, pending: true },
    ] as DrawingItem[] });
    expect(out.find((l) => /concealed electrical wiring/i.test(l.label))?.included).toBe(false);
    expect(out.find((l) => /distribution board/i.test(l.label))?.included).toBe(false);
    expect(out.find((l) => /geyser power points/i.test(l.label))?.included).toBe(false);
    // A non-electrical civil line is untouched — quantity intact.
    const steel = out.find((l) => /reinforcement steel/i.test(l.label));
    expect(steel?.included).not.toBe(false);
    expect(steel?.qty).toBe(800);
  });

  it("does not withhold template electrical when the drawing has no electrical scope", () => {
    const out = applyDrawing(template, { items: [{ match: "Wardrobe", qty: null, pending: true }] as DrawingItem[] });
    expect(out.find((l) => /concealed electrical wiring/i.test(l.label))?.included).not.toBe(false);
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
    expect(labels).not.toContain("Feature wall");
    expect(labels).not.toContain("Wardrobe");
  });

  it("never lets a null-quantity item overwrite a matching generated estimate", () => {
    const generated = [{ section: "Joinery", code: null, qty: 12, label: "Wardrobe", unit: "nos" }];
    const out = applyDrawing(generated, { items: [{ match: "Wardrobe", qty: null, pending: true }] as DrawingItem[] });
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe(12);
  });
});
