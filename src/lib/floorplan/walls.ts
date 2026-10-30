// FLOOR PLAN WALLS — wall CANDIDATES from pairs of parallel drawn lines.
//
// PURE and deterministic. A wall on an architectural plan is usually drawn as
// two parallel lines a wall-thickness apart. This finds such pairs and turns
// each into a centreline with a thickness, in millimetres, using a scale the
// user has confirmed. Every candidate keeps the ids of the two lines it came
// from. Nothing here decides that a candidate IS a wall: furniture, dimension
// lines and hatching can also form parallel pairs, so every candidate starts
// as "candidate" and the user confirms or deletes it.
//
// Rules:
//   - the two lines are parallel (within `angleTolDeg`), their separation is
//     a plausible wall thickness (`minThicknessMm`..`maxThicknessMm`) and they
//     run side by side for at least `minOverlapMm`;
//   - the pair must be NEAREST neighbours: if another parallel line lies
//     between them along the shared stretch, they are not one wall (this
//     stops hatching and triple lines making phantom walls);
//   - the wall covers only the stretch where both lines exist: a gap in the
//     lines (a door or window opening) stays a gap.

import { type Point, type Segment } from "./geometry";

export interface WallDetectionOptions {
  minThicknessMm: number;
  maxThicknessMm: number;
  minOverlapMm: number;
  minSegmentMm: number;
  angleTolDeg: number;
  minAspect: number;
}

export const DEFAULT_WALL_OPTIONS: WallDetectionOptions = {
  minThicknessMm: 75,
  maxThicknessMm: 450,
  minOverlapMm: 300,
  minSegmentMm: 300,
  angleTolDeg: 0.5,
  minAspect: 3,
};

export interface WallCandidate {
  /** Centreline end points, in millimetres (plan x right, plan y down). */
  start: Point;
  end: Point;
  thicknessMm: number;
  /** Ids of the two drawn lines the wall was read from. */
  evidence: [string, string];
  page: number;
}

