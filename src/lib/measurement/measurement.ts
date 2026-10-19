/**
 * IS 1200-style measurement rows (plan v1.2, B3 — owner-only preview lane).
 *
 * A BOQ line's quantity is built from measurement rows: No × L × B × D, with
 * deductions subtracted, each row carrying a drawing reference and a rule
 * citation. Nothing here claims compliance with IS 1200: every citation is
 * typed `verified: false`, because the standard's text has not been confirmed
 * (plan item E3 is blocked). The UI must say so.
 *
 * Rules (never invent a quantity):
 *  - A row needs exactly the dimensions its line's unit calls for:
 *      nos → No · m → No × L · sqm → No × L × B · cum → No × L × B × D.
 *    A missing required value (No included) makes the row — and therefore the
 *    line total — PENDING. It is never treated as 0 or 1.
 *  - A dimension the unit does not use (e.g. D on a sqm line), a non-length
 *    dimension unit, a negative value, or deductions larger than the gross
 *    are ERRORS: the line total is withheld, never clamped or guessed.
 *  - A missing drawing reference or rule citation is a WARNING: the total is
 *    shown, the gap is listed. A missing value is also reported as a warning;
 *    it is what makes the row PENDING.
 *
 * Rounding (documented, deterministic): dimensions are converted to metres
 * exactly; each row quantity is rounded to `ROW_DECIMALS` (2) half away from
 * zero, as a measurement book records it; the line total is the sum of the
 * rounded row quantities (gross rows minus deduction rows), rounded again to
 * 2 decimals to remove floating-point residue.
 */

export type LineUnit = "nos" | "m" | "sqm" | "cum";
export type LengthUnit = "m" | "cm" | "mm";
export type Dimension = "L" | "B" | "D";

export interface DimValue {
  value: number | null;
  /** Length unit of this value. Anything other than m, cm or mm is an error. */
  unit: string;
}

export interface DrawingRef {
  page: number;
  regionId: string;
}

export interface RuleCitation {
  part: string;
  clause: string;
  /** Always false in this release: IS 1200 texts are not verified (plan E3). */
  verified: false;
}

export interface MeasurementRow {
  id: string;
  description: string;
  /** Number of like items. Required; null = not yet measured. */
  no: number | null;
  L: DimValue | null;
  B: DimValue | null;
  D: DimValue | null;
  deduction: boolean;
  drawingRef: DrawingRef | null;
  rule: RuleCitation | null;
}

export interface MeasurementLine {
  id: string;
  item: string;
  unit: LineUnit;
  rows: MeasurementRow[];
}

export type IssueSeverity = "error" | "warning";
export interface Issue {
  severity: IssueSeverity;
  rowId: string | null;
  code:
    | "missing_value"
    | "negative_value"
    | "not_a_number"
    | "unexpected_dimension"
    | "non_length_unit"
    | "deductions_exceed_gross"
    | "no_rows"
    | "no_drawing_ref"
    | "no_rule";
  message: string;
}

export type RowStatus = "ok" | "pending" | "invalid";
export interface RowResult {
  rowId: string;
  status: RowStatus;
  /** Rounded row quantity; null unless status is "ok". Positive even for a deduction row. */
  quantity: number | null;
  issues: Issue[];
}

export type LineStatus = "established" | "confirmed_zero" | "pending" | "invalid";
export interface LineResult {
  lineId: string;
  unit: LineUnit;
  status: LineStatus;
  /** Gross minus deductions; null unless status is established or confirmed_zero. */
  total: number | null;
  gross: number | null;
  deductions: number | null;
  rows: RowResult[];
  issues: Issue[];
}

export const ROW_DECIMALS = 2;

/** Dimensions each line unit requires, in order. */
export const REQUIRED_DIMENSIONS: Record<LineUnit, Dimension[]> = {
  nos: [],
  m: ["L"],
  sqm: ["L", "B"],
  cum: ["L", "B", "D"],
};

const TO_METRES: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };

const isLengthUnit = (u: string): u is LengthUnit => u in TO_METRES;

/** Round half away from zero to `decimals`, without binary drift (e.g. 1.005 → 1.01). */
export function roundHalfAway(x: number, decimals = ROW_DECIMALS): number {
  const f = 10 ** decimals;
  const scaled = Math.abs(x) * f;
  // Nudge by a relative epsilon so values like 1.005 (stored as 1.00499…) round up.
  const r = Math.round(scaled * (1 + Number.EPSILON * 4)) / f;
  return x < 0 ? -r : r;
}

const issue = (severity: IssueSeverity, rowId: string | null, code: Issue["code"], message: string): Issue => ({ severity, rowId, code, message });

