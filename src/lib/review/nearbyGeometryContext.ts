// NEARBY GEOMETRY CONTEXT — Click-to-Identify's one consumer of Layer A's
// already-extracted page text (pdfGeometry.ts). This module adds nothing to
// what Layer A extracts and invents nothing of its own: it is a pure
// proximity filter over an already-computed text-run list, used to give an
// identification request a short list of nearby printed text as context.
// pdfGeometry.ts's own rule applies here too — this module may say "there is
// text reading '...' near this point", never "this is a window."
//
// A NEW FILE rather than an addition to pdfGeometry.ts/geometryFusion.ts, so
// those modules carry zero diff from this feature.
//
// PURE: no network, no Supabase, no React — same isolation discipline as
// pdfGeometry.ts/geometryFusion.ts.

import type { ExtractedTextRun } from "./pdfGeometry";

export interface NearbyContext {
  /** Nearby text runs' own text, closest first, capped to a small count so
   *  an AI prompt built from this stays small. Empty when nothing is within
   *  radius — never padded with unrelated text to "fill" the list. */
  nearbyText: string[];
}

const DEFAULT_RADIUS = 150; // page-space units — same space as EvidenceBox.bbox
const MAX_RESULTS = 12;

/** Distance from `point` to the NEAREST point on a text run's own bbox (not
 *  just its origin) — so a click anywhere over a wide run still reads as
 *  "at" it, not just at its top-left corner. */
function distanceToRun(point: { x: number; y: number }, run: ExtractedTextRun): number {
  const cx = Math.max(run.x, Math.min(point.x, run.x + run.width));
  const cy = Math.max(run.y, Math.min(point.y, run.y + run.height));
  return Math.hypot(point.x - cx, point.y - cy);
}

/**
 * Find text runs within `radius` page-space units of `point`, nearest first.
 * Pure — takes an already-extracted text-run list (e.g. from
 * extractPageGeometry) rather than extracting anything itself.
 */
export function findNearbyContext(
  point: { x: number; y: number },
  textRuns: ExtractedTextRun[],
  radius: number = DEFAULT_RADIUS,
): NearbyContext {
  const withDistance = textRuns
    .map((run) => ({ run, distance: distanceToRun(point, run) }))
    .filter((r) => r.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_RESULTS);
  return { nearbyText: withDistance.map((r) => r.run.text.trim()).filter((t) => t.length > 0) };
}
