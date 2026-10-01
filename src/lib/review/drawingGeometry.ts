// DRAWING GEOMETRY — the normalized geometry model that extends (never
// replaces) the existing bbox-only evidence model.
//
// PURE TYPES AND PURE HELPERS ONLY. No pdf.js, no React, no I/O.
//
// Why this exists: `EvidenceBox` (analysisSchemaV1.ts) and the markers built
// from it (drawingMarkers.ts) can only ever represent an axis-aligned
// rectangle, because that's the only shape the AI contract can emit today
// (see supabase/functions/_shared/openaiSchema.ts — bbox: number[4], nothing
// richer). `DrawingGeometry` is a strictly additive supplement: a detection
// MAY also carry one of these when real, deterministic shape data exists
// (either straight from the PDF's own vector content, or a genuine LOCATION
// observation's own evidence) — it never substitutes for or removes the
// bbox a consumer already relies on.
//
// COORDINATE CONVENTION — deliberately the SAME one evidenceCoords.ts already
// defines as the one source of truth: top-left origin, x right, y down, in
// the page's AS-DISPLAYED (already-rotated) space. `points`/`bbox` here live
// in exactly that space, at scale 1 (the PDF's own native page size, or the
// analysis's declared `pageSize` — same resolvePageSpace() convention). This
// module introduces NO second coordinate system; converting raw PDF content-
// stream space (bottom-left origin, y-up, unrotated) into this space is
// pdfGeometry.ts's job, not this file's.
//
// NO FALSE PRECISION: `confidenceTier` describes how trustworthy the GEOMETRY
// itself is, never a measured accuracy number. "deterministic" means "read
// directly off real PDF vector data or a real LOCATION observation" — not
// "100% correct", just "not invented". It is never derived from or equated
// with an AI confidence score.

/** The shape a piece of geometry actually is. `"bbox"` is the universal
 *  fallback every existing EvidenceBox already represents; everything else
 *  is additional precision only present when real source data supports it. */
export type GeometryType = "point" | "line" | "polyline" | "polygon" | "rectangle" | "bbox" | "path";

/**
 * Where this geometry came from — kept distinct from `confidenceTier`
 * (provenance answers "what produced this shape", confidence answers "how
 * much should a reviewer trust it", and the two are correlated but not
 * identical: e.g. a LOCATION observation's bbox is "deterministic" even
 * though its *source* is "LOCATION", not "PDF").
 *
 *  - "PDF"              — pure document geometry extracted from the PDF's own
 *                          vector content, with NO semantic association (no
 *                          AI item/observation matched it). Case C.
 *  - "AI"                — scaffolded for a future AI contract that emits real
 *                          geometry directly (not just a bbox). The CURRENT
 *                          production contract cannot do this (bbox-only) —
 *                          this tag exists so Case D (conflict) has something
 *                          to be IN conflict with, and is not reachable from
 *                          today's real data. See geometryFusion.ts Case D.
 *  - "HYBRID"            — a real PDF shape that a real AI evidence bbox
 *                          overlaps above the match threshold: the physical
 *                          geometry comes from the PDF, the semantic label
 *                          comes from the AI item. Case A.
 *  - "EXISTING_EVIDENCE" — the AI's own evidence bbox, unchanged, used as-is
 *                          because no matching PDF shape was found. Case B.
 *  - "LOCATION"          — a real LOCATION observation's own evidence bbox,
 *                          used as-is (or upgraded to HYBRID-via-LOCATION when
 *                          a matching PDF shape exists — still tagged by
 *                          origin here). Case E.
 */
export type GeometrySource = "PDF" | "AI" | "HYBRID" | "EXISTING_EVIDENCE" | "LOCATION";

/** How much a geometry's SHAPE (not any AI claim) should be trusted.
 *  "deterministic" is reserved for geometry read directly from real PDF
 *  vector data or a real LOCATION/evidence bbox — never assigned to anything
 *  inferred or matched. "high"/"medium"/"low" are reserved for a future
 *  fuzzy-matched or AI-supplied geometry; nothing in this phase's fusion
 *  logic currently emits them (see geometryFusion.ts) — they exist so the
 *  type is honest about degrees that aren't deterministic once that data
 *  exists, rather than being added later as a breaking change. */
export type GeometryConfidenceTier = "deterministic" | "high" | "medium" | "low";

