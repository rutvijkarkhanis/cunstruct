import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import type { DrawingSummary } from "./boqDrawing";

// Quantity-extraction maximisation: COUNTABLE ≠ FULLY SPECIFIED.
//
// When the drawing supports a count, the item must be QUANTIFIED even if its
// model / specification / material / running length is unknown (that missing
// detail lives in the note, never blocks the count). An item stays pending
// (qty null) ONLY when it is genuinely uncountable — inherently area/length
// based with no area/length on the drawing, or a symbol too illegible to count.
//
// The parser never invents: it faithfully lands whatever the evaluation states.
// This suite pins the contract across the full Floor-1 audit list so a countable
// category can never silently regress back to pending.

// Floor-1 categories the drawing DOES let us count. Several carry an
// unknown-spec / unknown-material note — the count must survive regardless.
const COUNTABLE: { requirement: string; qty: number; unit: string; note?: string }[] = [
  // Electrical
  { requirement: "5A socket", qty: 18, unit: "nos", note: "Model/specification not established" },
  { requirement: "15A socket", qty: 6, unit: "nos" },
  { requirement: "Switchboard", qty: 12, unit: "nos" },
  { requirement: "Distribution board", qty: 1, unit: "nos" },
  { requirement: "Ceiling lamp", qty: 22, unit: "nos" },
  { requirement: "Ceiling fan", qty: 6, unit: "nos", note: "Model not established" },
  { requirement: "Tube light", qty: 14, unit: "nos" },
  { requirement: "AC point", qty: 5, unit: "nos" },
  { requirement: "TV point", qty: 3, unit: "nos" },
  { requirement: "Calling bell", qty: 1, unit: "nos" },
  { requirement: "Geyser point", qty: 4, unit: "nos" },
  { requirement: "Floor point", qty: 2, unit: "nos" },
  { requirement: "Exhaust", qty: 4, unit: "nos" },
  { requirement: "Tower fan", qty: 1, unit: "nos" },
  { requirement: "Audio point", qty: 3, unit: "nos" },
  // Plumbing
  { requirement: "WC", qty: 4, unit: "nos", note: "Model/specification not established" },
  { requirement: "Wash basin", qty: 4, unit: "nos", note: "CP fitting model not established" },
  { requirement: "Shower", qty: 3, unit: "nos" },
  { requirement: "CP fitting set", qty: 4, unit: "nos" },
  { requirement: "Floor trap", qty: 6, unit: "nos" },
  { requirement: "Geyser connection", qty: 4, unit: "nos" },
  { requirement: "Kitchen sink", qty: 2, unit: "nos" },
  { requirement: "Washing-machine provision", qty: 1, unit: "nos" },
  { requirement: "Refrigerator provision", qty: 1, unit: "nos" },
  // Architectural
  { requirement: "Internal partition", qty: 5, unit: "nos" },
  { requirement: "Door", qty: 9, unit: "nos" },
  { requirement: "Window", qty: 8, unit: "nos" },
  { requirement: "Ventilator", qty: 3, unit: "nos" },
  { requirement: "Balcony", qty: 4, unit: "nos" },
  { requirement: "Green pocket", qty: 1, unit: "nos" },
  // Interior / joinery — fixed works, counted even with unknown run length / material
  { requirement: "Wardrobe", qty: 3, unit: "nos", note: "Run length/material not established" },
  { requirement: "Walk-in closet", qty: 1, unit: "nos" },
  { requirement: "Dress unit", qty: 1, unit: "nos" },
  { requirement: "Mirror unit", qty: 2, unit: "nos" },
  { requirement: "Study unit", qty: 1, unit: "nos" },
  { requirement: "Kitchen platform", qty: 1, unit: "nos" },
  { requirement: "Kitchen island", qty: 1, unit: "nos" },
  { requirement: "Wet-kitchen storage", qty: 1, unit: "nos" },
  { requirement: "Overhead storage", qty: 2, unit: "nos" },
  { requirement: "Utility storage", qty: 1, unit: "nos" },
  { requirement: "Feature wall", qty: 1, unit: "nos", note: "Area/finish not established" },
  { requirement: "Console / fixed storage", qty: 1, unit: "nos" },
  { requirement: "TV / plasma provision", qty: 1, unit: "nos" },
  { requirement: "Media-room screen / projection provision", qty: 1, unit: "nos" },
];

// Genuinely uncountable on THIS drawing — area/length based, no area/length given.
// These must remain pending (qty null), never coerced to a count.
const PENDING = [
  "Flooring", "Wall finishes", "False ceiling", "Conduit run", "Skirting run",
];

