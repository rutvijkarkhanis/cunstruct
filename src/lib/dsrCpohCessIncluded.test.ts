// DSR 2023 item rates already include water charges 1%, GST, contractor's profit
// & overheads 15% (CPOH) and labour cess 1% — CPWD Delhi Analysis of Rates 2023
// Vol. I, e.g. item 2.1.1: W 9126.40 → +1% water → +GST (×0.2127) → +15% CPOH
// → +1% cess = 12983.55 per 100 sqm = the DSR rate 129.85/sqm. So the abstract
// adds _overhead_pct and _cess_pct (like GST) only on the non-DSR part; cost index
// and contingency still apply to the whole works.
import { describe, it, expect } from "vitest";
import {
  buildDsrQuoteHtml, computeCommercials, DSR_CPOH_CESS_INCLUDED_LABEL, DSR_GST_INCLUDED_LABEL,
  type CommercialInputs,
} from "./boqDsrDocument";
import { commercialsFor, includedDsrTotal, includedTotal, liveQuotePayload } from "./boqLiveExport";
import type { WorkingLine, WorkingSubhead } from "./boqRevision";

const DEFAULTS: CommercialInputs = { costIndexPct: 0, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18 };

const wl = (o: Partial<WorkingLine> & { id: string }): WorkingLine => ({
  section: "Masonry", dsr_code: "6.1", description: o.id, unit: "cum", qty: 10, dsr_rate: 100, custom_rate: null,
  included: true, quantity_status: "MEASURED", ...o,
});
const sh = (lines: WorkingLine[]): WorkingSubhead[] => [{
  no: 1, name: "Masonry",
  rows: lines.map((line, i) => ({ line, no: `1.${String(i + 1).padStart(2, "0")}`, source: { sourceDocument: null, sourcePage: null } })),
}];
const docFor = (lines: WorkingLine[]) => buildDsrQuoteHtml(liveQuotePayload({
  boqName: "B", generatedOn: "20 Oct 2026", unresolvedReviewCount: 0,
  context: { rateYear: "2023" }, blankRates: false, subheads: sh(lines),
  commercials: commercialsFor(includedTotal(lines), {}, includedDsrTotal(lines)),
})!, { autoPrint: false });

describe("computeCommercials — overhead and cess only on the non-DSR part", () => {
  it("all-DSR: no overhead, cess or GST added; only contingency (and cost index) apply", () => {
    const c = computeCommercials(100000, DEFAULTS, 100000);
    expect(c).toMatchObject({
      contingencyAmt: 3000, overheadBase: 0, overheadAmt: 0, cessBase: 0, cessAmt: 0, gstBase: 0, gstAmt: 0, grandTotal: 103000,
    });
    // Cost index is a location adjustment on the whole works, DSR part included.
    const ci = computeCommercials(100000, { ...DEFAULTS, costIndexPct: 10 }, 100000);
    expect(ci).toMatchObject({ costIndexAmt: 10000, contingencyAmt: 3300, overheadAmt: 0, cessAmt: 0, gstAmt: 0, grandTotal: 113300 });
  });

  it("all-custom: every stage identical to the former whole-works waterfall", () => {
    const c = computeCommercials(100000, { ...DEFAULTS, costIndexPct: 10 }, 0);
    expect(c).toMatchObject({
      costIndexAmt: 10000, contingencyAmt: 3300, overheadAmt: 16500, subTotal: 129800, cessAmt: 1298, gstAmt: 23598, grandTotal: 154696,
    });
    expect(c.overheadBase).toBe(c.worksAdjusted);
    expect(c.cessBase).toBe(c.subTotal);
  });

  it("mixed: overhead, cess and GST only on the custom share", () => {
    const c = computeCommercials(100000, DEFAULTS, 60000);
    expect(c).toMatchObject({
      contingencyAmt: 3000,          // whole works
      overheadBase: 40000, overheadAmt: 6000,
      cessBase: 47200, cessAmt: 472, // 103000 × 0.4 + 6000
      gstBase: 47672, gstAmt: 8581,
      grandTotal: 118053,
    });
    expect(c.works + c.costIndexAmt + c.contingencyAmt + c.overheadAmt + c.cessAmt + c.gstAmt).toBe(c.grandTotal);
    // Same overhead/cess/GST as an all-custom BOQ of only the custom share, plus contingency on the DSR share.
    const customOnly = computeCommercials(40000, DEFAULTS, 0);
    expect([c.overheadAmt, c.cessAmt, c.gstAmt]).toEqual([customOnly.overheadAmt, customOnly.cessAmt, customOnly.gstAmt]);
  });

  it("a custom override of a DSR item counts as non-DSR (overhead and cess are added on it)", () => {
    const lines = [wl({ id: "brick", qty: 10, dsr_rate: 100, custom_rate: 120 })];
    expect(includedDsrTotal(lines)).toBe(0);
    const c = commercialsFor(includedTotal(lines), {}, includedDsrTotal(lines));
    expect(c).toMatchObject({ works: 1200, overheadAmt: 180, cessAmt: 14, gstAmt: 257 });
  });

  it("pending quantities never carry an amount, overhead or cess", () => {
    const lines = [wl({ id: "a", qty: 10 }), wl({ id: "p", qty: 12, custom_rate: 500, quantity_status: "PENDING", basis: "PENDING" })];
    expect(includedTotal(lines)).toBe(1000);
    expect(includedDsrTotal(lines)).toBe(1000);
    const c = commercialsFor(includedTotal(lines), {}, includedDsrTotal(lines));
    expect(c).toMatchObject({ overheadAmt: 0, cessAmt: 0, gstAmt: 0, grandTotal: 1030 });
  });
});

