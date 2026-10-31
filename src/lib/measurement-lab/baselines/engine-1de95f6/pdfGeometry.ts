// FROZEN COPY of src/lib/review/pdfGeometry.ts at commit 1de95f68f45abed3f8322cb04d786fe707a3f348 (the
// recovered engine), kept so the Measurement Lab can run the old and the current engine side by side.
// Byte-identical to the original except this header and the import specifiers below, which point at
// the shared, unchanged modules; baselineIntegrity.test.ts proves it. NEVER EDIT.
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
import type { DrawingGeometry, GeometryPageSize, GeometryType } from "@/lib/review/drawingGeometry";
import { boundingBoxOfPoints } from "@/lib/review/drawingGeometry";

export interface ExtractedTextRun {
  page: number;
  text: string;
  /** Baseline origin point, already converted to page space (top-left
   *  origin, y-down, as-displayed) — the same space DrawingGeometry uses. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Unit vector of the text's reading direction in page space ([1,0] for
   *  ordinary left-to-right text; [0,-1] for text running bottom-to-top, as
   *  on a vertical room label). `width` is measured along this direction. */
  direction?: [number, number];
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

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const isMatrix = (m: unknown): m is Matrix =>
  (Array.isArray(m) || ArrayBuffer.isView(m)) && (m as ArrayLike<number>).length === 6;

/** `cm n` under CTM m: points go through n first, then m (PDF: CTM' = n × CTM). */
function multiply(m: Matrix, n: ArrayLike<number>): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const apply = (m: Matrix, [x, y]: [number, number]): [number, number] =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The four corners of a transformed rectangle still form an axis-aligned box. */
function axisAligned(pts: [number, number][]): boolean {
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return pts.every((p, k) => {
    const q = pts[(k + 1) % pts.length];
    return eq(p[0], q[0]) || eq(p[1], q[1]);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Viewport = { convertToViewportPoint(x: number, y: number): any[] };

const round6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

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
  // Path operands are in the CURRENT user space, not raw page space: track
  // the graphics state's transformation matrix (q/Q, cm, form XObjects) and
  // apply it before the viewport conversion. Text items from getTextContent
  // already include it.
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.save) { stack.push(ctm); continue; }
    if (fn === OPS.restore) { ctm = stack.pop() ?? ctm; continue; }
    if (fn === OPS.transform) { if (isMatrix(args)) ctm = multiply(ctm, args); continue; }
    if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args) && isMatrix(args[0])) ctm = multiply(ctm, args[0]);
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) { ctm = stack.pop() ?? ctm; continue; }
    if (fn !== OPS.constructPath) continue;
    const subpaths = decodeConstructPath(args);
    for (const sp of subpaths) {
      if (sp.points.length === 0) continue;
      const userPoints = sp.points.map((pt) => apply(ctm, pt));
      // a rotated or skewed rectangle is a polygon, not an axis-aligned rectangle
      const type = sp.isRectangle && !axisAligned(userPoints) ? "polygon" : classifySubpath(sp);
      const pagePoints = toPageSpace(userPoints, viewport);
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
    // Reading direction: map the run's own x-axis (a, b) through the same
    // viewport transform, so page rotation is accounted for.
    const along = Math.hypot(a, b) || 1;
    const [dirX, dirY] = toPageSpace([[e + a / along, f + b / along]], viewport)[0];
    const dLen = Math.hypot(dirX - originX, dirY - originY) || 1;
    textRuns.push({
      direction: [round6((dirX - originX) / dLen), round6((dirY - originY) / dLen)],
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
