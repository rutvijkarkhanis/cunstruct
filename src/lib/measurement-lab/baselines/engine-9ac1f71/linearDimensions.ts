// LINEAR DIMENSIONS — read printed dimension strings off a vector drawing and
// tie each one to the dimension line it labels.
//
// PURE and deterministic. Input is one page of pdfGeometry.extractPageGeometry
// (shapes and text runs in the same page space). Every stage is its own
// function so it can be tested alone:
//
//   1. parseLinearDimensionText  — "3900", "3.9 m", "12'-6 1/2\"" → value + unit
//   2. dimensionTextCandidates   — which text runs on the page are lengths
//   3. findDimensionLine         — the drawn line, parallel to the text, just beside it
//   4. findSpan                  — the two terminators (extension lines / ticks)
//                                  on that line either side of the text
//   5. calibratePage             — the page's own scale, from dimensions that agree
//   6. relateDimensions          — chains, overall dimensions and possible repeats
//   7. status                    — consistent / conflict / ambiguous / unassociated
//
// What it will NOT do:
//   - assume the printed scale note is the PDF's scale (a sheet printed to fit
//     is not at its note's scale; the note is compared, never used);
//   - assume a unit: a number with no printed unit and no unit note on the
//     page keeps unit null and gets no millimetre value;
//   - call a dimension consistent when its value and its drawn length
//     disagree or when its line or terminators can't be found;
//   - drop a dimension that repeats another: a possible repeat is flagged.

import type { DrawingGeometry } from "./drawingGeometry";
import type { ExtractedTextRun } from "./pdfGeometry";
import { unitNoteOf } from "./drawingInventory";
import { chooseEndpoints, findTerminators, type EndpointDecision, type Endpoints, type Terminator, type TerminatorKind } from "./dimensionTerminators";
import { associateEndpoints, type Association, type AssociationDecision, type GridTag } from "./dimensionAssociation";

export type Point = [number, number];
export type DimensionUnit = "mm" | "cm" | "m" | "in";

export interface ParsedLength {
  text: string;
  /** The number as written, in `unit` (inches for feet-inches). */
  value: number;
  /** null when no unit is printed with the number. */
  unit: DimensionUnit | null;
  notation: "metric" | "imperial" | "unitless";
}

const MM_PER: Record<DimensionUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

// ── 1. notation ──────────────────────────────────────────────────────────────

const FRACTION_DENOMINATORS = new Set([2, 4, 8, 16, 32, 64]);
const FT = String.raw`(\d{1,4})\s*'`;
const IN = String.raw`(\d{1,2})?(?:\s*(\d{1,2})\/(\d{1,2}))?\s*"`;
const FEET_INCHES = new RegExp(String.raw`^${FT}(?:\s*-?\s*${IN})?$`);
const INCHES_ONLY = new RegExp(String.raw`^${IN}$`);
const METRIC = /^(\d{1,6}(?:\.\d{1,3})?)\s*(mm|cm|m)$/i;
const UNITLESS = /^(?:[1-9]\d{0,5}(?:\.\d{1,3})?|0\.\d{1,3}|[1-9]\d{0,2}(?:,\d{3})+)$/;

function inches(whole: string | undefined, num: string | undefined, den: string | undefined): number | null {
  let v = whole === undefined ? 0 : Number(whole);
  if (num !== undefined) {
    const n = Number(num), d = Number(den);
    if (!FRACTION_DENOMINATORS.has(d) || !(n > 0) || n >= d) return null;
    v += n / d;
  }
  return v;
}

/** One printed length, or null when the text is not exactly one length.
 *  Feet-inches are returned in inches (12'-6 1/2" → 150.5); inches must be
 *  under 12 and fractions must be ordinary drafting fractions. */
export function parseLinearDimensionText(raw: string): ParsedLength | null {
  const text = raw.trim().replace(/[’′]/g, "'").replace(/[”″]|''/g, '"');
  let m = FEET_INCHES.exec(text);
  if (m) {
    const inch = m[2] === undefined && m[3] === undefined ? 0 : inches(m[2], m[3], m[4]);
    if (inch === null || inch >= 12) return null;
    return { text: raw.trim(), value: Number(m[1]) * 12 + inch, unit: "in", notation: "imperial" };
  }
  m = INCHES_ONLY.exec(text);
  if (m && (m[1] !== undefined || m[2] !== undefined)) {
    const inch = inches(m[1], m[2], m[3]);
    if (inch === null || !(inch > 0)) return null;
    return { text: raw.trim(), value: inch, unit: "in", notation: "imperial" };
  }
  m = METRIC.exec(text);
  if (m) {
    const value = Number(m[1]);
    if (!(value > 0)) return null;
    return { text: raw.trim(), value, unit: m[2].toLowerCase() as DimensionUnit, notation: "metric" };
  }
  if (UNITLESS.test(text)) {
    const value = Number(text.replace(/,/g, ""));
    if (!(value > 0)) return null;
    return { text: raw.trim(), value, unit: null, notation: "unitless" };
  }
  return null;
}

