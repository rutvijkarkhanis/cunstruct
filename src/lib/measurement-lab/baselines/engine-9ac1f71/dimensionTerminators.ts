// DIMENSION TERMINATORS — the marks that end a dimension line, and the choice
// of the one endpoint pair a printed dimension measures. Part of the
// linearDimensions engine (stage 4 there); pure and deterministic.
//
// A terminator must be a mark ON the line, not anything that happens to end
// near it. Recognised conventions, none tied to one CAD exporter:
//   filled-tick     a small filled bar (any closed outline) whose long axis is
//                   oblique to the line and that STRADDLES it;
//   stroke-tick     a short oblique stroke that straddles the line;
//   arrowhead       a small filled triangle whose tip is on the line and whose
//                   axis runs along it;
//   dot             a small round filled mark centred on the line;
//   extension-stub  a perpendicular stroke that crosses or meets the line
//                   exactly where a piece of the dimension line itself ends
//                   (a line simply crossed by a wall or another dimension's
//                   extension line is not ended there).
// A mark that only touches the line at its tip (e.g. a neighbouring
// dimension's tick) does not straddle it and is not a terminator. The line's
// own end is never a terminator by itself.
//
// Coordinates: page space (pdfGeometry): PDF points, top-left origin, y down.
// Positions along the line are distances from line.a in the direction line.u.

import type { DrawingGeometry } from "./drawingGeometry";

type Point = [number, number];
interface LineSeg { a: Point; b: Point }

export type TerminatorKind = "filled-tick" | "stroke-tick" | "arrowhead" | "dot" | "extension-stub";
const STRONG: ReadonlySet<TerminatorKind> = new Set(["filled-tick", "stroke-tick", "arrowhead", "dot"]);

export interface Terminator {
  /** Position along the dimension line (page units from line.a). */
  at: number;
  kind: TerminatorKind;
  /** Index of the source shape (or shapes, for a bar drawn as two triangles). */
  shapes: number[];
  /** What was measured to accept it. */
  evidence: string;
}

export type EndpointDecision =
  /** one terminator either side of the text, nothing else inside the span, text between them */
  | "valid-pair"
  /** a terminator on one side only */
  | "one-sided"
  /** more than one plausible terminator on a side, or text not between the nearest pair while another pair would hold it */
  | "ambiguous"
  /** no terminator either side, or the nearest pair does not hold the text */
  | "unresolved";

export interface Endpoints {
  decision: EndpointDecision;
  reason: string;
  /** The chosen pair (valid-pair only). */
  start: Point | null;
  end: Point | null;
  length: number | null;
  ends: [Terminator, Terminator] | null;
  /** Where the text's middle sits in the span: 0 = centred, ±0.5 = at an end. */
  textPosition: number | null;
  /** Terminators considered on each side, nearest first (evidence for review). */
  left: Terminator[];
  right: Terminator[];
}

// ── tolerances (all relative to the dimension text height h unless stated) ──
/** Largest mark: a tick or arrowhead is drawn at about text size. */
const MARK_SIZE = 2.5;
/** A tick must reach this far past the line on BOTH sides (h-relative, min 0.3 pt). */
const STRADDLE = 0.04;
/** Oblique = between ~20° and ~70° to the line. */
const OBLIQUE_MIN_SIN = 0.34, OBLIQUE_MAX_SIN = 0.94;
/** An arrowhead's axis runs along the line (within ~15°); its tip and a dot's centre sit on it. */
const ALONG_MAX_SIN = 0.26, ON_LINE = 0.1;
/** Two crossings this close (pt) are one mark (a bar drawn as two triangles). */
const SAME_MARK = 1.5;
/** A dimension line piece ending this close (pt) to a perpendicular stroke ends at it. */
const PIECE_END = 0.3;
/** Two different marks on one side (further apart than SAME_MARK, so not one mark) but within a further
 *  RIVAL_GAP·h of each other cannot be told apart. */
