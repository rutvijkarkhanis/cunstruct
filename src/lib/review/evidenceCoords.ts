// EVIDENCE COORDINATE TRANSFORMS — page space → rendered pixels.
//
// Analysis bboxes are given in the drawing PAGE'S OWN coordinate space (e.g. the
// pixel size of the rendered page image, or PDF user units). The viewer displays
// the page at some other size (fit-to-width, zoom). These pure functions map a
// bbox to CSS pixels for an overlay, so we never assume raw coordinates equal
// browser pixels. If no page size or no boxes are available, callers fall back to
// a plain page reference — nothing is fabricated here.

import type { EvidenceBox } from "./analysisSchemaV1";

export interface Size { width: number; height: number }
export interface Rect { left: number; top: number; width: number; height: number }

/** Screen-pixel rect for one bbox, given the page's coordinate space and the
 *  rendered display size. Returns null if inputs are degenerate. */
export function transformBox(box: EvidenceBox, pageSize: Size, renderedSize: Size): Rect | null {
  if (!pageSize.width || !pageSize.height || !renderedSize.width || !renderedSize.height) return null;
  const sx = renderedSize.width / pageSize.width;
  const sy = renderedSize.height / pageSize.height;
  const [x1, y1, x2, y2] = box.bbox;
  return {
    left: x1 * sx,
    top: y1 * sy,
    width: (x2 - x1) * sx,
    height: (y2 - y1) * sy,
  };
}

/** Transform many boxes, dropping any that can't be placed. */
export function transformBoxes(boxes: EvidenceBox[], pageSize: Size, renderedSize: Size): Rect[] {
  return boxes.map((b) => transformBox(b, pageSize, renderedSize)).filter((r): r is Rect => r != null);
}

/** Union bbox over several boxes, in PAGE space. Null when there are no boxes. */
export function unionBox(boxes: EvidenceBox[]): [number, number, number, number] | null {
  if (!boxes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.bbox[0]); y1 = Math.min(y1, b.bbox[1]);
    x2 = Math.max(x2, b.bbox[2]); y2 = Math.max(y2, b.bbox[3]);
  }
  return [x1, y1, x2, y2];
}

export interface FitToEvidenceResult {
  /** Scale multiplier relative to `pageBase` (the PDF's own scale-1 size). */
  scale: number;
}

/**
 * The ONE canonical "fit to evidence" calculation. Computes the scale (relative
 * to `pageBase`, the PDF's own scale-1 size) so the union of `boxes` fills
 * roughly `fillFraction` of `viewportWidth` (CSS pixels). `space` is the
 * coordinate space the bboxes are actually given in — ordinarily the same as
 * `pageBase`, but can differ when the analysis declares its own `pageSize`
 * (see resolvePageSpace below). Centering/scrolling is inherently a DOM
 * concern (needs the container element and a post-resize tick) and stays with
 * the caller; this function only decides the scale. Returns null when it
 * can't be computed (no boxes, degenerate sizes) so the caller keeps the
 * current view rather than guessing.
 */
export function fitToEvidence(
  boxes: EvidenceBox[],
  space: Size,
  pageBase: Size,
  viewportWidth: number,
  opts: { fillFraction?: number; minScale?: number; maxScale?: number } = {},
): FitToEvidenceResult | null {
  const { fillFraction = 0.8, minScale = 0.2, maxScale = 8 } = opts;
  const u = unionBox(boxes);
  if (!u || !space.width || !pageBase.width || !viewportWidth) return null;
  const uw = Math.max(1, u[2] - u[0]);
  const scale = Math.max(minScale, Math.min(maxScale, (viewportWidth * fillFraction * space.width) / (uw * pageBase.width)));
  return { scale };
}

/** Does this analysis item carry precise, placeable evidence? Drives the honest
 *  "highlight available" vs "page reference only" fallback in the viewer. */
export function hasPlaceableEvidence(source?: { evidence?: EvidenceBox[] }): boolean {
  return (source?.evidence?.length ?? 0) > 0;
}