/** Evaluate one row for a line of the given unit. */
export function evaluateRow(row: MeasurementRow, unit: LineUnit): RowResult {
  const issues: Issue[] = [];
  const required = REQUIRED_DIMENSIONS[unit];
  let missing = false;
  let invalid = false;

  // No
  if (row.no == null) {
    missing = true;
    issues.push(issue("warning", row.id, "missing_value", "No (number of items) is not entered."));
  } else if (!Number.isFinite(row.no)) {
    invalid = true;
    issues.push(issue("error", row.id, "not_a_number", "No is not a number."));
  } else if (row.no < 0) {
    invalid = true;
    issues.push(issue("error", row.id, "negative_value", "No is negative."));
  }

  let metres = 1;
  for (const dim of ["L", "B", "D"] as Dimension[]) {
    const d = row[dim];
    const needed = required.includes(dim);
    const present = d != null && d.value != null;
    if (!needed) {
      if (present) {
        invalid = true;
        issues.push(issue("error", row.id, "unexpected_dimension", `${dim} is given, but a ${unit} line is measured without it.`));
      }
      continue;
    }
    if (!present) {
      missing = true;
      issues.push(issue("warning", row.id, "missing_value", `${dim} is not entered.`));
      continue;
    }
    if (!isLengthUnit(d!.unit)) {
      invalid = true;
      issues.push(issue("error", row.id, "non_length_unit", `${dim} is in "${d!.unit}", which is not a length unit (m, cm, mm).`));
      continue;
    }
    if (!Number.isFinite(d!.value)) {
      invalid = true;
      issues.push(issue("error", row.id, "not_a_number", `${dim} is not a number.`));
      continue;
    }
    if (d!.value! < 0) {
      invalid = true;
      issues.push(issue("error", row.id, "negative_value", `${dim} is negative.`));
      continue;
    }
    metres *= d!.value! * TO_METRES[d!.unit];
  }

  if (!row.drawingRef) issues.push(issue("warning", row.id, "no_drawing_ref", "No drawing reference."));
  if (!row.rule) issues.push(issue("warning", row.id, "no_rule", "No rule cited."));

  const status: RowStatus = invalid ? "invalid" : missing ? "pending" : "ok";
  const quantity = status === "ok" ? roundHalfAway(row.no! * metres) : null;
  return { rowId: row.id, status, quantity, issues };
}

/** Evaluate a line: its rows, then the total (gross − deductions). */
export function evaluateLine(line: MeasurementLine): LineResult {
  const rows = line.rows.map((r) => evaluateRow(r, line.unit));
  const issues: Issue[] = rows.flatMap((r) => r.issues);
  const base = { lineId: line.id, unit: line.unit, rows };

  if (line.rows.length === 0) {
    return { ...base, status: "pending", total: null, gross: null, deductions: null, issues: [issue("warning", null, "no_rows", "No measurement rows yet."), ...issues] };
  }
  if (rows.some((r) => r.status === "invalid")) {
    return { ...base, status: "invalid", total: null, gross: null, deductions: null, issues };
  }
  if (rows.some((r) => r.status === "pending")) {
    return { ...base, status: "pending", total: null, gross: null, deductions: null, issues };
  }

  let gross = 0;
  let deductions = 0;
  line.rows.forEach((r, i) => {
    if (r.deduction) deductions += rows[i].quantity!;
    else gross += rows[i].quantity!;
  });
  gross = roundHalfAway(gross);
  deductions = roundHalfAway(deductions);
  if (deductions > gross) {
    return {
      ...base, status: "invalid", total: null, gross, deductions,
      issues: [...issues, issue("error", null, "deductions_exceed_gross", `Deductions (${deductions}) exceed the gross quantity (${gross}); the total is withheld.`)],
    };
  }
  const total = roundHalfAway(gross - deductions);
  return { ...base, status: total === 0 ? "confirmed_zero" : "established", total, gross, deductions, issues };
}

/** The citation as shown to a user: never asserts compliance. */
export function citationLabel(rule: RuleCitation | null): string {
  if (!rule) return "No rule cited";
  return `IS 1200 Part ${rule.part}, cl. ${rule.clause} — not verified against the standard`;
}

/** Unit symbol for display. */
export const UNIT_LABEL: Record<LineUnit, string> = { nos: "nos", m: "m", sqm: "m²", cum: "m³" };

/** The editable numeric fields of a row. */
export type RowField = "no" | Dimension;

/** A copy of `line` with one row value replaced (null = not entered). A
 *  dimension keeps its row's length unit, or metres when it had none. */
export function setRowValue(line: MeasurementLine, rowId: string, field: RowField, value: number | null): MeasurementLine {
  return {
    ...line,
    rows: line.rows.map((r) => {
      if (r.id !== rowId) return r;
      if (field === "no") return { ...r, no: value };
      return { ...r, [field]: { value, unit: r[field]?.unit ?? "m" } };
    }),
  };
}