// ── 2. text candidates ───────────────────────────────────────────────────────

export interface DimensionText {
  run: ExtractedTextRun;
  parsed: ParsedLength;
  /** Unit vector of the reading direction, and the normal pointing from the
   *  text's top towards its baseline (where a dimension line usually sits). */
  dir: Point;
  normal: Point;
  /** Middle of the baseline. */
  anchor: Point;
}

const runDir = (r: ExtractedTextRun): Point => r.direction ?? [1, 0];

export function dimensionTextCandidates(runs: ExtractedTextRun[]): DimensionText[] {
  const out: DimensionText[] = [];
  for (const run of runs) {
    const parsed = parseLinearDimensionText(run.text);
    if (!parsed) continue;
    const dir = runDir(run);
    out.push({ run, parsed, dir, normal: [-dir[1], dir[0]], anchor: [run.x + (dir[0] * run.width) / 2, run.y + (dir[1] * run.width) / 2] });
  }
  return out;
}

// ── 3–4. dimension line and terminators ──────────────────────────────────────

export interface Segment {
  a: Point;
  b: Point;
  /** Index of the source shape. */
  shape: number;
  /** An edge of a closed outline (a filled mark, a box), not a drawn stroke. */
  closed?: boolean;
}

/** Straight edges of the page's shapes, except closed shapes that sit inside a
 *  text run's box (text masks and highlight boxes drawn round the characters). */
export function drawingSegments(shapes: DrawingGeometry[], runs: ExtractedTextRun[]): Segment[] {
  const boxes = runs.map(textBox);
  const out: Segment[] = [];
  shapes.forEach((s, i) => {
    const closed = s.type === "polygon" || s.type === "rectangle";
    if (!closed && s.type !== "line" && s.type !== "polyline") return;
    if (closed && boxes.some((q) => s.bbox[0] >= q[0] && s.bbox[1] >= q[1] && s.bbox[2] <= q[2] && s.bbox[3] <= q[3])) return;
    const p = s.points as Point[];
    const n = closed ? p.length : p.length - 1;
    for (let k = 0; k < n; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.05) out.push({ a, b, shape: i, ...(closed ? { closed: true } : {}) });
    }
  });
  return out;
}

function textBox(r: ExtractedTextRun): [number, number, number, number] {
  const [dx, dy] = runDir(r), nx = -dy, ny = dx, h = r.height, w = r.width;
  const pts: Point[] = [[r.x, r.y], [r.x + dx * w, r.y + dy * w], [r.x + dx * w - nx * h, r.y + dy * w - ny * h], [r.x - nx * h, r.y - ny * h]];
  const m = Math.max(1, 0.5 * h);
  return [Math.min(...pts.map((p) => p[0])) - m, Math.min(...pts.map((p) => p[1])) - m, Math.max(...pts.map((p) => p[0])) + m, Math.max(...pts.map((p) => p[1])) + m];
}

export interface DimensionLine {
  a: Point;
  b: Point;
  /** Unit direction a→b, and where the text's middle projects onto the line. */
  u: Point;
  length: number;
  at: number;
  /** Signed distance from the baseline to the line, along the text normal. */
  offset: number;
  /** Other parallel lines at the same distance that give a different span. */
  alternatives: number;
  /** The line is drawn in two pieces, interrupted by the text itself, and was
   *  read as one line across that gap (common in CAD exports). */
  joinedAcrossText?: true;
  /** The other lines counted in `alternatives` (same distance, different line). */
  rivals?: DimensionLine[];
}

const PARALLEL_SIN = 0.01;

/** Does any non-parallel segment cross the line a→a+u·L between `from` and `to`
 *  (distances along the line)? Used to refuse joining two pieces across a gap
 *  that holds a terminator: then the text would sit over two dimensions. */
function crossedBetween(a: Point, u: Point, from: number, to: number, segs: Segment[]): boolean {
  return segs.some((s) => {
    const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1];
    const den = u[0] * ey - u[1] * ex;
    if (Math.abs(den) < PARALLEL_SIN * Math.hypot(ex, ey)) return false;
    const along = ((s.a[0] - a[0]) * ey - (s.a[1] - a[1]) * ex) / den;
    const on = ((s.a[0] - a[0]) * u[1] - (s.a[1] - a[1]) * u[0]) / den;
    return on >= -0.01 && on <= 1.01 && along > from && along < to;
  });
}

/** The drawn line parallel to the text, passing under (or just over) its
 *  middle: within half a text height above the baseline to 1.5 heights below.
 *  A line drawn in two pieces with the text written in the gap between them is
 *  read as one line across the gap, but only when the gap is no wider than the
 *  text (plus a text height either side), sits at the text, and nothing crosses
 *  the line inside it. */
