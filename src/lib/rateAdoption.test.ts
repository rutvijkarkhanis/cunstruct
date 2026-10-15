import { describe, it, expect, vi, beforeEach } from "vitest";

const io = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  result: { data: "applied" as unknown, error: null as null | { message: string } },
}));
vi.mock("@/lib/untypedDb", () => ({
  rpc: (fn: string, args: Record<string, unknown>) => { io.calls.push({ fn, args }); return Promise.resolve(io.result); },
}));

import { applyRateAdoption, assessAdoption, confirmationText, previewAdoption, type CommercialLine } from "./rateAdoption";
import { buildRateComparison, type HistoricalLine, type VendorQuotation } from "./rateEvidence";
import type { DsrMappingRow } from "./dsrMapping";

const TODAY = "2026-10-12";
const LINE: CommercialLine = { id: "line-1", description: "Vitrified tiles", unit: "sqm", qty: 40, custom_rate: null, dsr_rate: 900 };
const MAPPING: DsrMappingRow = {
  id: "m1", boq_id: "boq-1", boq_line_id: "line-1", status: "mapped", include_in_estimate: false,
  dsr_item_id: "dsr-1", dsr_code: "11.41.2", dsr_description: "Vitrified tiles", dsr_unit: "sqm", dsr_rate: 1000,
  dsr_source: "DSR", dsr_rate_year: "2023", reviewer_note: null, reviewed_by: null, reviewed_at: null,
};
const quote = (o: Partial<VendorQuotation> = {}): VendorQuotation => ({
  id: "q1", boq_id: "boq-1", boq_line_id: "line-1", status: "received", vendor_name: "Vendor A", vendor_contact: null,
  quoted_description: "600x600 vitrified", quoted_unit: "sqm", quoted_rate: 1150, spec_match: "matches",
  tax_treatment: "excluded", tax_pct: 18, freight: "included", freight_amount: null, installation: "included",
  installation_amount: null, other_charges: null, quotation_date: "2026-10-01", valid_until: "2026-11-01",
  quotation_ref: "Q-1", source_document_id: null, exclusions: null, conditions: null, notes: null, recorded_by: null, ...o,
});
const HIST: HistoricalLine = {
  id: "old-1", boq_id: "boq-old", description: "Vitrified tiles", unit: "sqm", qty: 100, dsr_code: "11.41.2",
  dsr_rate: 950, custom_rate: 1200,
  boq: { name: "Tower A BOQ", status: "draft", rate_year: "2023", created_at: null, updated_at: "2026-01-15T00:00:00Z", project: { name: "Tower A", location: null } },
};

function evidence(o: { mapping?: DsrMappingRow | null; quotations?: VendorQuotation[]; historical?: HistoricalLine[] } = {}) {
  return buildRateComparison({
    line: LINE, mapping: o.mapping === undefined ? MAPPING : o.mapping, indicativeAmount: 40000,
    quotations: o.quotations ?? [], historical: o.historical ?? [], today: TODAY,
  }).items;
}
const find = (items: ReturnType<typeof evidence>, key: string) => items.find((i) => i.key === key)!;
const src = (o: Partial<{ mapping: DsrMappingRow | null; quotation: VendorQuotation | null; historical: HistoricalLine | null }> = {}) =>
  ({ mapping: MAPPING, quotation: null, historical: null, ...o });

