import { describe, it, expect } from "vitest";
import { parseChatGptEvaluation, specFromEvaluation } from "./chatgptEval";
import { generateForDiscipline } from "./disciplines";
import { classifyRequirements, findMissingDrawingScope } from "./boqMapping";
import { buildDsrQuoteHtml, computeCommercials, type DsrQuotePayload } from "./boqDsrDocument";
import { defaultSpec } from "./boqSpec";
import type { DrawingSummary } from "./boqDrawing";

// Cunstruct BOQ Integrity Pass — the 15-case checklist. One combined Floor 1
// evaluation drives most cases so the behaviours are proven together.

const QUANTIFIED = [
  { requirement: "WC", qty: 5, unit: "nos" },
  { requirement: "Wash basin", qty: 4, unit: "nos" },
  { requirement: "Media room screen", qty: 1, unit: "nos" },
  { requirement: "TV / plasma provision", qty: 5, unit: "nos" },
  { requirement: "Kitchen island", qty: 1, unit: "nos" },
  { requirement: "Kitchen platform", qty: 1, unit: "nos", note: "running length not established" },
  { requirement: "Wet kitchen platform", qty: 1, unit: "nos" },
  { requirement: "Wardrobe", qty: 4, unit: "nos" },
  { requirement: "Walk-in closet", qty: 2, unit: "nos" },
  { requirement: "WIC dress unit", qty: 2, unit: "nos" },
  { requirement: "Overhead storage block", qty: 6, unit: "nos" },
  { requirement: "Feature wall", qty: 1, unit: "nos" },
  { requirement: "Balcony", qty: 4, unit: "nos" },
  { requirement: "Green pocket", qty: 1, unit: "nos" },
];
const PENDING = [
  "Internal walls / partitions", "Flooring", "Wall finishes", "False ceiling", "CP fittings",
  "Floor drains / traps", "Kitchen plumbing", "Wet kitchen plumbing", "Water / waste points",
  "Geyser connections", "Electrical points", "HVAC / AC points", "Loose furniture",
];
const COMMON = ["Common lift", "Common corridor", "Common staircase"];