export function findDimensionLine(t: DimensionText, segs: Segment[]): DimensionLine | null {
  const h = t.run.height;
  const found: DimensionLine[] = [];
  // pieces that are parallel and in the window but do not pass under the anchor
  const pieces: { s: Segment; u: Point; offset: number; lo: number; hi: number }[] = [];
  for (const s of segs) {
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const u: Point = [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L];
    if (Math.abs(u[0] * t.dir[1] - u[1] * t.dir[0]) > PARALLEL_SIN) continue;
    const offset = (s.a[0] - t.anchor[0]) * t.normal[0] + (s.a[1] - t.anchor[1]) * t.normal[1];
    if (offset < -0.5 * h || offset > 1.5 * h) continue;
    const at = (t.anchor[0] - s.a[0]) * u[0] + (t.anchor[1] - s.a[1]) * u[1];
    if (at >= 0 && at <= L) { found.push({ a: s.a, b: s.b, u, length: L, at, offset, alternatives: 0 }); continue; }
    // signed positions of the piece's ends along the text direction, relative to the anchor
    const pa = (s.a[0] - t.anchor[0]) * t.dir[0] + (s.a[1] - t.anchor[1]) * t.dir[1];
    const pb = (s.b[0] - t.anchor[0]) * t.dir[0] + (s.b[1] - t.anchor[1]) * t.dir[1];
    pieces.push({ s, u, offset, lo: Math.min(pa, pb), hi: Math.max(pa, pb) });
  }
  const reach = t.run.width / 2 + h;
  for (const left of pieces) {
    if (left.hi > 0 || left.hi < -reach) continue;
    const right = pieces
      .filter((r) => r.lo >= 0 && r.lo <= reach && Math.abs(r.offset - left.offset) < 0.1)
      .sort((p, q) => p.lo - q.lo)[0];
    if (!right) continue;
    if (pieces.some((o) => o !== left && Math.abs(o.offset - left.offset) < 0.1 && o.hi > left.hi + 0.05 && o.hi <= 0)) continue; // a nearer left piece exists
    const a: Point = [t.anchor[0] + t.dir[0] * left.lo + t.normal[0] * left.offset, t.anchor[1] + t.dir[1] * left.lo + t.normal[1] * left.offset];
    const b: Point = [t.anchor[0] + t.dir[0] * right.hi + t.normal[0] * left.offset, t.anchor[1] + t.dir[1] * right.hi + t.normal[1] * left.offset];
    const L = right.hi - left.lo, at = -left.lo;
    if (crossedBetween(a, t.dir, left.hi - left.lo, right.lo - left.lo, segs)) continue;
    found.push({ a, b, u: t.dir, length: L, at, offset: left.offset, alternatives: 0, joinedAcrossText: true });
  }
  if (!found.length) return null;
  found.sort((p, q) => Math.abs(p.offset) - Math.abs(q.offset) || q.length - p.length);
  const best = found[0];
  // a different line at (almost) the same distance is a real ambiguity; the same line drawn twice is not
  const sameLine = (l: DimensionLine) => Math.abs(l.offset - best.offset) < 0.05 && Math.abs(l.length - best.length) < 0.05;
  const rivals = found.filter((l) => l !== best && !sameLine(l) && Math.abs(Math.abs(l.offset) - Math.abs(best.offset)) < 0.25 * h);
  best.alternatives = rivals.length;
  if (rivals.length) best.rivals = rivals;
  return best;
}

export interface Span {
  start: Point;
  end: Point;
  /** Page units (PDF points at scale 1). */
  length: number;
  /** The terminator found at each end (see dimensionTerminators.ts). */
  ends: [TerminatorKind, TerminatorKind];
}

// ── 5. scale, per drawing region ─────────────────────────────────────────────

export interface PageScale {
  /** Printed value units per page unit, agreed by `support` dimensions. */
  valuePerPoint: number;
  support: number;
  distinctValues: number;
  /** mm per page unit when the dimensions' unit is known. */
  mmPerPoint: number | null;
  /** The drawing scale (1:N) this calibration would mean IF the values are mm —
   *  evidence for comparing with a printed scale note, never a unit decision. */
  ratioIfMm: number;
}

/** One group of dimensions on a page whose value ÷ drawn length agree: the
 *  scale of the drawing region (viewport) they belong to. A sheet can hold
 *  several (plans at 1:50, details at 1:10); none is assumed, and the ratio is
 *  never snapped to a "standard" scale. */
export interface ScaleRegion extends PageScale {
  id: string;
  /** Ids of the agreeing dimensions. */
  members: string[];
}

const SCALE_TOLERANCE = 0.015;
const MIN_CALIBRATION_SPAN = 20; // page units; shorter spans are too coarse to calibrate from
const MIN_SUPPORT = 3;

interface ScaleSample { id?: string; value: number; length: number }