const RIVAL_GAP = 0.25;
/** The text must lie in the middle of its span: |position| ≤ this (observed ≤ 0.23 on the development drawing). */
const TEXT_CENTRED = 0.35;
/** A perpendicular stroke counts only if it ends within this (h-relative) past the line: an extension line's overshoot, not a wall crossing through. */
const STUB_REACH = 1.5;

interface Frame { a: Point; u: Point; length: number }
const along = (f: Frame, p: Point) => (p[0] - f.a[0]) * f.u[0] + (p[1] - f.a[1]) * f.u[1];
const across = (f: Frame, p: Point) => -(p[0] - f.a[0]) * f.u[1] + (p[1] - f.a[1]) * f.u[0];
/** |sin| of the angle between a direction and the line. */
const sinTo = (f: Frame, d: Point) => Math.abs(f.u[0] * d[1] - f.u[1] * d[0]) / (Math.hypot(d[0], d[1]) || 1);

/** Where the segment p→q meets the line (position along it), or null if it doesn't cross the line's carrier. */
function crossing(f: Frame, p: Point, q: Point): number | null {
  const dp = across(f, p), dq = across(f, q);
  if (dp === dq) return null;
  const t = dp / (dp - dq);
  return along(f, [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
}

function closedMarks(f: Frame, h: number, shapes: DrawingGeometry[]): Terminator[] {
  const size = MARK_SIZE * h, straddle = Math.max(0.3, STRADDLE * h), out: Terminator[] = [];
  shapes.forEach((s, i) => {
    if (s.type !== "polygon" && s.type !== "rectangle" && s.type !== "path") return;
    const pts = s.points as Point[];
    if (pts.length < 3 || Math.hypot(s.bbox[2] - s.bbox[0], s.bbox[3] - s.bbox[1]) > size) return;
    const pos = pts.map((p) => along(f, p));
    if (Math.max(...pos) < -size || Math.min(...pos) > f.length + size) return;
    const off = pts.map((p) => across(f, p));
    if (Math.min(...off) > size || Math.max(...off) < -size) return;
    // dot: a small round outline centred on the line
    const w = s.bbox[2] - s.bbox[0], ht = s.bbox[3] - s.bbox[1];
    const cx = (s.bbox[0] + s.bbox[2]) / 2, cy = (s.bbox[1] + s.bbox[3]) / 2;
    if (s.type === "path" && w <= h && ht <= h && w / ht >= 0.7 && w / ht <= 1.4 && Math.abs(across(f, [cx, cy])) <= ON_LINE * h) {
      out.push({ at: along(f, [cx, cy]), kind: "dot", shapes: [i], evidence: `round mark ${w.toFixed(2)}x${ht.toFixed(2)} centred ${across(f, [cx, cy]).toFixed(2)} off the line` });
      return;
    }
    if (s.type === "path") return;
    // arrowhead: a triangle with its tip on the line and its axis along it
    if (pts.length === 3) {
      const tipIdx = off.findIndex((o) => Math.abs(o) <= ON_LINE * h);
      if (tipIdx >= 0) {
        const tip = pts[tipIdx], base = pts.filter((_, k) => k !== tipIdx);
        const mid: Point = [(base[0][0] + base[1][0]) / 2, (base[0][1] + base[1][1]) / 2];
        const bo = base.map((p) => across(f, p));
        if (bo[0] * bo[1] < 0 && Math.abs(across(f, mid)) <= ON_LINE * h && sinTo(f, [mid[0] - tip[0], mid[1] - tip[1]]) <= ALONG_MAX_SIN) {
          out.push({ at: along(f, tip), kind: "arrowhead", shapes: [i], evidence: `triangle tip ${across(f, tip).toFixed(2)} off the line, axis along it` });
          return;
        }
      }
    }
    // filled tick: the outline's long axis is oblique and the outline straddles the line
    if (Math.min(...off) > -straddle || Math.max(...off) < straddle) return;
    let best: [Point, Point] | null = null;
    for (let k = 0; k < pts.length; k++) {
      const e: [Point, Point] = [pts[k], pts[(k + 1) % pts.length]];
      if (!best || Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]) > Math.hypot(best[1][0] - best[0][0], best[1][1] - best[0][1])) best = e;
    }
    const sin = sinTo(f, [best![1][0] - best![0][0], best![1][1] - best![0][1]]);
    if (sin < OBLIQUE_MIN_SIN || sin > OBLIQUE_MAX_SIN) return;
    const at = crossing(f, best![0], best![1]);
    if (at !== null) out.push({ at, kind: "filled-tick", shapes: [i], evidence: `filled outline crossing the line at ${(Math.asin(sin) * 180 / Math.PI).toFixed(0)}°, reaching ${Math.min(...off).toFixed(2)} / +${Math.max(...off).toFixed(2)} either side` });
  });
  return out;
}

