// PDF GEOMETRY — Layer A: deterministic extraction of real vector shapes and
// text runs from a PDF page's own content stream.
//
// WHAT THIS MODULE IS ALLOWED TO SAY: "there is a rectangle/polygon/path/line
// here, at these coordinates" and "there is text reading '...' at this
// position". WHAT IT MUST NEVER SAY: "this is a window" / "this is a door" /
// "this is a column" — or any other architectural meaning. Semantic
// interpretation is exclusively the AI layer's job (analysisSchemaV1.ts /
// observationSchemaV1.ts); geometryFusion.ts is the ONLY place that connects
// the two, and only when real evidence supports the connection.
//
// ISOLATED / DETERMINISTIC: no network, no Supabase, no React, no browser
// globals beyond what pdf.js itself needs. Callers pass an already-loaded
// `PDFPageProxy` (document loading / worker setup stays in
// PdfEvidenceViewer.tsx, which already owns that) — this module only reads
// from it. Given the same page object, this always returns the same result;
// there is no hidden state.
//
// COORDINATE CONVENTION: raw pdf.js operator/text coordinates are in the
// PDF's own content-stream space — bottom-left origin, y-up, UNROTATED,
// regardless of the page's declared /Rotate (verified empirically: a
// rectangle drawn at the same content-stream coordinates reports identical
// raw coordinates whether the page declares /Rotate 0 or /Rotate 90 — only
// the VIEWPORT's rendering transform changes). That is NOT the coordinate
// space the rest of Cunstruct uses (see evidenceCoords.ts: top-left origin,
// y-down, AS-DISPLAYED/rotated, matching the page's `getViewport({scale:1})`
// size). Every point this module returns is already converted into that
// second (existing, canonical) space via `PageViewport.convertToViewportPoint`
// — pdf.js's own rotation-aware transform, not a reimplementation — so
// nothing downstream needs to know raw PDF space exists.
//
// VECTOR VS RASTER: a scanned/raster page's content stream contains only
// `paintImageXObject` (image placement) — no path or text operators at all.
// This module does NOT attempt OCR or shape detection on raster content: a
// page with no extractable vector shapes AND no extractable text returns
// `geometryAvailable: false`, honestly, rather than fabricating anything.

import type { PDFPageProxy } from "pdfjs-dist";
import { OPS } from "pdfjs-dist";
import type { DrawingGeometry, GeometryPageSize, GeometryType } from "./drawingGeometry";
import { boundingBoxOfPoints } from "./drawingGeometry";

export interface ExtractedTextRun {
  page: number;
  text: string;
  /** Baseline origin point, already converted to page space (top-left
   *  origin, y-down, as-displayed) — the same space DrawingGeometry uses. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageGeometryExtraction {
  page: number;
  /** The page's own scale-1, as-displayed size (rotation already applied) —
   *  identical in meaning to `pageBase` in PdfEvidenceViewer.tsx and to what
   *  evidenceCoords.resolvePageSpace falls back to. */
  pageSize: GeometryPageSize;
  /** False only when NEITHER a vector shape NOR a text run could be
   *  extracted — the honest signal that this page is raster/scanned (or
   *  blank) and Layer A has nothing deterministic to offer for it. Never set
   *  true "optimistically" — it is derived, not asserted, from the actual
   *  extraction result below. */
  geometryAvailable: boolean;
  /** Every shape is source:"PDF", confidenceTier:"deterministic" — Layer A
   *  assigns no semantic type and no non-deterministic confidence. */
  shapes: DrawingGeometry[];
  textRuns: ExtractedTextRun[];
}

// Sub-operators that can appear inside a single `constructPath` operator's
// first argument (verified empirically via getOperatorList() against a
// hand-built fixture containing each of these). `rectangle` is its own
// sub-op (pdf.js special-cases the PDF `re` operator rather than emitting
// 4 lineTo's), which is exactly how a real rectangle is told apart from a
// polygon that happens to have 4 corners.
const SUBOP_RECTANGLE = OPS.rectangle;
const SUBOP_MOVE_TO = OPS.moveTo;
const SUBOP_LINE_TO = OPS.lineTo;
const SUBOP_CURVE_TO = OPS.curveTo;
const SUBOP_CLOSE_PATH = OPS.closePath;

interface RawSubpath {
  /** true when a `closePath` sub-op was seen for this subpath — a polygon,
   *  not an open polyline. Rectangles are always closed by definition. */
  closed: boolean;
  /** true when any segment was a `curveTo` — a real Bezier path, not a
   *  straight-edged polyline/polygon. */
  hasCurve: boolean;
  isRectangle: boolean;
  /** Raw (unconverted) PDF-space points. For a curve segment, only the
   *  on-curve points (start/end) plus control points are recorded in the
   *  order pdf.js reports them, consistent with DrawingGeometry's documented
   *  `path` point layout (1 + 3*N points for N curve segments). */
  points: [number, number][];
}

