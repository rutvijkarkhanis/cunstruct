import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { generateForDiscipline } from "./disciplines";
import { classifyRequirements } from "./boqMapping";
import { applyDrawing, type DrawingItem, type DrawingSummary } from "./boqDrawing";
import { buildDsrQuoteHtml, computeCommercials, type DsrQuotePayload } from "./boqDsrDocument";
import { defaultSpec } from "./boqSpec";
import type { GeneratedLine } from "./boqDsrGenerate";

// STRICT quantity provenance. The ONLY authoritative source of a drawing quantity is
// the DrawingItem quantity produced by the Drawing Evaluation. Its STATUS is
// authoritative: an "Identified — Needs detail" row MUST remain unquantified (qty
// null, pending) no matter what number the evaluation printed beside it. Nothing
// downstream — catalogue defaults, unit conversion, questionnaire toggles, scope
// filtering, applyDrawing binding, or rendering — may create, increase, or overwrite
// a quantity.

const drawing = (requirements: unknown[]) => specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
  project_type: "Residential", archetype: "Apartment", floor: 1, boq_allocation: "Floor 1",
  floor_scope: "First Floor / Floor 1 private apartment", area: 3960, area_type: "built-up",
  spaces: [{ name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 3 }, { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 }],
  disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
  requirements, confidence: {}, confirmations: [],
})));
const summaryOf = (spec: unknown) => (spec as Record<string, unknown>)._drawing as DrawingSummary;
const drawItem = (spec: unknown, match: string) => (summaryOf(spec).items ?? []).find((i) => i.match === match);

describe("the reported bug: D.40 15A socket points (needs-detail) never becomes a quantified 25", () => {
  // The exact evaluation wording from the report: a number is printed, but the row is
  // classified "Identified — Needs detail" because no defensible total was established.
  const spec = drawing([
    { allocation: "Floor 1", requirement: "15A socket points", qty: 25, unit: "nos", basis: "Counted", note: "Symbols visible, but complete defensible total not established", scope: "Works", status: "Identified — Needs detail" },
  ]);

  it("the DrawingItem stays pending with qty null — the 25 is not promoted", () => {
    const it = drawItem(spec, "15A socket points");
    expect(it).toBeDefined();
    expect(it?.qty).toBeNull();
    expect(it?.pending).toBe(true);
  });

  it("classification is quantity_pending, not priced", () => {
    const lines = generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 4 });
    const map = classifyRequirements(summaryOf(spec), lines);
    expect(map.find((m) => m.requirement === "15A socket points")?.state).toBe("quantity_pending");
  });

  it("no generated line prices 15A socket points, and none carries qty 25", () => {
    for (const d of ["civil", "electrical", "plumbing"]) {
      const lines = generateForDiscipline(d, spec, { area_sqft: 3960, floors: 4 });
      expect(lines.some((l) => /15\s*a\b.*socket/i.test(l.label) && l.qty === 25), `${d} priced a 25 for 15A sockets`).toBe(false);
    }
  });
});

