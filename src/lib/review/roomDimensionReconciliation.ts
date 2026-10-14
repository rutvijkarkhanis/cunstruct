// ROOM ↔ DIMENSION RECONCILIATION — which printed dimension belongs to which
// space label, decided only from page position, never from list order.
//
// Rule (architectural plans print a room's size directly beneath its name,
// in the same reading direction): a dimension is a *plausible* match for a
// label when both are on the same page, read in the same direction, the
// dimension's centre lies below the label's centre by at most
// MAX_BELOW_LINES label line-heights, and their extents overlap along the
// reading direction. Distance is measured in label line-heights, so the rule
// is scale-free.
//
// A pair is accepted only when each is the other's nearest plausible
// partner AND the next-nearest alternative (for either side) is at least
// MARGIN times farther. Everything else is reported, not guessed:
//   no_dimension — nothing plausible, or the only nearby dimension is
//                  another room's;
//   ambiguous    — more than one plausible reading, with the alternatives.
// A dimension is never given to two rooms, and a room's size is never
// borrowed from another room with the same label.
//
// Opening-schedule sizes (kind "opening_size", see drawingInventory.ts) are
// never room sizes and are never paired. A label printed on a schedule row,
// or one whose only size beneath it is an opening size, is reported as
// ambiguous with the reason — kept for review, not measured. Pure and deterministic.

import type { Box, DimensionPair, DrawingInventory, InventoryCandidate, SpaceClass } from "./drawingInventory";

export const MAX_BELOW_LINES = 3;
export const MARGIN = 1.5;
const STRONG_MARGIN = 2;

export type RoomStatus = "dimensioned" | "ambiguous" | "no_dimension";

export interface DimensionRef {
  candidateId: string;
  text: string;
  dimension: DimensionPair;
  box: Box;
  /** Distance from the label, in label line-heights. */
  distance: number;
}

export interface ReconciledRoom {
  candidateId: string;
  label: string;
  spaceClass: SpaceClass;
  documentId: string;
  page: number;
  pageSize: { width: number; height: number };
  /** The page's floor from its sheet title; null when unidentified or conflicting. */
  floor: string | null;
  box: Box;
  status: RoomStatus;
  dimension?: DimensionRef;
  confidence?: "high" | "medium";
  /** Other plausible dimensions — set for "ambiguous", and for a medium-confidence match. */
  alternatives: DimensionRef[];
  reason: string;
}

export interface UnmatchedDimension {
  candidateId: string;
  text: string;
  page: number;
  box: Box;
  reason: string;
}

export interface RoomReconciliation {
  rooms: ReconciledRoom[];
  unmatchedDimensions: UnmatchedDimension[];
}

const centre = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const extentAlong = (b: Box, [dx, dy]: [number, number]) => Math.abs(dx) * (b[2] - b[0]) + Math.abs(dy) * (b[3] - b[1]);
const sameDirection = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1] > 0.99;

/** Distance (in label line-heights) when `dim` sits where a room size is
 *  printed for `label`; null when it doesn't. */
export function placementDistance(label: InventoryCandidate, dim: InventoryCandidate): number | null {
  if (label.documentId !== dim.documentId || label.page !== dim.page) return null;
  if (!sameDirection(label.direction, dim.direction)) return null;
  const h = label.lineHeight || 1;
  const [dx, dy] = label.direction;
  const [lx, ly] = centre(label.box), [mx, my] = centre(dim.box);
  const along = (mx - lx) * dx + (my - ly) * dy;
  const below = (mx - lx) * -dy + (my - ly) * dx; // "down" is the direction rotated +90° in a y-down space
  if (below <= 0 || below > MAX_BELOW_LINES * h) return null;
  const halfSpan = (extentAlong(label.box, label.direction) + extentAlong(dim.box, label.direction)) / 2;
  if (Math.abs(along) > halfSpan) return null;
  return Math.hypot(along, below) / h;
}

function ref(dim: InventoryCandidate, distance: number): DimensionRef {
  return { candidateId: dim.id, text: dim.text, dimension: dim.dimension!, box: dim.box, distance: Math.round(distance * 100) / 100 };
}

