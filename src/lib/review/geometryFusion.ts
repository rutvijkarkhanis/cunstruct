// GEOMETRY FUSION — Layer C: deterministically connects real PDF document
// geometry (Layer A, pdfGeometry.ts) to real AI semantic evidence (Layer B,
// the existing AnalysisItemV1/ObservationV1 evidence bboxes) into truthful,
// provenance-tagged drawable geometry.
//
// PURE. No network, no Supabase, no React, no browser globals. Same inputs
// always produce the same output.
//
// WHAT THIS MODULE DOES NOT DO: it never fabricates a shape, never merges
// several unrelated PDF shapes into one object because they happen to
// overlap, and never fabricates a sibling instance for an item/observation
// that has no real evidence of its own. Every geometry it returns traces
// back to either a real PDF vector shape or a real AI/LOCATION evidence box
// — nothing in between is invented.
//
// FUSION CASES (see the architecture proposal):
//   A. PDF geometry + AI evidence, one unambiguous spatial match -> HYBRID,
//      using the PDF shape's real points/type with the AI's semantic
//      association carried by the CALLER (this module returns geometry
//      only — a label/category is drawingMarkers.ts's concern, same as
//      today's bbox-only markers).
//   B. AI evidence with no matching PDF shape -> the existing bbox, tagged
//      EXISTING_EVIDENCE/LOCATION. No polygon is invented.
//   C. A PDF shape matches no evidence at all -> exposed via
//      `unmatchedPdfShapes()` as source:"PDF", no semantic tag. The caller
//      decides whether/how to show "document geometry only" detections.
//   D. (Scaffolded — the current production AI contract is bbox-only, so
//      this is NOT reachable from real data today; see
//      `aiSuppliedGeometry` below.) A future AI-supplied geometry conflicts
//      with the matched PDF geometry -> CONFLICT, keeping the deterministic
//      PDF shape as the returned geometry and attaching the AI's version as
//      `conflictingAlternate` — never silently picking the AI's geometry.
//   E. A real LOCATION observation's own evidence -> call this function once
//      PER OBSERVATION (exactly how drawingMarkers.ts already builds one
//      marker per observation) so an item with 3 occurrences but only 1 real
//      LOCATION record only ever gets fused/real geometry for that one; the
//      other two are never invented here or anywhere upstream.

import type { DrawingGeometry, GeometryPageSize, GeometrySource } from "./drawingGeometry";
import { geometryFromBbox } from "./drawingGeometry";

// ── Named match thresholds (no magic numbers scattered through the code) ──

/**
 * Minimum Intersection-over-Union between a candidate PDF shape's bbox and
 * an AI evidence bbox for them to be considered the same physical object.
 * 0.5 is conservative: it requires the two boxes to genuinely overlap most
 * of each other's area, not merely touch — a looser threshold would start
 * matching an evidence box to an unrelated nearby shape (e.g. a neighboring
 * wall segment), which is exactly the false-precision failure mode this
 * phase must avoid.
 */
export const PDF_GEOMETRY_MATCH_IOU_THRESHOLD = 0.5;

/**
 * Minimum "containment ratio" — the intersection area as a fraction of the
 * SMALLER of the two boxes' own areas — for a match, independent of IoU.
 * This exists because IoU alone penalizes a real match where one box is
 * legitimately much larger than the other (e.g. a precise AI evidence crop
 * fully inside a PDF shape's slightly larger bbox, or vice versa) — IoU
 * would be low even though one box is almost entirely inside the other.
 * 0.85 is conservative: it requires near-total containment, not partial
 * overlap, before accepting that relationship as a match.
 */
export const PDF_GEOMETRY_CONTAINMENT_THRESHOLD = 0.85;

type Bbox = [number, number, number, number];

