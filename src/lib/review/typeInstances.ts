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
 *  matches, so callers can treat "no instances" uniformly. */
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
