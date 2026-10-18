// SYNTHETIC measurement rows. Nothing here is a real project's measurement or
// a statement about IS 1200; rule citations are placeholders, all unverified.
import { describe, expect, it } from "vitest";
import {
  REQUIRED_DIMENSIONS,
  citationLabel,
  evaluateLine,
  evaluateRow,
  roundHalfAway,
  type LineUnit,
  type MeasurementLine,
  type MeasurementRow,
} from "./measurement";

const m = (value: number | null, unit = "m") => ({ value, unit });
const rule = { part: "SYN", clause: "0.0", verified: false as const };
const ref = { page: 1, regionId: "R-SYN" };
const row = (o: Partial<MeasurementRow> = {}): MeasurementRow => ({
  id: "r1", description: "SYNTHETIC row", no: 1, L: m(2), B: m(3), D: m(0.5), deduction: false, drawingRef: ref, rule, ...o,
});
const line = (unit: LineUnit, rows: MeasurementRow[]): MeasurementLine => ({ id: "l1", item: "SYNTHETIC item", unit, rows });

describe("roundHalfAway", () => {
  it("rounds half away from zero without binary drift", () => {
    expect(roundHalfAway(1.005)).toBe(1.01);
    expect(roundHalfAway(1.004)).toBe(1);
    expect(roundHalfAway(-1.005)).toBe(-1.01);
    expect(roundHalfAway(2.675)).toBe(2.68);
    expect(roundHalfAway(0.1 + 0.2)).toBe(0.3);
    expect(roundHalfAway(12.3456, 3)).toBe(12.346);
    expect(roundHalfAway(0)).toBe(0);
  });
});

describe("evaluateRow — dimensions by line unit", () => {
  it("requires exactly the dimensions the unit uses", () => {
    expect(REQUIRED_DIMENSIONS).toEqual({ nos: [], m: ["L"], sqm: ["L", "B"], cum: ["L", "B", "D"] });
    expect(evaluateRow(row(), "cum")).toMatchObject({ status: "ok", quantity: 3 });
    expect(evaluateRow(row({ D: null }), "sqm")).toMatchObject({ status: "ok", quantity: 6 });
    expect(evaluateRow(row({ B: null, D: null }), "m")).toMatchObject({ status: "ok", quantity: 2 });
    expect(evaluateRow(row({ no: 4, L: null, B: null, D: null }), "nos")).toMatchObject({ status: "ok", quantity: 4 });
  });

  it("multiplies No into the product", () => {
    expect(evaluateRow(row({ no: 3 }), "cum").quantity).toBe(9);
  });

  it("converts cm and mm to metres, including mixed length units in one row", () => {
    expect(evaluateRow(row({ L: m(200, "cm"), B: m(3000, "mm"), D: m(0.5) }), "cum").quantity).toBe(3);
    expect(evaluateRow(row({ L: m(230, "mm"), B: m(3), D: null }), "sqm").quantity).toBe(0.69);
  });

  it("rounds each row to 2 decimals", () => {
    expect(evaluateRow(row({ L: m(1.234), B: m(1.111), D: null }), "sqm").quantity).toBe(1.37); // 1.370974
  });
});

describe("evaluateRow — missing values are pending, never 0 or 1", () => {
  it.each([
    ["No", { no: null }],
    ["L", { L: null }],
    ["B", { B: m(null) }],
    ["D", { D: null }],
  ])("missing %s → pending with no quantity", (_, o) => {
    const r = evaluateRow(row(o as Partial<MeasurementRow>), "cum");
    expect(r).toMatchObject({ status: "pending", quantity: null });
    expect(r.issues.some((i) => i.code === "missing_value")).toBe(true);
  });
});

