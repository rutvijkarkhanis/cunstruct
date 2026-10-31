// DIMENSION-TO-ELEMENT ASSOCIATION — what each end of a dimension measures
// from. Part of the linearDimensions engine (stage 5 there); pure and
// deterministic. Kept separate from line and endpoint detection: a dimension
// can have a correct line and endpoints and still not be tied to an element.
//
// Each end is examined along its own axis (the line through the endpoint,
// perpendicular to the dimension line):
//   grid       a grid bubble (a tag excluded as a dimension) sits on that
//              axis AND a drawn grid line actually runs between the bubble and
//              the endpoint. Being nearby is not enough.
//   edge       a drawn line lies on the axis and either passes through the
//              endpoint (a wall face the tick sits on) or is the far end of the
//              extension line that leaves the endpoint (the extension line
//              stops just short of the element it dimensions).
//   ambiguous  more than one interpretation fits the same end.
//   none       nothing on the axis can be tied to the end.
// Wall/room/opening TYPE is not decided here: Cunstruct has no wall or room
// model yet. "edge" means a drawn edge the dimension is measured to.
//
// Coordinates: page space (pdfGeometry): PDF points, top-left origin, y down.

type Point = [number, number];

export interface GridTag {
  label: string;
  /** Centre of the tag's outline. */
  center: Point;
  /** Half the outline's larger side: the grid line starts at the outline, not at its centre. */
  radius: number;
}

export type EndAssociation =
  | { kind: "grid"; labels: string[]; evidence: string }
  | { kind: "edge"; via: "through" | "extension"; shape: number; evidence: string }
  | { kind: "ambiguous"; candidates: string[]; reason: string }
  | { kind: "none"; reason: string };

export type AssociationDecision = "associated" | "ambiguous" | "unassociated";

export interface Association {
  decision: AssociationDecision;
  /** What the dimension spans, when both ends are associated. */
  measures: "grid-to-grid" | "grid-to-edge" | "edge-to-edge" | null;
  ends: [EndAssociation, EndAssociation];
  reason: string;
}

interface Seg { a: Point; b: Point; shape: number; closed?: boolean }

// tolerances (pt unless h-relative)
/** A grid bubble's centre and a grid or edge line must sit on the endpoint's axis within this. */
const ON_AXIS = 1.0, EDGE_ON_AXIS = 0.3;
/** A tick this close (h-relative) to a grid bubble's line but more than ON_AXIS off it is a near miss: visually on the
 *  grid line yet not exactly on it (drafting imprecision), so grid-or-element can't be told — held, not guessed.
 *  Further off, the tick is deliberately beside the grid line and the edge it sits on decides. */
const NEAR_GRID = 0.25;
/** Share of the bubble-to-endpoint distance a drawn (often dashed) grid line must cover, and the longest gap it may have (h-relative). */
const GRID_COVER = 0.4, GRID_MAX_GAP = 5;
/** An element edge is at least this long (h-relative): ticks and stubs are not elements. */
const MIN_EDGE = 2;
/** An extension line starts this close (h-relative) past the endpoint; it ends this close (h-relative) short of its element. */
const EXT_OVERSHOOT = 1.5, EXT_GAP = 1.5;

