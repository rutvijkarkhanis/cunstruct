// DOOR SWING DETECTION from a plan's own vector geometry.
//
// A swing door is drawn as a quarter arc (the leaf's sweep) plus a straight
// leaf line from the hinge to one end of the arc. Neither alone is enough:
// arcs also draw fixtures, furniture and curved walls; straight lines are
// everywhere. Only the pair — an arc of about 90° whose fitted centre is one
// end of a line as long as the arc's radius, whose other end is an arc end —
// is a door-swing candidate. Two swings meeting at one opening (a double
// door) are one candidate, not two.
//
// What this does NOT do: decide that a candidate is an installed door (it
// may be a cupboard shutter or a gate), read its size as a quantity, or find
// sliding/folding doors or windows (they have no swing). Those stay with
// tags, supplied symbols and the reviewer. Pure and deterministic.

import type { DrawingGeometry } from "../review/drawingGeometry";
import type { Bbox } from "./contract";

export const ARC_RADIUS_TOLERANCE = 0.06;     // |distance - r| / r for every sampled point
export const ARC_SWEEP_RANGE_DEG: [number, number] = [75, 105];
export const LEAF_ENDPOINT_TOLERANCE = 0.08;  // × r
export const DOUBLE_DOOR_MEET_TOLERANCE = 0.12; // × r
/** Plausible door leaf widths, used only when the sheet's scale is known. */
export const DOOR_LEAF_MM: [number, number] = [600, 1500];

type Pt = [number, number];

export interface DoorSwing {
  /** Indexes of the input shapes that form this swing (arc first). */
  shapeIndexes: number[];
  hinge: Pt;
  /** End of the arc touching the leaf (open position). */
  openEnd: Pt;
  /** The other end of the arc (closed position, on the wall line). */
  closedEnd: Pt;
  radius: number;
  sweepDeg: number;
  bbox: Bbox;
}

export interface DoorSymbol {
  kind: "door_swing_geometry" | "double_swing_geometry";
  swings: DoorSwing[];
  bbox: Bbox;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/** Points along the drawn curve: Bezier segments sampled, a polyline as is. */
export function samplePath(shape: DrawingGeometry): Pt[] | null {
  const p = shape.points;
  if (shape.type === "path") {
    if (p.length < 4 || (p.length - 1) % 3 !== 0) return null;
    const out: Pt[] = [p[0]];
    for (let i = 0; i + 3 < p.length; i += 3) {
      for (const t of [0.25, 0.5, 0.75, 1]) out.push(bezier(p[i], p[i + 1], p[i + 2], p[i + 3], t));
    }
    return out;
  }
  if (shape.type === "polyline" && p.length >= 5) return p; // a CAD arc flattened into segments
  return null;
}

function circumcircle(a: Pt, b: Pt, c: Pt): { centre: Pt; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null; // collinear: a straight line, not an arc
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  const centre: Pt = [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ];
  return { centre, r: dist(centre, a) };
}

/** A circular arc through the sampled points, or null. The sweep is the
 *  angle from first to last sample measured through the middle one. */
export function fitArc(samples: Pt[]): { centre: Pt; r: number; sweepDeg: number } | null {
  if (samples.length < 3) return null;
  const first = samples[0], last = samples[samples.length - 1], mid = samples[Math.floor(samples.length / 2)];
  const c = circumcircle(first, mid, last);
  if (!c || !(c.r > 0)) return null;
  if (samples.some((s) => Math.abs(dist(s, c.centre) - c.r) > ARC_RADIUS_TOLERANCE * c.r)) return null;
  const ang = (p: Pt) => Math.atan2(p[1] - c.centre[1], p[0] - c.centre[0]);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const toLast = norm(ang(last) - ang(first)), toMid = norm(ang(mid) - ang(first));
  const sweep = toMid <= toLast ? toLast : 2 * Math.PI - toLast;
  return { centre: c.centre, r: c.r, sweepDeg: (sweep * 180) / Math.PI };
}

function unionBox(boxes: Bbox[]): Bbox {
  return [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ];
}
const boxOf = (pts: Pt[]): Bbox => unionBox(pts.map((p) => [p[0], p[1], p[0], p[1]]));

/** Every arc + leaf pair on a sheet. Shapes are visited in input order, and
 *  when several lines qualify as one arc's leaf the closest fit is taken, so
 *  the result is the same on every run. A line is used as a leaf once. */
export function findDoorSwings(shapes: DrawingGeometry[]): { swings: DoorSwing[]; arcsWithoutLeaf: number } {
  const lines = shapes
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (s.type === "line" || s.type === "polyline") && s.points.length === 2);
  const usedLines = new Set<number>();
  const swings: DoorSwing[] = [];
  let arcsWithoutLeaf = 0;
  shapes.forEach((shape, i) => {
    const samples = samplePath(shape);
    if (!samples) return;
    const arc = fitArc(samples);
    if (!arc || arc.sweepDeg < ARC_SWEEP_RANGE_DEG[0] || arc.sweepDeg > ARC_SWEEP_RANGE_DEG[1]) return;
    const ends: Pt[] = [samples[0], samples[samples.length - 1]];
    const tol = LEAF_ENDPOINT_TOLERANCE * arc.r;
    let best: { idx: number; err: number; openEnd: Pt; closedEnd: Pt } | null = null;
    for (const { s, i: li } of lines) {
      if (usedLines.has(li)) continue;
      const [a, b] = s.points as [Pt, Pt];
      for (const [hingeSide, freeSide] of [[a, b], [b, a]] as [Pt, Pt][]) {
        const hErr = dist(hingeSide, arc.centre);
        if (hErr > tol) continue;
        for (const [k, end] of ends.entries()) {
          const err = hErr + dist(freeSide, end);
          if (dist(freeSide, end) <= tol && (!best || err < best.err)) {
            best = { idx: li, err, openEnd: end, closedEnd: ends[1 - k] };
          }
        }
      }
    }
    if (!best) { arcsWithoutLeaf++; return; }
    usedLines.add(best.idx);
    swings.push({
      shapeIndexes: [i, best.idx],
      hinge: arc.centre,
      openEnd: best.openEnd,
      closedEnd: best.closedEnd,
      radius: arc.r,
      sweepDeg: Math.round(arc.sweepDeg * 10) / 10,
      bbox: unionBox([boxOf(samples), boxOf([arc.centre])]),
    });
  });
  return { swings, arcsWithoutLeaf };
}

/** Swings → door symbols. Two swings whose closed ends meet, with their
 *  hinges on opposite sides of that point, are one double door. */
export function groupDoorSymbols(swings: DoorSwing[]): DoorSymbol[] {
  const used = new Set<number>();
  const out: DoorSymbol[] = [];
  swings.forEach((a, i) => {
    if (used.has(i)) return;
    for (let j = i + 1; j < swings.length; j++) {
      if (used.has(j)) continue;
      const b = swings[j];
      const r = Math.max(a.radius, b.radius);
      const meet = dist(a.closedEnd, b.closedEnd) <= DOUBLE_DOOR_MEET_TOLERANCE * r;
      const span = Math.abs(dist(a.hinge, b.hinge) - (a.radius + b.radius)) <= DOUBLE_DOOR_MEET_TOLERANCE * r;
      if (meet && span) {
        used.add(i); used.add(j);
        out.push({ kind: "double_swing_geometry", swings: [a, b], bbox: unionBox([a.bbox, b.bbox]) });
        return;
      }
    }
    used.add(i);
    out.push({ kind: "door_swing_geometry", swings: [a], bbox: a.bbox });
  });
  return out;
}
