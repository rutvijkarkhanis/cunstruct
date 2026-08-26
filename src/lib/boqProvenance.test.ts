import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { generateForDiscipline } from "./disciplines";
import { classifyRequirements } from "./boqMapping";
import { applyDrawing, drawingItemIsPending, resolveDrawingProvenance, type DrawingItem, type DrawingSummary } from "./boqDrawing";
import { buildDsrQuoteHtml, computeCommercials, type DsrQuotePayload } from "./boqDsrDocument";
import { defaultSpec, type Spec } from "./boqSpec";
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

// The REGENERATION path. A BOQ is generated from the PERSISTED spec._drawing, which
// is never re-parsed. So the provenance gate must also re-run at generation time on
// the stored items: a stored/mis-parsed number whose own evidence never established a
// defensible count MUST be forced back to pending before it can become a boq_line.
// These build spec._drawing DIRECTLY (bypassing the parser) to model stored data.
const stored = (items: DrawingItem[]): Spec => ({
  _source: "chatgpt",
  _boq_allocation: "Floor 1",
  _floors: 1,
  _disciplines: ["Architectural", "Electrical", "Plumbing"],
  _drawing: { items },
} as unknown as Spec);
const genLine = (spec: Spec, disc: string, re: RegExp) =>
  generateForDiscipline(disc, spec, { area_sqft: 3960, floors: 4 }).find((l) => re.test(l.label));

describe("regeneration cannot manufacture a quantity from a stored non-defensible item", () => {
  it("a stored 15A item with qty 25 but a 'total not established' note is re-nulled → no priced/drawing line carries 25", () => {
    const spec = stored([
      { match: "15A socket points", qty: 25, unit: "nos", basis: "Counted", note: "complete defensible total not established" },
    ]);
    const lines = generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 4 });
    expect(lines.some((l) => l.qty === 25)).toBe(false);
    expect(lines.some((l) => /15\s*a/i.test(l.label) && !!l.drawing)).toBe(false);
  });

  it("a stored 15A item with qty 25 and a COUNT-gap note is re-nulled (the count itself is unestablished)", () => {
    const spec = stored([
      { match: "15A socket points", qty: 25, unit: "nos", basis: "Counted", status: "Identified — Needs detail", note: "complete defensible total not established" },
    ]);
    expect(generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 4 }).some((l) => l.qty === 25)).toBe(false);
  });

  it("COUNTABLE ≠ FULLY SPECIFIED: a 'Needs detail' item with a present count and only a SPEC gap KEEPS its count", () => {
    // status "Needs detail" alone (missing rating/legend, not a count gap) must NOT
    // null a visible count — this is the 5A/ceiling-fan/wet-platform inconsistency fix.
    const spec = stored([
      { match: "5A socket points", qty: 12, unit: "nos", basis: "Counted", status: "Identified — Needs detail", note: "rating/legend not established; symbols visually counted" },
    ]);
    const line = generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 4 }).find((l) => /5\s*a/i.test(l.label));
    expect(line?.qty).toBe(12);
    expect(line?.drawing).toBeTruthy();
  });

  it("a stored geyser item with qty 4 and a 'count not established' note becomes pending — the 4 does not survive", () => {
    const spec = stored([
      { match: "Geyser points", qty: 4, unit: "nos", basis: "Counted", note: "geyser count not established" },
    ]);
    expect(generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 4 }).some((l) => /geyser/i.test(l.label) && l.qty === 4)).toBe(false);
    expect(generateForDiscipline("plumbing", spec, { area_sqft: 3960, floors: 4 }).some((l) => /geyser/i.test(l.label) && l.qty === 4)).toBe(false);
  });

  it("the INVERSE holds: a stored defensibly-counted item (qty 4, no unestablished signal) keeps its 4", () => {
    const spec = stored([
      { match: "Geyser points", qty: 4, unit: "nos", basis: "Counted", status: "Quantified", note: "four private bathrooms" },
    ]);
    // the geyser count survives onto its line, unchanged
    const line = genLine(spec, "electrical", /geyser/i) ?? genLine(spec, "plumbing", /geyser/i);
    expect(line?.qty).toBe(4);
    expect(line?.drawing).toBeTruthy();
  });
});

