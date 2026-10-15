import { describe, it, expect } from "vitest";
import {
  buildRateComparison, EMPTY_QUOTATION_FORM, historicalRateOf, isPreferred, parseQuotationForm, preferredFromEvidence,
  type ComparisonInput, type HistoricalLine, type RateReview, type VendorQuotation,
} from "./rateEvidence";
import type { DsrMappingRow } from "./dsrMapping";

const LINE = { id: "line-1", unit: "sqm", qty: 40 };
const MAPPING: DsrMappingRow = {
  id: "m1", boq_id: "boq-1", boq_line_id: "line-1", status: "mapped", include_in_estimate: true,
  dsr_item_id: "dsr-1", dsr_code: "11.41.2", dsr_description: "Vitrified tiles", dsr_unit: "sqm", dsr_rate: 1000,
  dsr_source: "DSR", dsr_rate_year: "2023", reviewer_note: null, reviewed_by: null, reviewed_at: null,
};
const quote = (o: Partial<VendorQuotation> & { id: string }): VendorQuotation => ({
  boq_id: "boq-1", boq_line_id: "line-1", status: "received", vendor_name: "Vendor A", vendor_contact: null,
  quoted_description: "600x600 vitrified", quoted_unit: "sqm", quoted_rate: 1100, spec_match: "matches",
  tax_treatment: "excluded", tax_pct: 18, freight: "included", freight_amount: null, installation: "not_stated",
  installation_amount: null, other_charges: null, quotation_date: "2026-09-20", valid_until: "2026-10-20",
  quotation_ref: "Q-17", source_document_id: null, exclusions: null, conditions: null, notes: null, recorded_by: null, ...o,
});
const hist = (o: Partial<HistoricalLine> & { id: string }): HistoricalLine => ({
  boq_id: "boq-old", description: "Vitrified tiles 600x600", unit: "sqm", qty: 120, dsr_code: "11.41.2",
  dsr_rate: 950, custom_rate: 1200,
  boq: { name: "Tower A BOQ", status: "sent", rate_year: "2023", created_at: "2025-11-02T10:00:00Z", updated_at: "2026-01-15T10:00:00Z", project: { name: "Tower A", location: "Vizag" } },
  ...o,
});
const run = (o: Partial<ComparisonInput> = {}) =>
  buildRateComparison({ line: LINE, mapping: MAPPING, indicativeAmount: 40000, quotations: [], historical: [], today: "2026-10-11", ...o });
const item = (r: ReturnType<typeof run>, key: string) => r.items.find((i) => i.key === key)!;

describe("buildRateComparison — DSR reference and indicative", () => {
  it("shows the DSR snapshot with its schedule/year and the indicative amount as separate evidence", () => {
    const r = run();
    expect(item(r, "dsr")).toMatchObject({ kind: "dsr_reference", rate: 1000, source: "DSR 11.41.2 · DSR 2023", dateLabel: "Schedule year 2023", preferable: true });
    expect(item(r, "indicative")).toMatchObject({ kind: "indicative", preferable: false });
    expect(item(r, "indicative").caveats[0]).toContain("₹40,000");
    expect(r.referenceIssue).toBeNull();
  });

  it.each([
    ["unmapped", null, "Line is not mapped to a DSR item"],
    ["needs review", { ...MAPPING, status: "needs_review" as const }, "DSR mapping still needs review"],
    ["no rate", { ...MAPPING, dsr_rate: null }, "DSR reference has no rate"],
    ["unit mismatch", { ...MAPPING, dsr_unit: "cum" }, "DSR reference unit (cum) doesn't match the measured unit (sqm)"],
  ])("no %% comparison baseline when %s", (_n, mapping, issue) => {
    const r = run({ mapping, quotations: [quote({ id: "q1" })] });
    expect(r.referenceIssue).toBe(issue);
    expect(item(r, "q:q1").pctVsReference).toBeNull();
  });
});

