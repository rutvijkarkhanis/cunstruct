// Project overview rollups for the journey (the next action and stages are
// lib/app/journey). Pure: every count comes from rows
// the caller already loaded, using the BOQ builder's own rules (qtyPending,
// effective rate = custom ?? DSR), so the overview can never disagree with
// the BOQ screen about what is pending or unpriced.
import { qtyPending } from "@/lib/quantity";

export interface OverviewLine {
  boq_id: string; qty: number | null; quantity_status?: string | null; basis?: string | null;
  dsr_rate: number | null; custom_rate: number | null; included: boolean;
  source_document_id?: string | null;
}

export interface BoqLineStats {
  total: number;
  /** Included lines only — excluded lines are not part of the BOQ total. */
  included: number;
  /** Included lines whose quantity is not established (see qtyPending). */
  pendingQty: number;
  /** Included lines with an established quantity but no rate. */
  unpriced: number;
  /** Included lines that are ready: quantity established and rated. */
  complete: number;
  /** Included lines carrying a drawing source reference. */
  withSource: number;
}

export const EMPTY_STATS: BoqLineStats = { total: 0, included: 0, pendingQty: 0, unpriced: 0, complete: 0, withSource: 0 };

export function lineStats(lines: OverviewLine[]): BoqLineStats {
  const s = { ...EMPTY_STATS };
  for (const l of lines) {
    s.total++;
    if (!l.included) continue;
    s.included++;
    if (l.source_document_id) s.withSource++;
    if (qtyPending(l)) s.pendingQty++;
    else if ((l.custom_rate ?? l.dsr_rate) == null) s.unpriced++;
    else s.complete++;
  }
  return s;
}

export function statsByBoq(lines: OverviewLine[]): Map<string, BoqLineStats> {
  const groups = new Map<string, OverviewLine[]>();
  for (const l of lines) groups.set(l.boq_id, [...(groups.get(l.boq_id) ?? []), l]);
  return new Map([...groups].map(([id, ls]) => [id, lineStats(ls)]));
}