function floor1Eval(): string {
  const requirements: unknown[] = [];
  for (const q of QUANTIFIED) requirements.push({ allocation: "Floor 1", ...q, basis: "Counted", location: "Floor 1", scope: "Works", status: "Quantified" });
  for (const p of PENDING) requirements.push({ allocation: "Floor 1", requirement: p, qty: null, unit: null, basis: "Not assessable", location: "Floor 1", scope: "Works", status: "Identified — Needs detail" });
  for (const c of COMMON) requirements.push({ allocation: "Common Area", requirement: c, qty: 1, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" });
  return JSON.stringify({
    project_type: "Residential", archetype: "Apartment", floor: 1,
    boq_allocation: "Floor 1", floor_scope: "First Floor / Floor 1 private apartment",
    area: 1800, area_type: "built-up",
    spaces: [{ name: "Master Bedroom", qty: 1 }, { name: "Bedroom", qty: 2 }, { name: "Bathroom", qty: 4 }, { name: "Kitchen", qty: 1 }, { name: "Balcony", qty: 4 }, { name: "Living", qty: 1 }],
    disciplines: { identified: ["Architectural", "Electrical", "Plumbing"], not_assessable: ["Fire"] },
    measurements: [], requirements, category_summary: {}, confidence: { archetype: "High" }, confirmations: [],
  });
}

const spec = specFromEvaluation(parseChatGptEvaluation(floor1Eval()));
const summary = ((spec as Record<string, unknown>)._drawing as DrawingSummary);
const lines = generateForDiscipline("civil", spec, { area_sqft: 1800, floors: 4 });
const map = classifyRequirements(summary, lines);
const STRUCTURAL = /excavation|pcc|\bRCC\b|reinforcement|shuttering|masonry/i;

describe("BOQ Integrity Pass — 15-case checklist", () => {
  it("1. drawing quantity transfers unchanged to the mapped catalogue item", () => {
    const wc = lines.find((l) => /\bWC\b|water closet|European WC/i.test(l.label) && l.drawing);
    expect(wc?.qty).toBe(5);
    expect(map.find((m) => m.requirement === "WC")?.state).toBe("priced");
  });
  it("2. the catalogue cannot invent a quantity (every priced line is drawing-derived)", () => {
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => !!l.drawing)).toBe(true);
  });
  it("3. the catalogue cannot change nos → sqm without a drawing measurement", () => {
    expect(lines.find((l) => /kitchen platform/i.test(l.label))?.unit).toBe("nos");
    expect(lines.some((l) => /granite kitchen platform/i.test(l.label))).toBe(false);
  });
  it("4. no quantified drawing requirement disappears", () => {
    expect(findMissingDrawingScope(summary, lines)).toEqual([]);
  });
  it("5. a mapped drawing item does not duplicate with a generic catalogue item", () => {
    // exactly one WC line; no separate generic WC allowance
    expect(lines.filter((l) => /\bWC\b|water closet|European WC/i.test(l.label)).length).toBe(1);
  });
  it("6. pending quantities remain pending (qty null)", () => {
    const pending = (summary.items ?? []).filter((i) => i.qty == null);
    expect(pending.length).toBe(PENDING.length);
    expect(pending.every((p) => p.qty === null)).toBe(true);
    expect(map.filter((m) => m.state === "quantity_pending").length).toBe(PENDING.length);
  });
  it("7. an unmapped drawing item stays visible (as a drawing_item)", () => {
    expect(map.find((m) => m.requirement === "Wardrobe")?.state).toBe("drawing_item");
    expect(lines.some((l) => /wardrobe/i.test(l.label))).toBe(true);
  });
  it("8/10. structural scope stays absent without structural evidence", () => {
    expect(lines.some((l) => STRUCTURAL.test(l.label))).toBe(false);
  });
  it("9. Common Area never leaks into the private Floor 1 BOQ", () => {
    expect((summary.items ?? []).some((i) => /common (lift|corridor|staircase)/i.test(i.match))).toBe(false);
    expect(lines.some((l) => /common (lift|corridor|staircase)/i.test(l.label))).toBe(false);
  });
  it("11. WC & wash basin remain correctly priced", () => {
    expect(map.find((m) => m.requirement === "WC")?.state).toBe("priced");
    expect(map.find((m) => m.requirement === "Wash basin")?.state).toBe("priced");
  });
  it("12. media room screen survives into the BOQ", () => {
    expect(lines.some((l) => /media room screen/i.test(l.label))).toBe(true);
    expect(map.find((m) => m.requirement === "Media room screen")?.qty).toBe(1);
  });
  it("14. whole-project (questionnaire) BOQ still generates catalogue scope", () => {
    const q = generateForDiscipline("civil", defaultSpec({ bathrooms: 2, kitchens: 1 }), { area_sqft: 1500, floors: 1 });
    expect(q.some((l) => /\bRCC\b/i.test(l.label))).toBe(true);     // questionnaire flow unchanged
    expect(q.length).toBeGreaterThan(10);
  });
  it("15. multi-floor allocations stay independent (Floor 2 is its own BOQ)", () => {
    const f2 = specFromEvaluation(parseChatGptEvaluation(JSON.stringify({
      project_type: "Residential", archetype: "Apartment", floor: 2,
      boq_allocation: "Floor 2", floor_scope: "Floor 2 private apartment",
      spaces: [{ name: "Bathroom", qty: 2 }],
      disciplines: { identified: ["Plumbing"], not_assessable: ["Fire"] },
      requirements: [{ allocation: "Floor 2", requirement: "WC", qty: 2, unit: "nos", basis: "Counted", scope: "Works", status: "Quantified" }],
      confidence: {}, confirmations: [],
    })));
    const l2 = generateForDiscipline("civil", f2, { area_sqft: 1500, floors: 4 });
    expect(l2.every((l) => !!l.drawing)).toBe(true);
    expect(l2.some((l) => /\bWC\b|European WC/i.test(l.label))).toBe(true);
  });
});

