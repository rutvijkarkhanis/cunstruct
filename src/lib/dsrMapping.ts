// BOQ LINE → DSR SPECIFICATION MAPPING — pure model for boq_line_dsr_mapping
// (supabase/deferred-migrations/20261003000000_boq_line_dsr_mapping.sql). A mapping is a
// reviewer's decision about which DSR item a BOQ line corresponds to, kept as
// a REFERENCE BENCHMARK only. Nothing here reads or writes boq_line's
// commercial fields (dsr_rate / custom_rate) — see indicativeCosting.ts.

export type DsrMappingStatus = "mapped" | "needs_review" | "unmatched";

/** A dsr_item row as read from the reference table. */
export interface DsrItemRef {
  id: string;
  code: string;
  description: string | null;
  unit: string | null;
  rate: number | null;
  source: string | null;
  rate_year: string | null;
  subhead?: string | null;
}

/** The copy of a dsr_item stored on the mapping when the decision was made. */
export interface DsrSnapshot {
  dsr_item_id: string | null;
  dsr_code: string | null;
  dsr_description: string | null;
  dsr_unit: string | null;
  dsr_rate: number | null;
  dsr_source: string | null;
  dsr_rate_year: string | null;
}

export interface DsrMappingRow extends DsrSnapshot {
  id: string;
  boq_id: string;
  boq_line_id: string;
  status: DsrMappingStatus;
  include_in_estimate: boolean;
  reviewer_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export const EMPTY_SNAPSHOT: DsrSnapshot = {
  dsr_item_id: null, dsr_code: null, dsr_description: null, dsr_unit: null,
  dsr_rate: null, dsr_source: null, dsr_rate_year: null,
};

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Copies a dsr_item verbatim. A missing field stays null — never filled in. */
export function snapshotFromDsrItem(item: DsrItemRef): DsrSnapshot {
  return {
    dsr_item_id: item.id,
    dsr_code: item.code,
    dsr_description: item.description ?? null,
    dsr_unit: item.unit ?? null,
    dsr_rate: numOrNull(item.rate),
    dsr_source: item.source ?? null,
    dsr_rate_year: item.rate_year ?? null,
  };
}

/**
 * Spelling-only normalisation so "Sq.m", "sqm" and " SQM " compare equal.
 * Case, whitespace and dots only — no alias table and no conversion, so
 * "m2" vs "sqm" or "cum" vs "m3" deliberately stay a mismatch for a human
 * to resolve.
 */
export function normalizeUnit(unit: string | null | undefined): string | null {
  const u = (unit ?? "").toLowerCase().replace(/[\s.]/g, "");
  return u || null;
}

export type UnitCheck = "match" | "mismatch" | "unknown";

/** "unknown" when either side has no unit — unverifiable, so never priced. */
export function compareUnits(boqUnit: string | null | undefined, dsrUnit: string | null | undefined): UnitCheck {
  const a = normalizeUnit(boqUnit), b = normalizeUnit(dsrUnit);
  if (!a || !b) return "unknown";
  return a === b ? "match" : "mismatch";
}

export type MappingDecision =
  | { kind: "select"; item: DsrItemRef }
  | { kind: "needs_review"; item?: DsrItemRef | null }
  | { kind: "unmatched" };

/** The columns written for a decision (the line/BOQ/reviewer are added by the caller). */
export interface MappingWrite extends DsrSnapshot {
  status: DsrMappingStatus;
  include_in_estimate: boolean;
}

/**
 * Every decision resets include_in_estimate to false: a new or changed
 * reference must be explicitly re-included before it prices anything.
 */
export function mappingWriteFor(decision: MappingDecision): MappingWrite {
  switch (decision.kind) {
    case "select":
      return { status: "mapped", include_in_estimate: false, ...snapshotFromDsrItem(decision.item) };
    case "needs_review":
      return {
        status: "needs_review", include_in_estimate: false,
        ...(decision.item ? snapshotFromDsrItem(decision.item) : EMPTY_SNAPSHOT),
      };
    case "unmatched":
      return { status: "unmatched", include_in_estimate: false, ...EMPTY_SNAPSHOT };
  }
}

export const MAPPING_STATUS_LABEL: Record<DsrMappingStatus | "unmapped", string> = {
  mapped: "Mapped",
  needs_review: "Needs review",
  unmatched: "Unmatched (custom item)",
  unmapped: "Unmapped",
};

/** "DSR 2023" / "CPWD DSR" / null — only from fields actually present. */
export function referenceLabel(source: string | null | undefined, year: string | null | undefined): string | null {
  const parts = [source?.trim(), year?.trim()].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