// The generic invariant the whole fix rests on, tested at the gate itself so it holds
// for EVERY item, not just the audited ones.
describe("generic provenance gate: qty=null in → never a number out; qty=n (defensible) in → exactly n out", () => {
  it("drawingItemIsPending flags every non-defensible shape and no defensible one", () => {
    // non-defensible → pending (null qty, explicit pending, Not assessable, or a COUNT gap)
    expect(drawingItemIsPending({ qty: null })).toBe(true);
    expect(drawingItemIsPending({ qty: 25, pending: true })).toBe(true);
    expect(drawingItemIsPending({ qty: 25, basis: "Assumed", status: "Not assessable" })).toBe(true);
    expect(drawingItemIsPending({ qty: 25, note: "symbols visible, total not established" })).toBe(true);   // COUNT gap
    expect(drawingItemIsPending({ qty: 0 })).toBe(true);
    // defensible → not pending. COUNTABLE ≠ FULLY SPECIFIED: a missing spec/dimension —
    // even tagged "Needs detail" — never nulls a present count; only a COUNT gap does.
    expect(drawingItemIsPending({ qty: 4, basis: "Counted", status: "Quantified" })).toBe(false);
    expect(drawingItemIsPending({ qty: 4, basis: "Counted", note: "running length not established" })).toBe(false); // missing DIMENSION keeps the count
    expect(drawingItemIsPending({ qty: 12, status: "Identified — Needs detail", note: "rating/legend not established" })).toBe(false); // missing SPEC keeps the count
    expect(drawingItemIsPending({ qty: 7 })).toBe(false);
  });

  it("resolveDrawingProvenance nulls a non-defensible number and preserves a defensible one", () => {
    const [pend, keep] = resolveDrawingProvenance([
      { match: "X", qty: 25, note: "total not established" },
      { match: "Y", qty: 4, basis: "Counted", status: "Quantified" },
    ]);
    expect(pend).toMatchObject({ qty: null, pending: true });
    expect(keep).toMatchObject({ qty: 4 });
  });

  it("applyDrawing never emits a line for a pending item, and never invents a number for one", () => {
    // a pending item next to a template line that has a heuristic number: the template
    // number must be superseded, and no drawing line may carry it
    const templateLine: GeneratedLine = { section: "Electrical", code: null, qty: 30, label: "15A socket points", unit: "point", ns: true, basis: "HEURISTIC" };
    const summary: DrawingSummary = { items: [{ match: "15A socket points", qty: null, pending: true, unit: "nos" }] };
    const out = applyDrawing([templateLine], summary);
    // the pending drawing item is not priced, and the heuristic 30 is superseded out of the total
    expect(out.some((l) => !!l.drawing)).toBe(false);
    expect(out.find((l) => /15\s*a/i.test(l.label))?.included).toBe(false);
  });

  it("a fully-null drawing set produces zero priced lines on a drawing-driven BOQ (no fabrication)", () => {
    const spec = stored([
      { match: "15A socket points", qty: null, unit: "nos", pending: true },
      { match: "Geyser points", qty: null, unit: "nos", pending: true },
      { match: "5A socket points", qty: null, unit: "nos", pending: true },
    ]);
    for (const disc of ["civil", "electrical", "plumbing"]) {
      const lines = generateForDiscipline(disc, spec, { area_sqft: 3960, floors: 4 });
      expect(lines.every((l) => l.qty == null), `${disc} fabricated a quantity from an all-null drawing set`).toBe(true);
    }
  });
});