function endAssociation(p: Point, n: Point, h: number, segs: Seg[], tags: GridTag[]): EndAssociation {
  // positions along the axis (n) and across it (along the dimension line)
  const ax = (q: Point) => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1];
  const cr = (q: Point) => -(q[0] - p[0]) * n[1] + (q[1] - p[1]) * n[0];
  const onAxis = segs.filter((s) => !s.closed && Math.abs(cr(s.a)) <= EDGE_ON_AXIS && Math.abs(cr(s.b)) <= EDGE_ON_AXIS && Math.abs(ax(s.a) - ax(s.b)) > 0.05);

  // grid: a bubble whose own grid line is drawn from its outline towards this end.
  // Coverage is measured on the BUBBLE's axis, so a tick drawn slightly off the
  // grid line is recognised as a near miss instead of being taken for an edge.
  // where each connected bubble's grid line is actually drawn, relative to this end's axis
  const lineOffset = new Map<GridTag, number>();
  const connected = tags.filter((t) => Math.abs(cr(t.center)) <= Math.max(ON_AXIS, NEAR_GRID * h)).filter((t) => {
    const off = cr(t.center);
    const c = ax(t.center), edge = c - Math.sign(c) * t.radius;
    if (Math.sign(edge) !== Math.sign(c)) return true; // the endpoint is at the bubble itself
    const lo = Math.min(0, edge), hi = Math.max(0, edge);
    // the drawn grid line lies on the bubble's axis or the end's axis (or between, when the drawing is a little off)
    const band = (q: Point) => cr(q) >= Math.min(0, off) - EDGE_ON_AXIS && cr(q) <= Math.max(0, off) + EDGE_ON_AXIS;
    const line = segs.filter((s) => !s.closed && band(s.a) && band(s.b) && Math.abs(ax(s.a) - ax(s.b)) > 0.05);
    const pieces = line.map((s) => [Math.max(lo, Math.min(ax(s.a), ax(s.b))), Math.min(hi, Math.max(ax(s.a), ax(s.b)))]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    let covered = 0, reach = lo, maxGap = 0;
    for (const [a, b] of pieces) { maxGap = Math.max(maxGap, a - reach); if (b > reach) { covered += b - Math.max(a, reach); reach = b; } }
    maxGap = Math.max(maxGap, hi - reach);
    // a grid line starts at its bubble's outline; a line merely passing near a tag does not
    const startsAtBubble = pieces.some(([a, b]) => Math.min(Math.abs(a - edge), Math.abs(b - edge)) <= Math.max(1, 0.15 * h));
    // and it is one drawn line (solid or finely dashed), not unrelated lines that happen to share the axis
    const ok = hi - lo > 0 && covered / (hi - lo) >= GRID_COVER && startsAtBubble && maxGap <= GRID_MAX_GAP * h;
    if (ok) {
      const w = line.map((s) => Math.abs(ax(s.a) - ax(s.b)));
      lineOffset.set(t, line.reduce((sum, s, k) => sum + w[k] * (cr(s.a) + cr(s.b)) / 2, 0) / (w.reduce((x, y) => x + y, 0) || 1));
    }
    return ok;
  });
  const grids = connected.filter((t) => Math.abs(cr(t.center)) <= ON_AXIS);
  const nearMiss = connected.filter((t) => Math.abs(cr(t.center)) > ON_AXIS);
  if (!grids.length && nearMiss.length) {
    const t = nearMiss[0];
    return { kind: "ambiguous", candidates: [`grid ${t.label}`, "a drawn edge on the endpoint's own axis"], reason: `This end is ${Math.abs(cr(t.center)).toFixed(2)} off grid ${t.label}'s line: the tick is not on the grid line, so whether it measures the grid or an element beside it can't be told.` };
  }
  // a solid edge through the endpoint that is not the grid line itself (grid lines are dashed: many pieces)
  // a face the tick sits on runs on past the dimension line on BOTH sides; a line that stops just past it is
  // an extension line (followed below to its element), never the element itself
  const through = onAxis.filter((s) => Math.min(ax(s.a), ax(s.b)) < -EXT_OVERSHOOT * h && Math.max(ax(s.a), ax(s.b)) > EXT_OVERSHOOT * h && Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) >= MIN_EDGE * h);

  // the tick sits exactly on a drawn face but only NEAR the grid line: face and grid compete
  const offGridLine = grids.filter((g) => Math.abs(lineOffset.get(g) ?? 0) > EDGE_ON_AXIS);
  const faceAtTick = onAxis.some((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) >= MIN_EDGE * h && Math.min(ax(s.a), ax(s.b)) <= EXT_OVERSHOOT * h && Math.max(ax(s.a), ax(s.b)) >= -EXT_OVERSHOOT * h);
  if (grids.length && offGridLine.length === grids.length && faceAtTick) {
    const g = grids[0];
    return { kind: "ambiguous", candidates: [`grid ${g.label}`, "the drawn face the tick sits on"], reason: `The tick sits on a drawn face ${Math.abs(lineOffset.get(g)!).toFixed(2)} beside grid ${g.label}'s line, not on the grid line: it may measure the face or the grid.` };
  }
  if (grids.length) {
    // a connected grid bubble decides it: the drawn line through the endpoint is
    // (or coincides with) the grid line; that coincidence is kept as evidence
    const labels = [...new Set(grids.map((g) => g.label))].sort();
    return { kind: "grid", labels, evidence: `grid bubble ${labels.join("/")} on this end's axis, joined to it by a drawn grid line${through.length ? "; a drawn edge also lies on this axis" : ""}` };
  }
  if (through.length) {
    const longest = through.reduce((x, y) => (Math.hypot(y.b[0] - y.a[0], y.b[1] - y.a[1]) > Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) ? y : x));
    return { kind: "edge", via: "through", shape: longest.shape, evidence: "a drawn line on this end's axis passes through the endpoint" };
  }
  // extension line: starts just past the endpoint and runs away from the dimension line
  const ext = onAxis.filter((s) => {
    const [lo, hi] = [Math.min(ax(s.a), ax(s.b)), Math.max(ax(s.a), ax(s.b))];
    return (Math.abs(lo) <= EXT_OVERSHOOT * h && hi > lo) || (Math.abs(hi) <= EXT_OVERSHOOT * h && lo < hi);
  });
  // the element is the FIRST drawn geometry beyond the extension line's end (it stops a small gap
  // short of what it dimensions); lines meeting at that same spot are one junction, anything further on is irrelevant
  const found: { dir: number; beyond: number; shapes: number[] }[] = [];
  for (const e of ext) {
    const far = Math.abs(ax(e.a)) > Math.abs(ax(e.b)) ? e.a : e.b, dir = Math.sign(ax(far));
    const hits: { beyond: number; shape: number }[] = [];
    for (const s of segs) {
      if (s === e || onAxis.includes(s)) continue;
      const ca = cr(s.a), cb = cr(s.b);
      if (ca * cb > 0 && Math.min(Math.abs(ca), Math.abs(cb)) > 0.3) continue;
      const t = ca === cb ? 0 : ca / (ca - cb);
      const beyond = (ax([s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]) - ax(far)) * dir;
      if (beyond >= -0.3 && beyond <= EXT_GAP * h) hits.push({ beyond, shape: s.shape });
    }
    if (!hits.length) continue;
    const first = Math.min(...hits.map((x) => x.beyond));
    found.push({ dir, beyond: first, shapes: [...new Set(hits.filter((x) => x.beyond - first <= 0.3).map((x) => x.shape))] });
  }
  const dirs = new Set(found.map((f) => f.dir));
  if (dirs.size > 1) return { kind: "ambiguous", candidates: found.map((f) => `edge ${f.dir > 0 ? "beyond" : "before"} the line`), reason: "Extension lines leave this end in both directions and reach different elements." };
  if (found.length) {
    const f = found.reduce((x, y) => (y.beyond < x.beyond ? y : x));
    return { kind: "edge", via: "extension", shape: f.shapes[0], evidence: `extension line ends ${f.beyond.toFixed(2)} short of the first drawn geometry beyond it${f.shapes.length > 1 ? ` (a junction of ${f.shapes.length} lines)` : ""}` };
  }
  return { kind: "none", reason: ext.length ? "An extension line leaves this end but does not lead to an identifiable element." : "No grid line, edge or extension line on this end's axis." };
}