function bestGroup<S extends ScaleSample>(usable: S[]): { members: S[]; ratio: number } | null {
  let best: { members: S[]; ratio: number } | null = null;
  for (const seed of usable) {
    const r = seed.value / seed.length;
    const members = usable.filter((s) => Math.abs(s.value / s.length - r) <= SCALE_TOLERANCE * r);
    const ratios = members.map((s) => s.value / s.length).sort((x, y) => x - y);
    const median = ratios[Math.floor(ratios.length / 2)];
    if (!best || members.length > best.members.length || (members.length === best.members.length && median < best.ratio))
      best = { members, ratio: median };
  }
  if (!best) return null;
  if (best.members.length < MIN_SUPPORT || new Set(best.members.map((s) => s.value)).size < MIN_SUPPORT) return null;
  return best;
}

/** The largest group of dimensions whose value ÷ drawn length agree within
 *  1.5%, from at least three different printed values. Null when no such
 *  group exists: then nothing on the page is checked against geometry. */
export function calibratePage(samples: { value: number; length: number }[]): Omit<PageScale, "mmPerPoint" | "ratioIfMm"> | null {
  const g = bestGroup(samples.filter((s) => s.length >= MIN_CALIBRATION_SPAN && s.value > 0));
  return g ? { valuePerPoint: g.ratio, support: g.members.length, distinctValues: new Set(g.members.map((s) => s.value)).size } : null;
}

/** Every agreeing group on the page, largest first: take the best group,
 *  remove its members, repeat. */
export function calibrateRegions(samples: Required<ScaleSample>[]): { id: string; valuePerPoint: number; members: Required<ScaleSample>[] }[] {
  let rest = samples.filter((s) => s.length >= MIN_CALIBRATION_SPAN && s.value > 0);
  const out: { id: string; valuePerPoint: number; members: Required<ScaleSample>[] }[] = [];
  for (let g = bestGroup(rest); g; g = bestGroup(rest)) {
    const ids = new Set(g.members.map((m) => m.id));
    out.push({ id: `S${out.length + 1}`, valuePerPoint: g.ratio, members: g.members });
    rest = rest.filter((s) => !ids.has(s.id));
  }
  return out;
}

/** "1:25", "SCALE 1 : 100" — the ratio a scale note prints, or null. */
export function scaleNoteRatio(text: string): number | null {
  const m = /(?:^|[^\d:])1\s*:\s*(\d{1,4})(?![\d:])/.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 ? n : null;
}

// ── 6–7. decisions, relations and status ────────────────────────────────────

export type DimensionStatus =
  /** value and drawn length agree with the scale of its region */
  | "consistent"
  /** a line and endpoints were found, but value and drawn length disagree */
  | "conflict"
  /** more than one line, or more than one endpoint pair, could be the one labelled */
  | "ambiguous"
  /** a line and endpoints were found but no region scale is available to check them against */
  | "unchecked"
  /** no dimension line, or no endpoint pair */
  | "unassociated";

/** Each stage's own outcome. A failure in one stage is never hidden by another. */
export interface DimensionDecisions {
  text: "detected";
  parse: "parsed";
  unit: "printed" | "page-note" | "none";
  line: "found" | "chosen-by-endpoints" | "ambiguous" | "not-found";
  endpoints: EndpointDecision | "not-attempted";
  association: AssociationDecision | "not-attempted";
  scale: "consistent" | "conflicting" | "unavailable" | "not-attempted";
  /** acceptable: every stage established; hold: some evidence, not enough; reject: no dimension evidence (no line or no terminators). */
  overall: "acceptable" | "hold" | "reject";
}

export interface ScaleCheck {
  region: string;
  /** Ratio from the region's OTHER dimensions (this one excluded). */
  valuePerPoint: number;
  basedOn: number;
  /** Drawn length converted with that ratio, in the printed value's unit. */
  measured: number;
  deviation: number;
  tolerance: number;
}

export interface LinearDimension {
  id: string;
  page: number;
  text: string;
  parsed: ParsedLength;
  /** Where the unit came from; null unit means none could be established. */
  unit: DimensionUnit | null;
  unitBasis: "printed" | "page-note" | "none";
  /** The printed value in mm, only when the unit is established. */
  statedMm: number | null;
  textAnchor: Point;
  /** Text height (page units): the scale of every geometric tolerance used for this dimension. */
  textHeight: number;
  /** joinedAcrossText: the line is drawn in two pieces with this text in the gap. */
  line: { a: Point; b: Point; joinedAcrossText?: true } | null;
  span: Span | null;
  /** Endpoint evidence: terminators considered and the decision with its reason. */
  endpoints: Endpoints | null;
  /** What each end is measured from. */
  association: Association | null;
  scaleCheck: ScaleCheck | null;
  /** Drawn length converted with the region's scale (mm only when the unit is known). */
  measured: { value: number; mm: number | null } | null;
  status: DimensionStatus;
  decisions: DimensionDecisions;
  reasons: string[];
  /** Same printed value over the same stretch as an earlier dimension: usually
   *  the same extent stated on the opposite side, but two equal rooms in line
   *  look the same, so it is flagged for review, never dropped. */
  possibleRepeatOf?: string;
  role: "single" | "chain" | "overall";
  chain?: string;
  /** For an overall dimension: the chain it totals, and whether the sum agrees. */
  covers?: { ids: string[]; sum: number; agrees: boolean };
  /** The same pair of grids dimensioned elsewhere (any page): agreeing or conflicting values. */
  crossView?: { grids: string; values: number[]; ids: string[]; conflict: boolean };
}

