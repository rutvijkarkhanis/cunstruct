// CROSS-REPRESENTATION CONSISTENCY — the same persisted BOQ lines must say the
// same thing in every representation: the journey's UI totals (boqTotals), the
// shared money rule (lib/quantity worksTotal), the live PDF payload, the live
// CSV and the frozen-revision lines. Line identity (code + item), quantity,
// unit, basis and price state must agree; a pending quantity is never priced
// as 0, a confirmed zero is a real ₹0, and a missing rate stays distinct from
// a missing quantity.
import { describe, it, expect } from "vitest";
import { boqTotals, lineStatus, type BoqTableLine } from "@/lib/app/boqTable";
import { quantityProvenance, worksTotal } from "@/lib/quantity";
import { buildRevisionLines, csvRowsFrom, pendingItemsFrom, quoteSubheadsFrom } from "@/lib/boqRevision";
import { commercialsFor, groupSubheads, includedTotal, liveCsv, liveQuotePayload, quoteContextFor, workingSubheadsFrom } from "@/lib/boqLiveExport";

const L = (o: Partial<BoqTableLine> & { id: string }): BoqTableLine => ({
  section: "Masonry", dsr_code: null, description: o.id, unit: "cum", qty: 1, dsr_rate: null, custom_rate: null,
  basis: null, basis_note: null, quantity_status: null, included: true, sort: 0, source_document_id: null, source_page: null, ...o,
});

// One line per case the rules must keep apart. Descriptions have no commas so
// the CSV can be split simply.
const LINES: BoqTableLine[] = [
  L({ id: "priced", dsr_code: "6.1", qty: 10, dsr_rate: 100, basis: "DRAWING_INPUT", sort: 1 }),
  L({ id: "override", dsr_code: "6.2", qty: 2.5, dsr_rate: 100, custom_rate: 333, basis: "MANUAL", sort: 2 }),
  L({ id: "norate", dsr_code: "6.3", qty: 4, basis: "HEURISTIC", sort: 3 }),
  L({ id: "zero-confirmed", dsr_code: "6.4", qty: 0, dsr_rate: 50, quantity_status: "MEASURED", basis: "REVIEW_VERIFIED", sort: 4 }),
  // An accepted DSR-check line whose quantity is still pending: keeps its code.
  L({ id: "dsr-pending", section: "Plaster", dsr_code: "13.1", qty: 0, dsr_rate: 200, quantity_status: "PENDING", basis: "PENDING", sort: 5 }),
  L({ id: "zero-unconfirmed", section: "Plaster", dsr_code: "13.2", qty: 0, dsr_rate: 80, sort: 6 }),
  L({ id: "basis-pending", section: "Plaster", dsr_code: "13.3", qty: 7, dsr_rate: 90, basis: "PENDING", sort: 7 }),
  L({ id: "negative", section: "Plaster", dsr_code: "13.4", qty: -3, dsr_rate: 90, sort: 8 }),
  L({ id: "excluded", dsr_code: "6.9", qty: 5, dsr_rate: 10, included: false, sort: 9 }),
];

const EXPECTED_WORKS = 10 * 100 + Math.round(2.5 * 333) + 0; // 1000 + 833 + confirmed ₹0

function representations(lines = LINES) {
  const subheads = workingSubheadsFrom(groupSubheads(lines), () => ({ sourceDocument: null, sourcePage: null }));
  const spec = {};
  const payload = liveQuotePayload({
    boqName: "B", context: quoteContextFor(null, spec), generatedOn: "today", blankRates: false,
    subheads, commercials: commercialsFor(includedTotal(lines), spec), unresolvedReviewCount: 0,
  })!;
  const csv = liveCsv({ boqName: "B", projectName: "P", generatedOn: "today", subheads, unresolvedReviewCount: 0 })!;
  const revision = buildRevisionLines(subheads);
  return { subheads, payload, csv, revision };
}

