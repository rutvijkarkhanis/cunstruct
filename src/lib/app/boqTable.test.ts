import { describe, it, expect } from "vitest";
import {
  BOQ_COLUMNS, boqTotals, filterLines, incompleteWarning, inversePatch, lineAmount, lineStatus,
  parseEdit, sectionOptions, sortLines, STATUS_LABEL, NO_FILTERS, type BoqTableLine,
} from "./boqTable";
import { DRAWING_REVIEW_SECTION } from "@/lib/applyFinding";

const L = (p: Partial<BoqTableLine>): BoqTableLine => ({
  id: "x", section: "Brickwork", dsr_code: "6.1", description: "Brick wall", unit: "cum", qty: 10,
  dsr_rate: 100, custom_rate: null, basis: null, quantity_status: null, measurement_method: null,
  included: true, sort: 0, source_document_id: null, source_page: null, ...p,
});

describe("columns and status", () => {
  it("labels every column", () => {
    expect(BOQ_COLUMNS.map((c) => c.label)).toEqual(["Section", "Code", "Description", "Quantity", "Unit", "Rate (₹)", "Amount (₹)", "Status", "Source"]);
  });
  it("classifies lines with the builder's pending rule", () => {
    expect(lineStatus(L({}))).toBe("complete");
    expect(lineStatus(L({ qty: 0 }))).toBe("pending");
    expect(lineStatus(L({ quantity_status: "PENDING" }))).toBe("pending");
    expect(lineStatus(L({ qty: 0, quantity_status: "COUNTED" }))).toBe("complete");
    expect(lineStatus(L({ dsr_rate: null }))).toBe("unpriced");
    expect(lineStatus(L({ included: false, qty: 0 }))).toBe("excluded");
    expect(STATUS_LABEL.pending).toBe("Quantity pending");
  });
  it("states no amount for a pending or unrated line, and prefers the custom rate", () => {
    expect(lineAmount(L({ qty: 0 }))).toBeNull();
    expect(lineAmount(L({ dsr_rate: null }))).toBeNull();
    expect(lineAmount(L({ qty: 2.5, custom_rate: 41 }))).toBe(103); // 102.5 → whole rupees
  });
});

describe("filterLines / sectionOptions", () => {
  const lines = [
    L({ id: "a", description: "Brick wall" }),
    L({ id: "b", section: "Plaster", description: "Cement plaster", dsr_code: "13.1", qty: 0 }),
    L({ id: "c", section: DRAWING_REVIEW_SECTION, description: "Door D1", dsr_rate: null }),
  ];
  it("searches description, code, section label and source name", () => {
    expect(filterLines(lines, { ...NO_FILTERS, q: "plaster" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLines(lines, { ...NO_FILTERS, q: "13.1" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLines(lines, { ...NO_FILTERS, q: "unassigned" }).map((l) => l.id)).toEqual(["c"]);
    expect(filterLines(lines, { ...NO_FILTERS, q: "gf plan" }, (l) => (l.id === "a" ? "GF Plan" : null)).map((l) => l.id)).toEqual(["a"]);
  });
  it("filters by section label and status", () => {
    expect(filterLines(lines, { ...NO_FILTERS, section: "Unassigned" }).map((l) => l.id)).toEqual(["c"]);
    expect(filterLines(lines, { ...NO_FILTERS, status: "pending" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLines(lines, { ...NO_FILTERS, status: "unpriced" }).map((l) => l.id)).toEqual(["c"]);
  });
  it("offers user-facing section labels only", () => {
    expect(sectionOptions(lines)).toEqual(["Brickwork", "Plaster", "Unassigned"]);
  });
});

describe("sortLines", () => {
  const lines = [
    L({ id: "a", sort: 2, qty: 5, dsr_rate: 10 }),
    L({ id: "b", sort: 1, qty: 1, dsr_rate: null }),
    L({ id: "c", sort: 3, qty: 3, dsr_rate: 30 }),
  ];
  it("keeps the BOQ order by default", () => {
    expect(sortLines(lines, { key: "sort", dir: "asc" }).map((l) => l.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts numbers both ways and always puts missing values last", () => {
    expect(sortLines(lines, { key: "rate", dir: "asc" }).map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(sortLines(lines, { key: "rate", dir: "desc" }).map((l) => l.id)).toEqual(["c", "a", "b"]);
    expect(sortLines(lines, { key: "amount", dir: "desc" }).map((l) => l.id)).toEqual(["c", "a", "b"]);
  });
  it("puts the most urgent status first", () => {
    const s = sortLines([L({ id: "ok" }), L({ id: "p", qty: 0 }), L({ id: "u", dsr_rate: null })], { key: "status", dir: "asc" });
    expect(s.map((l) => l.id)).toEqual(["p", "u", "ok"]);
  });
});

describe("parseEdit / inversePatch", () => {
  it("validates and trims", () => {
    expect(parseEdit(L({}), "description", "  ")).toEqual({ ok: false, error: "Description cannot be empty." });
    expect(parseEdit(L({}), "unit", " sqm ")).toEqual({ ok: true, patch: { unit: "sqm" } });
    expect(parseEdit(L({}), "qty", "abc")).toEqual({ ok: false, error: "Enter a number." });
    expect(parseEdit(L({}), "qty", "-1")).toEqual({ ok: false, error: "Quantity cannot be negative." });
    expect(parseEdit(L({}), "qty", "1,250.5")).toEqual({ ok: true, patch: { qty: 1250.5 } });
  });
  it("returns an empty patch when nothing changed", () => {
    expect(parseEdit(L({}), "qty", "10")).toEqual({ ok: true, patch: {} });
    expect(parseEdit(L({}), "description", "Brick wall")).toEqual({ ok: true, patch: {} });
  });
  it("confirms a pending line with a positive quantity, using the shared rule", () => {
    expect(parseEdit(L({ qty: 0, quantity_status: "PENDING", measurement_method: "COUNT" }), "qty", "4"))
      .toEqual({ ok: true, patch: { qty: 4, basis: null, quantity_status: "COUNTED" } });
    expect(parseEdit(L({ qty: 0, basis: "PENDING" }), "qty", "0")).toEqual({ ok: true, patch: {} });
  });
  it("builds the exact undo patch, including fields the edit cleared", () => {
    const line = L({ qty: 0, basis: "PENDING", quantity_status: "PENDING" });
    expect(inversePatch(line, { qty: 4, basis: null, quantity_status: "MEASURED" }))
      .toEqual({ qty: 0, basis: "PENDING", quantity_status: "PENDING" });
  });
});

describe("totals and incomplete warning", () => {
  it("prices complete lines only and says what was left out", () => {
    const t = boqTotals([L({}), L({ qty: 0 }), L({ dsr_rate: null }), L({ included: false })]);
    expect(t).toEqual({ pricedTotal: 1000, pending: 1, unpriced: 1, complete: 1, excluded: 1 });
    expect(incompleteWarning(t)).toBe("This BOQ is incomplete: 1 line has a pending quantity and 1 line has no rate. They are not in the priced total.");
  });
  it("has no warning when nothing is outstanding", () => {
    expect(incompleteWarning(boqTotals([L({}), L({ included: false, qty: 0 })]))).toBeNull();
  });
});
