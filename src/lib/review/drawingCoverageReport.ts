// DRAWING COVERAGE REPORT — model observations measured against what the
// drawing's own text says is there (drawingInventory.ts +
// roomDimensionReconciliation.ts), instead of against themselves.
//
// "The model returned N observations and all were processed" is never
// coverage. Coverage here is: of the spaces the drawing labels, how many did
// the analysis observe — and what is missing, ambiguous, rejected,
// duplicated or in conflict. The inventory itself is only as complete as its
// text layer and its fixed space vocabulary, so the report is always
// "provisional" (or "unavailable" with no text layer), never "complete".
//
// Pure: no I/O, never mutates its inputs or any BOQ.

import { labelKey, type DrawingInventory, type SpaceClass } from "./drawingInventory";
import type { ReconciledRoom, RoomReconciliation, UnmatchedDimension } from "./roomDimensionReconciliation";
import type { ObservationParseDiagnostics, RejectedObservation } from "./observationSchemaV1";
import { normalizeDimension } from "./observationBenchmarkScorer";

/** The parts of an observation the report reads — satisfied by both
 *  ObservationV1 (parser output) and a persisted LocationObservation mapped
 *  to this shape. */
export interface CoverageObservation {
  id?: string;
  observationType: string;
  mark?: string;
  scopeHint?: string;
  attributes: { dimension?: string };
  source: { page?: number; pageSize?: { width: number; height: number }; evidence: { bbox: [number, number, number, number]; page?: number }[] };
}

export interface UnpinnedSummary { index: number; observationType: string; mark?: string }

export type ObservationOutcome =
  | { status: "matched"; roomId: string; via: "location" | "label_only" }
  | { status: "duplicate"; roomId: string; reason: string }
  | { status: "unresolved"; reason: string }
  | { status: "not_in_inventory"; reason: string };

export interface ObservationCoverage {
  index: number;
  id?: string;
  observationType: string;
  mark?: string;
  page?: number;
  outcome: ObservationOutcome;
}

export interface FloorConflict { roomId: string; label: string; page: number; drawingFloor: string; observedFloor: string; observationIndex: number }
export interface DimensionConflict { roomId: string; label: string; page: number; drawingDimension: string; observedDimension: string; observationIndex: number }

export interface DrawingCoverageReport {
  status: "provisional" | "unavailable";
  provisionalReasons: string[];
  pages: { documentId: string; page: number; textLayer: "available" | "absent"; floor: string | null; floorStatus: string; spaces: number }[];
  spaces: {
    total: number;
    byClass: Record<SpaceClass, number>;
    dimensioned: ReconciledRoom[];
    ambiguous: ReconciledRoom[];
    noDimension: ReconciledRoom[];
  };
  /** Inventory spaces with at least one matched observation. */
  observed: { count: number; of: number; byClass: Record<SpaceClass, { observed: number; of: number }> };
  notObserved: ReconciledRoom[];
  observations: ObservationCoverage[];
  rejected: RejectedObservation[];
  unpinned: UnpinnedSummary[];
  /** false when parse diagnostics weren't supplied — rejections are then unknown, not zero. */
  rejectionsKnown: boolean;
  unmatchedDimensions: UnmatchedDimension[];
  conflicts: { pageFloors: { page: number; floors: string[] }[]; floorLabels: FloorConflict[]; dimensions: DimensionConflict[] };
  /** Dimensioned with high confidence — the only spaces allowed into quantity calculation. */
  readyForQuantity: ReconciledRoom[];
  /** Text the inventory could not classify (furniture, symbols, notes, or spaces outside its vocabulary). */
  unclassifiedText: number;
}

const centreFraction = (b: [number, number, number, number], s: { width: number; height: number }) =>
  [((b[0] + b[2]) / 2) / s.width, ((b[1] + b[3]) / 2) / s.height];

function observationPage(o: CoverageObservation): number | undefined {
  return o.source.page ?? o.source.evidence[0]?.page;
}