describe("abstract labels for overhead and cess", () => {
  it("mixed: states overhead & cess are included in DSR rates and adds them on non-DSR items", () => {
    const html = docFor([wl({ id: "brick", qty: 10, dsr_rate: 100 }), wl({ id: "plaster", qty: 10, dsr_rate: 50, custom_rate: 80 })]);
    expect(html).toContain("Overheads &amp; profit 15% and cess 1% — included in DSR 2023 rates (CPWD DAR 2023 rate build-up)");
    expect(html).toContain("Add: Overhead &amp; profit @ 15% on non-DSR items");
    expect(html).toContain("Add: Labour cess @ 1% on non-DSR items");
    expect(html).toContain(DSR_GST_INCLUDED_LABEL);
    expect(html).toContain("profit &amp; overheads 15% and labour cess 1% (CPWD Delhi Analysis of Rates 2023");
    expect(html).toContain("₹2,155");
  });

  it("all-DSR: overhead and cess shown as included, none added", () => {
    const html = docFor([wl({ id: "brick", qty: 10, dsr_rate: 100 })]);
    expect(DSR_CPOH_CESS_INCLUDED_LABEL).toBe("Overheads & profit 15% and cess 1% — included in DSR 2023 rates (CPWD DAR 2023 rate build-up)");
    expect(html).toContain("Overheads &amp; profit 15% and cess 1% — included in DSR 2023 rates");
    expect(html).not.toContain("Add: Overhead");
    expect(html).not.toContain("Add: Labour cess");
    expect(html).toContain("₹1,030");
  });

  it("all-custom: overhead and cess rows as before, no DSR wording", () => {
    const html = docFor([wl({ id: "tiles", qty: 10, dsr_rate: null, custom_rate: 100 })]);
    expect(html).toContain("Add: Overhead &amp; profit @ 15%");
    expect(html).toContain("Add: Labour cess @ 1%");
    expect(html).not.toContain("on non-DSR items");
    expect(html).not.toContain("included in DSR 2023 rates (CPWD DAR");
  });

  it("commercials frozen before this split (overhead on the whole works) render as computed, with the old wording", () => {
    // A revision frozen after the GST split but before this one: has dsrWorks, no overheadBase.
    const frozen = { ...computeCommercials(1000, DEFAULTS), dsrWorks: 1000, nonDsrWorks: 0, gstBase: 0, gstAmt: 0, grandTotal: 1192 };
    delete (frozen as { overheadBase?: number }).overheadBase;
    delete (frozen as { cessBase?: number }).cessBase;
    const html = buildDsrQuoteHtml({ boqName: "B", generatedOn: "x", subheads: [], abstract: [], commercials: frozen }, { autoPrint: false });
    expect(html).toContain("Add: Overhead &amp; profit @ 15%</td><td class=\"num\">₹150");
    expect(html).toContain("Add: Labour cess @ 1%</td><td class=\"num\">₹12");
    expect(html).not.toContain("on non-DSR items</td><td class=\"num\">₹150");
    expect(html).not.toContain("CPWD DAR 2023 rate build-up");
    expect(html).toContain("₹1,192");
  });
});