describe("assessAdoption — blocked candidates", () => {
  it("refuses the indicative estimate (adopt the DSR reference explicitly instead)", () => {
    const a = assessAdoption(LINE, find(evidence(), "indicative"), src(), TODAY);
    expect(a.adoptable).toBe(false);
    expect(a.blockers[0]).toMatch(/select the DSR reference itself/);
  });

  it.each([
    ["unavailable quotation", { status: "unavailable" as const, quoted_rate: null }, /no rate to adopt|did not provide a usable quotation/],
    ["incomplete quotation", { status: "incomplete" as const }, /marked incomplete/],
    ["scope differs", { spec_match: "differs" as const }, /differs from the BOQ line/],
    ["incompatible unit", { quoted_unit: "box" }, /incompatible with the BOQ line's unit "sqm" — rates are never converted/],
    ["missing unit", { quoted_unit: null }, /compatibility can't be verified/],
  ])("blocks a quotation: %s", (_n, o, re) => {
    const q = quote(o);
    const a = assessAdoption(LINE, find(evidence({ quotations: [q] }), "q:q1"), src({ quotation: q }), TODAY);
    expect(a.adoptable).toBe(false);
    expect(a.blockers.join(" ")).toMatch(re);
    expect(a.acknowledgements).toEqual([]);
  });

  it("blocks a DSR reference whose mapping still needs review", () => {
    const m = { ...MAPPING, status: "needs_review" as const };
    const a = assessAdoption(LINE, find(evidence({ mapping: m }), "dsr"), src({ mapping: m }), TODAY);
    expect(a.blockers.join(" ")).toMatch(/must be confirmed/);
  });

  it("blocks re-adopting the rate the line already has", () => {
    const q = quote();
    const a = assessAdoption({ ...LINE, custom_rate: 1150 }, find(evidence({ quotations: [q] }), "q:q1"), src({ quotation: q }), TODAY);
    expect(a.blockers).toContain("This rate is already the line's commercial rate.");
  });
});

describe("assessAdoption — caveats that must be acknowledged", () => {
  it("a fully stated, like-for-like quotation needs no acknowledgement", () => {
    const q = quote();
    expect(assessAdoption(LINE, find(evidence({ quotations: [q] }), "q:q1"), src({ quotation: q }), TODAY))
      .toEqual({ adoptable: true, blockers: [], acknowledgements: [] });
  });

  it("an unconfirmed scope, expired validity and unstated tax/freight must each be acknowledged", () => {
    const q = quote({ spec_match: "unclear", valid_until: "2026-10-05", tax_treatment: "not_stated", freight: "not_stated" });
    const a = assessAdoption(LINE, find(evidence({ quotations: [q] }), "q:q1"), src({ quotation: q }), TODAY);
    expect(a.adoptable).toBe(true);
    expect(a.acknowledgements).toEqual([
      "The quoted specification/scope has not been confirmed to match the BOQ line.",
      "The quotation's validity expired on 2026-10-05.",
      "The quotation does not state whether tax is included.",
      "The quotation does not state whether freight is included.",
    ]);
  });

  it("a historical rate is adoptable only with explicit acknowledgement that it isn't current pricing", () => {
    const a = assessAdoption(LINE, find(evidence({ historical: [HIST] }), "h:old-1"), src({ historical: HIST }), TODAY);
    expect(a.adoptable).toBe(true);
    expect(a.acknowledgements).toEqual(expect.arrayContaining([
      expect.stringMatching(/^This is a historical rate from another BOQ, not current market pricing/),
      "Its specification has not been verified against this BOQ line.",
      "From a draft BOQ — never sent or finalized",
    ]));
  });

  it("a confirmed DSR reference needs acknowledgement that it is a schedule benchmark", () => {
    const a = assessAdoption(LINE, find(evidence(), "dsr"), src(), TODAY);
    expect(a.adoptable).toBe(true);
    expect(a.acknowledgements[0]).toBe("DSR schedule rate (2023) is a reference benchmark, not a current market quotation.");
  });
});

describe("previewAdoption", () => {
  it("compares current (DSR on the line) and proposed amounts without changing anything", () => {
    expect(previewAdoption(LINE, 1150)).toEqual({
      currentRate: 900, currentBasis: "dsr", currentAmount: 36000, proposedRate: 1150, proposedAmount: 46000, delta: 10000, quantityPending: false,
    });
  });

  it("shows no amounts while the quantity is pending", () => {
    expect(previewAdoption({ ...LINE, qty: 0 }, 1150)).toMatchObject({ quantityPending: true, currentAmount: null, proposedAmount: null, delta: null });
  });
});

describe("applyRateAdoption — one atomic write", () => {
  beforeEach(() => { io.calls = []; io.result = { data: "applied", error: null }; });
  const base = () => {
    const q = quote({ tax_treatment: "not_stated" });
    return { boqId: "boq-1", line: LINE, item: find(evidence({ quotations: [q] }), "q:q1"), sources: src({ quotation: q }), confirmedBy: "reviewer-1", today: TODAY };
  };
  const ACK = ["The quotation does not state whether tax is included."];

  it("refuses without every acknowledgement — and calls nothing", async () => {
    await expect(applyRateAdoption({ ...base(), acknowledged: [] })).rejects.toThrow(/must be acknowledged/);
    expect(io.calls).toHaveLength(0);
  });

  it("refuses a blocked candidate — and calls nothing", async () => {
    const q = quote({ quoted_unit: "box" });
    await expect(applyRateAdoption({ ...base(), item: find(evidence({ quotations: [q] }), "q:q1"), sources: src({ quotation: q }), acknowledged: [] }))
      .rejects.toThrow(/Adoption blocked/);
    expect(io.calls).toHaveLength(0);
  });

  it("sends the guarded rate change and the full provenance in ONE adopt_boq_line_rate call", async () => {
    await expect(applyRateAdoption({ ...base(), acknowledged: ACK })).resolves.toEqual({ status: "applied" });
    expect(io.calls).toHaveLength(1);
    const { fn, args } = io.calls[0];
    expect(fn).toBe("adopt_boq_line_rate");
    expect(args).toMatchObject({
      p_line_id: "line-1", p_rate: 1150,
      p_expected: { custom_rate: null, dsr_rate: 900, unit: "sqm" },
      p_record: {
        previous_rate: 900, previous_basis: "dsr", source_kind: "vendor_quotation", source_quotation_id: "q1",
        source_label: "Quotation — Vendor A (Q-1)", source_unit: "sqm", source_date: "2026-10-01",
        line_unit: "sqm", line_qty: 40, acknowledged_caveats: ACK, confirmation_text: confirmationText(LINE, base().item),
      },
    });
    expect((args.p_record as { source_snapshot: { quotation: VendorQuotation } }).source_snapshot.quotation.vendor_name).toBe("Vendor A");
    // The reviewer identity is taken from the session by the database, never sent.
    expect(JSON.stringify(args)).not.toContain("reviewer-1");
  });

  it("on a stale preview (the function's compare-and-swap missed) reports a conflict", async () => {
    io.result = { data: "conflict", error: null };
    expect((await applyRateAdoption({ ...base(), acknowledged: ACK })).status).toBe("conflict");
  });

  it("any database error means nothing was changed — and says so", async () => {
    io.result = { data: null, error: { message: "new row violates row-level security policy" } };
    await expect(applyRateAdoption({ ...base(), acknowledged: ACK }))
      .rejects.toThrow("Rate adoption failed — nothing was changed: new row violates row-level security policy");
  });
});