describe("buildRateComparison — vendor quotations", () => {
  it("compares a like-for-like quote against the DSR reference and surfaces its tax/freight basis", () => {
    const q = item(run({ quotations: [quote({ id: "q1" })] }), "q:q1");
    expect(q).toMatchObject({ rate: 1100, pctVsReference: 10, notComparedReason: null, dateLabel: "Quoted 2026-09-20 · valid to 2026-10-20" });
    expect(q.source).toBe("Quotation — Vendor A (Q-17)");
    expect(q.caveats).toEqual(expect.arrayContaining(["Tax excluded (18%)", "Freight included", "Installation not stated"]));
  });

  it.each([
    ["unit differs", { quoted_unit: "box" }, "Unit differs (box vs sqm)"],
    ["scope differs", { spec_match: "differs" as const }, "Specification/scope differs from the BOQ line"],
    ["scope unconfirmed", { spec_match: "unclear" as const }, "Specification match not confirmed"],
    ["no rate (incomplete)", { status: "incomplete" as const, quoted_rate: null }, "No rate quoted"],
    ["unavailable", { status: "unavailable" as const, quoted_rate: null }, "No rate quoted"],
  ])("does not compare when %s", (_n, o, reason) => {
    const q = item(run({ quotations: [quote({ id: "q1", ...o })] }), "q:q1");
    expect(q.pctVsReference).toBeNull();
    expect(q.notComparedReason).toBe(reason);
  });

  it("keeps a genuine zero rate distinct from 'not available'", () => {
    const r = run({ quotations: [quote({ id: "zero", quoted_rate: 0 }), quote({ id: "none", status: "incomplete", quoted_rate: null })] });
    expect(item(r, "q:zero")).toMatchObject({ rate: 0, pctVsReference: -100, preferable: true });
    expect(item(r, "q:none")).toMatchObject({ rate: null, preferable: false });
  });

  it("flags expired validity, a missing date and an incomplete quote without changing the rate", () => {
    const q = item(run({ quotations: [quote({ id: "q1", status: "incomplete", valid_until: "2026-10-01", quotation_date: null })] }), "q:q1");
    expect(q.rate).toBe(1100);
    expect(q.caveats).toEqual(expect.arrayContaining(["Quotation incomplete", "Validity expired 2026-10-01", "Quotation date not recorded"]));
  });
});

describe("buildRateComparison — historical firm BOQ rates", () => {
  it("shows the historical rate with its project, BOQ, date and status — never compared, never adjusted", () => {
    const h = item(run({ historical: [hist({ id: "h1" })] }), "h:h1");
    expect(h).toMatchObject({
      rate: 1200, unit: "sqm", pctVsReference: null, date: "2026-01-15",
      source: "Firm BOQ — Tower A BOQ · Tower A, Vizag",
      notComparedReason: "Historical — specification not verified against this line",
    });
    expect(h.caveats).toEqual(expect.arrayContaining([
      "BOQ was sent to a client; whether it was executed isn't recorded", "Rate year 2023",
      "No adjustment for inflation, location, taxes or specification",
    ]));
  });

  it("labels a rate that was only the DSR rate carried in that BOQ, and a draft BOQ, honestly", () => {
    const h = item(run({ historical: [hist({ id: "h1", custom_rate: null, boq: { ...hist({ id: "x" }).boq!, status: "draft" } })] }), "h:h1");
    expect(h.rate).toBe(950);
    expect(h.caveats).toEqual(expect.arrayContaining(["DSR rate carried in that BOQ — not the firm's own rate", "From a draft BOQ — never sent or finalized"]));
  });

  it("states missing provenance instead of inventing it", () => {
    const h = item(run({ historical: [hist({ id: "h1", custom_rate: null, dsr_rate: null, boq: null })] }), "h:h1");
    expect(h).toMatchObject({ rate: null, preferable: false, dateLabel: "Date not recorded", source: "Firm BOQ — Unnamed BOQ · Project not recorded" });
    expect(h.caveats).toContain("BOQ status not recorded");
  });

  it("never offers the line under review as its own historical evidence", () => {
    expect(run({ historical: [hist({ id: "line-1" })] }).items.some((i) => i.kind === "historical_boq")).toBe(false);
  });

  it("historicalRateOf prefers the firm's own rate over a carried DSR rate", () => {
    expect(historicalRateOf(hist({ id: "a" }))).toEqual({ rate: 1200, basis: "firm_rate" });
    expect(historicalRateOf(hist({ id: "a", custom_rate: null }))).toEqual({ rate: 950, basis: "dsr_carried" });
  });
});

