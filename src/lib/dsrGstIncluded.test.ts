// DSR 2023 item rates already include GST @18% — CPWD Delhi Schedule of Rates
// 2023, Vol. 1, Preface §6.2: "The effect of GST @18% on works contract has been
// incorporated in all items." GST from boq.spec._gst_pct is therefore added only
// on lines NOT priced at the DSR rate (the estimator's own/custom rates), and
// every label says which rates include GST.
import { describe, it, expect } from "vitest";
import {
  buildBoqCsv, buildDsrQuoteHtml, buildProjectQuoteHtml, computeCommercials, DSR_GST_INCLUDED_LABEL,
  type CommercialInputs, type QuoteSubHead,
} from "./boqDsrDocument";
import { commercialsFor, includedDsrTotal, includedTotal, liveCsv, liveQuotePayload } from "./boqLiveExport";
import { dsrRated, dsrWorksTotal } from "./quantity";
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
const ARGS = { boqName: "B", projectName: "P", generatedOn: "19 Oct 2026", unresolvedReviewCount: 0 };
const docFor = (lines: WorkingLine[], rateYear: string | null = "2023") => buildDsrQuoteHtml(liveQuotePayload({
  ...ARGS, context: { rateYear }, blankRates: false, subheads: sh(lines),
  commercials: commercialsFor(includedTotal(lines), {}, includedDsrTotal(lines)),
})!, { autoPrint: false });

describe("computeCommercials — GST only on the non-DSR part of the works", () => {
  it("all-DSR BOQ: no GST is added (it is already inside the DSR rates)", () => {
    const c = computeCommercials(100000, DEFAULTS, 100000);
    expect(c).toMatchObject({ dsrWorks: 100000, nonDsrWorks: 0, gstBase: 0, gstAmt: 0 });
    // contingency 3000 + overhead 15000 + cess 1180 unchanged; no GST on top.
    expect(c.contingencyAmt).toBe(3000);
    expect(c.overheadAmt).toBe(15000);
    expect(c.cessAmt).toBe(1180);
    expect(c.grandTotal).toBe(119180);
  });

  it("all-custom BOQ: GST exactly as before (on the whole taxable value)", () => {
    const c = computeCommercials(100000, DEFAULTS, 0);
    expect(c).toMatchObject({ dsrWorks: 0, nonDsrWorks: 100000, gstBase: 119180, gstAmt: 21452, grandTotal: 140632 });
    // The default (no DSR part given) is the same result.
    expect(computeCommercials(100000, DEFAULTS)).toEqual(c);
  });

  it("mixed BOQ: GST only on the custom part's proportional share of the taxable value", () => {
    const c = computeCommercials(100000, DEFAULTS, 60000);
    // taxable 119180 × 40000/100000 = 47672; GST 18% = 8580.96 → 8581.
    expect(c).toMatchObject({ dsrWorks: 60000, nonDsrWorks: 40000, gstBase: 47672, gstAmt: 8581, grandTotal: 127761 });
    // Contingency / overhead / cess behaviour is unchanged by the split.
    const old = computeCommercials(100000, DEFAULTS);
    expect([c.contingencyAmt, c.overheadAmt, c.cessAmt, c.subTotal]).toEqual([old.contingencyAmt, old.overheadAmt, old.cessAmt, old.subTotal]);
    // The stages still add up exactly.
    expect(c.works + c.costIndexAmt + c.contingencyAmt + c.overheadAmt + c.cessAmt + c.gstAmt).toBe(c.grandTotal);
  });

  it("a DSR part larger than the works is clamped; an empty BOQ is zero", () => {
    expect(computeCommercials(1000, DEFAULTS, 5000).gstAmt).toBe(0);
    expect(computeCommercials(0, DEFAULTS, 0)).toMatchObject({ gstAmt: 0, grandTotal: 0 });
  });
});

