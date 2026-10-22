// CONTRACTOR WORK PACKAGES — a read-only presentation of the working BOQ,
// grouped by trade (the line's section) and then by location (the line's
// project scope). It reads the same lines the BOQ builder shows and changes
// nothing: no quantity, review decision, rate or total is derived here.
//
// A work package carries quantities only. Rates and amounts are deliberately
// absent — a contractor package is issued for pricing or execution, and the
// BOQ's commercial figures are not its to restate. Excluded lines are left out
// (they are not part of this BOQ's scope) but counted, and drawing-review items
// that were never applied are stated, so a package is never read as the
// drawing's complete scope.

import { qtyPending } from "@/lib/boqRevision";
import { csvCell, incompleteScopeNotice } from "@/lib/boqDsrDocument";
import { BOQ_DRAFT_DISCLAIMER } from "@/lib/boqDraftDisclaimer";
import { DRAWING_REVIEW_SECTION } from "@/lib/applyFinding";

export const NO_TRADE = "Unassigned trade";
export const NO_LOCATION = "No location";
/** Section values that say where a line came from, not what trade does the work:
 *  Apply's drawing-review label and the builder's default for a blank line. A
 *  package must not present them as a trade, so their lines are unassigned. */
const NOT_A_TRADE = new Set([DRAWING_REVIEW_SECTION, "Other"]);

export interface WorkPackageLineInput {
  id: string;
  section: string | null;
  dsr_code: string | null;
  description: string | null;
  unit: string | null;
  qty: number | null;
  quantity_status?: string | null;
  basis?: string | null;
  included: boolean;
  scope_id?: string | null;
  sort?: number;
}

export interface WorkPackageRow {
  lineId: string;
  itemNo: string;
  code: string | null;
  description: string;
  unit: string;
  /** null when the quantity is still pending — never a fabricated 0. */
  qty: number | null;
  status: "measured" | "pending";
  sourceDocument: string | null;
  sourcePage: string | null;
}

export interface WorkPackageLocation {
  location: string;
  rows: WorkPackageRow[];
}

export interface WorkPackage {
  no: number;
  trade: string;
  locations: WorkPackageLocation[];
  measuredCount: number;
  pendingCount: number;
}

export interface WorkPackageSet {
  packages: WorkPackage[];
  /** Lines excluded from the BOQ: not in any package, but reported. */
  excludedCount: number;
}

type SourceOf = (lineId: string) => { sourceDocument: string | null; sourcePage: string | null };

/**
 * Group included lines by trade, then location. Trades and locations are
 * ordered by name, with the "unassigned"/"no location" buckets last; lines
 * keep the BOQ's own order within a location. A scope id with no known name
 * is shown as unknown rather than dropped or merged into "No location".
 */
export function buildWorkPackages(
  lines: WorkPackageLineInput[],
  scopeNames: Map<string, string>,
  sourceOf: SourceOf = () => ({ sourceDocument: null, sourcePage: null }),
): WorkPackageSet {
  const included = lines.filter((l) => l.included);
  const trades = new Map<string, Map<string, WorkPackageLineInput[]>>();
  for (const l of [...included].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    const section = l.section?.trim();
    const trade = section && !NOT_A_TRADE.has(section) ? section : NO_TRADE;
    const location = l.scope_id ? (scopeNames.get(l.scope_id) ?? `Unknown location (${l.scope_id.slice(0, 8)})`) : NO_LOCATION;
    if (!trades.has(trade)) trades.set(trade, new Map());
    const byLocation = trades.get(trade)!;
    if (!byLocation.has(location)) byLocation.set(location, []);
    byLocation.get(location)!.push(l);
  }
  const lastly = (fallback: string) => (a: string, b: string) =>
    (a === fallback ? 1 : 0) - (b === fallback ? 1 : 0) || a.localeCompare(b);

  const packages = [...trades.keys()].sort(lastly(NO_TRADE)).map((trade, ti): WorkPackage => {
    const no = ti + 1;
    let item = 0, measuredCount = 0, pendingCount = 0;
    const byLocation = trades.get(trade)!;
    const locations = [...byLocation.keys()].sort(lastly(NO_LOCATION)).map((location) => ({
      location,
      rows: byLocation.get(location)!.map((l): WorkPackageRow => {
        const pending = qtyPending({ qty: l.qty, quantity_status: l.quantity_status, basis: l.basis });
        if (pending) pendingCount++; else measuredCount++;
        return {
          lineId: l.id, itemNo: `${no}.${String(++item).padStart(2, "0")}`, code: l.dsr_code,
          description: l.description?.trim() || "(no description)", unit: l.unit ?? "",
          qty: pending ? null : l.qty, status: pending ? "pending" : "measured",
          ...sourceOf(l.id),
        };
      }),
    }));
    return { no, trade, locations, measuredCount, pendingCount };
  });
  return { packages, excludedCount: lines.length - included.length };
}

/** One CSV for all packages: quantities, status and drawing references; no rates or amounts. */
export function buildWorkPackageCsv(
  set: WorkPackageSet,
  meta: { boqName: string; project?: string | null; generatedOn: string; unresolvedReviewCount?: number | null },
): string {
  const lines: string[] = [
    csvCell(`Work packages by trade and location — ${meta.boqName}`),
    csvCell(`${meta.project ?? "Standalone"}  ·  ${meta.generatedOn}  ·  Quantities only; rates and amounts are not part of a work package · ${BOQ_DRAFT_DISCLAIMER}`),
  ];
  const notice = incompleteScopeNotice(meta.unresolvedReviewCount);
  if (notice) lines.push(csvCell(notice));
  if (set.excludedCount > 0) lines.push(csvCell(`${set.excludedCount} excluded line${set.excludedCount === 1 ? "" : "s"} not shown.`));
  lines.push("", ["Package", "Trade", "Location", "Item", "Code", "Description", "Unit", "Qty", "Status", "Source Document", "Source Page"].map(csvCell).join(","));
  for (const p of set.packages) {
    for (const loc of p.locations) {
      for (const r of loc.rows) {
        lines.push([
          p.no, p.trade, loc.location, r.itemNo, r.code ?? "", r.description, r.unit,
          r.qty ?? "", r.status === "pending" ? "Pending — quantity not confirmed" : "Measured",
          r.sourceDocument ?? "", r.sourceDocument ? (r.sourcePage ?? "") : "",
        ].map(csvCell).join(","));
      }
    }
  }
  return lines.join("\r\n");
}