/** Decode one `constructPath` operator's `[subOps, coords, minMax]` args
 *  (the shape pdf.js actually returns — verified empirically) into one or
 *  more subpaths. A single `constructPath` call can contain several
 *  disconnected subpaths (multiple `moveTo`s); each becomes its own
 *  `RawSubpath` so they are never merged into one shape that doesn't exist
 *  in the source. */
function decodeConstructPath(args: unknown): RawSubpath[] {
  if (!Array.isArray(args) || args.length < 2) return [];
  const subOps = args[0] as ArrayLike<number>;
  const coords = args[1] as ArrayLike<number>;
  const subpaths: RawSubpath[] = [];
  let current: RawSubpath | null = null;
  let coordIdx = 0;
  const nextPoint = (): [number, number] => {
    const x = coords[coordIdx];
    const y = coords[coordIdx + 1];
    coordIdx += 2;
    return [x, y];
  };

  for (let i = 0; i < subOps.length; i++) {
    const op = subOps[i];
    if (op === SUBOP_RECTANGLE) {
      // rectangle sub-op args are [x, y, width, height] in the coords stream.
      const x = coords[coordIdx];
      const y = coords[coordIdx + 1];
      const w = coords[coordIdx + 2];
      const h = coords[coordIdx + 3];
      coordIdx += 4;
      subpaths.push({
        closed: true,
        hasCurve: false,
        isRectangle: true,
        points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
      });
      current = null; // a rectangle sub-op is self-contained, never continued
    } else if (op === SUBOP_MOVE_TO) {
      if (current && current.points.length > 0) subpaths.push(current);
      current = { closed: false, hasCurve: false, isRectangle: false, points: [nextPoint()] };
    } else if (op === SUBOP_LINE_TO) {
      if (!current) current = { closed: false, hasCurve: false, isRectangle: false, points: [] };
      current.points.push(nextPoint());
    } else if (op === SUBOP_CURVE_TO) {
      if (!current) current = { closed: false, hasCurve: false, isRectangle: false, points: [] };
      const c1 = nextPoint();
      const c2 = nextPoint();
      const end = nextPoint();
      current.points.push(c1, c2, end);
      current.hasCurve = true;
    } else if (op === SUBOP_CLOSE_PATH) {
      if (current) current.closed = true;
    }
    // Any other sub-op (shouldn't occur inside constructPath per pdf.js's own
    // emitter) is skipped rather than guessed at.
  }
  if (current && current.points.length > 0) subpaths.push(current);
  return subpaths;
}

/** Classify one decoded subpath into the DrawingGeometry type it honestly
 *  is — never upgraded or downgraded beyond what the source data shows. */
function classifySubpath(sp: RawSubpath): GeometryType {
  if (sp.isRectangle) return "rectangle";
  if (sp.hasCurve) return "path";
  if (sp.points.length === 2 && !sp.closed) return "line";
  if (sp.closed && sp.points.length >= 3) return "polygon";
  return "polyline";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Viewport = { convertToViewportPoint(x: number, y: number): any[] };

function toPageSpace(points: [number, number][], viewport: Viewport): [number, number][] {
  return points.map(([x, y]) => {
    const [vx, vy] = viewport.convertToViewportPoint(x, y);
    return [vx, vy] as [number, number];
  });
}

/**
 * Extract deterministic shapes + text runs from one PDF page. Pure given its
 * input: calling this twice on the same page returns equal results.
 */
export async function extractPageGeometry(pdfPage: PDFPageProxy, pageNumber: number): Promise<PageGeometryExtraction> {
  const viewport = pdfPage.getViewport({ scale: 1 });
  const pageSize: GeometryPageSize = { width: viewport.width, height: viewport.height };

  const [opList, textContent] = await Promise.all([
    pdfPage.getOperatorList(),
    pdfPage.getTextContent(),
  ]);

  const shapes: DrawingGeometry[] = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== OPS.constructPath) continue;
    const subpaths = decodeConstructPath(opList.argsArray[i]);
    for (const sp of subpaths) {
      if (sp.points.length === 0) continue;
      const type = classifySubpath(sp);
      const pagePoints = toPageSpace(sp.points, viewport);
      shapes.push({
        type,
        page: pageNumber,
        points: pagePoints,
        bbox: boundingBoxOfPoints(pagePoints),
        source: "PDF",
        confidenceTier: "deterministic",
      });
    }
  }

  const textRuns: ExtractedTextRun[] = [];
  for (const item of textContent.items) {
    // TextMarkedContent entries have no `str` — only real text items count.
    if (!("str" in item) || !item.str) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    // The text item's own transform already encodes its origin in raw PDF
    // space; convert that one point the same way shape points are converted.
    const [originX, originY] = toPageSpace([[e, f]], viewport)[0];
    textRuns.push({
      page: pageNumber,
      text: item.str,
      x: originX,
      y: originY,
      width: item.width ?? 0,
      height: item.height ?? (Math.hypot(b, d) || Math.hypot(a, c) || 0),
    });
  }

  return {
    page: pageNumber,
    pageSize,
    geometryAvailable: shapes.length > 0 || textRuns.length > 0,
    shapes,
    textRuns,
  };
}
