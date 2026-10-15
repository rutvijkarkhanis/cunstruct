// Project overview rollups for the journey. Pure: every count comes from rows
// the caller already loaded, using the BOQ builder's own rules (qtyPending,
// effective rate = custom ?? DSR), so the overview can never disagree with
// the BOQ screen about what is pending or unpriced.
import { qtyPending } from "@/lib/boqRevision";

export interface OverviewLine {
  boq_id: string; qty: number | null; quantity_status?: string | null;
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

export type NextStep =
  | { kind: "upload_drawings" }
  | { kind: "create_boq" }
  | { kind: "finish_review"; boqId: string; count: number }
  | { kind: "resolve_pending"; boqId: string; count: number }
  | { kind: "export"; boqId: string };

/** The single most useful next action, in journey order. Unfinished review
 *  comes before pending quantities: applying a finished review is what
 *  establishes many of those quantities. */
export function nextStep(input: {
  drawingCount: number;
  boqIds: string[];
  stats: Map<string, BoqLineStats>;
  unfinishedReview: Map<string, number>;
}): NextStep {
  if (input.drawingCount === 0) return { kind: "upload_drawings" };
  if (input.boqIds.length === 0) return { kind: "create_boq" };
  for (const id of input.boqIds) {
    const n = input.unfinishedReview.get(id) ?? 0;
    if (n > 0) return { kind: "finish_review", boqId: id, count: n };
  }
  for (const id of input.boqIds) {
    const n = input.stats.get(id)?.pendingQty ?? 0;
    if (n > 0) return { kind: "resolve_pending", boqId: id, count: n };
  }
  return { kind: "export", boqId: input.boqIds[0] };
}
