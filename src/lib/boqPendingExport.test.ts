// Pending quantities in every export: an included line with no established
// quantity (qtyPending) is listed once in the document's pending section —
// never as a measured row with Qty 0, never silently dropped. Measured rows,
// excluded lines, formulas and source columns are unchanged.
import { describe, it, expect } from "vitest";
import {
  buildRevisionLines, csvRowsFrom, pendingItemsFrom, pendingReason, qtyPending, quoteSubheadsFrom, revisionQuotePayload,
  type RevisionLine, type StoredRevision, type WorkingLine, type WorkingSubhead,
} from "./boqRevision";
import { buildBoqCsv, buildDsrQuoteHtml, computeCommercials } from "./boqDsrDocument";

const wl = (o: Partial<WorkingLine> & { id: string }): WorkingLine => ({
  section: "Drawing review — added", dsr_code: null, description: o.id, unit: "sqm", qty: 10, dsr_rate: null, custom_rate: null,
  included: true, quantity_status: "MEASURED", ...o,
});
const PLAN = { sourceDocument: "Ground Floor Plan", sourcePage: "3", sourceDocumentId: "doc-1" };
const sh = (lines: WorkingLine[], src: Record<string, typeof PLAN> = {}): WorkingSubhead[] => [{
  no: 1, name: "Drawing review — added",
  rows: lines.map((line, i) => ({ line, no: `1.${String(i + 1).padStart(2, "0")}`, source: src[line.id] ?? { sourceDocument: null, sourcePage: null } })),
}];
const META = { boqName: "Example", generatedOn: "13 Oct 2026" };
const csvBody = (csv: string) => csv.split("\r\n").slice(4);

const MIXED = buildRevisionLines(sh([
  wl({ id: "lift", description: "Floor area — LIFT", qty: 4.23, dsr_rate: 1000 }),
  wl({ id: "corridor", description: "Floor area — CORRIDOR", qty: 0, quantity_status: "PENDING" }),
  wl({ id: "porch", description: "Porch", qty: 0, quantity_status: null }),
  wl({ id: "client-lift", description: "Lift machine (by client)", qty: 1, included: false }),
  wl({ id: "excluded-pending", description: "Excluded pending", qty: 0, quantity_status: "PENDING", included: false }),
], { lift: PLAN, corridor: PLAN }));

describe("which lines are measured, pending or excluded", () => {
  it("measured rows hold only included lines with an established quantity", () => {
    expect(csvRowsFrom(MIXED).map((r) => r.spec)).toEqual(["Floor area — LIFT"]);
    expect(quoteSubheadsFrom(MIXED).flatMap((s) => s.lines.map((l) => l.spec))).toEqual(["Floor area — LIFT"]);
  });

  it("each included pending line is listed exactly once, with its description, unit, source and reason — and no quantity", () => {
    const pending = pendingItemsFrom(MIXED);
    expect(pending).toEqual([
      { no: "P.01", spec: "Floor area — CORRIDOR", unit: "sqm", note: "Quantity pending: not yet measured", sourceDocument: "Ground Floor Plan", sourcePage: "3" },
      { no: "P.02", spec: "Porch", unit: "sqm", note: "Quantity pending: no quantity recorded", sourceDocument: null, sourcePage: null },
    ]);
    expect(pending.every((p) => !("qty" in p))).toBe(true);
  });

  it("excluded lines appear in neither section, pending or not", () => {
    const everywhere = [...csvRowsFrom(MIXED).map((r) => r.spec), ...pendingItemsFrom(MIXED).map((p) => p.spec)];
    expect(everywhere).not.toContain("Lift machine (by client)");
    expect(everywhere).not.toContain("Excluded pending");
  });

  it("a line still marked pending stays pending even with a quantity typed in; the reason says so", () => {
    const lines = buildRevisionLines(sh([wl({ id: "x", description: "Plaster", qty: 12, quantity_status: "PENDING" })]));
    expect(csvRowsFrom(lines)).toEqual([]);
    expect(quoteSubheadsFrom(lines)).toEqual([]);
    expect(pendingItemsFrom(lines)[0].note).toBe("Quantity pending: still marked pending; the entered 12 sqm has not been confirmed");
    expect(pendingReason({ qty: 0, unit: null, quantity_status: "pending" })).toBe("Quantity pending: not yet measured");
  });
});

describe("CSV", () => {
  it("measured rows are unchanged; the pending line is in the pending section with a blank Qty and its source", () => {
    const body = csvBody(buildBoqCsv(csvRowsFrom(MIXED), META, pendingItemsFrom(MIXED)));
    expect(body).toEqual([
      "1.00 Drawing review — added,1.01,,Floor area — LIFT,sqm,4.23,1000,1000,=F5*H5,Ground Floor Plan,3",
      "",
      "IDENTIFIED — PENDING QUANTIFICATION (not priced; confirm a quantity to price)",
      "Pending,P.01,,Floor area — CORRIDOR — Quantity pending: not yet measured,sqm,,,,,Ground Floor Plan,3",
      "Pending,P.02,,Porch — Quantity pending: no quantity recorded,sqm,,,,,,",
    ]);
  });

  it("no pending line is ever written as a measured Qty of 0", () => {
    const rows = buildBoqCsv(csvRowsFrom(MIXED), META, pendingItemsFrom(MIXED)).split("\r\n");
    expect(rows.filter((r) => r.split(",")[5] === "0")).toEqual([]);
  });

  it("a pending-only BOQ exports its pending section", () => {
    const lines = buildRevisionLines(sh([wl({ id: "c", description: "Floor area — CORRIDOR", qty: 0, quantity_status: "PENDING" })], { c: PLAN }));
    const body = csvBody(buildBoqCsv(csvRowsFrom(lines), META, pendingItemsFrom(lines)));
    expect(body).toEqual([
      "",
      "IDENTIFIED — PENDING QUANTIFICATION (not priced; confirm a quantity to price)",
      "Pending,P.01,,Floor area — CORRIDOR — Quantity pending: not yet measured,sqm,,,,,Ground Floor Plan,3",
    ]);
  });
});

