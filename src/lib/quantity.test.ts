import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  countedAmount, MANUAL_BASIS, PENDING_BASIS, pricedAmount, qtyPending, quantityEstablished,
  quantityProvenance, quantityState, REVIEW_APPLY_NOTE, UNKNOWN_ORIGIN_LABEL, worksTotal,
} from "./quantity";
import { PENDING_BASIS as EVAL_PENDING_BASIS } from "./boqEvalJson";
import { quantityEditPatch, unitEditPatch } from "./quantityEdit";

describe("quantityState — confirmed zero, pending and unavailable stay distinct", () => {
  it.each([
    [{ qty: 12 }, "established"],
    [{ qty: 0, quantity_status: "MEASURED" }, "confirmed_zero"],
    [{ qty: 0, quantity_status: "counted" }, "confirmed_zero"],
    [{ qty: 0 }, "pending"],                                          // a bare 0 nobody confirmed
    [{ qty: 0, quantity_status: "ESTIMATED" }, "pending"],
    [{ qty: 12, quantity_status: "PENDING" }, "pending"],             // marked pending wins over a number
    [{ qty: 12, basis: PENDING_BASIS }, "pending"],
    [{ qty: 0, quantity_status: "MEASURED", basis: PENDING_BASIS }, "pending"],
    [{ qty: null }, "unavailable"],
    [{ qty: undefined }, "unavailable"],
    [{ qty: Number.NaN }, "unavailable"],
    [{ qty: -3 }, "unavailable"],
    [{ qty: null, quantity_status: "PENDING" }, "pending"],
  ] as const)("%o → %s", (line, state) => {
    expect(quantityState(line)).toBe(state);
  });

  it("only established quantities and confirmed zeros may be priced", () => {
    expect(quantityEstablished({ qty: 0, quantity_status: "MEASURED" })).toBe(true);
    expect(qtyPending({ qty: 0 })).toBe(true);
    expect(qtyPending({ qty: null })).toBe(true);
  });
});

describe("amounts", () => {
  it("a pending or unavailable quantity has no amount — never qty × rate, never a fabricated 0", () => {
    expect(pricedAmount({ qty: 12, basis: PENDING_BASIS, dsr_rate: 100 })).toBeNull();
    expect(pricedAmount({ qty: null, dsr_rate: 100 })).toBeNull();
    expect(pricedAmount({ qty: 0, dsr_rate: 100 })).toBeNull();
  });
  it("a confirmed zero is a real ₹0; an established quantity is rounded qty × effective rate", () => {
    expect(pricedAmount({ qty: 0, quantity_status: "COUNTED", dsr_rate: 100 })).toBe(0);
    expect(pricedAmount({ qty: 2.5, dsr_rate: 100, custom_rate: 41.3 })).toBe(103);
  });
  it("an unrated line has no amount", () => {
    expect(pricedAmount({ qty: 3, dsr_rate: null, custom_rate: null })).toBeNull();
    expect(countedAmount({ qty: 3, dsr_rate: null })).toBe(0);
  });
  it("worksTotal sums included, established, rated lines only", () => {
    expect(worksTotal([
      { qty: 2, dsr_rate: 100, included: true },
      { qty: 5, dsr_rate: 100, included: true, quantity_status: "PENDING" },
      { qty: 9, dsr_rate: 100, included: false },
      { qty: 4, dsr_rate: null, included: true },
    ])).toBe(200);
  });
});

describe("quantityProvenance — reads only what is recorded", () => {
  it.each([
    ["DRAWING_INPUT", "drawing", "From drawing summary (estimator's reading)"],
    ["DRAWING_DERIVED", "derived", "Calculated from drawing summary"],
    ["DSR_AOR", "derived", "Derived from DSR coefficients"],
    ["HEURISTIC", "assumption", "Assumption"],
    [MANUAL_BASIS, "manual", "Changed manually"],
    [PENDING_BASIS, "pending", "Awaiting quantity"],
  ])("system code %s → %s", (basis, origin, label) => {
    expect(quantityProvenance({ basis })).toMatchObject({ origin, label, stated: false, code: basis });
  });

  it("free-text basis from imported data is reported as stated, not as verified", () => {
    expect(quantityProvenance({ basis: "Counted" })).toMatchObject({ stated: true, label: "Counted (as stated in imported data)" });
    expect(quantityProvenance({ basis: "Measured" })).toMatchObject({ stated: true, label: "Measured (as stated in imported data)" });
    expect(quantityProvenance({ basis: "assumed" })).toMatchObject({ origin: "assumption", stated: true });
    expect(quantityProvenance({ basis: "Derived" })).toMatchObject({ origin: "derived", stated: true });
  });

  it("an unrecognised basis is unknown, and keeps its raw code for audit", () => {
    expect(quantityProvenance({ basis: "From site visit?" })).toMatchObject({ origin: "unknown", label: UNKNOWN_ORIGIN_LABEL, code: "From site visit?" });
  });

  it("a line created by drawing-review Apply is identified by its note only", () => {
    expect(quantityProvenance({ basis: null, basis_note: REVIEW_APPLY_NOTE }).origin).toBe("review");
  });

  it("legacy lines with no basis stay unknown — never inferred from qty, source, status or a drawing reference", () => {
    const legacy = { basis: null, basis_note: null, qty: 40, source: "auto", quantity_status: "MEASURED", source_document_id: "d1", source_page: "3" };
    expect(quantityProvenance(legacy)).toEqual({ origin: "unknown", label: UNKNOWN_ORIGIN_LABEL, stated: false, note: null, code: null });
  });

  it("keeps the line's own note verbatim", () => {
    expect(quantityProvenance({ basis: "HEURISTIC", basis_note: "  0.9 points per sqm " }).note).toBe("0.9 points per sqm");
  });
});

describe("one pending marker everywhere", () => {
  it("boqEvalJson writes the same PENDING basis the shared rule reads (it keeps its own copy: it may import nothing)", () => {
    expect(EVAL_PENDING_BASIS).toBe(PENDING_BASIS);
  });
  it("the shared rule module stays importable from edge functions (no @/ imports)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/quantity.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});

describe("editor patches record a person's change", () => {
  it("a typed quantity on an established line is recorded as MANUAL", () => {
    expect(quantityEditPatch({ qty: 10, basis: "DRAWING_INPUT" }, 12)).toEqual({ qty: 12, basis: MANUAL_BASIS });
  });
  it("a positive quantity confirms a pending line; zero leaves it pending", () => {
    expect(quantityEditPatch({ qty: 0, basis: PENDING_BASIS, measurement_method: "count" }, 3))
      .toEqual({ qty: 3, basis: MANUAL_BASIS, quantity_status: "COUNTED" });
    expect(quantityEditPatch({ qty: 0, quantity_status: "PENDING" }, 0)).toEqual({ qty: 0 });
  });
  it("a unit change is MANUAL, except on a pending line whose marker must survive", () => {
    expect(unitEditPatch({ basis: "HEURISTIC" }, "sqm")).toEqual({ unit: "sqm", basis: MANUAL_BASIS });
    expect(unitEditPatch({ basis: PENDING_BASIS }, "sqm")).toEqual({ unit: "sqm" });
    expect(unitEditPatch({ basis: null, quantity_status: "PENDING" }, "sqm")).toEqual({ unit: "sqm" });
  });
});
