import { describe, it, expect } from "vitest";
import {
  assessRevisionLimitations, buildRevisionLines, csvRowsFrom, diffRevisionAgainstWorking, limitationText, pendingItemsFrom, quoteSubheadsFrom, revisionQuotePayload,
  type AdoptionRef, type StoredRevision, type WorkingLine, type WorkingSubhead,
} from "./boqRevision";
import { computeCommercials } from "./boqDsrDocument";

const wl = (o: Partial<WorkingLine> & { id: string }): WorkingLine => ({
  section: "Finishes", dsr_code: "11.41.2", description: o.id, unit: "sqm", qty: 10, dsr_rate: 100, custom_rate: null,
  included: true, quantity_status: "MEASURED", ...o,
});
const sh = (no: number, name: string, lines: WorkingLine[], src: Record<string, { sourceDocument: string | null; sourcePage: string | null; sourceDocumentId?: string | null }> = {}): WorkingSubhead => ({
  no, name, rows: lines.map((line, i) => ({ line, no: `${no}.${String(i + 1).padStart(2, "0")}`, source: src[line.id] ?? { sourceDocument: null, sourcePage: null } })),
});
const ADOPTION: AdoptionRef = {
  id: "ad-1", boq_line_id: "tiles", adopted_rate: 1150, source_kind: "vendor_quotation", source_label: "Quotation — Vendor A (Q-1)",
  source_unit: "sqm", source_date: "2026-10-01", confirmed_by: "reviewer-1", confirmed_at: "2026-10-12T09:00:00Z",
};

describe("buildRevisionLines", () => {
  const subheads = [
    sh(1, "Concrete", [wl({ id: "pcc", dsr_code: "4.1.3", unit: "cum", qty: 5, dsr_rate: 7000 })]),
    sh(2, "Finishes", [
      wl({ id: "tiles", custom_rate: 1150 }),
      wl({ id: "paint", custom_rate: 95 }),
      wl({ id: "rail", dsr_rate: null }),
      wl({ id: "door", qty: 0, quantity_status: "PENDING" }),
      wl({ id: "lift", included: false }),
    ], { tiles: { sourceDocument: "Ground Floor Plan", sourcePage: "3", sourceDocumentId: "doc-1" } }),
  ];
  const lines = buildRevisionLines(subheads, [ADOPTION]);
  const byId = (id: string) => lines.find((l) => l.source_line_id === id)!;

  it("numbers lines and copies quantity, unit, description and source exactly", () => {
    expect(lines.map((l) => [l.position, l.item_no])).toEqual([[1, "1.01"], [2, "2.01"], [3, "2.02"], [4, "2.03"], [5, "2.04"], [6, "2.05"]]);
    expect(byId("tiles")).toMatchObject({
      subhead_no: 2, subhead_name: "Finishes", description: "tiles", unit: "sqm", qty: 10,
      source_document_id: "doc-1", source_document_name: "Ground Floor Plan", source_page: "3",
    });
  });

  it("records the rate actually used, its basis and provenance", () => {
    expect(byId("pcc")).toMatchObject({ rate: 7000, rate_basis: "dsr", rate_provenance: "dsr_on_line", amount: 35000 });
    expect(byId("tiles")).toMatchObject({
      rate: 1150, rate_basis: "custom", rate_provenance: "adopted", amount: 11500,
      adoption_id: "ad-1", adoption_source_kind: "vendor_quotation", adoption_source_label: "Quotation — Vendor A (Q-1)",
      adoption_source_date: "2026-10-01", adoption_confirmed_by: "reviewer-1",
    });
    expect(byId("paint")).toMatchObject({ rate: 95, rate_provenance: "manual_override", adoption_id: null });
    expect(byId("rail")).toMatchObject({ rate: null, rate_basis: "none", amount: null });
  });

  it("treats a rate edited after adoption as a manual override, not as adopted", () => {
    const edited = buildRevisionLines([sh(1, "Finishes", [wl({ id: "tiles", custom_rate: 1200 })])], [ADOPTION]);
    expect(edited[0]).toMatchObject({ rate: 1200, rate_provenance: "manual_override", adoption_id: null });
  });

  it("records per-line limitations and leaves unpriced lines without an amount", () => {
    expect(byId("rail").limitations).toEqual(["No rate"]);
    expect(byId("door")).toMatchObject({ amount: null, limitations: ["Quantity pending"] });
    expect(byId("lift")).toMatchObject({ amount: null, limitations: ["Excluded from the BOQ"] });
    expect(byId("paint").limitations).toEqual(["Rate entered manually — no matching adoption record"]);
  });

  it("revision-level limitations name the status and counts, for explicit acknowledgement", () => {
    const lims = assessRevisionLimitations(lines, { boqStatus: "draft", adoptionRecordsAvailable: true });
    expect(lims.map(limitationText)).toEqual([
      'The BOQ\'s status is "draft", not finalized — this revision freezes a working draft. Mark the BOQ finalized first if it is ready.',
      "1 included line(s) have no rate and are unpriced",
      "1 included line(s) have no measured quantity yet",
      "1 line(s) use a manually entered rate with no matching adoption record",
      "2 included line(s) are priced at the DSR rate on the line, not an adopted rate",
      "1 line(s) are excluded from the BOQ and not priced",
    ]);
    const clean = buildRevisionLines([sh(1, "Finishes", [wl({ id: "tiles", custom_rate: 1150 })])], [ADOPTION]);
    expect(assessRevisionLimitations(clean, { boqStatus: "finalized", adoptionRecordsAvailable: true })).toEqual([]);
  });
});