describe("13. partial pricing is not presented as a complete project total", () => {
  const payload = (opts: { unpriced?: boolean; pending?: boolean }): DsrQuotePayload => ({
    boqName: "Floor 1", generatedOn: "2026-08-25",
    subheads: [{
      no: 1, name: "Sanitary", subtotal: 5000,
      lines: [
        { no: "1.01", code: "17.2.1", spec: "WC", qty: 5, unit: "each", rate: 1000, amount: 5000 },
        ...(opts.unpriced ? [{ no: "1.02", code: null, spec: "Wardrobe", qty: 4, unit: "nos", rate: null, amount: null }] : []),
      ],
    }],
    abstract: [{ no: 1, name: "Sanitary", amount: 5000 }],
    commercials: computeCommercials(5000, { costIndexPct: 0, contingencyPct: 3, overheadPct: 10, cessPct: 1, gstPct: 18 }),
    pendingItems: opts.pending ? [{ no: "P1", spec: "Flooring", unit: "sqm" }] : [],
  });

  it("labels the total 'currently priced scope only' and shows the partial-pricing breakdown", () => {
    const html = buildDsrQuoteHtml(payload({ unpriced: true, pending: true }), { autoPrint: false });
    expect(html).toContain("currently priced scope only");
    expect(html).toContain("Partially priced");
    expect(html).toMatch(/Rate pending: \d+ item/);       // quantified works line, no rate yet
    expect(html).toMatch(/Quantity pending: \d+ item/);
    expect(html).not.toContain(">Grand total<");   // the bare "Grand total" label is replaced
  });

  it("a fully-priced BOQ still shows a plain Grand total", () => {
    const html = buildDsrQuoteHtml(payload({ unpriced: false, pending: false }), { autoPrint: false });
    expect(html).toContain(">Grand total<");
    expect(html).not.toContain("Partially priced");
  });

  it("the basis note is evidence-driven, not 'derived from project parameters'", () => {
    const html = buildDsrQuoteHtml(payload({ unpriced: true }), { autoPrint: false });
    expect(html).toContain("supplied drawing evidence");
    expect(html).not.toContain("derived from project parameters and room dimensions");
  });

  // Private-project default: no rateYear → the document must NOT claim a DSR basis.
  it("a private project (no rateYear) is not labelled 'Basis: DSR'", () => {
    const html = buildDsrQuoteHtml(payload({ unpriced: true }), { autoPrint: false });
    expect(html).not.toContain("Basis: DSR");
    expect(html).not.toContain("Delhi Schedule of Rates");
    expect(html).toContain("private-project quotation");
  });
  // DSR basis is asserted only when a rate year was explicitly supplied.
  it("a DSR-priced project (rateYear set) does assert the DSR basis", () => {
    const html = buildDsrQuoteHtml({ ...payload({ unpriced: false }), rateYear: "2023" }, { autoPrint: false });
    expect(html).toContain("Basis: DSR 2023");
    expect(html).toContain("Delhi Schedule of Rates 2023");
  });
});

describe("new document sections — quantified works in the BOQ, equipment & excluded audited", () => {
  // The new structure: a quantified WORKS item with no rate yet is a first-class BOQ
  // line (Wardrobe, in the sub-head, rate null); only loose client EQUIPMENT (media
  // screen) lives in the reference section. Nothing the drawing counted disappears.
  const base: DsrQuotePayload = {
    boqName: "Floor 1", generatedOn: "2026-08-25",
    subheads: [{
      no: 1, name: "Sanitary", subtotal: 5000, lines: [
        { no: "1.01", code: "17.2.1", spec: "WC", qty: 5, unit: "each", rate: 1000, amount: 5000 },
        { no: "1.02", code: null, spec: "Wardrobe", qty: 4, unit: "rft", rate: null, amount: null },
      ],
    }],
    abstract: [{ no: 1, name: "Sanitary", amount: 5000 }],
    commercials: computeCommercials(5000, { costIndexPct: 0, contingencyPct: 3, overheadPct: 10, cessPct: 1, gstPct: 18 }),
    drawingItems: [
      { no: "E.01", spec: "Media room screen", qty: 1, unit: "nos", scope: "equipment" },
    ],
    excludedItems: [
      { spec: "Common lift", allocation: "Common Area", qty: 1, unit: "nos" },
      { spec: "Common staircase", allocation: "Common Area", qty: 1, unit: "nos" },
    ],
  };

  it("a quantified works item with no rate is a first-class BOQ line, not banished below the fold", () => {
    const html = buildDsrQuoteHtml(base, { autoPrint: false });
    // Wardrobe appears inside the main Bill of Quantities table, above the equipment section.
    const boqTable = html.slice(html.indexOf("Bill of Quantities"), html.indexOf("Client Equipment"));
    expect(boqTable).toContain("Wardrobe");
  });
  it("renders the client-equipment section and the media room screen survives into the PDF", () => {
    const html = buildDsrQuoteHtml(base, { autoPrint: false });
    expect(html).toContain("Client Equipment &amp; Loose Items");
    expect(html).toContain("Media room screen");   // equipment item no longer disappears
  });
  it("renders the excluded Common-Area audit section (seen → excluded, not missed)", () => {
    const html = buildDsrQuoteHtml(base, { autoPrint: false });
    expect(html).toContain("Seen in Drawing — Excluded");
    expect(html).toContain("Common lift");
    expect(html).toContain("Common staircase");
  });
  it("the partial-pricing status counts rate-pending works, equipment and excluded scope", () => {
    const html = buildDsrQuoteHtml(base, { autoPrint: false });
    expect(html).toContain("Partially priced");
    expect(html).toMatch(/Rate pending: 1 item/);          // Wardrobe
    expect(html).toMatch(/Client equipment: 1 item/);      // Media room screen
    expect(html).toMatch(/Excluded \(other allocation\): 2 items/);
  });
});
