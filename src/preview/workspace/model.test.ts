// SYNTHETIC fixtures only: these tests check software behaviour, not accuracy.
import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  INITIAL_WORKSPACE_LINES as L,
  applyCellText,
  ledgerSummary,
  lineAmount,
  lineQuantityState,
  linesForRegion,
  moveCell,
  parseClipboard,
  pasteRange,
  regionLink,
} from "./model";

const ROWS = L.length;
const QTY = COLUMNS.findIndex((c) => c.id === "qty");
const RATE = COLUMNS.findIndex((c) => c.id === "rate");

describe("moveCell (Excel-like)", () => {
  it("arrows move one cell and stop at the edges", () => {
    expect(moveCell({ row: 2, col: 2 }, "ArrowUp", ROWS)).toEqual({ row: 1, col: 2 });
    expect(moveCell({ row: 2, col: 2 }, "ArrowDown", ROWS)).toEqual({ row: 3, col: 2 });
    expect(moveCell({ row: 2, col: 2 }, "ArrowLeft", ROWS)).toEqual({ row: 2, col: 1 });
    expect(moveCell({ row: 2, col: 2 }, "ArrowRight", ROWS)).toEqual({ row: 2, col: 3 });
    expect(moveCell({ row: 0, col: 0 }, "ArrowUp", ROWS)).toEqual({ row: 0, col: 0 });
    expect(moveCell({ row: 0, col: 0 }, "ArrowLeft", ROWS)).toEqual({ row: 0, col: 0 });
    expect(moveCell({ row: ROWS - 1, col: COLUMNS.length - 1 }, "ArrowDown", ROWS)).toEqual({ row: ROWS - 1, col: COLUMNS.length - 1 });
  });
  it("Enter / Shift+Enter move down / up", () => {
    expect(moveCell({ row: 1, col: QTY }, "Enter", ROWS)).toEqual({ row: 2, col: QTY });
    expect(moveCell({ row: 1, col: QTY }, "ShiftEnter", ROWS)).toEqual({ row: 0, col: QTY });
  });
  it("Tab moves right and wraps to the next row; leaves the grid after the last cell", () => {
    expect(moveCell({ row: 0, col: QTY }, "Tab", ROWS)).toEqual({ row: 0, col: RATE });
    expect(moveCell({ row: 0, col: COLUMNS.length - 1 }, "Tab", ROWS)).toEqual({ row: 1, col: 0 });
    expect(moveCell({ row: ROWS - 1, col: COLUMNS.length - 1 }, "Tab", ROWS)).toBeNull();
    expect(moveCell({ row: 1, col: 0 }, "ShiftTab", ROWS)).toEqual({ row: 0, col: COLUMNS.length - 1 });
    expect(moveCell({ row: 0, col: 0 }, "ShiftTab", ROWS)).toBeNull();
  });
});

describe("applyCellText", () => {
  it("a number establishes the quantity; a typed 0 is a confirmed zero, distinct from pending", () => {
    const r = applyCellText(L[2], "qty", "1,250.5");
    expect(r).toMatchObject({ ok: true, line: { qty: 1250.5, quantityStatus: "MEASURED", edited: ["qty"] } });
    const z = applyCellText(L[2], "qty", "0");
    expect("line" in z && lineQuantityState(z.line)).toBe("confirmed_zero");
    expect("line" in z && lineAmount(z.line)).toBe(0);
  });
  it("clearing a quantity makes it pending — never 0 — and removes its amount", () => {
    const r = applyCellText(L[0], "qty", "  ");
    expect(r).toMatchObject({ ok: true, line: { qty: null, quantityStatus: "PENDING" } });
    expect("line" in r && lineQuantityState(r.line)).toBe("pending");
    expect("line" in r && lineAmount(r.line)).toBeNull();
  });
  it("refuses junk, a comma decimal and negatives without changing the line", () => {
    expect(applyCellText(L[0], "qty", "abc")).toEqual({ ok: false, error: 'Quantity "abc" is not a number.' });
    expect(applyCellText(L[0], "qty", "4,5")).toEqual({ ok: false, error: 'Quantity "4,5" is not a number.' });
    expect(applyCellText(L[0], "rate", "-10")).toEqual({ ok: false, error: 'Rate "-10" must be zero or more.' });
  });
  it("a cleared rate leaves no amount even with a quantity", () => {
    const r = applyCellText(L[0], "rate", "");
    expect("line" in r && r.line.rate).toBeNull();
    expect("line" in r && lineAmount(r.line)).toBeNull();
  });
});

describe("pasteRange (all or nothing)", () => {
  it("parses tab/newline blocks, tolerating a trailing newline and CRLF", () => {
    expect(parseClipboard("1\t2\r\n3\t4\n")).toEqual([["1", "2"], ["3", "4"]]);
  });
  it("applies a valid qty × rate block from the active cell", () => {
    const r = pasteRange(L, { row: 0, col: QTY }, "30\t500\n7\t6100");
    expect(r.ok).toBe(true);
    if (!("lines" in r)) return;
    expect(r.lines.slice(0, 2).map((l) => [l.qty, l.rate])).toEqual([[30, 500], [7, 6100]]);
    expect([r.rows, r.cols]).toEqual([2, 2]);
    expect(L[0].qty).toBe(24); // the input is not mutated
  });
  it("rejects the whole paste when any cell is not a number", () => {
    const r = pasteRange(L, { row: 0, col: QTY }, "30\nabc");
    expect(r).toEqual({ ok: false, errors: ['row 2, cell 1: Quantity "abc" is not a number.'] });
  });
  it("rejects a paste that overflows the grid or lands on a read-only column", () => {
    const over = pasteRange(L, { row: L.length - 1, col: QTY }, "1\n2");
    expect("errors" in over && over.errors).toEqual(["row 2, cell 1 falls outside the grid."]);
    const ro = pasteRange(L, { row: 0, col: RATE }, "1\t2");
    expect("errors" in ro && ro.errors).toEqual(['row 1, cell 2 lands on "Amount", which cannot be edited.']);
  });
});

describe("drawing links (I3)", () => {
  it("classifies every line's region: linked, unverified or none", () => {
    expect(L.map((l) => [l.id, regionLink(l)])).toEqual([
      ["L-01", "linked"], ["L-02", "linked"], ["L-03", "unverified"], ["L-04", "linked"], ["L-05", "linked"], ["L-06", "none"],
    ]);
  });
  it("a region maps back to all of its lines", () => {
    expect(linesForRegion("R-FOOTING", L)).toEqual(["L-02", "L-04"]);
    expect(linesForRegion("R-BARS", L)).toEqual(["L-03"]);
  });
});

describe("sign-off ledger", () => {
  it("summarises in one line and never claims a sign-off", () => {
    expect(ledgerSummary(L)).toBe(
      "6 lines · 1 pending · 1 without a rate · 1 without a drawing region · 1 with an unverified region · 0 edited (demo) · Not signed off — demo only, no reference set",
    );
  });
});
