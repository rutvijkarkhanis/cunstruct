// SYNTHETIC FIXTURES — hand-built text runs and vector shapes for the
// counting engine's unit tests. They exercise the rules (association,
// de-duplication, cross-view, schedule checks); they are not drawings and
// say nothing about accuracy on real drawings.
//
// Space: canonical page points, top-left origin, y down (A3 landscape).

import type { DrawingTextRun } from "../../review/drawingInventory";
import type { DrawingGeometry } from "../../review/drawingGeometry";
import { boundingBoxOfPoints } from "../../review/drawingGeometry";
import type { CountingSheetInput, ScheduleEntryInput } from "../contract";

export const PAGE = { width: 1191, height: 842 };
type Pt = [number, number];

/** One text run; width ≈ 0.6 × height per character. */
export function run(text: string, x: number, y: number, opts: { h?: number; dir?: [number, number] } = {}): DrawingTextRun {
  const h = opts.h ?? 6;
  return { text, origin: [x, y], direction: opts.dir ?? [1, 0], width: text.length * h * 0.6, height: h };
}

const shape = (type: DrawingGeometry["type"], points: Pt[], page = 1): DrawingGeometry =>
  ({ type, page, points, bbox: boundingBoxOfPoints(points), source: "PDF", confidenceTier: "deterministic" });

const K = 0.5522847498; // cubic Bezier quarter-circle constant

/** A quarter arc from angle a0 to a0+90° around (cx, cy), as a cubic path. */
export function quarterArc(cx: number, cy: number, r: number, a0Deg: number, sweepDeg = 90, page = 1): DrawingGeometry {
  const a0 = (a0Deg * Math.PI) / 180, a1 = ((a0Deg + sweepDeg) * Math.PI) / 180;
  const k = K * (sweepDeg / 90);
  const p0: Pt = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
  const p3: Pt = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  const p1: Pt = [p0[0] - k * r * Math.sin(a0), p0[1] + k * r * Math.cos(a0)];
  const p2: Pt = [p3[0] + k * r * Math.sin(a1), p3[1] - k * r * Math.cos(a1)];
  return shape("path", [p0, p1, p2, p3], page);
}

export const line = (a: Pt, b: Pt, page = 1) => shape("line", [a, b], page);

/**
 * A swing door: hinge at (hx, hy), leaf of radius r drawn open at angle
 * `openDeg`, arc sweeping 90° to the closed position. Returns [arc, leaf].
 */
export function door(hx: number, hy: number, r = 25, openDeg = 270, page = 1): DrawingGeometry[] {
  const a = (openDeg * Math.PI) / 180;
  return [quarterArc(hx, hy, r, openDeg, 90, page), line([hx, hy], [hx + r * Math.cos(a), hy + r * Math.sin(a)], page)];
}

/** A double door: two leaves of radius r whose closed ends meet at
 *  (hx + r, hy). */
export function doubleDoor(hx: number, hy: number, r = 20, page = 1): DrawingGeometry[] {
  // Left leaf opens up (270°) and closes to 0° (towards +x).
  const left = [quarterArc(hx, hy, r, 270, 90, page), line([hx, hy], [hx, hy - r], page)];
  // Right leaf, hinged at hx + 2r: closed position points to -x (180°), open up (270°).
  const h2: Pt = [hx + 2 * r, hy];
  const right = [quarterArc(h2[0], h2[1], r, 180, 90, page), line(h2, [h2[0], h2[1] - r], page)];
  return [...left, ...right];
}

export function sheet(over: Partial<CountingSheetInput> & { documentId: string; title?: string }): CountingSheetInput {
  const { title, ...rest } = over;
  return {
    page: 1,
    pageSize: PAGE,
    textLayer: "available",
    textSource: "pdf_text",
    shapes: [],
    ...rest,
    runs: [...(title ? [run(title, 500, 800, { h: 12 })] : []), ...(over.runs ?? [])],
  };
}

export function entry(mark: string, over: Partial<ScheduleEntryInput> = {}): ScheduleEntryInput {
  return { id: `sched:${mark}`, mark, scheduledQuantity: null, ...over };
}

/**
 * The base fixture: a GROUND FLOOR PLAN with three swing doors (two tagged
 * D1, one D2), each tag printed just above its door's hinge, plus two W1
 * window tags (no window symbols — this version does not detect windows).
 */
export function groundFloor(documentId = "doc-ground", extra: Partial<CountingSheetInput> = {}): CountingSheetInput {
  return sheet({
    documentId,
    sheetNumber: "A-101",
    title: "GROUND FLOOR PLAN",
    runs: [
      run("D1", 110, 60), run("D1", 410, 60), run("D2", 710, 60),
      run("W1", 200, 400), run("W1", 600, 400),
      run("KITCHEN", 300, 200), run("ALL DOORS TO BE FLUSH", 900, 700),
    ],
    shapes: [...door(100, 100), ...door(400, 100), ...door(700, 100)],
    ...extra,
  });
}

export const SCHEDULE: ScheduleEntryInput[] = [
  entry("D1", { description: "MAIN DOOR", dimension: "900 x 2100", category: "door" }),
  entry("D2", { description: "TOILET DOOR", dimension: "750 x 2100", category: "door" }),
  entry("W1", { description: "WINDOW", dimension: "1200 x 1200", category: "window" }),
];