export function buildDrawingCoverageReport(
  inventory: DrawingInventory,
  reconciliation: RoomReconciliation,
  observations: CoverageObservation[],
  diagnostics: (ObservationParseDiagnostics & { unpinned?: UnpinnedSummary[] }) | null,
): DrawingCoverageReport {
  const spaces = reconciliation.rooms;
  const byId = new Map(spaces.map((r) => [r.candidateId, r]));

  // ── Match observations to inventory spaces: page + label, then location.
  // A boxed observation claims the nearest same-label space on its page; a
  // second one claiming the same space is a duplicate. An unboxed one matches
  // only when its label is unique on that page — never by list order.
  type Claim = { index: number; roomId: string; d: number };
  const located: Claim[] = [];
  const outcomes = new Map<number, ObservationOutcome>();
  observations.forEach((o, index) => {
    const page = observationPage(o);
    if (page === undefined) return outcomes.set(index, { status: "unresolved", reason: "The observation names no page." });
    const same = spaces.filter((r) => r.page === page && labelKey(r.label) === labelKey(o.mark));
    if (!o.mark || same.length === 0) {
      return outcomes.set(index, { status: "not_in_inventory", reason: o.mark ? `No "${o.mark}" label on page ${page} of the drawing text.` : "The observation has no label to look up." });
    }
    const boxes = o.source.evidence.filter((b) => (b.page ?? page) === page);
    if (boxes.length === 0) {
      return outcomes.set(index, same.length === 1
        ? { status: "matched", roomId: same[0].candidateId, via: "label_only" }
        : { status: "unresolved", reason: `"${o.mark}" appears ${same.length} times on page ${page}, and the observation has no evidence box to say which.` });
    }
    for (const r of same) {
      const [ox, oy] = centreFraction(boxes[0].bbox, o.source.pageSize ?? r.pageSize);
      const [rx, ry] = centreFraction(r.box, r.pageSize);
      located.push({ index, roomId: r.candidateId, d: Math.hypot(ox - rx, oy - ry) });
    }
  });
  const nearestRoom = new Map<number, Claim>();
  for (const c of located) if (!nearestRoom.has(c.index) || c.d < nearestRoom.get(c.index)!.d) nearestRoom.set(c.index, c);
  const claimedBy = new Map<string, number>();
  for (const c of [...nearestRoom.values()].sort((a, b) => a.d - b.d)) {
    if (!claimedBy.has(c.roomId)) {
      claimedBy.set(c.roomId, c.index);
      outcomes.set(c.index, { status: "matched", roomId: c.roomId, via: "location" });
    } else {
      outcomes.set(c.index, { status: "duplicate", roomId: c.roomId, reason: `Same space as observation #${claimedBy.get(c.roomId)}.` });
    }
  }
  // Label-only matches can also land on a space already claimed.
  observations.forEach((_, index) => {
    const out = outcomes.get(index);
    if (out?.status !== "matched" || out.via !== "label_only") return;
    const owner = claimedBy.get(out.roomId);
    if (owner !== undefined && owner !== index) outcomes.set(index, { status: "duplicate", roomId: out.roomId, reason: `Same space as observation #${owner}.` });
    else claimedBy.set(out.roomId, index);
  });

  const observationCoverage: ObservationCoverage[] = observations.map((o, index) => ({
    index, id: o.id, observationType: o.observationType, mark: o.mark, page: observationPage(o), outcome: outcomes.get(index)!,
  }));

  // ── Conflicts between what was observed and what the drawing says.
  const floorLabels: FloorConflict[] = [];
  const dimensions: DimensionConflict[] = [];
  for (const oc of observationCoverage) {
    if (oc.outcome.status !== "matched") continue;
    const room = byId.get(oc.outcome.roomId)!;
    const o = observations[oc.index];
    if (room.floor && labelKey(o.scopeHint) !== labelKey(room.floor)) {
      floorLabels.push({ roomId: room.candidateId, label: room.label, page: room.page, drawingFloor: room.floor, observedFloor: o.scopeHint ?? "(none)", observationIndex: oc.index });
    }
    if (room.dimension && o.attributes.dimension && normalizeDimension(o.attributes.dimension) !== normalizeDimension(room.dimension.text)) {
      dimensions.push({ roomId: room.candidateId, label: room.label, page: room.page, drawingDimension: room.dimension.text, observedDimension: o.attributes.dimension, observationIndex: oc.index });
    }
  }

  const classes: SpaceClass[] = ["room", "circulation", "outdoor"];
  const zero = () => Object.fromEntries(classes.map((c) => [c, 0])) as Record<SpaceClass, number>;
  const byClass = zero();
  for (const s of spaces) byClass[s.spaceClass]++;
  const observedIds = new Set(observationCoverage.flatMap((o) => (o.outcome.status === "matched" ? [o.outcome.roomId] : [])));
  const observedByClass = Object.fromEntries(classes.map((c) => [c, {
    observed: spaces.filter((s) => s.spaceClass === c && observedIds.has(s.candidateId)).length, of: byClass[c],
  }])) as DrawingCoverageReport["observed"]["byClass"];

  const pagesWithText = inventory.pages.filter((p) => p.textLayer === "available");
  const provisionalReasons = [
    "Spaces are recognised from a fixed vocabulary of room words; a space named outside it is not counted.",
    ...inventory.pages.filter((p) => p.textLayer === "absent").map((p) => `Page ${p.page} has no text layer (scanned or raster) — its spaces are unknown.`),
    ...inventory.pages.filter((p) => p.floor.status !== "identified").map((p) => `Page ${p.page}'s floor is ${p.floor.status === "conflict" ? "ambiguous (several sheet titles)" : "not identified from a sheet title"}.`),
    ...(diagnostics ? [] : ["The parser's rejections for this run are not available, so rejected observations are unknown rather than zero."]),
  ];

  return {
    status: pagesWithText.length === 0 ? "unavailable" : "provisional",
    provisionalReasons,
    pages: inventory.pages.map((p) => ({
      documentId: p.documentId, page: p.page, textLayer: p.textLayer,
      floor: p.floor.status === "identified" ? p.floor.floor : null, floorStatus: p.floor.status,
      spaces: spaces.filter((s) => s.page === p.page && s.documentId === p.documentId).length,
    })),
    spaces: {
      total: spaces.length, byClass,
      dimensioned: spaces.filter((s) => s.status === "dimensioned"),
      ambiguous: spaces.filter((s) => s.status === "ambiguous"),
      noDimension: spaces.filter((s) => s.status === "no_dimension"),
    },
    observed: { count: observedIds.size, of: spaces.length, byClass: observedByClass },
    notObserved: spaces.filter((s) => !observedIds.has(s.candidateId)),
    observations: observationCoverage,
    rejected: diagnostics?.rejected ?? [],
    unpinned: diagnostics?.unpinned ?? [],
    rejectionsKnown: !!diagnostics,
    unmatchedDimensions: reconciliation.unmatchedDimensions,
    conflicts: {
      pageFloors: inventory.pages.flatMap((p) => (p.floor.status === "conflict" ? [{ page: p.page, floors: p.floor.floors }] : [])),
      floorLabels, dimensions,
    },
    readyForQuantity: spaces.filter((s) => s.status === "dimensioned" && s.confidence === "high"),
    unclassifiedText: inventory.candidates.filter((c) => c.kind === "other").length,
  };
}