// ── Coordinate convention (single source of truth) ───────────────────────────
//
// Analysis bboxes use a TOP-LEFT origin (x right, y down) in a page coordinate
// space. That space is, in priority order:
//   1. `source.pageSize` when the analysis explicitly declares it (authoritative);
//   2. otherwise the PDF page's own scale-1 size (the pdf.js viewport at scale 1).
//
// This is the ONE place the convention lives. If the analysis pipeline later
// adopts a different convention (e.g. bottom-left PDF user units), change it here
// and every overlay follows. We never guess a page size when neither source is
// available — the caller then falls back to a non-positional evidence state.
//
// ROTATION: a PDF page can declare its own `/Rotate` (commonly 90/270 for a
// landscape schedule or detail sheet embedded in an otherwise-portrait set).
// pdf.js's `getViewport({ scale })` already returns the page's RENDERED size —
// width/height swapped, rotation baked into the render transform — so what
// this module calls "the PDF page's own scale-1 size" is ALWAYS the rotated,
// as-displayed size, never the raw/unrotated content-stream size. The
// contract for every bbox and every declared `pageSize` is therefore: measure
// in that same rendered space (what you see when the page is opened normally
// — top-left origin of the page AS DISPLAYED), never in the page's raw
// content-stream coordinates. A bbox measured in the wrong (unrotated) space
// for a 90°/270°-rotated page will have its axes swapped once transformed
// against the rotated `pageSize` — see `detectPageSizeMismatch` below for a
// heuristic that catches exactly this.

export interface EvidenceSource {
  pageSize?: { width: number; height: number };
}

/**
 * Resolve the page coordinate space for an item's bboxes. Returns the declared
 * `pageSize`, else the supplied PDF page size, else null (unknown — do not guess).
 */
export function resolvePageSpace(
  source: EvidenceSource | undefined,
  pdfPageSize?: Size | null,
): Size | null {
  if (source?.pageSize && source.pageSize.width > 0 && source.pageSize.height > 0) {
    return { width: source.pageSize.width, height: source.pageSize.height };
  }
  if (pdfPageSize && pdfPageSize.width > 0 && pdfPageSize.height > 0) {
    return { width: pdfPageSize.width, height: pdfPageSize.height };
  }
  return null;
}

/**
 * Heuristic rotation-mismatch detector: a declared `pageSize` whose aspect
 * ratio is the INVERSE of the PDF's own actual (rendered, rotation-applied)
 * page size is exactly what you get when bboxes were measured in the page's
 * raw/unrotated content-stream space instead of the rendered space the
 * convention above requires — the width and height are swapped. This can't
 * prove a rotation problem (a declared size can simply be wrong for other
 * reasons), so it only ever returns a WARNING, never blocks or auto-corrects
 * anything — nothing here guesses a "fixed" coordinate. Returns null when
 * either size is unknown or when the aspect ratios are consistent.
 */
export function detectPageSizeMismatch(declared: Size | undefined | null, actual: Size | undefined | null): string | null {
  if (!declared || !actual || !declared.width || !declared.height || !actual.width || !actual.height) return null;
  const declaredRatio = declared.width / declared.height;
  const actualRatio = actual.width / actual.height;
  const closeTo = (a: number, b: number, tolerance = 0.08) => Math.abs(a - b) / b <= tolerance;
  if (closeTo(declaredRatio, actualRatio)) return null; // same orientation family — fine, even if sizes differ.
  if (closeTo(declaredRatio, 1 / actualRatio)) {
    return `Declared page size (${declared.width}×${declared.height}) looks rotated 90° relative to the PDF's actual rendered page (${actual.width}×${actual.height}) — evidence coordinates may be on the wrong axis. Re-measure in the page's rendered (as-displayed) space.`;
  }
  return null;
}

/** Get evidence boxes for a specific claim. Evidence without a claim is treated as "general". */
export function getEvidenceForClaim(boxes: EvidenceBox[], claimType: string): EvidenceBox[] {
  return boxes.filter((b) => (b.claim ?? "general") === claimType);
}

/** Check if evidence exists for a specific claim. */
export function hasEvidenceForClaim(boxes: EvidenceBox[], claimType: string): boolean {
  return boxes.some((b) => (b.claim ?? "general") === claimType);
}
