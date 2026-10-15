// INDICATIVE COSTING — a preliminary estimate priced from the DSR reference
// rates SNAPSHOTTED on boq_line_dsr_mapping, kept entirely apart from final
// commercial pricing:
//   • reads the line's measured qty/unit only — never boq_line.dsr_rate or
//     custom_rate (IndicativeLine has no such fields), and never the live
//     dsr_item table (only the mapping's snapshot);
//   • writes nothing; the result is display data. computeCommercials and the
//     BOQ exports never see it.
//   • prices a line only when the reviewer explicitly included a settled
//     (`mapped`) reference whose unit matches and whose rate and quantity are
//     present. Everything else is reported with the reason, never estimated,
//     converted or defaulted.
// Only rupee amounts are summed — quantities are never added across lines, so
// incompatible units can never be combined.

import { roundRupee } from "@/lib/boqDsrDocument";
import { compareUnits, type DsrMappingRow, type UnitCheck } from "@/lib/dsrMapping";

export const INDICATIVE_LABEL = "Indicative Cost Estimate — Not Final Pricing";

/** The BOQ-line fields indicative costing may read. Commercial rates are absent on purpose. */
export interface IndicativeLine {
  id: string;
  description: string | null;
  section?: string | null;
  unit: string | null;
  qty: number | null;
  included: boolean;
  quantity_status?: string | null;
}

export type IndicativeStatus =
  | "priced"            // included by the reviewer and fully eligible
  | "eligible"          // could be priced; reviewer has not included it
  | "unmapped"          // no mapping decision yet
  | "unmatched"         // custom item, no DSR equivalent
  | "needs_review"      // ambiguous mapping, never priced
  | "missing_rate"      // mapped, but the snapshot has no usable rate
  | "unit_mismatch"     // mapped, units differ — never converted
  | "unit_unknown"      // mapped, a unit is missing so it can't be checked
  | "missing_quantity"  // mapped, but the measured quantity is absent/pending
  | "excluded";         // line is excluded from the BOQ itself

export interface IndicativeRow {
  line: IndicativeLine;
  mapping: DsrMappingRow | null;
  status: IndicativeStatus;
  unitCheck: UnitCheck | null;
  /** Snapshot rate actually used; null unless priced. */
  rate: number | null;
  /** qty × snapshot rate, whole rupees; null unless priced. */
  amount: number | null;
}

export interface IndicativeSummary {
  rows: IndicativeRow[];
  total: number;
  /** True whenever any in-scope line is not priced. */
  partial: boolean;
  counts: {
    inScope: number;
    priced: number;
    unpriced: number;
    eligible: number;
    unmapped: number;
    unmatched: number;
    needsReview: number;
    unitMismatch: number;
    unitUnknown: number;
    missingRate: number;
    missingQuantity: number;
    excluded: number;
  };
}

const hasQuantity = (l: IndicativeLine) =>
  l.qty != null && Number.isFinite(l.qty) && l.qty > 0 && String(l.quantity_status ?? "").toUpperCase() !== "PENDING";

const hasRate = (r: number | null | undefined): r is number => r != null && Number.isFinite(r) && r > 0;

export function classifyIndicativeLine(line: IndicativeLine, mapping: DsrMappingRow | null): IndicativeRow {
  const base = { line, mapping, rate: null, amount: null };
  if (!line.included) return { ...base, status: "excluded", unitCheck: null };
  if (!mapping) return { ...base, status: "unmapped", unitCheck: null };
  if (mapping.status === "unmatched") return { ...base, status: "unmatched", unitCheck: null };
  const unitCheck = compareUnits(line.unit, mapping.dsr_unit);
  if (mapping.status === "needs_review") return { ...base, status: "needs_review", unitCheck };
  if (!hasRate(mapping.dsr_rate)) return { ...base, status: "missing_rate", unitCheck };
  if (unitCheck === "mismatch") return { ...base, status: "unit_mismatch", unitCheck };
  if (unitCheck === "unknown") return { ...base, status: "unit_unknown", unitCheck };
  if (!hasQuantity(line)) return { ...base, status: "missing_quantity", unitCheck };
  if (!mapping.include_in_estimate) return { ...base, status: "eligible", unitCheck };
  const rate = mapping.dsr_rate;
  return { ...base, status: "priced", unitCheck, rate, amount: roundRupee((line.qty as number) * rate) };
}

/** Whether the reviewer may switch "include in estimate" on for this row. */
export const canInclude = (row: IndicativeRow) => row.status === "eligible" || row.status === "priced";

export function buildIndicativeEstimate(lines: IndicativeLine[], mappings: DsrMappingRow[]): IndicativeSummary {
  const byLine = new Map(mappings.map((m) => [m.boq_line_id, m]));
  const rows = lines.map((l) => classifyIndicativeLine(l, byLine.get(l.id) ?? null));
  const n = (s: IndicativeStatus) => rows.filter((r) => r.status === s).length;
  const inScope = rows.filter((r) => r.status !== "excluded").length;
  const priced = n("priced");
  return {
    rows,
    total: rows.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    partial: priced < inScope,
    counts: {
      inScope, priced, unpriced: inScope - priced,
      eligible: n("eligible"), unmapped: n("unmapped"), unmatched: n("unmatched"),
      // Any referenced line whose units differ, even when another blocker
      // (e.g. no rate, needs review) is the headline status.
      needsReview: n("needs_review"), unitMismatch: rows.filter((r) => r.unitCheck === "mismatch").length,
      unitUnknown: n("unit_unknown"),
      missingRate: n("missing_rate"), missingQuantity: n("missing_quantity"), excluded: n("excluded"),
    },
  };
}

export const INDICATIVE_STATUS_LABEL: Record<IndicativeStatus, string> = {
  priced: "Included",
  eligible: "Eligible — not included",
  unmapped: "Unmapped",
  unmatched: "Unmatched (custom item)",
  needs_review: "Needs review",
  missing_rate: "No reference rate",
  unit_mismatch: "Unit mismatch",
  unit_unknown: "Unit missing",
  missing_quantity: "Quantity pending",
  excluded: "Excluded from BOQ",
};