/** Associate both ends of a dimension whose endpoints are established. u is the dimension direction, h its text height. */
export function associateEndpoints(start: Point, end: Point, u: Point, h: number, segs: Seg[], tags: GridTag[]): Association {
  const n: Point = [-u[1], u[0]];
  const ends: [EndAssociation, EndAssociation] = [endAssociation(start, n, h, segs, tags), endAssociation(end, n, h, segs, tags)];
  const kinds = ends.map((e) => e.kind);
  if (kinds.includes("ambiguous")) return { decision: "ambiguous", measures: null, ends, reason: "At least one end could be measured from more than one element." };
  if (kinds.includes("none")) return { decision: "unassociated", measures: null, ends, reason: kinds.every((k) => k === "none") ? "Neither end can be tied to a grid or drawn edge." : "One end cannot be tied to a grid or drawn edge." };
  const measures = kinds[0] === "grid" && kinds[1] === "grid" ? "grid-to-grid" : kinds[0] === "edge" && kinds[1] === "edge" ? "edge-to-edge" : "grid-to-edge";
  // a grid-to-edge dimension whose grid end also lies on a drawn face: the face may be what is measured
  // (a wall flush with the grid), so grid-or-face can't be told at that end
  if (measures === "grid-to-edge") {
    const k = kinds.indexOf("grid"), g = ends[k] as Extract<EndAssociation, { kind: "grid" }>;
    if (/a drawn edge also lies on this axis/.test(g.evidence)) {
      ends[k] = { kind: "ambiguous", candidates: [`grid ${g.labels.join("/")}`, "a drawn face on the grid line"], reason: "This end is on a grid line that a drawn face also follows, and the other end is a face: the dimension may measure the face, not the grid." };
      return { decision: "ambiguous", measures: null, ends, reason: ends[k].reason };
    }
  }
  return { decision: "associated", measures, ends, reason: `Measured ${measures.replace(/-/g, " ")}.` };
}