export interface PageDimensions {
  page: number;
  dimensions: LinearDimension[];
  /** The page's largest scale region (kept for callers that read one scale). */
  scale: PageScale | null;
  regions: ScaleRegion[];
  unitNote: { unit: string; text: string } | null;
  scaleNotes: { ratio: number; text: string; mmPerPoint: number; agreesWithCalibration: boolean | null }[];
  /** Numbers that look like lengths but were not read as dimensions, and why. */
  excluded: { text: string; at: Point; reason: string }[];
}

const PT_MM = 25.4 / 72;
/** A region covers the extent of its agreeing dimensions (their spans and text) plus this many text heights. */
const REGION_MARGIN = 10;

export function extractLinearDimensions(page: { page: number; shapes: DrawingGeometry[]; textRuns: ExtractedTextRun[] }): PageDimensions {
  const segs = drawingSegments(page.shapes, page.textRuns);
  const notes = page.textRuns.map((r) => ({ unit: unitNoteOf(r.text), text: r.text.trim() })).filter((n) => n.unit);
  const units = new Set(notes.map((n) => n.unit));
  const unitNote = units.size === 1 ? { unit: notes[0].unit as string, text: notes[0].text } : null;
  const noteUnit: DimensionUnit | null = unitNote && unitNote.unit !== "ft-in" ? (unitNote.unit as DimensionUnit) : null;

  // ── text and tags
  const excluded: PageDimensions["excluded"] = [];
  const tags: GridTag[] = [];
  const texts = dimensionTextCandidates(page.textRuns).filter((t) => {
    const tag = isScaleNoteNumber(t, page.textRuns) ? null : enclosingTag(t, page.shapes);
    const why = isScaleNoteNumber(t, page.textRuns) ? "part of a scale note"
      : tag ? "a tag inside a small closed outline (grid bubble, view or section marker)" : null;
    if (tag) tags.push({ label: t.parsed.text, ...tag });
    if (why) excluded.push({ text: t.parsed.text, at: t.anchor, reason: `Not read as a dimension: ${why}.` });
    return !why;
  });
  // non-numeric grid labels inside the same outlines are grid tags too. Grid labels are
  // letters (A, AA, A') or numbers with an optional suffix (4a, 6'); a letter-and-number
  // mark (D3, W2, SD1) is a door/window/element tag, never a grid
  for (const r of page.textRuns) {
    const label = r.text.trim();
    if (!/^[A-Z]{1,2}'?$|^\d{1,3}[a-z']$/.test(label)) continue;
    const dir = runDir(r), normal: Point = [-dir[1], dir[0]];
    const probe = { run: r, parsed: { text: label, value: 0, unit: null, notation: "unitless" as const }, dir, normal, anchor: [r.x + (dir[0] * r.width) / 2, r.y + (dir[1] * r.width) / 2] as Point };
    const c = enclosingTag(probe, page.shapes);
    if (c) tags.push({ label, ...c });
  }

  // ── line, then endpoints (the endpoints decide between equally close lines)
  const raw = texts.map((t, i) => {
    const id = `D${page.page}-${i + 1}`, h = t.run.height;
    const best = findDimensionLine(t, segs);
    if (!best) return { id, t, line: null, lineDecision: "not-found" as const, ep: null };
    const tried = [best, ...(best.rivals ?? [])].map((l) => ({ l, ep: chooseEndpoints(l, l.at, h, findTerminators(l, h, page.shapes, segs)) }));
    const valid = tried.filter((x) => x.ep.decision === "valid-pair");
    const distinct = valid.filter((x, k) => valid.findIndex((y) => Math.abs(y.ep.length! - x.ep.length!) < 0.5 && Math.hypot(y.ep.start![0] - x.ep.start![0], y.ep.start![1] - x.ep.start![1]) < 0.5) === k);
    if (tried.length === 1) return { id, t, line: best, lineDecision: "found" as const, ep: tried[0].ep };
    if (distinct.length === 1) return { id, t, line: valid[0].l, lineDecision: "chosen-by-endpoints" as const, ep: valid[0].ep };
    return { id, t, line: best, lineDecision: "ambiguous" as const, ep: tried[0].ep };
  });

  // ── scale per region, each dimension checked against the OTHER members of its region
  const samples = raw.filter((r) => r.lineDecision !== "ambiguous" && r.ep?.decision === "valid-pair").map((r) => ({ id: r.id, value: r.t.parsed.value, length: r.ep!.length! }));
  const groups = calibrateRegions(samples);
  const memberOf = new Map<string, (typeof groups)[number]>();
  for (const g of groups) for (const m of g.members) memberOf.set(m.id, g);
  const byId = new Map(raw.map((r) => [r.id, r]));
  const commonUnit = (() => {
    const us = new Set(raw.map((r) => r.t.parsed.unit ?? noteUnit));
    return us.size === 1 ? [...us][0] : null;
  })();
  const asScale = (vpp: number, support: number, distinctValues: number): PageScale =>
    ({ valuePerPoint: vpp, support, distinctValues, mmPerPoint: commonUnit ? vpp * MM_PER[commonUnit] : null, ratioIfMm: round(vpp / PT_MM, 1) });
  const regions: ScaleRegion[] = groups.map((g) => ({ id: g.id, members: g.members.map((m) => m.id), ...asScale(g.valuePerPoint, g.members.length, new Set(g.members.map((m) => m.value)).size) }));

  const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  function scaleFor(r: (typeof raw)[number]): { check: ScaleCheck | null; why: string } {
    const h = r.t.run.height, own = memberOf.get(r.id), [x, y] = r.t.anchor, margin = REGION_MARGIN * h;
    const near = groups.filter((g) => {
      const pts = g.members.filter((m) => m.id !== r.id).flatMap((m) => { const o = byId.get(m.id)!; return [o.t.anchor, o.ep!.start!, o.ep!.end!]; });
      if (!pts.length) return false;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return x >= Math.min(...xs) - margin && x <= Math.max(...xs) + margin && y >= Math.min(...ys) - margin && y <= Math.max(...ys) + margin;
    });
    const candidates = own && !near.includes(own) ? [own, ...near] : near;
    if (!candidates.length) return { check: null, why: "No agreeing group of dimensions (at least three different values) near this one, so its drawn length can't be checked." };
    const ratios = candidates.map((g) => { const others = g.members.filter((m) => m.id !== r.id); return { g, others, vpp: others.length >= MIN_SUPPORT - 1 ? median(others.map((m) => m.value / m.length)) : null }; });
    const usable = ratios.filter((x) => x.vpp !== null);
    if (!usable.length) return { check: null, why: "Its region's scale rests on too few other dimensions to check this one independently." };
    const lo = Math.min(...usable.map((x) => x.vpp!)), hi = Math.max(...usable.map((x) => x.vpp!));
    if (hi - lo > SCALE_TOLERANCE * lo) return { check: null, why: `It lies where drawing regions of different scales meet (${usable.map((x) => x.g.id).join(", ")}), so no one scale applies.` };
    const pick = usable.find((x) => x.g === own) ?? usable[0];
    const measured = r.ep!.length! * pick.vpp!;
    const tolerance = Math.max(SCALE_TOLERANCE * r.t.parsed.value, 0.3 * pick.vpp!);
    return { check: { region: pick.g.id, valuePerPoint: pick.vpp!, basedOn: pick.others.length, measured: round(measured, 1), deviation: round(measured - r.t.parsed.value, 1), tolerance: round(tolerance, 1) }, why: "" };
  }

  const dimensions: LinearDimension[] = raw.map((r) => {
    const { id, t, line, lineDecision, ep } = r;
    const h = t.run.height;
    const unit = t.parsed.unit ?? noteUnit;
    const reasons: string[] = [];
    if (!unit) reasons.push("No unit is printed with this number and the page has no note stating the dimension unit.");
    let status: DimensionStatus, measured: LinearDimension["measured"] = null, span: Span | null = null, scaleCheck: ScaleCheck | null = null, association: Association | null = null;
    let scale: DimensionDecisions["scale"] = "not-attempted";
    if (!line) { status = "unassociated"; reasons.push("No drawn line runs parallel to this text just beside it."); }
    else if (lineDecision === "ambiguous") { status = "ambiguous"; reasons.push(`${(line.rivals?.length ?? 0) + 1} different lines sit equally close to this text, and the terminators do not single one out.`); }
    else if (ep!.decision !== "valid-pair") { status = ep!.decision === "ambiguous" ? "ambiguous" : "unassociated"; reasons.push(ep!.reason); }
    else {
      span = { start: ep!.start!, end: ep!.end!, length: ep!.length!, ends: [ep!.ends![0].kind, ep!.ends![1].kind] };
      association = associateEndpoints(span.start, span.end, line.u, h, segs, tags);
      if (association.decision !== "associated") reasons.push(association.reason);
      const sc = scaleFor(r);
      if (!sc.check) { status = "unchecked"; scale = "unavailable"; reasons.push(sc.why); }
      else {
        scaleCheck = sc.check;
        measured = { value: sc.check.measured, mm: unit ? round(sc.check.measured * MM_PER[unit], 1) : null };
        if (Math.abs(sc.check.deviation) <= sc.check.tolerance) { status = "consistent"; scale = "consistent"; }
        else { status = "conflict"; scale = "conflicting"; reasons.push(`The printed ${t.parsed.text} does not match the drawn length (${round(sc.check.measured, 0)} at the scale of its region, from ${sc.check.basedOn} other dimensions): the text may label a different line, or the drawing is not to scale here. The printed value is kept.`); }
      }
    }
    if (lineDecision === "chosen-by-endpoints") reasons.push("Another line sat equally close; this one was chosen because it alone has a terminator either side of the text.");
    const noEvidence = !line || (ep && ep.decision === "unresolved" && !ep.left.length && !ep.right.length);
    const decisions: DimensionDecisions = {
      text: "detected", parse: "parsed", unit: t.parsed.unit ? "printed" : unit ? "page-note" : "none",
      line: lineDecision, endpoints: ep && lineDecision !== "ambiguous" ? ep.decision : "not-attempted",
      association: association ? association.decision : "not-attempted", scale,
      overall: noEvidence ? "reject" : status === "consistent" && unit && association?.decision === "associated" ? "acceptable" : "hold",
    };
    const trim = (xs: Terminator[]) => xs.slice(0, 3);
    return {
      id, page: page.page, text: t.parsed.text, parsed: t.parsed, unit, unitBasis: decisions.unit,
      statedMm: unit ? round(t.parsed.value * MM_PER[unit], 3) : null,
      textAnchor: t.anchor, textHeight: h,
      line: line ? { a: line.a, b: line.b, ...(line.joinedAcrossText ? { joinedAcrossText: true as const } : {}) } : null,
      span, endpoints: ep ? { ...ep, left: trim(ep.left), right: trim(ep.right) } : null, association, scaleCheck, measured,
      status, decisions, reasons, role: "single",
    };
  });

  relateDimensions(dimensions, texts.map((t) => t.dir), regions[0] ?? null);
  // an overall dimension whose parts do not add up is held
  for (const d of dimensions) if (d.covers && !d.covers.agrees && d.decisions.overall === "acceptable") d.decisions.overall = "hold";

  // scale notes: only text that says it is a scale ("SCALE 1:50", "(Scale 1:10)"), never a slope ("1:12")
  const scaleNotes = page.textRuns.flatMap((r, i) => {
    const ratio = scaleNoteRatio(r.text);
    if (!ratio || !(/scale/i.test(r.text) || /^\s*scale\s*:?\s*$/i.test(page.textRuns[i - 1]?.text ?? ""))) return [];
    const mmPerPoint = ratio * PT_MM;
    const known = regions.filter((g) => g.mmPerPoint);
    const agrees = known.length ? known.some((g) => Math.abs(g.mmPerPoint! - mmPerPoint) <= SCALE_TOLERANCE * mmPerPoint) : null;
    return [{ ratio, text: r.text.trim(), mmPerPoint: round(mmPerPoint, 4), agreesWithCalibration: agrees }];
  });

  return { page: page.page, dimensions, excluded, scale: regions[0] ?? null, regions, unitNote, scaleNotes };
}