// THE PRODUCTION PATH the earlier tests missed: when the project has room dimensions,
// OpsBoqBuilder passes `dims` to generateForDiscipline. defaultBasis then stamps EVERY
// template line "DRAWING_DERIVED", which the quantity-evidence gate used to accept — so
// pure room-count / area coefficients (WC=baths, AC=beds+baths, sockets=rooms·2+…,
// flooring=area) manufactured quantities on a drawing-driven BOQ even when the drawing
// itemised none of them. These tests drive that exact path (dims present) and assert
// no non-DrawingItem quantity can survive. This is where D.02/D.40/D.41 came from.
const DIMS = { rooms: [
  { room_type: "bedroom", length_ft: 12, width_ft: 12, height_ft: 10, count: 5, electrical_points: 6 },
  { room_type: "bathroom", length_ft: 8, width_ft: 6, height_ft: 10, count: 4, electrical_points: 3 },
  { room_type: "kitchen", length_ft: 10, width_ft: 10, height_ft: 10, count: 1, electrical_points: 6 },
  { room_type: "living", length_ft: 16, width_ft: 14, height_ft: 10, count: 1, electrical_points: 8 },
] } as unknown as Parameters<typeof generateForDiscipline>[3];
const storedRooms = (items: DrawingItem[]): Spec => ({
  _source: "chatgpt", _boq_allocation: "Floor 1", _floors: 1,
  _disciplines: ["Architectural", "Electrical", "Plumbing", "HVAC"],
  bedrooms: 5, bathrooms: 4, kitchens: 1, geyser: true, oht: true,
  _drawing: { items },
} as unknown as Spec);
const genAll = (spec: Spec) => ["civil", "electrical", "plumbing", "hvac"].flatMap((d) => generateForDiscipline(d, spec, { area_sqft: 3960, floors: 4 }, DIMS));
const leaked = (spec: Spec) => genAll(spec).filter((l) => l.qty != null && !l.drawing);

describe("room dimensions present (production path) cannot manufacture a quantity", () => {
  it("A. source qty null → final qty null (every pending item, dims present)", () => {
    const spec = storedRooms([
      { match: "15A socket points", qty: null, unit: "nos", pending: true },
      { match: "Geyser power points (15A)", qty: null, unit: "nos", pending: true },
      { match: "AC points", qty: null, unit: "nos", pending: true },
    ]);
    expect(leaked(spec)).toEqual([]);
    expect(genAll(spec).every((l) => l.qty == null)).toBe(true);
  });

  it("B. source qty null + catalogue item HAS a default qty → final qty null (WC=baths must not price)", () => {
    // WC is a catalogue line with default qty = baths (4). With the drawing WC pending,
    // that 4 must NOT survive — the catalogue default is not a drawing quantity.
    const spec = storedRooms([{ match: "WC", qty: null, unit: "nos", pending: true }]);
    expect(genAll(spec).some((l) => /\bWC\b|water closet|European WC/i.test(l.label) && l.qty === 4)).toBe(false);
    expect(leaked(spec)).toEqual([]);
  });

  it("C. source qty null + questionnaire toggle/default → final qty null (geyser toggle on, drawing pending)", () => {
    // geyser:true, oht:true toggles are ON, but the drawing geyser is pending → the
    // toggle controls inclusion only, never a quantity. Nothing geyser-quantified.
    const spec = storedRooms([{ match: "Geyser points", qty: null, unit: "nos", pending: true }]);
    expect(genAll(spec).some((l) => /geyser/i.test(l.label) && l.qty != null)).toBe(false);
    expect(leaked(spec)).toEqual([]);
  });

  it("D. source qty 4 → final qty 4 (defensible count survives, dims present)", () => {
    const spec = storedRooms([{ match: "Geyser points", qty: 4, unit: "nos", basis: "Counted", status: "Quantified" }]);
    const g = genAll(spec).find((l) => /geyser/i.test(l.label));
    expect(g?.qty).toBe(4);
    expect(g?.drawing).toBeTruthy();
    expect(leaked(spec)).toEqual([]);
  });

  it("E. source qty 25 → final qty 25 (defensible count survives, dims present)", () => {
    const spec = storedRooms([{ match: "15A socket points", qty: 25, unit: "nos", basis: "Counted", status: "Quantified" }]);
    const s = genAll(spec).find((l) => /15\s*a/i.test(l.label));
    expect(s?.qty).toBe(25);
    expect(s?.drawing).toBeTruthy();
    expect(leaked(spec)).toEqual([]);
  });

  it("F. scope filtering never creates a quantity (allocation drops items, never adds numbers)", () => {
    // Built through specFromEvaluation so the real allocation filter runs: a Common-Area
    // item is excluded from the Floor-1 _drawing, and a Floor-1 pending item stays
    // pending. Filtering must REMOVE, never fabricate — no leaked number, dims present.
    const spec = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
      project_type: "Residential", archetype: "Apartment", floor: 1, boq_allocation: "Floor 1",
      floor_scope: "First Floor / Floor 1 private apartment", area: 3960, area_type: "built-up",
      spaces: [{ name: "Bedroom", qty: 5 }, { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 }],
      disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
      requirements: [
        { allocation: "Common Area", requirement: "Common lift", qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" },
        { allocation: "Floor 1", requirement: "15A socket points", qty: null, unit: null, basis: "Not assessable", scope: "Works", status: "Identified — Needs detail" },
      ], confidence: {}, confirmations: [],
    })));
    expect(leaked(spec)).toEqual([]);
    expect(genAll(spec).some((l) => /common lift/i.test(l.label))).toBe(false);   // other allocation removed
    expect(genAll(spec).some((l) => /15\s*a/i.test(l.label) && l.qty != null)).toBe(false);   // pending stays pending
  });

  it("G. catalogue / DSR mapping never creates a quantity (mapped item keeps the drawing count, not the DSR coefficient)", () => {
    // WC maps to DSR 17.2.1 (whose template qty would be baths=4). The drawing says 5.
    // The mapped line must show 5 (drawing), never 4 (catalogue), and nothing leaks.
    const spec = storedRooms([{ match: "WC", qty: 5, unit: "nos", basis: "Counted", status: "Quantified" }]);
    const wc = genAll(spec).filter((l) => /\bWC\b|water closet|European WC/i.test(l.label));
    expect(wc.length).toBeGreaterThan(0);
    for (const l of wc) { expect(l.qty).toBe(5); expect(l.drawing).toBeTruthy(); }
    expect(leaked(spec)).toEqual([]);
  });
});

