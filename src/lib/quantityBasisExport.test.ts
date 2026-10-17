// The PDF and CSV state each quantity's recorded basis — and nothing more. A
// document never claims its quantities come from drawings unless the lines
// say so; a line with no recorded basis says "Basis not recorded".
import { describe, it, expect } from "vitest";
import { liveCsv, liveQuotePayload } from "./boqLiveExport";
import { buildDsrQuoteHtml, computeCommercials } from "./boqDsrDocument";
import type { WorkingLine, WorkingSubhead } from "./boqRevision";

const wl = (o: Partial<WorkingLine> & { id: string }): WorkingLine => ({
  section: "Finishes", dsr_code: null, description: o.id, unit: "sqm", qty: 10, dsr_rate: 100, custom_rate: null,
  included: true, quantity_status: "MEASURED", ...o,
});
const sh = (lines: WorkingLine[]): WorkingSubhead[] => [{
  no: 1, name: "Finishes",
  rows: lines.map((line, i) => ({ line, no: `1.${String(i + 1).padStart(2, "0")}`, source: { sourceDocument: "GF Plan", sourcePage: "2" } })),
}];
const ARGS = { boqName: "B", projectName: "P", generatedOn: "16 Oct 2026", unresolvedReviewCount: 0 };
const pdf = (subheads: WorkingSubhead[]) => buildDsrQuoteHtml(liveQuotePayload({
  ...ARGS, context: {}, blankRates: false, subheads, commercials: computeCommercials(1000, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 0 }),
})!, { autoPrint: false });

const WITH_BASIS = sh([
  wl({ id: "tiles", basis: "DRAWING_INPUT", basis_note: null }),
  wl({ id: "plaster", basis: null, basis_note: null }),
  wl({ id: "paint", basis: "HEURISTIC", basis_note: "3 coats assumed" }),
  wl({ id: "door", qty: 0, basis: "PENDING", quantity_status: "PENDING" }),
]);

describe("CSV — a 'Quantity basis' column after the source columns", () => {
  it("states each recorded basis; unknown stays unknown; the Amount formula columns are unchanged", () => {
    const csv = liveCsv({ ...ARGS, subheads: WITH_BASIS })!;
    const rows = csv.split("\r\n");
    const header = rows.find((r) => r.startsWith("Sub-head,"))!;
    expect(header.split(",").slice(-3)).toEqual(["Source Document", "Source Page", "Quantity basis"]);
    expect(rows.find((r) => r.includes(",tiles,"))).toMatch(/=F\d+\*H\d+,GF Plan,2,From drawing summary \(estimator's reading\)$/);
    expect(rows.find((r) => r.includes(",plaster,"))).toMatch(/,Basis not recorded$/);
    expect(rows.find((r) => r.includes(",paint,"))).toMatch(/,Assumption$/);
    expect(rows.find((r) => r.startsWith("Pending,"))).toMatch(/door — Quantity pending.*,Awaiting quantity$/);
  });
  it("lines that carry no basis fields leave the column blank rather than inventing one", () => {
    const csv = liveCsv({ ...ARGS, subheads: sh([{ ...wl({ id: "x" }) }]) })!;
    expect(csv.split("\r\n").find((r) => r.includes(",x,"))).toMatch(/,GF Plan,2,$/);
  });
});

describe("PDF — basis per line and an honest footer", () => {
  it("prints each line's recorded basis and never claims the quantities came from drawings", () => {
    const html = pdf(WITH_BASIS);
    expect(html).toContain("Basis: From drawing summary (estimator&#39;s reading)");
    expect(html).not.toMatch(/take-off|counted or measured from the supplied drawings/i);
    expect(html).toContain("Basis: Basis not recorded");
    expect(html).toContain("Basis: Assumption");
    expect(html).toContain("Each quantity states its recorded basis.");
    expect(html).not.toMatch(/Quantities are (established from|based on supplied drawing)/);
  });
  it("without basis data the footer says the document does not state it", () => {
    const html = pdf(sh([wl({ id: "x" })]));
    expect(html).toContain("This document does not state the basis of each quantity.");
    expect(html).not.toMatch(/Quantities are (established from|based on supplied drawing)/);
  });
});
