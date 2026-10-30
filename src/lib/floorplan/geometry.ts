// FLOOR PLAN GEOMETRY — straight segments from the PDF's own vector shapes.
//
// PURE. Input is pdfGeometry.extractPageGeometry's `shapes` (page space:
// top-left origin, y down, PDF points at scale 1). Output is every straight
// edge those shapes really contain, each traceable to its source shape. Curved
// paths (door swings, arcs) are kept apart: they are never straightened.

import type { DrawingGeometry } from "@/lib/review/drawingGeometry";

export type Point = [number, number];

export interface Segment {
  id: string;
  a: Point;
  b: Point;
  /** Index of the source shape in the extraction's `shapes` array. */
  shape: number;
  /** The source shape is closed (a rectangle or polygon). */
  closed: boolean;
  page: number;
}

export const dist = (p: Point, q: Point) => Math.hypot(q[0] - p[0], q[1] - p[1]);

/** Every straight edge of the page's line, polyline, polygon and rectangle
 *  shapes. Zero-length edges are dropped; nothing is joined or invented. */
export function segmentsFromShapes(shapes: DrawingGeometry[]): Segment[] {
  const out: Segment[] = [];
  shapes.forEach((s, i) => {
    let pts: Point[] = [];
    let closed = false;
    if (s.type === "line" || s.type === "polyline") pts = s.points as Point[];
    else if (s.type === "polygon") { pts = s.points as Point[]; closed = true; }
    else if (s.type === "rectangle") {
      const [[x0, y0], [x1, y1]] = s.points as Point[];
      pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      closed = true;
    } else return; // points, bboxes and curved paths are not straight edges
    const n = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      if (dist(a, b) > 1e-6) out.push({ id: `s${out.length}`, a, b, shape: i, closed, page: s.page });
    }
  });
  return out;
}