describe("which lines are DSR-rated", () => {
  it("only a line priced AT its DSR rate; a custom override of a DSR item is non-DSR", () => {
    expect(dsrRated({ dsr_rate: 100, custom_rate: null })).toBe(true);
    expect(dsrRated({ dsr_rate: 100, custom_rate: 120 })).toBe(false);
    expect(dsrRated({ dsr_rate: null, custom_rate: 120 })).toBe(false);
    expect(dsrRated({ dsr_rate: null, custom_rate: null })).toBe(false);
  });

  it("the overridden DSR item is charged GST; the plain DSR item is not", () => {
    const lines = [
      wl({ id: "brick", qty: 10, dsr_rate: 100 }),                    // 1000 at DSR rate
      wl({ id: "plaster", qty: 10, dsr_rate: 50, custom_rate: 80 }),  // 800 at own rate
    ];
    expect(includedTotal(lines)).toBe(1800);
    expect(includedDsrTotal(lines)).toBe(1000);
    const c = commercialsFor(includedTotal(lines), {}, includedDsrTotal(lines));
    // taxable: 1800 + 54 + 270 = 2124, + cess 21 = 2145; GST base round(2145 × 800/1800) = 953; GST 172.
    expect(c).toMatchObject({ works: 1800, dsrWorks: 1000, nonDsrWorks: 800, gstBase: 953, gstAmt: 172, grandTotal: 2317 });
  });

  it("pending quantities, unrated and excluded lines never add to the DSR part (or any amount)", () => {
    const lines = [
      wl({ id: "a", qty: 10 }),
      wl({ id: "pending", qty: 12, quantity_status: "PENDING", basis: "PENDING" }),
      wl({ id: "zero", qty: 0, quantity_status: null }),
      wl({ id: "unrated", qty: 3, dsr_rate: null }),
      wl({ id: "excluded", qty: 5, included: false }),
    ];
    expect(dsrWorksTotal(lines)).toBe(1000);
    expect(includedTotal(lines)).toBe(1000);
  });
});

