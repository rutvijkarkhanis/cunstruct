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

// A pending/unestablished quantity must never be promoted to a numeric count at the
// PARSER stage — a stray number the evaluation supplies for a "total not established"
// row is not a defensible count. This is distinct from a missing dimension/spec
// (COUNTABLE ≠ MEASURABLE), where the count IS kept.
describe("pending quantities are never promoted to a number by the parser", () => {
  const e = parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1, boq_allocation: "Floor 1",
    floor_scope: "First Floor / Floor 1 private apartment",
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    requirements: [
      // the reported bug: a number is present but the evaluation says the total is not established
      { allocation: "Floor 1", requirement: "15A socket points", qty: 25, unit: "nos", basis: "Counted", note: "Symbols visible, but complete defensible total not established", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "5A socket points", qty: 30, unit: "nos", basis: "Counted", note: "count not established", scope: "Works", status: "Identified — Needs detail" },
      // genuinely counted electrical/plumbing/joinery — must stay numeric
      { allocation: "Floor 1", requirement: "Geyser points", qty: 4, unit: "nos", basis: "Counted", note: "four private bathrooms", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "WC", qty: 5, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Wash basin", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Shower", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "AC points", qty: 9, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "TV / plasma provision", qty: 5, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Switchboard", qty: 12, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Ceiling fan", qty: 6, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "DB", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      { allocation: "Floor 1", requirement: "Calling bell", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
      // COUNTABLE ≠ MEASURABLE: dimension/spec missing but count IS defensible → stays counted
      { allocation: "Floor 1", requirement: "Wardrobe", qty: 4, unit: "nos", basis: "Counted", note: "running length/material not established", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "Overhead storage", qty: 6, unit: "nos", basis: "Counted", note: "running length not established", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "D1 door", qty: 7, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    ], confidence: {}, confirmations: [],
  }));
  const q = (m: string) => e.requirements.find((r) => r.match === m);
  const pend = (m: string) => e.needsDetail.find((r) => r.match === m);

  it("15A socket points (total not established) stays pending — never becomes 25", () => {
    expect(q("15A socket points")).toBeUndefined();
    expect(pend("15A socket points")).toMatchObject({ qty: null, pending: true });
    expect(pend("5A socket points")).toMatchObject({ qty: null, pending: true });
  });

  it("counted quantities transfer unchanged", () => {
    for (const [m, n] of [["Geyser points", 4], ["WC", 5], ["Wash basin", 4], ["Shower", 4], ["AC points", 9], ["TV / plasma provision", 5], ["Switchboard", 12], ["Ceiling fan", 6], ["DB", 1], ["Calling bell", 1], ["D1 door", 7]] as [string, number][])
      expect(q(m)?.qty, m).toBe(n);
  });

  it("COUNTABLE ≠ MEASURABLE preserved — a MISSING DIMENSION keeps the count", () => {
    expect(q("Wardrobe")?.qty).toBe(4);        // "running length/material not established" → still 4
    expect(q("Overhead storage")?.qty).toBe(6);
  });
});
