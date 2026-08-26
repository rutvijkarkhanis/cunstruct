import { describe, it, expect } from "vitest";
import { applyDrawing, matchScore, type DrawingItem } from "./boqDrawing";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { generateForDiscipline } from "./disciplines";
import type { GeneratedLine } from "./boqDsrGenerate";

// Quantity integrity: a drawing-derived quantity is authoritative and can NEVER be
// replaced by a template/catalogue quantity, nor by a DIFFERENT drawing item's
// quantity via a loose catalogue match. The catalogue supplies description / code /
// rate / unit only; the QUANTITY is always the bound drawing item's own quantity.

describe("§14 geyser points 4 cannot become 25 after catalogue mapping", () => {
  it("applyDrawing binds the geyser line to 'Geyser points' (4), not a generic 'Power points' (25)", () => {
    const geyserLine: GeneratedLine = { section: "Electrical", code: null, qty: 25, label: "Geyser power points (15A) with wiring", unit: "point", ns: true, basis: "HEURISTIC" };
    const items: DrawingItem[] = [
      { match: "16A power points", qty: 25, unit: "nos", basis: "Counted" },
      { match: "Power points", qty: 25, unit: "nos", basis: "Counted" },
      { match: "Geyser points", qty: 4, unit: "nos", basis: "Counted" },
    ];
    const out = applyDrawing([geyserLine], { items });
    const geyser = out.find((l) => /geyser power points/i.test(l.label));
    expect(geyser?.qty).toBe(4);                    // the drawing's geyser count, unchanged
    expect(out.some((l) => /geyser power points/i.test(l.label) && l.qty === 25)).toBe(false);
  });

  it("full civil pipeline: no geyser line carries a non-geyser quantity", () => {
    const spec = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
      project_type: "Residential", archetype: "Apartment", floor: 1, boq_allocation: "Floor 1",
      floor_scope: "First Floor / Floor 1 private apartment", area: 3960, area_type: "built-up",
      spaces: [{ name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 }],
      disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
      requirements: [
        { allocation: "Floor 1", requirement: "Geyser points", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
        { allocation: "Floor 1", requirement: "16A power points", qty: 25, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      ], confidence: {}, confirmations: [],
    })));
    const lines = generateForDiscipline("civil", spec, { area_sqft: 3960, floors: 4 });
    for (const l of lines.filter((l) => /geyser/i.test(l.label))) expect(l.qty).toBe(4);
  });
});

describe("§15 every drawing quantity transfers unchanged through catalogue mapping", () => {
  const Q: [string, number][] = [
    ["WC", 5], ["Wash basin", 4], ["Shower", 4], ["AC points", 9],
    ["TV / plasma provision", 5], ["Wardrobe", 4], ["Overhead storage", 6], ["D1 door", 7], ["Geyser points", 4],
  ];
  const spec = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1, boq_allocation: "Floor 1",
    floor_scope: "First Floor / Floor 1 private apartment", area: 3960, area_type: "built-up",
    spaces: [{ name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 }],
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    requirements: [
      ...Q.map(([r, q]) => ({ allocation: "Floor 1", requirement: r, qty: q, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" })),
      // a generic competitor that must NOT donate its quantity to a specific line
      { allocation: "Floor 1", requirement: "Power points", qty: 25, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Flooring", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
    ], confidence: {}, confirmations: [],
  })));
  const lines = generateForDiscipline("civil", spec, { area_sqft: 3960, floors: 4 });
  const matching = (match: string) => lines.filter((l) => !!l.drawing && (l.label === match || matchScore(match, { code: l.code, label: l.label }) > 0));

  for (const [match, qty] of Q) {
    it(`${match} = ${qty} stays ${qty} on every line that represents it`, () => {
      const ls = matching(match);
      expect(ls.length, `${match} must survive into the BOQ`).toBeGreaterThan(0);
      for (const l of ls) expect(l.qty, `${match} line "${l.label}" must keep qty ${qty}`).toBe(qty);
    });
  }

  it("no fabricated/template quantity: every priced line's qty equals some drawing item's quantity", () => {
    const drawingQtys = new Set<number>([5, 4, 9, 6, 7, 25]);   // the quantified requirements above
    for (const l of lines) expect(drawingQtys.has(l.qty), `line "${l.label}" has qty ${l.qty} not from any drawing item`).toBe(true);
  });

  it("qty null stays null and pending (never coerced, never priced)", () => {
    const pend = ((spec as Record<string, unknown>)._drawing as { items: { match: string; qty: number | null; pending?: boolean }[] }).items.find((d) => d.match === "Flooring");
    expect(pend?.qty).toBeNull();
    expect(pend?.pending).toBe(true);
    expect(lines.some((l) => l.label === "Flooring")).toBe(false);   // not priced
  });
});

describe("matchScore ranks a specific catalogue line above a generic one", () => {
  it("'Geyser points' scores higher on the geyser line than 'Power points'", () => {
    const line = { code: null, label: "Geyser power points (15A) with wiring" };
    expect(matchScore("Geyser points", line)).toBeGreaterThan(matchScore("Power points", line));
  });
});