export function reconcileRoomDimensions(inventory: DrawingInventory): RoomReconciliation {
  const allLabels = inventory.candidates.filter((c) => c.kind === "space_label");
  const labels = allLabels.filter((c) => !c.scheduleRow);
  const dims = inventory.candidates.filter((c) => c.kind === "room_dimension");
  const openingSizes = inventory.candidates.filter((c) => c.kind === "opening_size");
  const floorOf = new Map(inventory.pages.map((p) => [`${p.documentId}:${p.page}`, p.floor.status === "identified" ? p.floor.floor : null]));

  // Plausible pairs, nearest first, from each side.
  const byLabel = new Map<string, { dim: InventoryCandidate; d: number }[]>();
  const byDim = new Map<string, { label: InventoryCandidate; d: number }[]>();
  for (const label of labels) {
    for (const dim of dims) {
      const d = placementDistance(label, dim);
      if (d === null) continue;
      (byLabel.get(label.id) ?? byLabel.set(label.id, []).get(label.id)!).push({ dim, d });
      (byDim.get(dim.id) ?? byDim.set(dim.id, []).get(dim.id)!).push({ label, d });
    }
  }
  for (const list of [...byLabel.values(), ...byDim.values()]) list.sort((a, b) => a.d - b.d);

  // Accept mutual-nearest pairs with a clear margin on both sides.
  const accepted = new Map<string, { dim: InventoryCandidate; d: number; margin: number }>(); // label id →
  const takenDims = new Map<string, string>(); // dim id → label text
  for (const label of labels) {
    const options = byLabel.get(label.id) ?? [];
    if (options.length === 0) continue;
    const best = options[0];
    const rivals = byDim.get(best.dim.id)!;
    if (rivals[0].label.id !== label.id) continue;
    const labelMargin = options[1] ? options[1].d / best.d : Infinity;
    const dimMargin = rivals[1] ? rivals[1].d / best.d : Infinity;
    const margin = Math.min(labelMargin, dimMargin);
    if (margin < MARGIN) continue;
    accepted.set(label.id, { dim: best.dim, d: best.d, margin });
    takenDims.set(best.dim.id, label.text);
  }

  const rooms: ReconciledRoom[] = allLabels.map((label) => {
    const base = {
      candidateId: label.id, label: label.text, spaceClass: label.spaceClass!, documentId: label.documentId,
      page: label.page, pageSize: label.pageSize, floor: floorOf.get(`${label.documentId}:${label.page}`) ?? null, box: label.box,
    };
    if (label.scheduleRow) return { ...base, status: "ambiguous", alternatives: [], reason: label.scheduleRow.reason };
    const options = byLabel.get(label.id) ?? [];
    const hit = accepted.get(label.id);
    if (hit) {
      return {
        ...base, status: "dimensioned", dimension: ref(hit.dim, hit.d),
        confidence: hit.margin >= STRONG_MARGIN ? "high" : "medium",
        alternatives: options.slice(1).map((o) => ref(o.dim, o.d)),
        reason: options.length === 1 && (byDim.get(hit.dim.id)?.length ?? 0) === 1
          ? "The only dimension printed beneath this label, and this is the only label above it."
          : `Nearest dimension beneath this label, ${hit.margin === Infinity ? "unopposed" : `${hit.margin.toFixed(1)}× closer than the next reading`}.`,
      };
    }
    if (options.length === 0) {
      const opening = openingSizes.find((o) => placementDistance(label, o) !== null);
      if (opening) {
        return { ...base, status: "ambiguous", alternatives: [], reason: `The size beneath this label ("${opening.text}") is an opening-schedule entry (${opening.opening!.reason}); it is not used as a room size.` };
      }
      return { ...base, status: "no_dimension", alternatives: [], reason: "No dimension is printed beneath this label." };
    }
    const free = options.filter((o) => !takenDims.has(o.dim.id));
    if (free.length === 0) {
      const owners = [...new Set(options.map((o) => takenDims.get(o.dim.id)!))];
      return { ...base, status: "no_dimension", alternatives: [], reason: `The nearby dimension belongs to ${owners.join(", ")}.` };
    }
    return {
      ...base, status: "ambiguous", alternatives: options.map((o) => ref(o.dim, o.d)),
      reason: options.length > 1
        ? "Several dimensions are printed beneath this label with no clear nearest."
        : "This dimension is about as close to another label; it can't be assigned to either with confidence.",
    };
  });

  const unmatchedDimensions: UnmatchedDimension[] = dims
    .filter((d) => !takenDims.has(d.id))
    .map((d) => {
      const near = byDim.get(d.id) ?? [];
      return {
        candidateId: d.id, text: d.text, page: d.page, box: d.box,
        reason: near.length === 0
          ? "No space label is printed directly above this dimension."
          : `Could belong to ${near.map((n) => n.label.text).join(" or ")}; not assigned.`,
      };
    });

  return { rooms, unmatchedDimensions };
}