export interface GeometryPageSize {
  width: number;
  height: number;
}

export interface DrawingGeometry {
  type: GeometryType;
  /** 1-based page number, same convention as EvidenceBox.page. */
  page: number;
  /** Vertex list in page space (top-left origin, y-down, as-displayed),
   *  scale 1. Length depends on `type`:
   *    point     -> 1 point
   *    line      -> 2 points
   *    polyline  -> >=2 points, open (no implied closing edge)
   *    polygon   -> >=3 points, implicitly closed
   *    rectangle -> 2 points: [top-left, bottom-right] (always axis-aligned —
   *                 a rotated rectangle is a polygon, not this type)
   *    bbox      -> 2 points: [top-left, bottom-right] (identical shape to
   *                 rectangle; kept as a separate tag so callers can tell
   *                 "this IS a real rectangle shape in the source" apart
   *                 from "this is just the fallback bbox of something else")
   *    path      -> control points of one or more cubic Bezier segments,
   *                 flattened as [start, c1, c2, end, c1, c2, end, ...] —
   *                 i.e. 1 + 3*N points for N curve segments. Consumers that
   *                 can't render a true curve may fall back to `bbox`. */
  points: [number, number][];
  /** Axis-aligned bounding box, ALWAYS present regardless of `type` — the
   *  universal fallback/hit-test rect every consumer can rely on even if it
   *  doesn't understand `type` or `points`. [x1,y1,x2,y2], same convention as
   *  EvidenceBox.bbox. Never approximated from `points` by a renderer at
   *  display time — computed once, here, from the real source geometry (see
   *  `boundingBoxOfPoints` below) so it's never out of sync with `points`. */
  bbox: [number, number, number, number];
  source: GeometrySource;
  confidenceTier: GeometryConfidenceTier;
  /** Same optional-override convention as EvidenceBox/AnalysisSource: the
   *  coordinate space `points`/`bbox` are measured in, when it differs from
   *  the PDF's own scale-1 rendered size. Absent means "the PDF's own size". */
  pageSize?: GeometryPageSize;
  /**
   * True only when geometryFusion.ts found a real (currently scaffolded,
   * since the production AI contract is bbox-only — see geometryFusion.ts
   * Case D) AI-supplied geometry that disagrees with this deterministic PDF
   * geometry at the same evidence location. Per the "never silently accept
   * AI geometry" rule, `conflict: true` NEVER changes which shape this
   * object's own `type`/`points`/`bbox` describe — it only flags that an
   * alternative exists, in `conflictingAlternate`, for the Review layer to
   * surface. Absent (not `false`) when no conflict was ever evaluated.
   */
  conflict?: boolean;
  /** The alternative geometry that conflicted with this one. Present only
   *  when `conflict` is true. */
  conflictingAlternate?: DrawingGeometry;
  /**
   * True only when more than one real PDF shape matched an evidence
   * location above the fusion thresholds — geometryFusion.ts deliberately
   * did NOT upgrade to one of them (that would be guessing which one is
   * "the" object) and kept this as a bbox fallback instead. Absent (not
   * `false`) when the match was unambiguous or no PDF shapes were
   * considered at all.
   */
  ambiguousMatch?: boolean;
}

/** Pure helper: the axis-aligned bbox that exactly contains every point.
 *  Never invents a box for an empty list — callers must guarantee at least
 *  one point (every `DrawingGeometry` constructor below does). */
export function boundingBoxOfPoints(points: [number, number][]): [number, number, number, number] {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of points) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return [x1, y1, x2, y2];
}

/** Build a `DrawingGeometry` from an EvidenceBox-shaped bbox — the universal
 *  fallback constructor every fusion case that doesn't have real shape data
 *  (Case B, and Case E without a PDF match) uses, so "wrap an existing bbox
 *  as geometry" has exactly one implementation. */
export function geometryFromBbox(
  bbox: [number, number, number, number],
  page: number,
  source: GeometrySource,
  opts: { pageSize?: GeometryPageSize; confidenceTier?: GeometryConfidenceTier } = {},
): DrawingGeometry {
  const [x1, y1, x2, y2] = bbox;
  return {
    type: "bbox",
    page,
    points: [[x1, y1], [x2, y2]],
    bbox,
    source,
    confidenceTier: opts.confidenceTier ?? "deterministic",
    pageSize: opts.pageSize,
  };
}
