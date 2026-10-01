// FIND SIMILAR — LOCATION enrichment (M5).
//
// Purely additive, read-only, optional: annotates an already-returned,
// AUTHORITATIVE AI match with whether a LOCATION observation already
// recorded under the SAME mark exists for this document. Find Similar's own
// match list is never a prerequisite on this, never gated by it, and never
// altered by it — no match is ever added, removed, reordered, or merged
// into another because of anything in this file. See the Find Similar M5
// investigation: there is no existing deterministic link from a generic
// AI-returned label (e.g. "Door") to a specific LOCATION mark (e.g. "D1")
// beyond plain string identity — this module uses exactly that, nothing
// richer, and reports when it finds nothing just as honestly as when it
// finds something.
//
// Reuses the EXACT SAME exact-string, case-insensitive/trimmed equality
// `instancesForType` (typeInstances.ts) already uses to connect a BOQ
// item's key to a LOCATION observation's `mark` — applied here to a Find
// Similar match's own `label` instead of a BOQ item's `key`. This is not a
// new heuristic and not a reinterpretation of that matching as a visual or
// geometric similarity: it is the identical plain-string-identity rule,
// applied to a structurally analogous pair of strings. `typeInstances.ts`
// itself is untouched — this is a new, independent module, not an edit to
// it, so that file carries zero diff from this feature (the norm() helper
// below is intentionally re-declared, not imported, since it isn't
// exported there and exporting a private helper isn't worth widening that
// file's surface for one three-line function).
//
// No page/bbox coordinates are used anywhere in this file: the Find Similar
// M5 investigation found no safe way to turn bbox proximity into a
// deterministic "same occurrence" signal without inventing a new geometric-
// similarity heuristic, which this phase is explicitly scoped to avoid.

import type { LocationObservation } from "./locationObservations";
import type { SimilarMatchV1 } from "./findSimilarSchemaV1";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface LocationEnrichment {
  /** The real, stored mark this match's label exactly equals (case-
   *  insensitive, trimmed) — never a guessed or partial match. */
  mark: string;
  /** How many LOCATION observations already exist under this mark.
   *  Multiple existing observations sharing one mark is normal (it's how
   *  several physical instances of one type are represented) — this module
   *  never picks one specific observation to "be" this match, so an
   *  ambiguous (>1) count is reported honestly, never resolved by guessing
   *  which observation corresponds to this match. */
  count: number;
}

/**
 * One enrichment entry per match, in the SAME order as `matches` — index i
 * of the result always describes `matches[i]`, `null` when no exact mark
 * match exists for it. The returned array has exactly `matches.length`
 * entries: an empty `matches` input always returns `[]`, so LOCATION data
 * can never turn an honest empty AI result into a non-empty one, and a
 * LOCATION observation with no corresponding match is never surfaced at
 * all (this function only ever iterates `matches`, never `observations`).
 */
export function enrichMatchesWithLocation(
  matches: SimilarMatchV1[],
  observations: LocationObservation[],
): (LocationEnrichment | null)[] {
  return matches.map((match) => {
    const key = norm(match.label);
    if (!key) return null;
    const sameMark = observations.filter((o) => norm(o.mark) === key);
    if (sameMark.length === 0) return null;
    return { mark: sameMark[0].mark as string, count: sameMark.length };
  });
}
