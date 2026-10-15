import { describe, it, expect } from "vitest";
import { commercialsFor, groupSubheads, liveCsv, liveQuotePayload, quoteContextFor, workingSubheadsFrom } from "./boqLiveExport";
import type { WorkingLine } from "./boqRevision";

const L = (p: Partial<WorkingLine>): WorkingLine => ({
  id: "x", section: "Brickwork", dsr_code: "6.1", description: "Brick", unit: "cum", qty: 10,
  dsr_rate: 100, custom_rate: null, included: true, quantity_status: null, ...p,
});
const noSource = () => ({ sourceDocument: null, sourcePage: null });

describe("groupSubheads", () => {
  it("orders sub-heads by DSR chapter, uncoded last, and numbers items", () => {
    const g = groupSubheads([
      L({ id: "a", section: "Plaster", dsr_code: "13.1" }),
      L({ id: "b", section: "Misc", dsr_code: null }),
      L({ id: "c", section: "Brickwork", dsr_code: "6.1" }),
      L({ id: "d", section: "Brickwork", dsr_code: "6.2", qty: 0 }),
    ]);
    expect(g.map((s) => [s.no, s.name])).toEqual([[1, "Brickwork"], [2, "Plaster"], [3, "Misc"]]);
    expect(g[0].rows.map((r) => r.no)).toEqual(["1.01", "1.02"]);
    expect(g[0].subtotal).toBe(1000); // the pending line counts 0
  });
});

describe("commercialsFor / quoteContextFor", () => {
  it("applies CPWD-style defaults when the spec sets none", () => {
    const c = commercialsFor(100000, {});
    expect(c).toMatchObject({ costIndexPct: 0, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18 });
  });
  it("only claims a DSR basis when DSR pricing was chosen", () => {
    expect(quoteContextFor({ name: "P" }, {}).rateYear).toBeNull();
    expect(quoteContextFor({ name: "P" }, { _pricing_basis: "DSR" }).rateYear).toBe("2023");
  });
});

describe("liveQuotePayload / liveCsv", () => {
  const args = (lines: WorkingLine[]) => ({
    boqName: "B", context: quoteContextFor(null, {}), generatedOn: "1 Jan 2026", blankRates: false,
    subheads: workingSubheadsFrom(groupSubheads(lines), noSource), commercials: commercialsFor(0, {}), unresolvedReviewCount: 2,
  });
  it("returns nothing to export when every line is excluded", () => {
    expect(liveQuotePayload(args([L({ included: false })]))).toBeNull();
    expect(liveCsv({ boqName: "B", projectName: null, generatedOn: "", subheads: args([L({ included: false })]).subheads, unresolvedReviewCount: 0 })).toBeNull();
  });
  it("still exports a pending-only BOQ, listing the line as pending", () => {
    const p = liveQuotePayload(args([L({ qty: 0 })]))!;
    expect(p.subheads).toEqual([]);
    expect(p.pendingItems).toHaveLength(1);
    expect(p.unresolvedReviewCount).toBe(2);
  });
  it("carries a resolved source into the payload", () => {
    const subheads = workingSubheadsFrom(groupSubheads([{ ...L({}), source_document_id: "d1" } as WorkingLine & { source_document_id: string }]),
      () => ({ sourceDocument: "GF Plan", sourcePage: "2" }));
    expect(subheads[0].rows[0].source).toEqual({ sourceDocument: "GF Plan", sourcePage: "2", sourceDocumentId: "d1" });
  });
});
