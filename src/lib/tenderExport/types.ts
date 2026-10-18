// Locked tender BoQ export (plan v1.2 §5B, from B8; owner-only preview lane).
// Shared types for the reader, mapper, writer and consistency check.
import type ExcelJS from "exceljs";

/** Column indices (1-based, Excel style) of the tender's item table. */
export interface ColumnMap {
  itemNo: number;
  description: number;
  unit: number;
  qty: number;
  rate: number;
  /** Optional: the department's amount column (usually a formula). Never written. */
  amount?: number;
}

/** One priced item of the tender's item table. */
export interface TenderItem {
  sheet: string;
  row: number;
  /** Normalised item number as printed (e.g. "1.2", "2.10"). */
  itemNo: string;
  description: string;
  unit: string;
  /** The department's quantity; null if the cell holds no number. */
  qty: number | null;
  /** Section heading this item sits under (the last heading row above it), or null. */
  section: string | null;
}

/** A total row inside an item table ("Total", "Sub-total", "Carried to abstract" …). */
export interface TotalRow {
  sheet: string;
  row: number;
  label: string;
  /** Section the total closes, or null for a sheet total. */
  section: string | null;
  /** Item rows (sheet rows) the total is expected to cover. */
  coversRows: number[];
}

/** One item table found in one worksheet. */
export interface TenderTable {
  sheet: string;
  headerRow: number;
  columns: ColumnMap;
  items: TenderItem[];
  totals: TotalRow[];
}

export interface ReadTender {
  workbook: ExcelJS.Workbook;
  tables: TenderTable[];
  /** Sheets in which no item table was recognised (kept untouched). */
  skippedSheets: string[];
}

/** A Cunstruct BOQ line offered for mapping. */
export interface CunstructLine {
  id: string;
  /** Tender item number the line was priced against, if known (e.g. "1.2"). */
  tenderItemNo?: string | null;
  description: string;
  unit: string | null;
  /** Cunstruct's own quantity (may differ from the department's). */
  qty: number | null;
  /** Rate in rupees per unit; null = no rate (never invented). */
  rate: number | null;
  /** Shared quantity state (src/lib/quantity.ts): pending lines are never priced as amounts. */
  quantityState: "established" | "confirmed_zero" | "pending" | "unavailable";
}

export type MatchBasis = "item_no" | "description_and_unit";

export interface Match {
  item: TenderItem;
  line: CunstructLine;
  basis: MatchBasis;
}

export type GapReason =
  | "no_line"            // no Cunstruct line matched this tender item
  | "ambiguous"          // several lines (or several items) matched; none is chosen
  | "no_rate"            // matched, but the line has no rate
  | "unit_mismatch";     // matched by item number, but the units differ

export interface Gap {
  item: TenderItem;
  reason: GapReason;
  detail: string;
}

export interface Mapping {
  matches: Match[];
  /** Tender items that will not receive a rate. */
  gaps: Gap[];
  /** Cunstruct lines that map to no tender item. */
  unmatchedLines: { line: CunstructLine; detail: string }[];
}

export type GapMode = "blank" | "zero";

export interface FillOptions {
  /** Per-tender setting for items without a rate. Default "blank". */
  gapMode?: GapMode;
}

export interface FillResult {
  written: { sheet: string; row: number; itemNo: string; rate: number }[];
  gapsWritten: { sheet: string; row: number; itemNo: string; value: 0 | null }[];
  /** Rate cells left alone because they already held a value or a formula. */
  refused: { sheet: string; row: number; itemNo: string; detail: string }[];
}

export type DisagreementKind =
  | "amount_formula"     // amount cell's formula is not this row's qty × rate
  | "amount_value"       // amount cell holds a number that differs from qty × rate
  | "total_formula"      // total's formula does not cover exactly its section's item rows
  | "total_value"        // total holds a number that differs from the section's sum
  | "qty_differs"        // department qty differs from Cunstruct's qty for the matched line
  | "line_amount"        // department qty × rate differs from Cunstruct's line amount
  | "not_compared";      // a comparison was impossible (pending line, missing number)

export interface Disagreement {
  kind: DisagreementKind;
  sheet: string;
  row: number;
  itemNo?: string;
  detail: string;
}

export interface ConsistencyReport {
  ok: boolean;
  disagreements: Disagreement[];
  /** Section and sheet sums computed from the filled rates, in rupees. */
  sums: { sheet: string; section: string | null; amount: number }[];
}
