// BOQ table rules for the project journey: status, labels, search/filter,
// sort, edit parsing and the incomplete warning. Pure, so every rule is
// unit-tested. Quantity state, amounts and provenance come from lib/quantity —
// the one rule the builder, exports and public share also use.
import { effectiveRate as sharedEffectiveRate, pricedAmount, qtyPending, quantityProvenance, quantityState, type QuantityProvenance, type QuantityState } from "@/lib/quantity";
import { quantityEditPatch, unitEditPatch } from "@/lib/quantityEdit";
import { sectionLabel } from "./labels";

export interface BoqTableLine {
  id: string; section: string | null; dsr_code: string | null; description: string | null;
  unit: string | null; qty: number; dsr_rate: number | null; custom_rate: number | null;
  basis?: string | null; basis_note?: string | null; quantity_status?: string | null; measurement_method?: string | null;
  included: boolean; sort: number;
  source_document_id?: string | null; source_page?: string | null;
}

export type LineStatus = "excluded" | "pending" | "unpriced" | "complete";
/** A ?status= value from a link, when it names a real status. */
export const statusParam = (v: string | null): LineStatus | "" =>
  v === "excluded" || v === "pending" || v === "unpriced" || v === "complete" ? v : "";
export const STATUS_LABEL: Record<LineStatus, string> = {
  pending: "Quantity pending",
  unpriced: "No rate",
  // Established quantity with a rate — says what is known, not that the line is "complete".
  complete: "Priced",
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
  { key: "basis", label: "Quantity basis" },
  { key: "source", label: "Source" },
] as const;

/** The rate in effect (lib/quantity): the override, else the DSR reference; null when neither. */
export const effectiveRate = (l: BoqTableLine) => sharedEffectiveRate(l);

export function lineStatus(l: BoqTableLine): LineStatus {
  if (!l.included) return "excluded";
  if (qtyPending(l)) return "pending";
  if (effectiveRate(l) == null) return "unpriced";
  return "complete";
}

/** Whole-rupee amount, or null when it cannot be stated (no established quantity, or no rate). */
export const lineAmount = (l: BoqTableLine): number | null => pricedAmount(l);

/** Which quantity state applies — the cell shows it, so a pending line is never
 *  read as a measured 0 and a confirmed 0 is never read as pending. */
export const qtyState = (l: BoqTableLine): QuantityState => quantityState(l);

/** Where the quantity came from, as recorded — "Basis not recorded" when nothing says. */
export const lineProvenance = (l: BoqTableLine): QuantityProvenance => quantityProvenance(l);

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
    return [l.description, l.dsr_code, sectionLabel(l.section), l.unit, sourceName(l), quantityProvenance(l).label]
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
    return { ok: true, patch: text === (line.unit ?? "") ? {} : unitEditPatch(line, text) };
  }
  const n = Number(text.replace(/,/g, ""));
  if (!text || !Number.isFinite(n)) return { ok: false, error: "Enter a number." };
  if (n < 0) return { ok: false, error: "Quantity cannot be negative." };
  if (n === line.qty) return { ok: true, patch: {} };
  return { ok: true, patch: quantityEditPatch(line, n) };
}

export type RateEditResult = { ok: true; rate: number | null; unchanged: boolean } | { ok: false; error: string };
/**
 * A typed rate, by the BOQ builder's rules: an own rate is a number of zero or
 * more (commas allowed); an empty field clears the own rate, so the line falls
 * back to its DSR rate — or to no rate at all, which is said, never assumed.
 * The write itself is the audited path (lib/manualRateEdit).
 */
export function parseRateEdit(line: BoqTableLine, raw: string): RateEditResult {
  const text = raw.trim().replace(/,/g, "");
  if (text === "") return { ok: true, rate: null, unchanged: line.custom_rate == null };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a rate in rupees, or leave it empty to use the DSR rate." };
  if (n < 0) return { ok: false, error: "Rate cannot be negative." };
  return { ok: true, rate: n, unchanged: line.custom_rate != null && Number(line.custom_rate) === n };
}

/** Where a line's rate comes from, as the table states it. */
export function rateSource(l: BoqTableLine): "own" | "dsr" | "none" {
  if (l.custom_rate != null) return "own";
  return l.dsr_rate != null ? "dsr" : "none";
}

/** The fields to restore to undo `patch` on `line`. */
export function inversePatch(line: BoqTableLine, patch: Partial<BoqTableLine>): Partial<BoqTableLine> {
  const prev: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof BoqTableLine)[]) prev[k] = line[k] ?? null;
  return prev as Partial<BoqTableLine>;
}

export interface BoqTotals {
  pricedTotal: number; pending: number; unpriced: number; complete: number; excluded: number;
  /** Included lines with an established quantity whose recorded basis is an assumption. */
  assumed: number;
  /** Included lines with an established quantity and no recorded basis. */
  basisUnknown: number;
}
export function boqTotals(lines: BoqTableLine[]): BoqTotals {
  const t: BoqTotals = { pricedTotal: 0, pending: 0, unpriced: 0, complete: 0, excluded: 0, assumed: 0, basisUnknown: 0 };
  for (const l of lines) {
    const st = lineStatus(l);
    t[st]++;
    if (st === "complete") t.pricedTotal += lineAmount(l) ?? 0;
    if (st === "complete" || st === "unpriced") {
      const origin = quantityProvenance(l).origin;
      if (origin === "assumption") t.assumed++;
      else if (origin === "unknown") t.basisUnknown++;
    }
  }
  return t;
}

/** Says how far the established quantities can be relied on: assumptions and
 *  quantities with no recorded basis are counted, never hidden. */
export function basisNotice(t: BoqTotals): string | null {
  const parts: string[] = [];
  if (t.assumed) parts.push(`${t.assumed} quantit${t.assumed === 1 ? "y is an assumption" : "ies are assumptions"}, not take-offs`);
  if (t.basisUnknown) parts.push(`${t.basisUnknown} ha${t.basisUnknown === 1 ? "s" : "ve"} no recorded basis`);
  return parts.length ? `Quantity basis: ${parts.join("; ")}.` : null;
}

/** Stated whenever the priced total leaves included lines out, so the total
 *  can never be read as the whole BOQ. Null when nothing is outstanding. */
//
// Quantity and rate are separate: a missing quantity makes the Quantity BOQ
// incomplete; a missing rate does not (rates belong to the Pricing phase), but
// it still keeps the line out of the priced total, and says so.
export function incompleteWarning(t: BoqTotals): string | null {
  const noRate = t.unpriced ? `${t.unpriced} line${t.unpriced === 1 ? " has" : "s have"} no rate yet` : "";
  if (t.pending) {
    return `Quantities are incomplete: ${t.pending} line${t.pending === 1 ? " has" : "s have"} a pending quantity.`
      + (noRate ? ` ${noRate}.` : "") + " These lines are not in the priced total.";
  }
  if (t.unpriced) return `All included quantities are established. ${noRate} and ${t.unpriced === 1 ? "is" : "are"} not in the priced total — rates belong to the Pricing phase.`;
  return null;
}

/** A source page usable as a viewer page number ("3"), or null for a
 *  non-numeric reference ("A-101") the viewer cannot jump to. */
export const pageParam = (page: string | null | undefined): string | null =>
  page && /^\d+$/.test(page.trim()) ? page.trim() : null;