interface Oriented {
  seg: Segment;
  c: number; // offset along the normal (mm)
  lo: number; // interval along the direction (mm)
  hi: number;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

export function detectWallCandidates(segments: Segment[], mmPerUnit: number, options: Partial<WallDetectionOptions> = {}): WallCandidate[] {
  const o = { ...DEFAULT_WALL_OPTIONS, ...options };
  if (!(mmPerUnit > 0)) throw new Error("A confirmed scale is needed before walls can be measured.");
  // group the long-enough segments by direction (0..180°)
  const groups = new Map<number, { u: Point; n: Point; items: Segment[] }>();
  for (const s of segments) {
    const dx = (s.b[0] - s.a[0]) * mmPerUnit, dy = (s.b[1] - s.a[1]) * mmPerUnit;
    const len = Math.hypot(dx, dy);
    if (len < o.minSegmentMm) continue;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 180;
    if (deg >= 180 - o.angleTolDeg / 2) deg -= 180;
    const key = round(deg, o.angleTolDeg);
    if (!groups.has(key)) {
      const r = (key * Math.PI) / 180;
      groups.set(key, { u: [Math.cos(r), Math.sin(r)], n: [-Math.sin(r), Math.cos(r)], items: [] });
    }
    groups.get(key)!.items.push(s);
  }

  const walls: WallCandidate[] = [];
  for (const { u, n, items } of groups.values()) {
    const dot = (p: Point, v: Point) => p[0] * mmPerUnit * v[0] + p[1] * mmPerUnit * v[1];
    const or: Oriented[] = items
      .map((seg) => {
        const ta = dot(seg.a, u), tb = dot(seg.b, u);
        return { seg, c: (dot(seg.a, n) + dot(seg.b, n)) / 2, lo: Math.min(ta, tb), hi: Math.max(ta, tb) };
      })
      .sort((p, q) => p.c - q.c);
    for (let i = 0; i < or.length; i++) {
      for (let j = i + 1; j < or.length && or[j].c - or[i].c <= o.maxThicknessMm; j++) {
        const t = or[j].c - or[i].c;
        if (t < o.minThicknessMm) continue;
        const lo = Math.max(or[i].lo, or[j].lo), hi = Math.min(or[i].hi, or[j].hi);
        if (hi - lo < o.minOverlapMm) continue;
        if (or[i].seg.closed && or[i].seg.shape === or[j].seg.shape && hi - lo < o.minAspect * t) continue;
        // nearest neighbours only: a line strictly between them, over at least half the shared stretch, breaks the pair
        const blocked = or.slice(i + 1, j).some((k) =>
          k.c - or[i].c > 1 && or[j].c - k.c > 1 && Math.min(hi, k.hi) - Math.max(lo, k.lo) >= (hi - lo) / 2);
        if (blocked) continue;
        const cm = (or[i].c + or[j].c) / 2;
        const at = (s: number): Point => [u[0] * s + n[0] * cm, u[1] * s + n[1] * cm];
        walls.push({ start: at(lo), end: at(hi), thicknessMm: t, evidence: [or[i].seg.id, or[j].seg.id], page: or[i].seg.page });
      }
    }
  }
  return joinCorners(mergeCollinear(walls));
}

/** Overlapping candidates on the same centreline with the same thickness
 *  (duplicate drawn lines) become one; separate pieces with a gap between
 *  them stay separate, because the gap may be an opening. */
function mergeCollinear(walls: WallCandidate[], tolMm = 1): WallCandidate[] {
  const out: WallCandidate[] = [];
  for (const w of walls) {
    const dir = unit(w.start, w.end);
    const hit = out.find((v) => {
      const d2 = unit(v.start, v.end);
      if (Math.abs(dir[0] * d2[1] - dir[1] * d2[0]) > 1e-3) return false;
      if (Math.abs(v.thicknessMm - w.thicknessMm) > tolMm) return false;
      const off = Math.abs((w.start[0] - v.start[0]) * -d2[1] + (w.start[1] - v.start[1]) * d2[0]);
      if (off > tolMm) return false;
      const p = (q: Point) => (q[0] - v.start[0]) * d2[0] + (q[1] - v.start[1]) * d2[1];
      const [a, b] = [p(w.start), p(w.end)].sort((x, y) => x - y);
      const L = p(v.end);
      return b >= -tolMm && a <= L + tolMm;
    });
    if (!hit) { out.push({ ...w }); continue; }
    const d2 = unit(hit.start, hit.end);
    const p = (q: Point) => (q[0] - hit.start[0]) * d2[0] + (q[1] - hit.start[1]) * d2[1];
    const ts = [0, p(hit.end), p(w.start), p(w.end)];
    const s0 = Math.min(...ts), s1 = Math.max(...ts);
    const base = hit.start;
    hit.start = [base[0] + d2[0] * s0, base[1] + d2[1] * s0];
    hit.end = [base[0] + d2[0] * s1, base[1] + d2[1] * s1];
  }
  return out;
}

function unit(a: Point, b: Point): Point {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
}

/** Close corners: a wall end that stops within half a crossing wall's
 *  thickness of that wall's centreline is extended (or trimmed) to meet it.
 *  Only ends close to a non-parallel wall move, and never by more than half
 *  the other wall's thickness plus `tolMm`; nothing else changes. */
export function joinCorners(walls: WallCandidate[], tolMm = 5): WallCandidate[] {
  const out = walls.map((w) => ({ ...w, start: [...w.start] as Point, end: [...w.end] as Point }));
  for (const w of out) {
    for (const key of ["start", "end"] as const) {
      const p = w[key];
      let best: { q: Point; d: number } | null = null;
      for (const v of walls) {
        if (v === walls[out.indexOf(w)]) continue;
        const q = intersect(w.start, w.end, v.start, v.end);
        if (!q) continue;
        const reach = v.thicknessMm / 2 + tolMm;
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d > reach) continue;
        // the meeting point must lie on the other wall (within its half thickness of either end)
        const dv = unit(v.start, v.end), Lv = Math.hypot(v.end[0] - v.start[0], v.end[1] - v.start[1]);
        const s = (q[0] - v.start[0]) * dv[0] + (q[1] - v.start[1]) * dv[1];
        if (s < -reach || s > Lv + reach) continue;
        if (!best || d < best.d) best = { q, d };
      }
      if (best) w[key] = best.q;
    }
  }
  return out;
}

function intersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r: Point = [b[0] - a[0], b[1] - a[1]], s: Point = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9 * Math.hypot(...r) * Math.hypot(...s)) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}