function bboxArea(b: Bbox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function bboxIntersectionArea(a: Bbox, b: Bbox): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/** Intersection-over-Union of two bboxes, in [0,1]. */
export function bboxIoU(a: Bbox, b: Bbox): number {
  const inter = bboxIntersectionArea(a, b);
  const union = bboxArea(a) + bboxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** Containment ratio: the intersection area as a fraction of the SMALLER of
 *  the two boxes' own areas, in [0,1]. 1.0 means the smaller box is
 *  entirely inside the larger one. */
export function bboxContainmentRatio(a: Bbox, b: Bbox): number {
  const areaA = bboxArea(a);
  const areaB = bboxArea(b);
  if (areaA <= 0 || areaB <= 0) return 0;
  const inter = bboxIntersectionArea(a, b);
  return inter / Math.min(areaA, areaB);
}

/** The one deterministic match test every caller uses — IoU OR containment
 *  clears its threshold. Exported so fixtures/tests can probe boundary
 *  conditions directly against the real decision function, not a copy of it. */
export function isGeometryMatch(a: Bbox, b: Bbox): boolean {
  return bboxIoU(a, b) >= PDF_GEOMETRY_MATCH_IOU_THRESHOLD || bboxContainmentRatio(a, b) >= PDF_GEOMETRY_CONTAINMENT_THRESHOLD;
}

/** One piece of AI-supplied (or LOCATION-supplied) evidence to fuse against
 *  real PDF geometry — the minimal shape every EvidenceBox already has. */
export interface EvidenceLocation {
  page: number;
  bbox: Bbox;
  pageSize?: GeometryPageSize;
}

export type FusionCase = "HYBRID" | "EXISTING_EVIDENCE" | "LOCATION" | "CONFLICT";

export interface FusionResult {
  geometry: DrawingGeometry;
  case: FusionCase;
  /** True when more than one PDF shape matched above threshold — the
   *  richer geometry was deliberately NOT used (ambiguous which one is the
   *  real object), and the bbox fallback was kept instead. */
  ambiguous: boolean;
  matchedShapeCount: number;
}

/** Real PDF shapes on the SAME page as `evidence` whose bbox matches it
 *  deterministically. Never considers shapes on a different page — a
 *  cross-page "match" would be a coordinate-system error, not a detection. */
export function findMatchingPdfShapes(pdfShapes: DrawingGeometry[], evidence: EvidenceLocation): DrawingGeometry[] {
  return pdfShapes.filter((shape) => shape.page === evidence.page && isGeometryMatch(shape.bbox, evidence.bbox));
}

/**
 * Fuse one piece of AI/LOCATION evidence against the real PDF shapes
 * extracted for its page. `origin` says what kind of evidence this is
 * (EXISTING_EVIDENCE for an AnalysisItemV1's own evidence box, LOCATION for
 * an ObservationV1's) — it becomes the fallback geometry's `source` tag
 * when no PDF match exists.
 *
 * `aiSuppliedGeometry` is Case D's scaffolded input: a hypothetical future
 * AI-supplied real geometry (not a bbox) for this exact evidence location.
 * The current production AI contract cannot supply this (bbox-only — see
 * supabase/functions/_shared/openaiSchema.ts), so in every real call today
 * this parameter is simply omitted and Case D never triggers. It exists so
 * the conflict behavior is implemented and tested NOW, not designed later
 * as a breaking change when/if the AI contract is ever extended.
 */
export function fuseEvidenceGeometry(
  pdfShapes: DrawingGeometry[],
  evidence: EvidenceLocation,
  origin: "EXISTING_EVIDENCE" | "LOCATION",
  aiSuppliedGeometry?: DrawingGeometry,
): FusionResult {
  const candidates = findMatchingPdfShapes(pdfShapes, evidence);

  // Case D (scaffolded, not reachable from today's production AI contract):
  // exactly one real PDF shape matched this evidence, AND a (hypothetical)
  // AI-supplied geometry for the same evidence disagrees with that PDF
  // shape's own bbox. Never silently pick one — keep the deterministic PDF
  // geometry as the returned shape, flag the conflict, and attach the AI's
  // version for the Review layer to surface.
  if (aiSuppliedGeometry && candidates.length === 1 && !isGeometryMatch(aiSuppliedGeometry.bbox, candidates[0].bbox)) {
    const pdfGeometry = candidates[0];
    return {
      geometry: {
        ...pdfGeometry,
        conflict: true,
        conflictingAlternate: aiSuppliedGeometry,
      },
      case: "CONFLICT",
      ambiguous: false,
      matchedShapeCount: 1,
    };
  }

  if (candidates.length === 1) {
    const matched = candidates[0];
    return {
      geometry: { ...matched, source: "HYBRID" as GeometrySource },
      case: "HYBRID",
      ambiguous: false,
      matchedShapeCount: 1,
    };
  }

  // Zero matches, or more than one (ambiguous which shape is the real
  // object) — the bbox fallback either way. `ambiguousMatch` distinguishes
  // "nothing matched" from "something matched but we can't tell which".
  const fallback = geometryFromBbox(evidence.bbox, evidence.page, origin, { pageSize: evidence.pageSize });
  return {
    geometry: candidates.length > 1 ? { ...fallback, ambiguousMatch: true } : fallback,
    case: origin,
    ambiguous: candidates.length > 1,
    matchedShapeCount: candidates.length,
  };
}

/**
 * Case C — real PDF shapes that matched NO evidence at all on their page:
 * genuine document geometry, never assigned a semantic type. The caller
 * decides whether/how to render these (e.g. a quiet "unclassified
 * detections" layer) — this function only identifies them honestly.
 */
export function unmatchedPdfShapes(pdfShapes: DrawingGeometry[], evidenceList: EvidenceLocation[]): DrawingGeometry[] {
  return pdfShapes.filter(
    (shape) => !evidenceList.some((ev) => ev.page === shape.page && isGeometryMatch(shape.bbox, ev.bbox)),
  );
}