function strokeMarks(f: Frame, h: number, segs: (LineSeg & { shape: number; closed?: boolean })[], pieceEnds: number[]): Terminator[] {
  const size = MARK_SIZE * h, straddle = Math.max(0.3, STRADDLE * h), out: Terminator[] = [];
  for (const s of segs) {
    if (s.closed) continue; // edges of filled outlines are judged as outlines above
    const d: Point = [s.b[0] - s.a[0], s.b[1] - s.a[1]], L = Math.hypot(d[0], d[1]);
    const oa = across(f, s.a), ob = across(f, s.b);
    if (Math.min(oa, ob) > 0.3 || Math.max(oa, ob) < -0.3) continue; // does not reach the line
    const at = crossing(f, s.a, s.b);
    if (at === null || at < -size || at > f.length + size) continue;
    const sin = sinTo(f, d);
    if (L <= size && sin >= OBLIQUE_MIN_SIN && sin <= OBLIQUE_MAX_SIN && Math.min(oa, ob) <= -straddle && Math.max(oa, ob) >= straddle) {
      if (isHatch(s, segs)) continue;
      out.push({ at, kind: "stroke-tick", shapes: [s.shape], evidence: `oblique stroke ${L.toFixed(2)} long crossing the line at ${(Math.asin(sin) * 180 / Math.PI).toFixed(0)}°` });
    } else if (sin > 0.995) {
      // perpendicular: only where the dimension line itself ends, and only an overshoot past the line
      const pastLine = Math.min(Math.abs(oa), Math.abs(ob));
      if (pastLine > STUB_REACH * h) continue;
      if (!pieceEnds.some((e) => Math.abs(e - at) <= PIECE_END)) continue;
      out.push({ at, kind: "extension-stub", shapes: [s.shape], evidence: `perpendicular stroke where the dimension line ends, ${pastLine.toFixed(2)} past it` });
    }
  }
  return out;
}

/** One mark per spot: crossings within SAME_MARK of each other (a bar drawn as
 *  two triangles, or a tick drawn over an extension line's end) are one
 *  terminator, placed at the mean of its strongest kind's crossings. */
function merge(marks: Terminator[]): Terminator[] {
  const sorted = [...marks].sort((p, q) => p.at - q.at);
  const groups: Terminator[][] = [];
  for (const m of sorted) {
    const g = groups[groups.length - 1];
    if (g && m.at - g[g.length - 1].at <= SAME_MARK) g.push(m); else groups.push([m]);
  }
  return groups.map((g) => {
    const strong = g.filter((m) => STRONG.has(m.kind));
    const lead = strong.length ? strong : g;
    return { ...lead[0], at: lead.reduce((s, m) => s + m.at, 0) / lead.length, shapes: g.flatMap((m) => m.shapes) };
  });
}

/** A stroke that is one of a family of parallel strokes of similar length close
 *  by is hatching (a wall or section fill), not a tick. */