describe("evaluateRow — errors are flagged, not clamped", () => {
  it("negative values", () => {
    expect(evaluateRow(row({ L: m(-2) }), "cum")).toMatchObject({ status: "invalid", quantity: null });
    expect(evaluateRow(row({ no: -1 }), "cum")).toMatchObject({ status: "invalid", quantity: null });
  });

  it("a dimension the unit does not use", () => {
    const r = evaluateRow(row(), "sqm"); // D given on a sqm line
    expect(r.status).toBe("invalid");
    expect(r.issues.find((i) => i.code === "unexpected_dimension")!.message).toMatch(/D is given, but a sqm line/);
  });

  it("a non-length unit", () => {
    const r = evaluateRow(row({ B: m(3, "kg") }), "cum");
    expect(r.status).toBe("invalid");
    expect(r.issues.find((i) => i.code === "non_length_unit")!.message).toContain('"kg"');
  });

  it("a non-finite number", () => {
    expect(evaluateRow(row({ L: m(Number.NaN) }), "cum").status).toBe("invalid");
    expect(evaluateRow(row({ no: Number.POSITIVE_INFINITY }), "cum").status).toBe("invalid");
  });

  it("invalid outranks pending when both occur", () => {
    expect(evaluateRow(row({ L: null, B: m(-1) }), "cum").status).toBe("invalid");
  });

  it("zero is a real value, not a missing one", () => {
    expect(evaluateRow(row({ L: m(0) }), "cum")).toMatchObject({ status: "ok", quantity: 0 });
  });
});

describe("evaluateRow — evidence gaps are warnings", () => {
  it("missing drawing reference and rule are listed but do not block", () => {
    const r = evaluateRow(row({ drawingRef: null, rule: null }), "cum");
    expect(r.status).toBe("ok");
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([["no_drawing_ref", "warning"], ["no_rule", "warning"]]);
  });
});

describe("evaluateLine — totals", () => {
  it("gross minus deductions, summed from rounded rows", () => {
    const res = evaluateLine(line("sqm", [
      row({ id: "a", D: null, L: m(4), B: m(3) }),
      row({ id: "b", D: null, L: m(1.234), B: m(1.111) }), // 1.37
      row({ id: "c", D: null, L: m(1), B: m(2.1), deduction: true }), // door 2.10
    ]));
    expect(res).toMatchObject({ status: "established", gross: 13.37, deductions: 2.1, total: 11.27 });
  });

  it("any pending row makes the whole line pending: no total, not 0", () => {
    const res = evaluateLine(line("cum", [row({ id: "a" }), row({ id: "b", D: null })]));
    expect(res).toMatchObject({ status: "pending", total: null, gross: null });
  });

  it("any invalid row withholds the total", () => {
    const res = evaluateLine(line("cum", [row({ id: "a" }), row({ id: "b", L: m(-1) })]));
    expect(res).toMatchObject({ status: "invalid", total: null });
  });

  it("deductions larger than the gross are an error, never clamped to 0", () => {
    const res = evaluateLine(line("sqm", [
      row({ id: "a", D: null, L: m(1), B: m(1) }),
      row({ id: "b", D: null, L: m(2), B: m(1), deduction: true }),
    ]));
    expect(res).toMatchObject({ status: "invalid", total: null, gross: 1, deductions: 2 });
    expect(res.issues.some((i) => i.code === "deductions_exceed_gross")).toBe(true);
  });

  it("deductions exactly equal to the gross give a confirmed zero", () => {
    const res = evaluateLine(line("sqm", [
      row({ id: "a", D: null, L: m(1), B: m(2) }),
      row({ id: "b", D: null, L: m(2), B: m(1), deduction: true }),
    ]));
    expect(res).toMatchObject({ status: "confirmed_zero", total: 0 });
  });

  it("a line with no rows is pending", () => {
    const res = evaluateLine(line("cum", []));
    expect(res).toMatchObject({ status: "pending", total: null });
    expect(res.issues[0].code).toBe("no_rows");
  });

  it("removes floating-point residue from the total", () => {
    const res = evaluateLine(line("m", [
      row({ id: "a", B: null, D: null, L: m(0.1) }),
      row({ id: "b", B: null, D: null, L: m(0.2) }),
    ]));
    expect(res.total).toBe(0.3);
  });
});

describe("citationLabel — never asserts compliance", () => {
  it("labels every citation as not verified", () => {
    expect(citationLabel(rule)).toBe("IS 1200 Part SYN, cl. 0.0 — not verified against the standard");
    expect(citationLabel(null)).toBe("No rule cited");
  });
});