describe("electrical audit: Quantified rows keep their count, needs-detail rows stay pending", () => {
  // Every electrical class named in the audit. Some have a defensible count
  // (Quantified), some are pending — the same shapes the evaluator produces.
  const spec = drawing([
    { allocation: "Floor 1", requirement: "5A socket points", qty: 30, unit: "nos", basis: "Counted", note: "count not established", scope: "Works", status: "Identified — Needs detail" },
    { allocation: "Floor 1", requirement: "15A socket points", qty: 25, unit: "nos", basis: "Counted", note: "total not established", scope: "Works", status: "Identified — Needs detail" },
    { allocation: "Floor 1", requirement: "Switchboard", qty: 12, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Ceiling lamp", qty: 18, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Ceiling fan", qty: 6, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Tube light", qty: 8, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Cable TV point", qty: 5, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Tower fan point", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
    { allocation: "Floor 1", requirement: "AC points", qty: 9, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Geyser points", qty: 4, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "DB", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    { allocation: "Floor 1", requirement: "Calling bell", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
  ]);

  it("pending electrical classes (5A, 15A, tower fan) all stay qty null pending", () => {
    for (const m of ["5A socket points", "15A socket points", "Tower fan point"]) {
      const it = drawItem(spec, m);
      expect(it?.qty, `${m} must be pending`).toBeNull();
      expect(it?.pending, `${m} must be pending`).toBe(true);
    }
  });

  it("Quantified electrical classes keep their exact drawing count", () => {
    for (const [m, n] of [["Switchboard", 12], ["Ceiling lamp", 18], ["Ceiling fan", 6], ["Tube light", 8], ["Cable TV point", 5], ["AC points", 9], ["Geyser points", 4], ["DB", 1], ["Calling bell", 1]] as [string, number][]) {
      const it = drawItem(spec, m);
      expect(it?.qty, `${m} must keep ${n}`).toBe(n);
      expect(it?.pending, `${m} must not be pending`).toBeFalsy();
    }
  });
});

describe("no downstream stage can create, overwrite, or increase a quantity", () => {
  it("rule 1/9: applyDrawing preserves the bound DrawingItem qty exactly", () => {
    const line: GeneratedLine = { section: "Electrical", code: null, qty: 25, label: "15A socket points with wiring", unit: "point", ns: true, basis: "HEURISTIC" };
    const items: DrawingItem[] = [{ match: "AC points", qty: 9, unit: "nos", basis: "Counted" }];
    // only a real (non-pending) drawing item can bind; a pending 15A never reaches here
    const out = applyDrawing([line], { items });
    // the generic template's 25 is not a drawing count → the line is not upgraded to a drawing qty of 25
    expect(out.every((l) => !(l.drawing && l.qty === 25 && /15\s*a/i.test(l.label)))).toBe(true);
  });

  it("rule 5: a catalogue default cannot overwrite a drawing quantity (geyser stays 4, not 25)", () => {
    const geyserLine: GeneratedLine = { section: "Electrical", code: null, qty: 25, label: "Geyser power points (15A) with wiring", unit: "point", ns: true, basis: "HEURISTIC" };
    const items: DrawingItem[] = [
      { match: "Power points", qty: 25, unit: "nos", basis: "Counted" },
      { match: "Geyser points", qty: 4, unit: "nos", basis: "Counted" },
    ];
    const out = applyDrawing([geyserLine], { items });
    expect(out.find((l) => /geyser power points/i.test(l.label))?.qty).toBe(4);
  });

  it("rule 7: a questionnaire toggle controls inclusion only, never quantity — no drawing qty is invented", () => {
    // the questionnaire flow has no drawing items; it must not fabricate any of the
    // audited drawing counts (25/30/9/4…) onto its template lines
    const q = generateForDiscipline("electrical", defaultSpec({ bedrooms: 4, bathrooms: 4, kitchens: 1 }), { area_sqft: 3960, floors: 1 });
    for (const l of q) expect(!!l.drawing, `questionnaire line "${l.label}" must not be marked drawing-derived`).toBe(false);
  });

  it("rule 8: scope filtering only removes items — a pending row is dropped from pricing, never quantified", () => {
    const spec = drawing([
      { allocation: "Floor 1", requirement: "15A socket points", qty: 25, unit: "nos", basis: "Counted", note: "total not established", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "AC points", qty: 9, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
    ]);
    const lines = generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 4 });
    // pending item is not priced; the AC count is unchanged; nothing is 25
    expect(lines.some((l) => l.qty === 25)).toBe(false);
    expect(lines.filter((l) => /ac point/i.test(l.label)).every((l) => l.qty === 9 || l.qty == null)).toBe(true);
  });

  it("rule 2: qty null stays null through parse → spec → classification (never coerced)", () => {
    const spec = drawing([
      { allocation: "Floor 1", requirement: "Flooring", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
    ]);
    expect(drawItem(spec, "Flooring")?.qty).toBeNull();
    const lines = generateForDiscipline("civil", spec, { area_sqft: 3960, floors: 4 });
    expect(lines.some((l) => l.label === "Flooring")).toBe(false);
    expect(classifyRequirements(summaryOf(spec), lines).find((m) => m.requirement === "Flooring")?.state).toBe("quantity_pending");
  });
});

describe("rule 10: rendering displays exactly the final quantity, with no fallback", () => {
  const payload: DsrQuotePayload = {
    boqName: "Floor 1", generatedOn: "2026-08-26",
    subheads: [{
      no: 1, name: "Electrical", subtotal: 9000,
      lines: [{ no: "1.01", code: "E.1", spec: "AC points", qty: 9, unit: "point", rate: 1000, amount: 9000 }],
    }],
    abstract: [{ no: 1, name: "Electrical", amount: 9000 }],
    commercials: computeCommercials(9000, { costIndexPct: 0, contingencyPct: 3, overheadPct: 10, cessPct: 1, gstPct: 18 }),
    // the pending 15A row renders WITHOUT a quantity — no 25 fallback
    pendingItems: [{ no: "P1", spec: "15A socket points", unit: "nos" }],
  };
  const html = buildDsrQuoteHtml(payload, { autoPrint: false });

  it("the priced AC line renders its exact qty 9", () => {
    expect(html).toMatch(/AC points[\s\S]*?>9</);
  });
  it("the pending 15A row appears in the pending section and never carries 25", () => {
    expect(html).toContain("15A socket points");
    expect(html).not.toMatch(/15A socket points[\s\S]{0,120}>25</);
  });
});

describe("explicit drawing quantities remain unchanged end-to-end", () => {
  const Q: [string, number][] = [
    ["WC", 5], ["Wash basin", 4], ["Shower", 4], ["Geyser points", 4],
    ["AC points", 9], ["Wardrobe", 4], ["Overhead storage", 6], ["D1 door", 7],
  ];
  const spec = drawing([
    ...Q.map(([r, q]) => ({ allocation: "Floor 1", requirement: r, qty: q, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" })),
    // 15A sockets: a number present but no defensible total → pending/null
    { allocation: "Floor 1", requirement: "15A socket points", qty: 25, unit: "nos", basis: "Counted", note: "defensible total not established", scope: "Works", status: "Identified — Needs detail" },
  ]);

  for (const [m, n] of Q) {
    it(`${m} = ${n} survives unchanged in the DrawingItem`, () => {
      expect(drawItem(spec, m)?.qty).toBe(n);
    });
  }
  it("15A socket points is null/pending (no defensible count in source)", () => {
    expect(drawItem(spec, "15A socket points")?.qty).toBeNull();
    expect(drawItem(spec, "15A socket points")?.pending).toBe(true);
  });
});