function isHatch(s: LineSeg, segs: (LineSeg & { closed?: boolean })[]): boolean {
  const d: Point = [s.b[0] - s.a[0], s.b[1] - s.a[1]], L = Math.hypot(d[0], d[1]);
  const mid: Point = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  let n = 0;
  for (const o of segs) {
    if (o === s || o.closed) continue;
    const e: Point = [o.b[0] - o.a[0], o.b[1] - o.a[1]], M = Math.hypot(e[0], e[1]);
    if (M < 0.5 * L || M > 2 * L || Math.abs(d[0] * e[1] - d[1] * e[0]) / (L * M) > 0.02) continue;
    if (Math.hypot((o.a[0] + o.b[0]) / 2 - mid[0], (o.a[1] + o.b[1]) / 2 - mid[1]) <= 3 * L && ++n >= 2) return true;
  }
  return false;
}

/** All terminators on a dimension line. `segs` are the page's straight edges
 *  (closed outlines flagged), `shapes` its shapes, h the dimension text height. */
export function findTerminators(line: Frame, h: number, shapes: DrawingGeometry[], segs: (LineSeg & { shape: number; closed?: boolean })[]): Terminator[] {
  // where pieces of the dimension line itself end (for perpendicular stubs)
  const pieceEnds: number[] = [];
  for (const s of segs) {
    if (s.closed) continue;
    if (Math.abs(across(line, s.a)) > 0.1 || Math.abs(across(line, s.b)) > 0.1) continue;
    pieceEnds.push(along(line, s.a), along(line, s.b));
  }
  return merge([...closedMarks(line, h, shapes), ...strokeMarks(line, h, segs, pieceEnds)]);
}

/** Choose the endpoint pair for text whose middle sits at `textAt` along the line. */
export function chooseEndpoints(line: Frame, textAt: number, h: number, marks: Terminator[]): Endpoints {
  const point = (s: number): Point => [line.a[0] + line.u[0] * s, line.a[1] + line.u[1] * s];
  const left = marks.filter((m) => m.at < textAt - 0.5).sort((p, q) => q.at - p.at);
  const right = marks.filter((m) => m.at > textAt + 0.5).sort((p, q) => p.at - q.at);
  const none = { start: null, end: null, length: null, ends: null, textPosition: null, left, right };
  if (!left.length && !right.length) return { ...none, decision: "unresolved", reason: "No terminator (tick, arrowhead, dot or ended extension line) on either side of the text." };
  if (!left.length || !right.length) return { ...none, decision: "one-sided", reason: `A terminator was found on one side only (${(left[0] ?? right[0]).kind}); the other end of the dimension is not established.` };
  // two different marks so close on one side that either could be this dimension's end
  const rival = (side: Terminator[]) => side.length > 1 && Math.abs(side[1].at - side[0].at) <= SAME_MARK + RIVAL_GAP * h ? side[1] : null;
  const r = rival(left) ?? rival(right);
  if (r) return { ...none, decision: "ambiguous", reason: `Two different terminators (${r.kind}) sit within ${(SAME_MARK + RIVAL_GAP * h).toFixed(1)} of each other on one side: the end can't be told.` };
  const [l, rt] = [left[0], right[0]];
  const length = rt.at - l.at;
  const textPosition = (textAt - (l.at + rt.at) / 2) / length;
  if (Math.abs(textPosition) > TEXT_CENTRED) {
    return { ...none, textPosition, decision: "unresolved", reason: `The text is not between its nearest terminators (position ${textPosition.toFixed(2)} of the span from its middle); this pair may belong to another dimension.` };
  }
  return { decision: "valid-pair", reason: `${l.kind} and ${rt.kind} either side of the text, nothing between them, text at ${textPosition.toFixed(2)} from the middle.`, start: point(l.at), end: point(rt.at), length, ends: [l, rt], textPosition, left, right };
}
