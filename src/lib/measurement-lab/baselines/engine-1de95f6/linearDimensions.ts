// FROZEN COPY of src/lib/review/linearDimensions.ts at commit 1de95f68f45abed3f8322cb04d786fe707a3f348 (the
// recovered engine), kept so the Measurement Lab can run the old and the current engine side by side.
// Byte-identical to the original except this header and the import specifiers below, which point at
// the shared, unchanged modules; baselineIntegrity.test.ts proves it. NEVER EDIT.
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

import type { DrawingGeometry } from "@/lib/review/drawingGeometry";
import type { ExtractedTextRun } from "./pdfGeometry";
import { unitNoteOf } from "@/lib/review/drawingInventory";

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
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.05) out.push({ a, b, shape: i });
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
}

const PARALLEL_SIN = 0.01;

/** The drawn line parallel to the text, passing under (or just over) its
 *  middle: within half a text height above the baseline to 1.5 heights below. */
export function findDimensionLine(t: DimensionText, segs: Segment[]): DimensionLine | null {
  const h = t.run.height;
  const found: DimensionLine[] = [];
  for (const s of segs) {
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const u: Point = [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L];
    if (Math.abs(u[0] * t.dir[1] - u[1] * t.dir[0]) > PARALLEL_SIN) continue;
    const at = (t.anchor[0] - s.a[0]) * u[0] + (t.anchor[1] - s.a[1]) * u[1];
    if (at < 0 || at > L) continue;
    const offset = (s.a[0] - t.anchor[0]) * t.normal[0] + (s.a[1] - t.anchor[1]) * t.normal[1];
    if (offset < -0.5 * h || offset > 1.5 * h) continue;
    found.push({ a: s.a, b: s.b, u, length: L, at, offset, alternatives: 0 });
  }
  if (!found.length) return null;
  found.sort((p, q) => Math.abs(p.offset) - Math.abs(q.offset) || q.length - p.length);
  const best = found[0];
  // a different line at (almost) the same distance is a real ambiguity; the same line drawn twice is not
  const sameLine = (l: DimensionLine) => Math.abs(l.offset - best.offset) < 0.05 && Math.abs(l.length - best.length) < 0.05;
  best.alternatives = found.filter((l) => l !== best && !sameLine(l) && Math.abs(Math.abs(l.offset) - Math.abs(best.offset)) < 0.25 * h).length;
  return best;
}

export interface Span {
  start: Point;
  end: Point;
  /** Page units (PDF points at scale 1). */
  length: number;
  /** How each end was found: a crossing extension line or tick, or the
   *  dimension line's own end (when nothing crosses it there). */
  ends: ["terminator" | "line-end", "terminator" | "line-end"];
}

/** The nearest terminator on each side of the text. A terminator is a
 *  non-parallel drawn segment that meets the dimension line and ENDS near it
 *  (an extension line's overshoot, a tick or an arrowhead) — a wall or grid
 *  line passing straight through is not one. */
export function findSpan(t: DimensionText, line: DimensionLine, segs: Segment[]): Span | null {
  const reach = 1.5 * t.run.height;
  const { a, u, length: L, at } = line;
  const hits: number[] = [];
  for (const s of segs) {
    const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1];
    const segL = Math.hypot(ex, ey);
    const den = u[0] * ey - u[1] * ex;
    if (Math.abs(den) < PARALLEL_SIN * segL) continue;
    const along = ((s.a[0] - a[0]) * ey - (s.a[1] - a[1]) * ex) / den;
    const on = ((s.a[0] - a[0]) * u[1] - (s.a[1] - a[1]) * u[0]) / den;
    if (on < -0.01 || on > 1.01 || along < -0.5 || along > L + 0.5) continue;
    if (Math.min(on, 1 - on) * segL > reach) continue;
    hits.push(along);
  }
  const before = hits.filter((s) => s < at - 0.5), after = hits.filter((s) => s > at + 0.5);
  const s0 = before.length ? Math.max(...before) : 0;
  const s1 = after.length ? Math.min(...after) : L;
  const ends: Span["ends"] = [before.length ? "terminator" : "line-end", after.length ? "terminator" : "line-end"];
  if (ends[0] === "line-end" && ends[1] === "line-end") return null;
  const p = (s: number): Point => [a[0] + u[0] * s, a[1] + u[1] * s];
  return { start: p(s0), end: p(s1), length: s1 - s0, ends };
}

// ── 5. the page's own scale ──────────────────────────────────────────────────

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

