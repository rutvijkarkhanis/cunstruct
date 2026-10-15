// BOQ table rules for the project journey: status, labels, search/filter,
// sort, edit parsing and the incomplete warning. Pure, so every rule is
// unit-tested. Pending/amount rules are the BOQ builder's own (qtyPending,
// custom rate over DSR rate, whole-rupee rounding) — never a second opinion.
import { qtyPending } from "@/lib/boqRevision";
import { roundRupee } from "@/lib/boqDsrDocument";
import { quantityEditPatch } from "@/lib/quantityEdit";
import { sectionLabel } from "./labels";

export interface BoqTableLine {
  id: string; section: string | null; dsr_code: string | null; description: string | null;
  unit: string | null; qty: number; dsr_rate: number | null; custom_rate: number | null;
  basis?: string | null; quantity_status?: string | null; measurement_method?: string | null;
  included: boolean; sort: number;
  source_document_id?: string | null; source_page?: string | null;
}

export type LineStatus = "excluded" | "pending" | "unpriced" | "complete";
export const STATUS_LABEL: Record<LineStatus, string> = {
  pending: "Quantity pending",
  unpriced: "No rate",
  complete: "Complete",
  excluded: "Excluded",
};

/** Column headers, in display order — one source of truth for the table and its tests. */
export const BOQ_COLUMNS = [
  { key: "section", label: "Section" },
  { key: "code", label: "Code" },
  { key: "description", label: "Description" },
  { key: "qty", label: "Quantity" },
  { key: "unit", label: "Unit" },
  { key: "rate", label: "Rate (₹)" },
  { key: "amount", label: "Amount (₹)" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
] as const;

export const effectiveRate = (l: BoqTableLine) => l.custom_rate ?? l.dsr_rate;

export function lineStatus(l: BoqTableLine): LineStatus {
  if (!l.included) return "excluded";
  if (qtyPending(l)) return "pending";
  if (effectiveRate(l) == null) return "unpriced";
  return "complete";
}

/** Whole-rupee amount, or null when it cannot be stated (pending quantity or no rate). */
export function lineAmount(l: BoqTableLine): number | null {
  const rate = effectiveRate(l);
  if (qtyPending(l) || rate == null) return null;
  return roundRupee(l.qty * rate);
}

export interface BoqFilters {
  q: string;
  section: string;            // a sectionLabel(), or "" for all
  status: LineStatus | "";    // "" for all
}
export const NO_FILTERS: BoqFilters = { q: "", section: "", status: "" };

export function filterLines(lines: BoqTableLine[], f: BoqFilters, sourceName: (l: BoqTableLine) => string | null = () => null): BoqTableLine[] {
  const needle = f.q.trim().toLowerCase();
  return lines.filter((l) => {
    if (f.section && sectionLabel(l.section) !== f.section) return false;
    if (f.status && lineStatus(l) !== f.status) return false;
    if (!needle) return true;
    return [l.description, l.dsr_code, sectionLabel(l.section), l.unit, sourceName(l)]
      .some((v) => (v ?? "").toLowerCase().includes(needle));
  });
}

export function sectionOptions(lines: BoqTableLine[]): string[] {
  return [...new Set(lines.map((l) => sectionLabel(l.section)))].sort((a, b) => a.localeCompare(b));
}

export type SortKey = "sort" | "section" | "description" | "qty" | "rate" | "amount" | "status";
export interface BoqSort { key: SortKey; dir: "asc" | "desc" }
export const DEFAULT_SORT: BoqSort = { key: "sort", dir: "asc" };
const STATUS_ORDER: Record<LineStatus, number> = { pending: 0, unpriced: 1, complete: 2, excluded: 3 };

/** Stable sort; lines with no value for a numeric key (no rate, no amount)
 *  always sort last, in either direction, so "missing" never masquerades as 0. */
export function sortLines(lines: BoqTableLine[], s: BoqSort): BoqTableLine[] {
  const val = (l: BoqTableLine): string | number | null => {
    switch (s.key) {
      case "sort": return l.sort;
      case "section": return sectionLabel(l.section).toLowerCase();
      case "description": return (l.description ?? "").toLowerCase();
      case "qty": return qtyPending(l) ? null : l.qty;
      case "rate": return effectiveRate(l);
      case "amount": return lineAmount(l);
      case "status": return STATUS_ORDER[lineStatus(l)];
    }
  };
  const sign = s.dir === "asc" ? 1 : -1;
  return lines
    .map((l, i) => ({ l, i, v: val(l) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v));
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.l);
}

export type EditableField = "description" | "qty" | "unit";
export type EditResult = { ok: true; patch: Partial<BoqTableLine> } | { ok: false; error: string };

/** Parse what was typed into a cell into the exact patch to save, or an
 *  error to show. Returns an empty patch when nothing changed. */
export function parseEdit(line: BoqTableLine, field: EditableField, raw: string): EditResult {
  const text = raw.trim();
  if (field === "description") {
    if (!text) return { ok: false, error: "Description cannot be empty." };
    return { ok: true, patch: text === (line.description ?? "") ? {} : { description: text } };
  }
  if (field === "unit") {
    if (!text) return { ok: false, error: "Unit cannot be empty." };
    return { ok: true, patch: text === (line.unit ?? "") ? {} : { unit: text } };
  }
  const n = Number(text.replace(/,/g, ""));
  if (!text || !Number.isFinite(n)) return { ok: false, error: "Enter a number." };
  if (n < 0) return { ok: false, error: "Quantity cannot be negative." };
  if (n === line.qty) return { ok: true, patch: {} };
  return { ok: true, patch: quantityEditPatch(line, n) };
}

/** The fields to restore to undo `patch` on `line`. */
export function inversePatch(line: BoqTableLine, patch: Partial<BoqTableLine>): Partial<BoqTableLine> {
  const prev: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof BoqTableLine)[]) prev[k] = line[k] ?? null;
  return prev as Partial<BoqTableLine>;
}

export interface BoqTotals { pricedTotal: number; pending: number; unpriced: number; complete: number; excluded: number }
export function boqTotals(lines: BoqTableLine[]): BoqTotals {
  const t: BoqTotals = { pricedTotal: 0, pending: 0, unpriced: 0, complete: 0, excluded: 0 };
  for (const l of lines) {
    const st = lineStatus(l);
    t[st]++;
    if (st === "complete") t.pricedTotal += lineAmount(l) ?? 0;
  }
  return t;
}

/** Stated whenever the priced total leaves included lines out, so the total
 *  can never be read as the whole BOQ. Null when nothing is outstanding. */
export function incompleteWarning(t: BoqTotals): string | null {
  const parts: string[] = [];
  if (t.pending) parts.push(`${t.pending} line${t.pending === 1 ? " has" : "s have"} a pending quantity`);
  if (t.unpriced) parts.push(`${t.unpriced} line${t.unpriced === 1 ? " has" : "s have"} no rate`);
  if (!parts.length) return null;
  return `This BOQ is incomplete: ${parts.join(" and ")}. They are not in the priced total.`;
}

/** A source page usable as a viewer page number ("3"), or null for a
 *  non-numeric reference ("A-101") the viewer cannot jump to. */
export const pageParam = (page: string | null | undefined): string | null =>
  page && /^\d+$/.test(page.trim()) ? page.trim() : null;