describe("preferred candidate", () => {
  it("snapshots the chosen evidence's rate, unit, source and date", () => {
    const r = run({ quotations: [quote({ id: "q1" })] });
    expect(preferredFromEvidence(item(r, "q:q1"))).toEqual({
      preferred_kind: "vendor_quotation", preferred_quotation_id: "q1", preferred_boq_line_id: null,
      preferred_rate: 1100, preferred_unit: "sqm", preferred_source_label: "Quotation — Vendor A (Q-17)", preferred_rate_date: "2026-09-20",
    });
  });

  it("refuses the indicative row and evidence without a rate", () => {
    const r = run({ quotations: [quote({ id: "q1", status: "unavailable", quoted_rate: null })] });
    expect(() => preferredFromEvidence(item(r, "indicative"))).toThrow();
    expect(() => preferredFromEvidence(item(r, "q:q1"))).toThrow();
  });

  it("matches the recorded preference to its evidence row by source id", () => {
    const r = run({ quotations: [quote({ id: "q1" }), quote({ id: "q2" })] });
    const review = { preferred_kind: "vendor_quotation", preferred_quotation_id: "q2" } as RateReview;
    expect(isPreferred(item(r, "q:q1"), review)).toBe(false);
    expect(isPreferred(item(r, "q:q2"), review)).toBe(true);
    expect(isPreferred(item(r, "dsr"), review)).toBe(false);
  });
});

describe("parseQuotationForm", () => {
  const form = { ...EMPTY_QUOTATION_FORM, vendor_name: "Vendor A", quoted_rate: "1,250.50", quoted_unit: "sqm" };

  it("turns blanks into null, never a default", () => {
    const r = parseQuotationForm(form);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ quoted_rate: 1250.5, tax_pct: null, freight_amount: null, quotation_date: null, source_document_id: null, tax_treatment: "not_stated" });
  });

  it("allows an incomplete or unavailable quotation with no rate", () => {
    expect(parseQuotationForm({ ...form, status: "incomplete", quoted_rate: "", quoted_unit: "" }).ok).toBe(true);
    expect(parseQuotationForm({ ...form, status: "unavailable", quoted_rate: "" }).ok).toBe(true);
  });

  it("rejects a received quote without a rate or unit, a rate on an unavailable quote, and bad numbers/dates", () => {
    const errs = (f: typeof form) => { const r = parseQuotationForm(f); return r.ok === false ? r.errors : []; };
    expect(errs({ ...form, quoted_rate: "" })[0]).toMatch(/needs a rate/);
    expect(errs({ ...form, quoted_unit: "" })[0]).toMatch(/needs a unit/);
    expect(errs({ ...form, status: "unavailable" })[0]).toMatch(/can't carry a rate/);
    expect(errs({ ...form, quoted_rate: "-5" })).toContain("Quoted rate can't be negative");
    expect(errs({ ...form, tax_pct: "abc" })).toContain("Tax % must be a number");
    expect(errs({ ...form, quotation_date: "2026-10-10", valid_until: "2026-10-01" })).toContain("Validity date is before the quotation date");
    expect(errs({ ...form, vendor_name: " " })).toContain("Vendor name is required");
  });
});