const SCALE_TOLERANCE = 0.015;
const MIN_CALIBRATION_SPAN = 20; // page units; shorter spans are too coarse to calibrate from
const MIN_SUPPORT = 3;

/** The largest group of dimensions whose value ÷ drawn length agree within
 *  1.5%, from at least three different printed values. Null when no such
 *  group exists: then nothing on the page is checked against geometry. */
export function calibratePage(samples: { value: number; length: number }[]): Omit<PageScale, "mmPerPoint" | "ratioIfMm"> | null {
  const usable = samples.filter((s) => s.length >= MIN_CALIBRATION_SPAN && s.value > 0);
  let best: { members: typeof usable; ratio: number } | null = null;
  for (const seed of usable) {
    const r = seed.value / seed.length;
    const members = usable.filter((s) => Math.abs(s.value / s.length - r) <= SCALE_TOLERANCE * r);
    const ratios = members.map((s) => s.value / s.length).sort((x, y) => x - y);
    const median = ratios[Math.floor(ratios.length / 2)];
    if (!best || members.length > best.members.length || (members.length === best.members.length && median < best.ratio))
      best = { members, ratio: median };
  }
  if (!best) return null;
  const distinctValues = new Set(best.members.map((s) => s.value)).size;
  if (best.members.length < MIN_SUPPORT || distinctValues < MIN_SUPPORT) return null;
  return { valuePerPoint: best.ratio, support: best.members.length, distinctValues };
}

/** "1:25", "SCALE 1 : 100" — the ratio a scale note prints, or null. */
export function scaleNoteRatio(text: string): number | null {
  const m = /(?:^|[^\d:])1\s*:\s*(\d{1,4})(?![\d:])/.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 ? n : null;
}

// ── 6–7. relations and status ────────────────────────────────────────────────

export type DimensionStatus =
  /** value and drawn length agree with the page's calibrated scale */
  | "consistent"
  /** a line and span were found, but value and drawn length disagree */
  | "conflict"
  /** more than one line could be the one labelled */
  | "ambiguous"
  /** a line and span were found but the page has no calibrated scale to check them against */
  | "unchecked"
  /** no dimension line or no terminators found */
  | "unassociated";

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
  line: { a: Point; b: Point } | null;
  span: Span | null;
  /** Drawn length converted with the page's calibrated scale (mm only when the unit is known). */
  measured: { value: number; mm: number | null } | null;
  status: DimensionStatus;
  reasons: string[];
  /** Same printed value over the same stretch as an earlier dimension: usually
   *  the same extent stated on the opposite side, but two equal rooms in line
   *  look the same, so it is flagged for review, never dropped. */
  possibleRepeatOf?: string;
  role: "single" | "chain" | "overall";
  chain?: string;
  /** For an overall dimension: the chain it totals, and whether the sum agrees. */
  covers?: { ids: string[]; sum: number; agrees: boolean };
}

export interface PageDimensions {
  page: number;
  dimensions: LinearDimension[];
  scale: PageScale | null;
  unitNote: { unit: string; text: string } | null;
  scaleNotes: { ratio: number; text: string; mmPerPoint: number; agreesWithCalibration: boolean | null }[];
  /** Numbers that look like lengths but were not read as dimensions, and why. */
  excluded: { text: string; at: Point; reason: string }[];
}

const PT_MM = 25.4 / 72;