/** Grid-to-grid dimensions of the same pair of grids anywhere in a drawing set:
 *  equal values support each other; different values are a conflict, held on
 *  every page for review (no value is chosen). */
export function relateAcrossPages(pages: PageDimensions[]): void {
  const byPair = new Map<string, LinearDimension[]>();
  for (const d of pages.flatMap((p) => p.dimensions)) {
    if (d.association?.measures !== "grid-to-grid") continue;
    const [a, b] = d.association.ends.map((e) => (e.kind === "grid" ? e.labels.join("/") : ""));
    const key = [a, b].sort().join(" ↔ ");
    byPair.set(key, [...(byPair.get(key) ?? []), d]);
  }
  for (const [grids, ds] of byPair) {
    if (ds.length < 2) continue;
    const values = [...new Set(ds.map((d) => d.parsed.value))].sort((x, y) => x - y);
    const conflict = values.length > 1;
    for (const d of ds) {
      d.crossView = { grids, values, ids: ds.map((x) => x.id), conflict };
      if (conflict) {
        d.reasons.push(`Grids ${grids} are dimensioned ${values.join(" and ")} on different views: the printed values disagree. Held for review; no value is chosen.`);
        if (d.decisions.overall === "acceptable") d.decisions.overall = "hold";
      }
    }
  }
}