describe("PDF", () => {
  const rev: StoredRevision = {
    id: "rev-1", boq_id: "boq-1", project_id: "proj-1", boq_name: "Civil BOQ", project_name: "Tower B", revision_no: 1,
    label: "Rev A", boq_status_at_issue: "draft", discipline: "civil", rate_year: null, context: { quote: {} },
    commercials: computeCommercials(4230, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 0 }),
    works_total: 4230, grand_total: 4230, line_count: 5, priced_line_count: 1, limitations: [], limitations_acknowledged: true,
    issue_note: null, issued_by: "u1", issued_at: "2026-10-12T09:00:00Z",
  };

  it("a frozen revision's payload lists its pending lines from its own saved rows", () => {
    const p = revisionQuotePayload(rev, MIXED, false);
    expect(p.subheads.flatMap((s) => s.lines.map((l) => l.spec))).toEqual(["Floor area — LIFT"]);
    expect(p.pendingItems).toEqual(pendingItemsFrom(MIXED));
  });

  it("uses the revision's stored values, not anything newer: a saved pending line stays pending", () => {
    const saved: RevisionLine[] = MIXED.map((l) => ({ ...l }));
    const p = revisionQuotePayload(rev, saved, false);
    saved[1].qty = 99; saved[1].quantity_status = "MEASURED"; // a later change elsewhere does not reach the built payload
    expect(p.pendingItems!.map((x) => x.spec)).toEqual(["Floor area — CORRIDOR", "Porch"]);
  });

  it("the rendered document shows pending lines as 'pending' with source and reason, and counts them in the status", () => {
    const html = buildDsrQuoteHtml(revisionQuotePayload(rev, MIXED, false), { autoPrint: false });
    expect(html).toContain("Identified — Pending Quantification");
    expect(html).toContain("Floor area — CORRIDOR<span class=\"pnote\"> — Quantity pending: not yet measured</span><span class=\"srcref\"> · Ground Floor Plan, p.3</span>");
    expect(html).toContain("Quantity pending: 2 items");
    expect((html.match(/class="num pend">pending</g) ?? []).length).toBe(2);
  });

  it("a pending-only revision still has content to export", () => {
    const lines = buildRevisionLines(sh([wl({ id: "c", description: "Floor area — CORRIDOR", qty: 0, quantity_status: "PENDING" })]));
    const p = revisionQuotePayload(rev, lines, false);
    expect(p.subheads).toEqual([]);
    expect(p.pendingItems).toHaveLength(1);
    expect(buildDsrQuoteHtml(p, { autoPrint: false })).toContain("Floor area — CORRIDOR");
  });
});

describe("one rule for pending, measured zero and excluded", () => {
  it("qtyPending: PENDING always; a positive quantity is established; zero only when MEASURED or COUNTED", () => {
    expect(qtyPending({ qty: 12, quantity_status: "PENDING" })).toBe(true);
    expect(qtyPending({ qty: null, quantity_status: "MEASURED" })).toBe(true);
    expect(qtyPending({ qty: 4.2, quantity_status: null })).toBe(false);
    expect(qtyPending({ qty: 0, quantity_status: "MEASURED" })).toBe(false);
    expect(qtyPending({ qty: 0, quantity_status: "counted" })).toBe(false);
    for (const s of [null, "", "ESTIMATED", "DERIVED", "NOT_APPLICABLE"]) expect(qtyPending({ qty: 0, quantity_status: s })).toBe(true);
    expect(qtyPending({ qty: -1, quantity_status: "MEASURED" })).toBe(true);
  });

  const lines = buildRevisionLines(sh([
    wl({ id: "tiles", description: "Tiles", qty: 40, dsr_rate: 100 }),
    wl({ id: "plaster", description: "Plaster", qty: 12, dsr_rate: 100, quantity_status: "PENDING" }),
    wl({ id: "skirting", description: "Skirting (none required)", qty: 0, dsr_rate: 100, quantity_status: "MEASURED" }),
    wl({ id: "lift", description: "Lift", qty: 1, dsr_rate: 100, included: false }),
  ]));

  it("a verified zero is a measured row with Qty 0 and amount 0 — distinct from pending and from excluded", () => {
    expect(csvRowsFrom(lines).map((r) => [r.spec, r.qty])).toEqual([["Tiles", 40], ["Skirting (none required)", 0]]);
    expect(pendingItemsFrom(lines).map((p) => p.spec)).toEqual(["Plaster"]);
    expect(lines.find((l) => l.source_line_id === "skirting")).toMatchObject({ amount: 0, limitations: [] });
  });

  it("an unconfirmed quantity is never priced: no line amount, and the sub-head subtotal counts only measured lines", () => {
    expect(lines.find((l) => l.source_line_id === "plaster")).toMatchObject({ amount: null, limitations: ["Quantity pending"] });
    expect(quoteSubheadsFrom(lines)[0].subtotal).toBe(4000);
  });
});