// Minimal quote-aware CSV row split (csvCell quotes cells containing , " or newline).
const splitRow = (row: string): string[] => {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (q) { if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
};
const csvTable = (csv: string) => {
  const rows = csv.split("\r\n").map(splitRow);
  const header = rows[3];
  const pendingAt = rows.findIndex((r) => r[0].startsWith("IDENTIFIED"));
  const body = rows.slice(4, pendingAt === -1 ? undefined : pendingAt).filter((r) => r.length > 1);
  const pending = pendingAt === -1 ? [] : rows.slice(pendingAt + 1).filter((r) => r[0] === "Pending");
  const col = (name: string) => header.indexOf(name);
  return { body, pending, col };
};

describe("same BOQ lines → UI totals, live PDF, live CSV and revision lines agree", () => {
  const { payload, csv, revision } = representations();
  const byId = new Map(LINES.map((l) => [l.id, l]));
  const measuredIds = LINES.filter((l) => l.included && lineStatus(l) !== "pending").map((l) => l.id);
  const pendingIds = LINES.filter((l) => l.included && lineStatus(l) === "pending").map((l) => l.id);

  it("classifies the fixture as intended (guards the fixture itself)", () => {
    expect(Object.fromEntries(LINES.map((l) => [l.id, lineStatus(l)]))).toEqual({
      priced: "complete", override: "complete", norate: "unpriced", "zero-confirmed": "complete",
      "dsr-pending": "pending", "zero-unconfirmed": "pending", "basis-pending": "pending", negative: "pending",
      excluded: "excluded",
    });
  });

  it("totals: UI priced total = shared works total = PDF works/abstract/subtotals = revision amounts", () => {
    const ui = boqTotals(LINES);
    expect(ui.pricedTotal).toBe(EXPECTED_WORKS);
    expect(worksTotal(LINES)).toBe(EXPECTED_WORKS);
    expect(includedTotal(LINES)).toBe(EXPECTED_WORKS);
    expect(payload.commercials.works).toBe(EXPECTED_WORKS);
    expect(payload.subheads.reduce((s, sh) => s + sh.subtotal, 0)).toBe(EXPECTED_WORKS);
    expect(payload.abstract.reduce((s, a) => s + a.amount, 0)).toBe(EXPECTED_WORKS);
    expect(payload.subheads.flatMap((sh) => sh.lines).reduce((s, l) => s + (l.amount ?? 0), 0)).toBe(EXPECTED_WORKS);
    expect(revision.reduce((s, l) => s + (l.amount ?? 0), 0)).toBe(EXPECTED_WORKS);
    // Counts agree too.
    expect(ui).toMatchObject({ complete: 3, unpriced: 1, pending: 4, excluded: 1 });
    expect(payload.pendingItems).toHaveLength(ui.pending);
    expect(payload.subheads.flatMap((sh) => sh.lines).filter((l) => l.rate == null)).toHaveLength(ui.unpriced);
  });

  it("line identity: the same measured lines (code, item no) appear in the PDF, CSV and revision, in the same order", () => {
    const pdf = payload.subheads.flatMap((sh) => sh.lines).map((l) => [l.code, l.no]);
    const { body, col } = csvTable(csv);
    const csvIds = body.map((r) => [r[col("Code")], r[col("Item")]]);
    const rev = revision.filter((l) => measuredIds.includes(l.source_line_id!)).map((l) => [l.dsr_code, l.item_no]);
    expect(pdf).toEqual(rev);
    expect(csvIds).toEqual(rev);
    expect(rev.map(([c]) => c)).toEqual(measuredIds.map((id) => byId.get(id)!.dsr_code));
  });

  it("quantity, unit, rate, amount and basis per measured line match the persisted line in every representation", () => {
    const pdfLines = payload.subheads.flatMap((sh) => sh.lines);
    const { body, col } = csvTable(csv);
    measuredIds.forEach((id, i) => {
      const l = byId.get(id)!;
      const rate = l.custom_rate ?? l.dsr_rate;
      const amount = rate == null ? null : Math.round(l.qty * rate);
      const basis = quantityProvenance(l).label;
      expect(pdfLines[i]).toMatchObject({ code: l.dsr_code, qty: l.qty, unit: l.unit, rate, amount, basis });
      const r = body[i];
      expect([r[col("Code")], Number(r[col("Qty")]), r[col("Unit")], r[col("Your rate")], r[col("Quantity basis")]])
        .toEqual([l.dsr_code, l.qty, l.unit, rate == null ? "" : String(rate), basis]);
      // A missing rate leaves no Amount formula (never a computed 0).
      expect(r[col("Amount")] === "").toBe(rate == null);
      const rv = revision.find((x) => x.source_line_id === id)!;
      expect(rv).toMatchObject({ dsr_code: l.dsr_code, qty: l.qty, unit: l.unit, rate, amount, basis: l.basis });
    });
  });

  it("confirmed zero is a real ₹0 measured row; missing rate is a measured row with no amount", () => {
    const pdfLines = payload.subheads.flatMap((sh) => sh.lines);
    expect(pdfLines.find((l) => l.code === "6.4")).toMatchObject({ qty: 0, rate: 50, amount: 0 });
    expect(pdfLines.find((l) => l.code === "6.3")).toMatchObject({ qty: 4, rate: null, amount: null });
    expect(revision.find((l) => l.dsr_code === "6.3")!.limitations).toContain("No rate");
    expect(revision.find((l) => l.dsr_code === "6.3")!.limitations).not.toContain("Quantity pending");
  });

  it("pending lines: never priced, never a measured row, listed with their code and pending state in PDF and CSV", () => {
    const pendingCodes = pendingIds.map((id) => byId.get(id)!.dsr_code);
    expect(payload.pendingItems!.map((p) => p.code)).toEqual(pendingCodes);
    expect(payload.pendingItems!.every((p) => /^Quantity pending/.test(p.note ?? ""))).toBe(true);
    expect(payload.pendingItems!.every((p) => !("qty" in p))).toBe(true);
    const pdfCodes = payload.subheads.flatMap((sh) => sh.lines).map((l) => l.code);
    for (const c of pendingCodes) expect(pdfCodes).not.toContain(c);
    const { body, pending, col } = csvTable(csv);
    expect(body.map((r) => r[col("Code")])).not.toEqual(expect.arrayContaining(pendingCodes));
    expect(pending.map((r) => r[col("Code")])).toEqual(pendingCodes);
    expect(pending.every((r) => r[col("Qty")] === "" && r[col("Amount")] === "")).toBe(true);
    for (const id of pendingIds) {
      const rv = revision.find((x) => x.source_line_id === id)!;
      expect(rv.amount).toBeNull();
      expect(rv.limitations).toContain("Quantity pending");
      expect(rv.dsr_code).toBe(byId.get(id)!.dsr_code);
    }
    // Revisions re-exported from their own rows say the same as the live export.
    expect(pendingItemsFrom(revision)).toEqual(payload.pendingItems);
    expect(quoteSubheadsFrom(revision)).toEqual(payload.subheads);
    expect(csvRowsFrom(revision).map((r) => r.code)).toEqual(payload.subheads.flatMap((sh) => sh.lines).map((l) => l.code));
  });

  it("excluded lines appear in no export and add nothing to any total", () => {
    expect(JSON.stringify(payload)).not.toContain("6.9");
    expect(csv).not.toContain("6.9");
    expect(revision.find((l) => l.dsr_code === "6.9")).toMatchObject({ included: false, amount: null });
  });
});