/** A number written inside a small round outline — a grid bubble, a view
 *  number or a section marker — is a tag, not a length. Only curved outlines
 *  about as wide as they are tall count: boxes and hatch cells round a real
 *  dimension's text do not. */
function enclosingTag(t: DimensionText, shapes: DrawingGeometry[]): { center: Point; radius: number } | null {
  const h = t.run.height;
  // the text's own middle (the anchor is the middle of its baseline)
  const x = t.anchor[0] - (t.normal[0] * h) / 2, y = t.anchor[1] - (t.normal[1] * h) / 2;
  for (const s of shapes) {
    if (s.type !== "path") continue;
    const w = s.bbox[2] - s.bbox[0], ht = s.bbox[3] - s.bbox[1];
    if (!(w >= t.run.width && ht >= h && w <= 5 * h && ht <= 5 * h && w / ht >= 0.75 && w / ht <= 1.33)) continue;
    // a tag's text is written in the middle of its outline; a number that only
    // overlaps the outline's box (a dimension just beside a door or grid tag) is not inside it
    const cx = (s.bbox[0] + s.bbox[2]) / 2, cy = (s.bbox[1] + s.bbox[3]) / 2;
    if (Math.abs(x - cx) <= 0.25 * w && Math.abs(y - cy) <= 0.25 * ht) return { center: [cx, cy], radius: Math.max(w, ht) / 2 };
  }
  return null;
}

