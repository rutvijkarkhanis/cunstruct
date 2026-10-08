// TYPE INSTANCES — maps LOCATION observations onto a BOQ type by shared
// `mark`, when LOCATION extraction has actually been run for the document
// this analysis resolves against.
//
// This is the one place Cunstruct has genuine per-occurrence data: each
// analysis_observation carries its own evidence (a real bbox on the
// drawing), unlike a BOQ item's own evidence (usually one schedule-row
// region supporting the type's aggregate quantity, not one box per placed
// unit — see analysisSchemaV1.ts). LOCATION extraction is admin-only and
// manually triggered per document (DocumentLocationExtraction.tsx) — in
// most real review sessions no observations will exist yet, and that is an
// honest "instance detail unavailable" state, never worked around by
// inventing placements the data doesn't have.
//
// Purely additive and read-only: an instance here NEVER gets its own review
// status and NEVER feeds Apply — applyReview.ts classifies and writes
// exactly one boq_line per AnalysisItemV1, completely unchanged by this file.

import type { LocationObservation } from "./locationObservations";
import type { ObservationType } from "./observationSchemaV1";

export interface TypeInstance {
  observation: LocationObservation;
  /** True when the observation's own dimension/specification (when it
   *  states one) disagrees with the parent type's declared value — a real,
   *  observed exception, never invented by comparing against nothing. */
  differsFromType: boolean;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Every LOCATION observation sharing this type's key (case-insensitive,
 *  trimmed) — the real, non-fabricated Type -> Instances mapping. Returns
 *  [] (not undefined) both when the type has no key and when nothing
 *  matches, so callers can treat "no instances" uniformly.
 *
 *  Deliberately UNFILTERED by observation type — this includes a
 *  `schedule_entry` sharing the mark, same as every other caller has always
 *  seen (drawingMarkers.ts draws a marker per entry here; narrowing this
 *  function's own output would silently change what it draws). A
 *  `schedule_entry` is a schedule-TABLE row, not a placed occurrence on a
 *  drawing — see physicalInstancesForType/hasScheduleEntryForType below for
 *  the two callers that need that physical/non-physical distinction (instance
 *  *counting*), added additively rather than changed in place here. */
export function instancesForType(
  item: { key: string; dimension?: string; specification?: string },
  observations: LocationObservation[],
): TypeInstance[] {
  const key = norm(item.key);
  if (!key) return [];
  return observations
    .filter((o) => norm(o.mark) === key)
    .map((observation) => {
      const dimDiffers = !!observation.attributes.dimension && !!item.dimension
        && norm(observation.attributes.dimension) !== norm(item.dimension);
      const specDiffers = !!observation.attributes.specification && !!item.specification
        && norm(observation.attributes.specification) !== norm(item.specification);
      return { observation, differsFromType: dimDiffers || specDiffers };
    });
}

// Observation types that represent an actual PLACED/PHYSICAL occurrence on a
// drawing — i.e. something a reviewer could point at and say "there it is."
// Deliberately excludes:
//   - "schedule_entry": the schedule TABLE's own row for this mark — proves
//     the mark is a real, documented type, never a placed unit (see
//     observationSchemaV1.ts's own "LOCATION mode never asserts a resolved
//     quantity" discipline — a schedule_entry has no count of its own either).
//   - "dimension_annotation" / "level_annotation": drawing annotations, not
//     occurrences of the annotated element itself.
// Everything else (opening, wall_or_partition, room_or_space,
// structural_element, fixture, equipment, plan_symbol, finish_or_material,
// other_construction_fact) is a real candidate "this is one physical W1".
const PHYSICAL_OBSERVATION_TYPES: ReadonlySet<ObservationType> = new Set([
  "opening", "wall_or_partition", "room_or_space", "structural_element",
  "fixture", "equipment", "plan_symbol", "finish_or_material", "other_construction_fact",
]);

/** Same Type -> Instances mapping as instancesForType, narrowed to
 *  PHYSICAL_OBSERVATION_TYPES — this is the count reconciliation should use
 *  ("how many of this type are actually placed on the drawing"), never
 *  instancesForType's own unfiltered output (which would double-count a
 *  schedule table row as if it were a placed unit). */
export function physicalInstancesForType(
  item: { key: string; dimension?: string; specification?: string },
  observations: LocationObservation[],
): TypeInstance[] {
  return instancesForType(item, observations).filter((i) => PHYSICAL_OBSERVATION_TYPES.has(i.observation.observationType));
}

/** True when at least one `schedule_entry` observation shares this type's
 *  mark — i.e. a schedule table on this drawing documents this mark at all.
 *  This is presence only, never a count (LOCATION mode asserts no quantity
 *  for a schedule_entry) — see instanceReconciliation.ts for how this is
 *  used as an independent-source signal, not a number to reconcile against. */
export function hasScheduleEntryForType(
  item: { key: string },
  observations: LocationObservation[],
): boolean {
  const key = norm(item.key);
  if (!key) return false;
  return observations.some((o) => norm(o.mark) === key && o.observationType === "schedule_entry");
}
