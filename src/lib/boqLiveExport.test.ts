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

describe("subhead names", () => {
  it("never prints the internal review section as a sub-head", () => {
    const g = groupSubheads([L({ id: "r", section: "Drawing review — added", dsr_code: null }), L({ id: "b" })]);
    expect(g.map((s) => s.name)).toEqual(["Brickwork", "Unassigned"]);
    const csv = liveCsv({ boqName: "B", projectName: null, generatedOn: "", unresolvedReviewCount: 0, subheads: workingSubheadsFrom(g, noSource) })!;
    expect(csv).not.toContain("Drawing review");
    expect(csv).toContain("Unassigned");
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

describe("working-BOQ exports say what they are, and the CSV states the PDF's totals", () => {
  const lines = [L({ id: "a" }), L({ id: "b", dsr_code: null, description: "Own item", dsr_rate: null, custom_rate: 50, qty: 4 })];
  const subheads = workingSubheadsFrom(groupSubheads(lines), noSource);
  const c = commercialsFor(1200, {}, 1000);

  it("dates a working export as a working estimate, never as a frozen revision", () => {
    const p = liveQuotePayload({ boqName: "B", context: quoteContextFor(null, {}), generatedOn: "1 Jan 2026", blankRates: false, subheads, commercials: c, unresolvedReviewCount: 0 })!;
    expect(p.generatedOn).toBe("1 Jan 2026 (working estimate, not frozen)");
    const csv = liveCsv({ boqName: "B", projectName: "P", generatedOn: "1 Jan 2026", subheads, unresolvedReviewCount: 0 })!;
    expect(csv.split("\r\n")[1]).toContain("1 Jan 2026 (working estimate, not frozen)");
  });

  it("states the cost of works and grand total under the lines, computed as for the PDF", () => {
    const csv = liveCsv({ boqName: "B", projectName: "P", generatedOn: "1 Jan 2026", subheads, unresolvedReviewCount: 0, commercials: c })!;
    const rows = csv.split("\r\n");
    const works = rows.find((r) => r.includes("Cost of works (priced items)"))!;
    expect(works).toBe(`"Cost of works (priced items): ₹${Math.round(c.works).toLocaleString("en-IN")}"`);
    const grand = rows.find((r) => r.includes("Grand total"))!;
    expect(grand).toContain(`: ₹${Math.round(c.grandTotal).toLocaleString("en-IN")}`);
    expect(grand).not.toContain("currently priced scope only");
  });

  it("says when the totals cover only the priced scope", () => {
    const partial = workingSubheadsFrom(groupSubheads([...lines, L({ id: "c", dsr_code: null, description: "No rate yet", dsr_rate: null, qty: 2 }), L({ id: "d", qty: 0 })]), noSource);
    const csv = liveCsv({ boqName: "B", projectName: "P", generatedOn: "1 Jan 2026", subheads: partial, unresolvedReviewCount: 0, commercials: c })!;
    expect(csv).toContain("currently priced scope only; 1 item without a rate and 1 with a pending quantity not included");
    expect(csv).toContain("Grand total of currently priced scope only");
  });

  it("totals are single-cell rows, which readers of the line table skip (as they do section titles)", () => {
    const csv = liveCsv({ boqName: "B", projectName: "P", generatedOn: "1 Jan 2026", subheads, unresolvedReviewCount: 0, commercials: c })!;
    const header = csv.split("\r\n").findIndex((r) => r.startsWith("Sub-head,"));
    const after = csv.split("\r\n").slice(header + 1);
    const tableRows = after.filter((r) => r !== "" && !r.startsWith('"'));
    expect(tableRows).toHaveLength(2); // exactly the two line rows
    for (const r of after.filter((x) => x.startsWith('"'))) expect(r.endsWith('"')).toBe(true);
  });

  it("without commercials, no totals are stated (nothing is guessed)", () => {
    const csv = liveCsv({ boqName: "B", projectName: "P", generatedOn: "1 Jan 2026", subheads, unresolvedReviewCount: 0 })!;
    expect(csv).not.toContain("Grand total");
  });
});
