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

export interface FitResult {
  /** Multiplier to apply to a fit-to-width base so the evidence fills ~viewport. */
  zoom: number;
  /** Center of the evidence in PAGE space (for scroll/pan). */
  centerX: number;
  centerY: number;
}

/**
 * Compute a zoom + center that frames all evidence boxes within a viewport, with
 * padding. `pageSize` is the bbox coordinate space; `viewport` is the visible
 * area in the same units at zoom 1. Returns null when it can't be computed (no
 * boxes / degenerate sizes) so the caller keeps the current view rather than
 * guessing.
 */
export function fitToEvidence(
  boxes: EvidenceBox[],
  pageSize: Size,
  viewport: Size,
  paddingFactor = 1.4,
  maxZoom = 6,
): FitResult | null {
  const u = unionBox(boxes);
  if (!u || !pageSize.width || !viewport.width || !viewport.height) return null;
  const [x1, y1, x2, y2] = u;
  const w = Math.max(1, (x2 - x1) * paddingFactor);
  const h = Math.max(1, (y2 - y1) * paddingFactor);
  const zoom = Math.min(maxZoom, Math.max(1, Math.min(viewport.width / w, viewport.height / h)));
  return { zoom, centerX: (x1 + x2) / 2, centerY: (y1 + y2) / 2 };
}

/** Does this analysis item carry precise, placeable evidence? Drives the honest
 *  "highlight available" vs "page reference only" fallback in the viewer. */
export function hasPlaceableEvidence(source?: { evidence?: EvidenceBox[] }): boolean {
  return (source?.evidence?.length ?? 0) > 0;
}