/** The "25" of a "1 : 25" split over several runs is not a dimension. */
function isScaleNoteNumber(t: DimensionText, runs: ExtractedTextRun[]): boolean {
  return runs.some((r) => r !== t.run && /:\s*$/.test(r.text) && Math.abs(r.y - t.run.y) < 0.5 * t.run.height && t.run.x > r.x && t.run.x - (r.x + r.width) < 2 * t.run.height);
}

/** Chains (spans end to end on one line), overall dimensions (one span equal
 *  to a whole chain) and possible repeats (same value over the same stretch).
 *  Only dimensions whose value agrees with their drawn length take part;
 *  nothing is corrected or removed. */
export function relateDimensions(dims: LinearDimension[], dirs: Point[], scale: PageScale | null): void {
  const tol = 0.75;
  // only dimensions whose value and drawn length agree (or can't yet be checked) are related
  const withSpan = dims.map((d, i) => ({ d, dir: dirs[i] })).filter((x) => x.d.span && (x.d.status === "consistent" || x.d.status === "unchecked"));
  const axis = (x: { dir: Point }) => (Math.abs(x.dir[0]) >= Math.abs(x.dir[1]) ? 0 : 1);
  const lo = (x: { d: LinearDimension; dir: Point }) => Math.min(x.d.span!.start[axis(x)], x.d.span!.end[axis(x)]);
  const hi = (x: { d: LinearDimension; dir: Point }) => Math.max(x.d.span!.start[axis(x)], x.d.span!.end[axis(x)]);
  const across = (x: { d: LinearDimension; dir: Point }) => x.d.span!.start[1 - axis(x)];

  // possible repeats: the same printed value over the same stretch (e.g. top and bottom strings)
  withSpan.forEach((x, i) => {
    const first = withSpan.slice(0, i).find((y) => !y.d.possibleRepeatOf && axis(y) === axis(x) && y.d.parsed.value === x.d.parsed.value
      && y.d.parsed.unit === x.d.parsed.unit && Math.abs(lo(y) - lo(x)) <= tol && Math.abs(hi(y) - hi(x)) <= tol);
    if (first) {
      x.d.possibleRepeatOf = first.d.id;
      x.d.reasons.push(`Same value over the same stretch as ${first.d.id}: it may state the same extent again (opposite side) or measure a different element of equal size. Confirm before counting both.`);
    }
  });

  // chains: on one line, spans that meet end to end
  const rows = new Map<string, typeof withSpan>();
  for (const x of withSpan) {
    const key = `${axis(x)}:${Math.round(across(x) / tol)}`;
    const near = [...rows.keys()].find((k) => k.startsWith(`${axis(x)}:`) && Math.abs(Number(k.split(":")[1]) - Math.round(across(x) / tol)) <= 1);
    const k = near ?? key;
    rows.set(k, [...(rows.get(k) ?? []), x]);
  }
  let chainNo = 0;
  const chains: (typeof withSpan)[] = [];
  for (const row of rows.values()) {
    const sorted = [...row].sort((p, q) => lo(p) - lo(q));
    let run: typeof withSpan = [];
    const flush = () => {
      if (run.length >= 2) {
        const id = `C${dims[0]?.page ?? 0}-${++chainNo}`;
        for (const x of run) { x.d.role = "chain"; x.d.chain = id; }
        chains.push(run);
      }
      run = [];
    };
    for (const x of sorted) {
      if (run.length && Math.abs(lo(x) - hi(run[run.length - 1])) > tol) flush();
      run.push(x);
    }
    flush();
  }

  // overall: one span equal to a contiguous stretch of a chain on another line
  for (const x of withSpan) {
    if (x.d.possibleRepeatOf) continue;
    for (const chain of chains) {
      if (axis(chain[0]) !== axis(x) || chain.includes(x)) continue;
      const i = chain.findIndex((c) => Math.abs(lo(c) - lo(x)) <= tol);
      const j = chain.findIndex((c) => Math.abs(hi(c) - hi(x)) <= tol);
      if (i < 0 || j < i || j === i) continue;
      const parts = chain.slice(i, j + 1);
      const sum = parts.reduce((s, c) => s + c.d.parsed.value, 0);
      const agrees = Math.abs(sum - x.d.parsed.value) <= (scale ? 0.5 * scale.valuePerPoint : 0) + 1e-9;
      x.d.role = "overall";
      x.d.covers = { ids: parts.map((c) => c.d.id), sum, agrees };
      if (!agrees) x.d.reasons.push(`The parts it covers add up to ${sum}, not ${x.d.parsed.value}: the printed values disagree.`);
      break;
    }
  }
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
export { PT_MM };