describe("documents state which rates include GST", () => {
  const mixed = [wl({ id: "brick", qty: 10, dsr_rate: 100 }), wl({ id: "plaster", qty: 10, dsr_rate: 50, custom_rate: 80 })];

  it("DSR quote: no 'excl. GST' claim on rates; abstract shows GST included in DSR and added on non-DSR only", () => {
    const html = docFor(mixed);
    expect(html).not.toContain("Rate (excl. GST)");
    expect(html).not.toContain("Amount (excl. GST)");
    expect(html).not.toContain("at DSR rates, excl. GST");
    expect(html).not.toMatch(/Delhi Schedule of Rates 2023 \(material \+ labour \+ plant\), exclusive of GST/);
    expect(html).toContain(DSR_GST_INCLUDED_LABEL);
    expect(html).toContain("GST @18% — included in DSR 2023 rates (DSR 2023 preface §6.2)");
    expect(html).toContain("Add: GST @ 18% on non-DSR items");
    expect(html).toContain("DSR 2023 item rates include GST @18% (DSR 2023 Vol. 1, Preface §6.2");
    expect(html).toContain("own/custom rates) are exclusive of GST");
    expect(html).toContain("DSR 2023, incl. GST");      // per-line tag on the DSR-rated line
    expect(html).toContain("own rate, excl. GST");      // per-line tag on the overridden line
    expect(html).toContain("₹2,317");                    // grand total = commercialsFor above
  });

  it("all-DSR quote: no GST is added and none is claimed to be", () => {
    const html = docFor([wl({ id: "brick", qty: 10, dsr_rate: 100 })]);
    expect(html).toContain(DSR_GST_INCLUDED_LABEL);
    expect(html).not.toContain("Add: GST");
    expect(html).toContain("₹1,192");                    // 1000 + 30 + 150 + 12, no GST
    expect(html).not.toContain("₹1,407");                // the former double-GST total
  });

  it("all-custom private quote: GST added as before; the private-project wording stays", () => {
    const html = docFor([wl({ id: "tiles", qty: 10, dsr_rate: null, custom_rate: 100 })], null);
    expect(html).toContain("Add: GST @ 18%");
    expect(html).not.toContain("on non-DSR items");
    expect(html).not.toContain(DSR_GST_INCLUDED_LABEL);
    expect(html).toContain("Rates are the estimator's own composite rates (material, labour and installation), exclusive of GST");
    expect(html).toContain("Cost of works (own/custom rates, excl. GST)");
    expect(html).toContain("₹1,407");
  });

  it("private quote that still has DSR-rated lines says those rates include GST", () => {
    const html = docFor(mixed, null);
    expect(html).toContain("Rates are the estimator's own composite rates");
    expect(html).toContain("already include GST @18% (DSR 2023 Vol. 1, Preface §6.2");
  });

  it("project quote uses the same split and labels", () => {
    const subheads: QuoteSubHead[] = [{ no: 1, name: "Masonry", subtotal: 1800, lines: [
      { no: "1.01", code: "6.1", spec: "Brick", qty: 10, unit: "cum", rate: 100, amount: 1000, rateBasis: "dsr" },
      { no: "1.02", code: "13.1", spec: "Plaster", qty: 10, unit: "sqm", rate: 80, amount: 800, rateBasis: "custom" },
    ] }];
    const html = buildProjectQuoteHtml({ projectName: "P", generatedOn: "x", branding: "firm" },
      [{ name: "Civil", subheads, commercials: computeCommercials(1800, DEFAULTS, 1000) }], { autoPrint: false });
    expect(html).not.toContain("excl. GST)</th>");
    expect(html).not.toContain("Cost of works (excl. GST)");
    expect(html).toContain(DSR_GST_INCLUDED_LABEL);
    expect(html).toContain("Add: GST @ 18% on non-DSR items");
    expect(html).toContain("₹2,317");
  });

  it("a revision frozen before the split (no dsrWorks) renders as computed, without claiming a basis", () => {
    const legacy = computeCommercials(1000, DEFAULTS);
    delete legacy.dsrWorks; delete legacy.nonDsrWorks; delete legacy.gstBase;
    const html = buildDsrQuoteHtml({ boqName: "B", generatedOn: "x", subheads: [], abstract: [], commercials: legacy }, { autoPrint: false });
    expect(html).toContain("Add: GST @ 18%");
    expect(html).not.toContain(DSR_GST_INCLUDED_LABEL);
    expect(html).toContain("₹1,407");
  });
});

describe("CSV states the rate basis per line", () => {
  it("header no longer says the reference rate is excl. GST, and a 'Rate basis' column follows the existing ones", () => {
    const csv = buildBoqCsv([], { boqName: "B", generatedOn: "x" });
    const header = csv.split("\r\n")[3].split(",");
    expect(header).toEqual(["Sub-head", "Item", "Code", "Specification", "Unit", "Qty", "Rate (ref)", "Your rate", "Amount", "Source Document", "Source Page", "Quantity basis", "Rate basis"]);
    expect(csv).not.toMatch(/excl GST/);
    expect(csv.split("\r\n")[1]).toContain("DSR 2023 rates include GST @18% (DSR 2023 preface §6.2); own/custom rates exclude GST");
  });

  it("each priced row says whether its rate includes GST; the Amount formula columns are unchanged", () => {
    const csv = liveCsv({ ...ARGS, subheads: sh([
      wl({ id: "brick", qty: 10, dsr_rate: 100 }),
      wl({ id: "plaster", qty: 10, dsr_rate: 50, custom_rate: 80 }),
      wl({ id: "ns", qty: 2, dsr_rate: null }),
    ]) })!;
    const rows = csv.split("\r\n");
    expect(rows.find((r) => r.includes(",brick,"))).toMatch(/=F5\*H5,,,[^,]*,DSR 2023 rate \(incl\. GST @18%\)$/);
    expect(rows.find((r) => r.includes(",plaster,"))).toMatch(/=F6\*H6,,,[^,]*,Own\/custom rate \(excl\. GST\)$/);
    expect(rows.find((r) => r.includes(",ns,"))).toMatch(/,$/); // unrated: nothing stated
  });
});