export function extractLinearDimensions(page: { page: number; shapes: DrawingGeometry[]; textRuns: ExtractedTextRun[] }): PageDimensions {
  const segs = drawingSegments(page.shapes, page.textRuns);
  const notes = page.textRuns.map((r) => ({ unit: unitNoteOf(r.text), text: r.text.trim() })).filter((n) => n.unit);
  const units = new Set(notes.map((n) => n.unit));
  const unitNote = units.size === 1 ? { unit: notes[0].unit as string, text: notes[0].text } : null;
  const noteUnit: DimensionUnit | null = unitNote && unitNote.unit !== "ft-in" ? (unitNote.unit as DimensionUnit) : null;

  const excluded: PageDimensions["excluded"] = [];
  const texts = dimensionTextCandidates(page.textRuns).filter((t) => {
    const why = isScaleNoteNumber(t, page.textRuns) ? "part of a scale note"
      : enclosingTag(t, page.shapes) ? "a tag inside a small closed outline (grid bubble, view or section marker)" : null;
    if (why) excluded.push({ text: t.parsed.text, at: t.anchor, reason: `Not read as a dimension: ${why}.` });
    return !why;
  });
  const raw = texts.map((t, i) => {
    const line = findDimensionLine(t, segs);
    const span = line ? findSpan(t, line, segs) : null;
    return { id: `D${page.page}-${i + 1}`, t, line, span };
  });

  const cal = calibratePage(raw.filter((r) => r.span && !r.line!.alternatives).map((r) => ({ value: r.t.parsed.value, length: r.span!.length })));
  const commonUnit = (() => {
    const us = new Set(raw.map((r) => r.t.parsed.unit ?? noteUnit));
    return us.size === 1 ? [...us][0] : null;
  })();
  const scale: PageScale | null = cal
    ? { ...cal, mmPerPoint: commonUnit ? cal.valuePerPoint * MM_PER[commonUnit] : null, ratioIfMm: round(cal.valuePerPoint / PT_MM, 1) }
    : null;

  const dimensions: LinearDimension[] = raw.map(({ id, t, line, span }) => {
    const unit = t.parsed.unit ?? noteUnit;
    const reasons: string[] = [];
    if (!unit) reasons.push("No unit is printed with this number and the page has no note stating the dimension unit.");
    let status: DimensionStatus;
    let measured: LinearDimension["measured"] = null;
    if (!line) { status = "unassociated"; reasons.push("No drawn line runs parallel to this text just beside it."); }
    else if (!span) { status = "unassociated"; reasons.push("The dimension line has no extension line or tick on either side of the text."); }
    else if (line.alternatives) { status = "ambiguous"; reasons.push(`${line.alternatives + 1} different lines sit equally close to this text.`); }
    else if (!scale) { status = "unchecked"; reasons.push("The page has no calibrated scale (fewer than three dimensions agree), so the drawn length can't be checked."); }
    else {
      const value = span.length * scale.valuePerPoint;
      measured = { value: round(value, 1), mm: unit ? round(value * MM_PER[unit], 1) : null };
      const tol = Math.max(SCALE_TOLERANCE * t.parsed.value, 0.3 * scale.valuePerPoint);
      if (Math.abs(value - t.parsed.value) <= tol) status = "consistent";
      else { status = "conflict"; reasons.push(`The printed ${t.parsed.text} does not match the drawn length (${round(value, 0)} at this page's scale): the text may label a different line.`); }
    }
    if (span && span.ends.includes("line-end")) reasons.push("One end is the dimension line's own end: no extension line or tick was found there.");
    return {
      id, page: page.page, text: t.parsed.text, parsed: t.parsed, unit, unitBasis: t.parsed.unit ? "printed" : unit ? "page-note" : "none",
      statedMm: unit ? round(t.parsed.value * MM_PER[unit], 3) : null,
      textAnchor: t.anchor, line: line ? { a: line.a, b: line.b } : null, span, measured, status, reasons, role: "single",
    };
  });

  relateDimensions(dimensions, texts.map((t) => t.dir), scale);

  const scaleNotes = page.textRuns.flatMap((r) => {
    const ratio = scaleNoteRatio(r.text);
    if (!ratio) return [];
    const mmPerPoint = ratio * PT_MM;
    const agrees = scale?.mmPerPoint ? Math.abs(scale.mmPerPoint - mmPerPoint) <= SCALE_TOLERANCE * mmPerPoint : null;
    return [{ ratio, text: r.text.trim(), mmPerPoint: round(mmPerPoint, 4), agreesWithCalibration: agrees }];
  });

  return { page: page.page, dimensions, excluded, scale, unitNote, scaleNotes };
}

/** A number written inside a small round outline — a grid bubble, a view
 *  number or a section marker — is a tag, not a length. Only curved outlines
 *  about as wide as they are tall count: boxes and hatch cells round a real
 *  dimension's text do not. */
function enclosingTag(t: DimensionText, shapes: DrawingGeometry[]): boolean {
  const h = t.run.height, [x, y] = t.anchor;
  return shapes.some((s) => {
    if (s.type !== "path") return false;
    const w = s.bbox[2] - s.bbox[0], ht = s.bbox[3] - s.bbox[1];
    return s.bbox[0] <= x && s.bbox[2] >= x && s.bbox[1] <= y && s.bbox[3] >= y
      && w >= t.run.width && ht >= h && w <= 5 * h && ht <= 5 * h && w / ht >= 0.75 && w / ht <= 1.33;
  });
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
