// Revision delta (B9 logic, PREVIEW ONLY): old → new quantity and Δ₹ per line,
// sorted by |Δ₹|. Only lines whose inputs changed reset to unverified.
//
// A line with a pending quantity on either side has no Δ₹ (an unknown cannot
// be subtracted), and a line with no rate has no Δ₹ either; both are listed
// after the priced deltas, never as ₹0.
import { lineAmount, type EngineLine } from "./types";

export type DeltaStatus = "changed" | "unchanged" | "added" | "removed" | "unpriced";

export interface DeltaRow {
  id: string;
  description: string;
  unit: string;
  oldQuantity: number | null;
  newQuantity: number | null;
  /** new − old, or null when either side is pending or missing. */
  deltaQuantity: number | null;
  /** Δ₹ at the new rate (old rate for a removed line), or null when it cannot be priced. */
  deltaRs: number | null;
  status: DeltaStatus;
  /** True when this line's verification must be reset. */
  resetsVerification: boolean;
}

const qtyOf = (l: EngineLine | undefined): number | null => (!l || l.quantityState === "pending" ? null : l.quantity);

/** Inputs that, if changed, invalidate a reviewer's verification. */
export function verificationInputsChanged(a: EngineLine, b: EngineLine): boolean {
  return a.quantity !== b.quantity || a.quantityState !== b.quantityState || a.unit !== b.unit || a.rate !== b.rate || a.description !== b.description;
}

export function revisionDelta(oldLines: EngineLine[], newLines: EngineLine[]): DeltaRow[] {
  const oldById = new Map(oldLines.map((l) => [l.id, l]));
  const newById = new Map(newLines.map((l) => [l.id, l]));
  const ids = [...new Set([...oldLines.map((l) => l.id), ...newLines.map((l) => l.id)])];
  const rows = ids.map((id): DeltaRow => {
    const o = oldById.get(id);
    const n = newById.get(id);
    const ref = (n ?? o)!;
    const oldQ = qtyOf(o);
    const newQ = qtyOf(n);
    const base = { id, description: ref.description, unit: ref.unit, oldQuantity: oldQ, newQuantity: newQ };
    if (!o) {
      const a = lineAmount(n!);
      return { ...base, deltaQuantity: newQ, deltaRs: a, status: a == null ? "unpriced" : "added", resetsVerification: true };
    }
    if (!n) {
      const a = lineAmount(o);
      return { ...base, deltaQuantity: oldQ == null ? null : -oldQ, deltaRs: a == null ? null : -a, status: a == null ? "unpriced" : "removed", resetsVerification: true };
    }
    const changed = verificationInputsChanged(o, n);
    const oa = lineAmount(o);
    const na = lineAmount(n);
    if (oa == null || na == null) {
      return { ...base, deltaQuantity: oldQ != null && newQ != null ? round2(newQ - oldQ) : null, deltaRs: null, status: changed ? "unpriced" : "unchanged", resetsVerification: changed };
    }
    return { ...base, deltaQuantity: round2(newQ! - oldQ!), deltaRs: na - oa, status: changed ? "changed" : "unchanged", resetsVerification: changed };
  });
  const group = (r: DeltaRow) => (r.deltaRs != null && r.status !== "unchanged" ? 0 : r.status === "unpriced" ? 1 : 2);
  return rows.sort((a, b) => group(a) - group(b) || Math.abs(b.deltaRs ?? 0) - Math.abs(a.deltaRs ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The ids whose verification resets: only lines whose inputs changed (or that were added or removed). */
export const resetIds = (rows: DeltaRow[]): string[] => rows.filter((r) => r.resetsVerification).map((r) => r.id);

const round2 = (n: number) => Math.round(n * 100) / 100;