function floor1Json(): string {
  const requirements: unknown[] = [];
  for (const c of COUNTABLE)
    requirements.push({
      allocation: "Floor 1", requirement: c.requirement, qty: c.qty, unit: c.unit,
      basis: "Counted", location: "Floor 1", note: c.note ?? "", scope: "Works", status: "Quantified",
    });
  for (const p of PENDING)
    requirements.push({
      allocation: "Floor 1", requirement: p, qty: null, unit: null,
      basis: "Not assessable", location: "Floor 1", note: "Area/length not established",
      scope: "Works", status: "Identified — Needs detail",
    });
  // Common Area scope — must be excluded from the Floor 1 BOQ.
  requirements.push({ allocation: "Common Area", requirement: "Passenger lift", qty: 2, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" });
  requirements.push({ allocation: "Common Area", requirement: "Common corridor lighting", qty: 8, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" });

  return JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1,
    boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
    area: null, area_type: null,
    spaces: [
      { name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 4 },
      { name: "Kitchen", qty: 2 }, { name: "Balcony", qty: 4 }, { name: "Living", qty: 1 },
    ],
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    measurements: [], requirements, category_summary: {},
    confidence: { archetype: "High" }, confirmations: [],
  });
}

describe("Floor 1 quantity extraction — COUNTABLE ≠ FULLY SPECIFIED", () => {
  const e = parseChatGptEvaluation(floor1Json());
  // The parser keeps allocation on each row; Floor-1 filtering happens downstream
  // in specFromEvaluation. Scope the count assertions to the Floor-1 subset.
  const floor1Quantified = e.requirements.filter((r) => r.allocation === "Floor 1");

  it("quantifies every countable category, even with unknown spec / model / material", () => {
    expect(floor1Quantified.length).toBe(COUNTABLE.length);
    for (const c of COUNTABLE) {
      const r = floor1Quantified.find((x) => x.match === c.requirement);
      expect(r, `${c.requirement} should be quantified`).toBeTruthy();
      expect(r?.qty, `${c.requirement} qty`).toBe(c.qty);
      // a present count is never demoted to pending
      expect(e.needsDetail.some((x) => x.match === c.requirement)).toBe(false);
    }
  });

  it("keeps a real count with a trustworthy basis (never 'Not assessable')", () => {
    for (const r of floor1Quantified) {
      expect(r.qty != null && (r.qty as number) > 0).toBe(true);
      expect(r.basis).not.toBe(undefined);
      expect(["Counted", "Measured", "Derived"]).toContain(r.basis);
    }
  });

  it("an unknown specification / material lives in the note, not in the qty", () => {
    const wardrobe = e.requirements.find((r) => r.match === "Wardrobe");
    expect(wardrobe).toMatchObject({ qty: 3 });
    expect(wardrobe?.note).toMatch(/material/i);
    expect(e.requirements.find((r) => r.match === "WC")?.qty).toBe(4);
    expect(e.requirements.find((r) => r.match === "Ceiling fan")?.qty).toBe(6);
    expect(e.requirements.find((r) => r.match === "Wash basin")?.qty).toBe(4);
    expect(e.requirements.find((r) => r.match === "Feature wall")?.qty).toBe(1);
    expect(e.requirements.find((r) => r.match === "Distribution board")?.qty).toBe(1);
    expect(e.requirements.find((r) => r.match === "Refrigerator provision")?.qty).toBe(1);
    expect(e.requirements.find((r) => r.match === "Kitchen island")?.qty).toBe(1);
    expect(e.requirements.find((r) => r.match === "Media-room screen / projection provision")?.qty).toBe(1);
  });

  it("keeps only genuinely area/length-based items pending (qty null, pending true)", () => {
    expect(e.needsDetail.length).toBe(PENDING.length);
    for (const p of PENDING) {
      const d = e.needsDetail.find((x) => x.match === p);
      expect(d, `${p} should be pending`).toBeTruthy();
      expect(d?.qty).toBeNull();
      expect(d?.pending).toBe(true);
      // never turned into a priced requirement
      expect(e.requirements.some((r) => r.match === p)).toBe(false);
    }
  });

  it("preserves allocation = Floor 1 and keeps Common Area out of the pending set", () => {
    for (const r of [...floor1Quantified, ...e.needsDetail]) expect(r.allocation).toBe("Floor 1");
    // Common Area is parsed with its own allocation (excluded from the Floor 1 BOQ
    // downstream by specFromEvaluation), and never leaks into the pending set.
    expect(e.needsDetail.some((r) => /passenger lift|corridor lighting/i.test(r.match))).toBe(false);
    expect(e.requirements.filter((r) => r.allocation === "Common Area").map((r) => r.match).sort())
      .toEqual(["Common corridor lighting", "Passenger lift"]);
  });

  it("all Floor-1 requirements (quantified + pending) survive into DrawingItem rows; Common Area excluded", () => {
    const spec = specFromEvaluation(e);
    const rows = ((spec as Record<string, unknown>)._drawing as DrawingSummary).items ?? [];
    expect(rows.length).toBe(COUNTABLE.length + PENDING.length);
    expect(rows.every((r) => r.allocation === "Floor 1")).toBe(true);
    expect(rows.some((r) => /passenger lift|corridor lighting/i.test(r.match))).toBe(false);
    // the pending rows are still present (never dropped), still null
    for (const p of PENDING) {
      const row = rows.find((r) => r.match === p);
      expect(row?.qty).toBeNull();
      expect(row?.pending).toBe(true);
    }
  });
});
