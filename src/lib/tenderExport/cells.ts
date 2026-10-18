// Cell helpers over exceljs values (number | string | rich text | formula | …).
import type ExcelJS from "exceljs";

/** The cell's formula text without "=", or null. Shared formulas resolve to their own text. */
export function formulaOf(cell: ExcelJS.Cell): string | null {
  const v = cell.value as unknown;
  if (v && typeof v === "object") {
    const o = v as { formula?: string; sharedFormula?: string };
    if (typeof o.formula === "string") return o.formula.replace(/^=/, "");
  }
  // exceljs exposes the translated text of a shared-formula clone on .formula.
  const f = (cell as unknown as { formula?: string }).formula;
  return typeof f === "string" && f ? f.replace(/^=/, "") : null;
}

/** Plain text of a cell (rich text joined, formula results as text), trimmed. */
export function textOf(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
    if (typeof o.text === "string") return o.text.trim();
    if (o.result != null) return String(o.result).trim();
  }
  return String(v).trim();
}

/** A literal number in the cell (not a formula), or null. Text like "1,234.5" is parsed. */
export function literalNumberOf(cell: ExcelJS.Cell): number | null {
  const v = cell.value as unknown;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.replace(/,/g, "").trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
}

/** True when the cell holds nothing (no value, no formula). */
export const isEmpty = (cell: ExcelJS.Cell) => cell.value == null || (typeof cell.value === "string" && cell.value.trim() === "");

/** Normalise an item number for comparison: "1.10." → "1.10", " 2 . 3 " → "2.3". */
export const normItemNo = (s: string | number | null | undefined) =>
  String(s ?? "").trim().replace(/\s+/g, "").replace(/\.+$/, "").toLowerCase();

/** Normalise free text for exact comparison: case and whitespace only — never fuzzy. */
export const normText = (s: string | null | undefined) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Normalise a unit for comparison ("Cum" = "cum", "sq.m" = "sqm", "m2" = "sqm"). */
export function normUnit(s: string | null | undefined): string {
  const u = String(s ?? "").trim().toLowerCase().replace(/[\s.]/g, "");
  const alias: Record<string, string> = { m2: "sqm", "m²": "sqm", sqmt: "sqm", m3: "cum", "m³": "cum", cumt: "cum", no: "nos", each: "nos", rm: "m", rmt: "m", mtr: "m", metre: "m" };
  return alias[u] ?? u;
}

/** Column letter for a 1-based index (1 → A, 27 → AA). */
export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