describe("exports from snapshot lines", () => {
  const lines = buildRevisionLines([
    sh(1, "Concrete", [wl({ id: "pcc", unit: "cum", qty: 5, dsr_rate: 7000 }), wl({ id: "lift", included: false, qty: 3 })]),
    sh(2, "Openings", [wl({ id: "door", qty: 0, quantity_status: "PENDING" })]),
    sh(3, "Finishes", [wl({ id: "rail", dsr_rate: null, qty: 4 })], { rail: { sourceDocument: "Plan", sourcePage: "2" } }),
  ]);

  it("quote: included lines with quantity, priced or not; empty sub-heads dropped; subtotal counts included lines", () => {
    const q = quoteSubheadsFrom(lines);
    expect(q.map((s) => s.no)).toEqual([1, 3]);
    expect(q[0]).toMatchObject({ subtotal: 35000, lines: [{ no: "1.01", qty: 5, rate: 7000, amount: 35000 }] });
    expect(q[1].lines[0]).toMatchObject({ no: "3.01", rate: null, amount: null, sourceDocument: "Plan", sourcePage: "2" });
  });

  it("csv: every included line with a quantity; the pending door goes to the pending section, not a Qty of 0", () => {
    expect(csvRowsFrom(lines).map((r) => r.itemNo)).toEqual(["1.01", "3.01"]);
    expect(pendingItemsFrom(lines).map((p) => p.spec)).toEqual(["door"]);
  });

  it("a revision's PDF payload is built only from its own saved rows and header", () => {
    const rev: StoredRevision = {
      id: "rev-1", boq_id: "boq-1", project_id: "proj-1", boq_name: "Civil BOQ", project_name: "Tower B", revision_no: 1,
      label: "Rev A", boq_status_at_issue: "draft", discipline: "civil", rate_year: "2023",
      context: { quote: { projectName: "Tower B", clientName: "ACME", firmName: "Firm", rateYear: null } },
      commercials: computeCommercials(35000, { costIndexPct: 0, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18 }),
      works_total: 35000, grand_total: 0, line_count: 4, priced_line_count: 1, limitations: [], limitations_acknowledged: true,
      issue_note: null, issued_by: "u1", issued_at: "2026-10-12T09:00:00Z",
    };
    const p = revisionQuotePayload(rev, lines, false);
    expect(p).toMatchObject({ boqName: "Civil BOQ — Rev A", projectName: "Tower B", clientName: "ACME", firmName: "Firm", blankRates: false });
    expect(p.generatedOn).toMatch(/Rev A, frozen/);
    expect(p.commercials).toBe(rev.commercials);
    expect(p.abstract).toEqual([{ no: 1, name: "Concrete", amount: 35000 }, { no: 3, name: "Finishes", amount: 0 }]);
  });
});

describe("diffRevisionAgainstWorking", () => {
  const saved = buildRevisionLines([sh(1, "Finishes", [wl({ id: "a" }), wl({ id: "b", qty: 5 }), wl({ id: "c" })])]);

  it("reports unchanged, changed (field by field), removed and added lines", () => {
    const working = buildRevisionLines([sh(1, "Finishes", [
      wl({ id: "a" }),
      wl({ id: "b", qty: 7, custom_rate: 120 }),
      wl({ id: "d", description: "New skirting" }),
    ])]);
    const d = diffRevisionAgainstWorking(saved, working);
    expect(d.lines.get(1)).toEqual({ status: "unchanged", changes: [] });
    expect(d.lines.get(2)).toEqual({ status: "changed", changes: [{ field: "qty", from: "5", to: "7" }, { field: "rate", from: "100", to: "120" }] });
    expect(d.lines.get(3)).toEqual({ status: "removed", changes: [] });
    expect(d).toMatchObject({ changed: 1, removed: 1, added: [{ id: "d", description: "New skirting" }] });
  });

  it("compares numeric values stored as strings by the database as numbers", () => {
    const fromDb = saved.map((l) => ({ ...l, qty: String(l.qty) as unknown as number, rate: String(l.rate) as unknown as number }));
    expect(diffRevisionAgainstWorking(fromDb, saved).changed).toBe(0);
  });

  it("never modifies the saved lines it compares", () => {
    const before = JSON.stringify(saved);
    diffRevisionAgainstWorking(saved, []);
    expect(JSON.stringify(saved)).toBe(before);
  });
});