// COUNTABLE ≠ FULLY SPECIFIED: a visibly countable symbol must be COUNTED even when
// its spec / rating / model / material / dimension / legend is missing. Only a genuine
// COUNT gap (or a symbol that cannot be seen) stays pending. These feed the evaluation
// exactly as an evaluator would emit it (a present qty + a spec/legend-gap note, tagged
// "Needs detail"), through parse → spec → generation, and assert the count survives.
describe("visible-but-underspecified symbols are counted, not left pending", () => {
  const evalOf = (reqs: unknown[]) => specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1, boq_allocation: "Floor 1",
    floor_scope: "First Floor / Floor 1 private apartment", area: 3960, area_type: "built-up",
    spaces: [{ name: "Bedroom", qty: 5 }, { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Living", qty: 1 }],
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    requirements: reqs, confidence: {}, confirmations: [],
  })));
  const item = (spec: unknown, m: string) => (summaryOf(spec).items ?? []).find((i) => i.match === m);
  const nd = (reqs: unknown[]) => parseChatGptEvaluation(JSON.stringify({
    project_type: "Residential", floor: 1, boq_allocation: "Floor 1",
    disciplines: { identified: ["Electrical"], not_assessable: [] }, requirements: reqs, confidence: {}, confirmations: [],
  }));

  it("a visible symbol with unknown SPECIFICATION still gets counted", () => {
    const spec = evalOf([{ allocation: "Floor 1", requirement: "5A socket points", qty: 12, unit: "nos", basis: "Counted", note: "rating/specification not established", scope: "Works", status: "Identified — Needs detail" }]);
    expect(item(spec, "5A socket points")?.qty).toBe(12);
    expect(item(spec, "5A socket points")?.pending).toBeFalsy();
  });

  it("5A sockets are NOT null merely because the complete electrical specification is unavailable", () => {
    const e = nd([{ allocation: "Floor 1", requirement: "5A socket points", qty: 18, unit: "nos", basis: "Counted", note: "complete electrical specification unavailable", scope: "Works", status: "Identified — Needs detail" }]);
    expect(e.requirements.find((r) => r.match === "5A socket points")?.qty).toBe(18);
    expect(e.needsDetail.some((r) => r.match === "5A socket points")).toBe(false);
  });

  it("ceiling fans are NOT null merely because the legend / extracted text is incomplete", () => {
    const e = nd([{ allocation: "Floor 1", requirement: "Ceiling fan points", qty: 6, unit: "nos", basis: "Counted", note: "legend incomplete; symbols visually counted", scope: "Works", status: "Identified — Needs detail" }]);
    expect(e.requirements.find((r) => r.match === "Ceiling fan points")?.qty).toBe(6);
  });

  it("ceiling lamps and tube lights follow the same rule (count kept despite legend gap)", () => {
    const e = nd([
      { allocation: "Floor 1", requirement: "Ceiling lamp points", qty: 18, unit: "nos", basis: "Counted", note: "wattage/model not established", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "Tube light points", qty: 8, unit: "nos", basis: "Counted", note: "fitting spec not established", scope: "Works", status: "Identified — Needs detail" },
    ], "");
    expect(e.requirements.find((r) => r.match === "Ceiling lamp points")?.qty).toBe(18);
    expect(e.requirements.find((r) => r.match === "Tube light points")?.qty).toBe(8);
  });

  it("wet kitchen platform gets qty 1 even though running length is unknown", () => {
    const e = nd([{ allocation: "Floor 1", requirement: "Wet kitchen platform", qty: 1, unit: "nos", basis: "Counted", note: "Counter/platform visibly shown; running length and material not established", scope: "Works", status: "Identified — Needs detail" }]);
    expect(e.requirements.find((r) => r.match === "Wet kitchen platform")).toMatchObject({ qty: 1, unit: "nos" });
    expect(e.needsDetail.some((r) => r.match === "Wet kitchen platform")).toBe(false);
  });

  it("the counted quantities survive all the way into the generated BOQ (dims present)", () => {
    const spec = evalOf([
      { allocation: "Floor 1", requirement: "5A socket points", qty: 12, unit: "nos", basis: "Counted", note: "rating not established", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "Ceiling fan points", qty: 6, unit: "nos", basis: "Counted", note: "legend incomplete", scope: "Works", status: "Identified — Needs detail" },
    ]);
    const lines = generateForDiscipline("electrical", spec, { area_sqft: 3960, floors: 4 }, DIMS);
    expect(lines.find((l) => /5\s*a/i.test(l.label))?.qty).toBe(12);
    expect(lines.find((l) => /fan/i.test(l.label))?.qty).toBe(6);
    // and nothing fabricated
    expect(lines.every((l) => l.qty == null || !!l.drawing)).toBe(true);
  });

  it("a symbol that genuinely CANNOT be seen stays pending — no quantity is fabricated", () => {
    const e = nd([
      { allocation: "Floor 1", requirement: "Floor point", qty: null, unit: null, basis: "Not assessable", note: "symbol illegible", scope: "Works", status: "Identified — Needs detail" },
      { allocation: "Floor 1", requirement: "Projector point", qty: 25, unit: "nos", basis: "Counted", note: "complete defensible total not established", scope: "Works", status: "Identified — Needs detail" },
    ], "");
    expect(e.requirements.some((r) => r.match === "Floor point")).toBe(false);
    expect(e.needsDetail.find((r) => r.match === "Floor point")).toMatchObject({ qty: null, pending: true });
    // a COUNT-gap number is also not fabricated into a count
    expect(e.requirements.some((r) => r.match === "Projector point")).toBe(false);
    expect(e.needsDetail.find((r) => r.match === "Projector point")).toMatchObject({ qty: null, pending: true });
  });
});
