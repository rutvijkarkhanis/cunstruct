/**
 * Per-measurement results ledger: one row per reference (Gold Set) dimension, joining the
 * reference record and the frozen engine's output for it, with one outcome per stage.
 *
 * Measurement-quality tooling only. Nothing in the product imports this module, and it imports
 * only TYPES from the engine (erased at build time), so it cannot run or change the engine.
 *
 * The scoring rules are a line-for-line port of the historical scorer (score2.py) so that the
 * recomputed figures can be compared item by item with the historical ones. Each rule is stated
 * next to the code; metric definitions are in docs/measurement-quality/METRICS.md.
 */
import type { LinearDimension, PageDimensions, Point } from "@/lib/review/linearDimensions";

export const LEDGER_SCHEMA = "cunstruct.measurement-ledger.v1";

/** A Gold Set linear-dimension record, as stored (fields the ledger reads). */
export interface ReferenceDimension {
  gold_id: string;
  source_id?: string;
  kind: "linear_dimension";
  file: string;
  sha256: string;
  page: number;
  view: string;
  view_scale: string;
  printed_text: string;
  value: number;
  /** null when the drawing states no unit (the engine must then report none). */
  unit: string | null;
  orientation: "horizontal" | "vertical";
  text_center_pt: Point;
  endpoints_pt: [Point, Point] | null;
  endpoint_method?: string;
  associated_element: string;
  association_basis?: string;
  reference_status: string;
  verification: string;
  amendments?: { date: string; field: string; from: unknown; to: unknown; why: string; trigger?: string }[];
}

export type DetectionOutcome = "found" | "missed";
export type ParseOutcome = "correct" | "incorrect-value" | "incorrect-unit" | "not-applicable";
export type LineOutcome = "correct" | "incorrect" | "multiple-plausible" | "none" | "no-reference" | "not-applicable";
export type EndpointOutcome =
  | "correct-pair" | "wrong-pair" | "one-sided-match" | "one-sided-wrong" | "ambiguous" | "unresolved"
  | "not-attempted" | "no-reference" | "not-applicable";
export type AssociationOutcome =
  | "correct" | "incorrect" | "ambiguous" | "unassociated" | "associated-unscored" | "not-attempted" | "not-applicable";
export type FinalOutcome =
  | "correctly-accepted" | "incorrectly-accepted"
  | "correctly-held" | "unnecessarily-held"
  | "correctly-rejected" | "incorrectly-rejected"
  | "missed";

/** Reference statuses for which the reference itself names one unambiguous answer. Every other
 *  status (CONFLICT, GEOMETRY-INCONSISTENT, NOT-DERIVABLE, ASSOCIATION-UNCERTAIN) means a reviewer
 *  should see the item: holding or rejecting it is correct, accepting it is not. */
export const DETERMINED_STATUS = "OK";

export type EndRef = { kind: "grid"; label: string } | { kind: "edge" };

export interface LedgerRow {
  measurement_id: string;
  source_ref: string | null;
  source_pdf: string;
  source_sha256: string;
  page: number;
  view: string;
  view_scale: string;
  /** The reference exactly as stored, including any amendment history (never overwritten). */
  reference: {
    printed_text: string;
    value: number;
    unit: string | null;
    orientation: string;
    text_center_pt: Point;
    endpoints_pt: [Point, Point] | null;
    associated_element: string;
    /** associated_element before any amendment (equal to it when never amended). */
    associated_element_original: string;
    association_basis: string | null;
    parsed_ends: [EndRef, EndRef] | null;
    status: string;
    verification: string;
    amendments: NonNullable<ReferenceDimension["amendments"]>;
  };
  /** The engine's record for the matched dimension, copied verbatim from its output (null when missed). */
  engine: null | {
    id: string;
    text: string;
    parsed_value: number;
    unit: string | null;
    unit_basis: string;
    text_anchor: Point;
    text_height: number;
    line: LinearDimension["line"];
    span: LinearDimension["span"];
    endpoint_decision: string;
    endpoint_reason: string | null;
    terminators: { start: string; end: string } | null;
    terminator_evidence: string[];
    association: LinearDimension["association"];
    scale_region: string | null;
    scale_check: LinearDimension["scaleCheck"];
    measured_mm: number | null;
    status: string;
    decisions: LinearDimension["decisions"];
    reasons: string[];
    cross_view: LinearDimension["crossView"] | null;
    covers: LinearDimension["covers"] | null;
  };
  outcomes: {
    detection: DetectionOutcome;
    parse: ParseOutcome;
    line: LineOutcome;
    endpoints: EndpointOutcome;
    association: AssociationOutcome;
    scale: string;
    conflict: "none" | "cross-view-conflict" | "chain-disagrees";
    overall: "acceptable" | "hold" | "reject" | "missed";
    final: FinalOutcome;
  };
  /** Line on the reference axis even though the engine called it ambiguous (diagnostic only). */
  line_on_reference_axis: boolean | null;
  /** false when the reference does not say what is measured (e.g. R0): association is then not scored,
   *  and fully_correct covers parse and endpoints only. Always reported next to any acceptance count. */
  association_scorable: boolean;
  fully_correct: boolean;
  reference_determined: boolean;
  /** Accepted: the gates passed. Held/rejected: the engine's own reasons, verbatim. */
  final_reason: string;
  association_detail: string | null;
}

/** Per end of a reference dimension: a named grid, or a drawn edge. Port of score2.gold_ends:
 *  a one-sided description is an element measured edge to edge (a thickness, pier, clear width)
 *  unless it starts with "grid"; a side counts as a grid only when it IS a grid ("grid 7"), not a
 *  face located on one ("face on grid 6"). Returns null when the text cannot be read as two ends. */
export function parseReferenceEnds(associated: string): [EndRef, EndRef] | null {
  if (!associated.trim()) return null; // the reference does not say what is measured
  const sides = associated.split("->");
  if (sides.length === 1 && !/^\s*grid /.test(sides[0])) return [{ kind: "edge" }, { kind: "edge" }];
  if (sides.length !== 2) return null;
  return sides.map((s): EndRef => {
    const m = /^\s*(?:[A-Z]{2,3}:\s*)?grid ([A-Za-z0-9']+)/.exec(s);
    return m ? { kind: "grid", label: m[1] } : { kind: "edge" };
  }) as [EndRef, EndRef];
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Matching rule (port of score2): in reference order, the nearest not-yet-used engine dimension on
 *  the same page with the same parsed value whose text anchor is within 12 pt of the reference text
 *  centre. Each engine dimension is matched at most once. */
export const MATCH_RADIUS_PT = 12;
export function matchReferences(refs: ReferenceDimension[], pages: PageDimensions[]): Map<string, LinearDimension | null> {
  const byPage = new Map(pages.map((p) => [p.page, p]));
  const used = new Set<string>();
  const out = new Map<string, LinearDimension | null>();
  for (const g of refs) {
    const P = byPage.get(g.page);
    const cands = (P?.dimensions ?? []).filter((d) => !used.has(d.id) && d.parsed.value === g.value && dist(d.textAnchor, g.text_center_pt) <= MATCH_RADIUS_PT);
    const d = cands.length ? cands.reduce((m, x) => (dist(x.textAnchor, g.text_center_pt) < dist(m.textAnchor, g.text_center_pt) ? x : m)) : null;
    if (d) used.add(d.id);
    out.set(g.gold_id, d);
  }
  return out;
}

/** Tolerances (pt) used by the historical scorer. */
export const LINE_AXIS_TOL = 0.5;
export const ENDPOINT_TOL = 1.0;

const originalOf = (g: ReferenceDimension, field: string, current: unknown) => {
  const first = (g.amendments ?? []).find((a) => a.field === field);
  return first ? first.from : current;
};

export function buildLedgerRow(g: ReferenceDimension, d: LinearDimension | null): LedgerRow {
  const hz = g.orientation === "horizontal";
  const A = hz ? 0 : 1, Q = hz ? 1 : 0; // along, across
  const ge = g.endpoints_pt;
  const refEnds = parseReferenceEnds(g.associated_element);
  const determined = g.reference_status === DETERMINED_STATUS;
  const reference: LedgerRow["reference"] = {
    printed_text: g.printed_text, value: g.value, unit: g.unit, orientation: g.orientation,
    text_center_pt: g.text_center_pt, endpoints_pt: ge, associated_element: g.associated_element,
    associated_element_original: String(originalOf(g, "associated_element", g.associated_element)),
    association_basis: g.association_basis ?? null, parsed_ends: refEnds, status: g.reference_status,
    verification: g.verification, amendments: g.amendments ?? [],
  };
  const base = {
    measurement_id: g.gold_id, source_ref: g.source_id ?? null, source_pdf: g.file, source_sha256: g.sha256,
    page: g.page, view: g.view, view_scale: g.view_scale, reference, reference_determined: determined,
  };
  if (!d) {
    return {
      ...base, engine: null, line_on_reference_axis: null, association_scorable: refEnds !== null, fully_correct: false, association_detail: null,
      outcomes: { detection: "missed", parse: "not-applicable", line: "not-applicable", endpoints: "not-applicable", association: "not-applicable", scale: "not-applicable", conflict: "none", overall: "missed", final: "missed" },
      final_reason: "No engine dimension matched this reference (same page, same value, text within 12 pt).",
    };
  }

  // parse: value and unit must both equal the reference
  const parse: ParseOutcome = d.parsed.value !== g.value ? "incorrect-value" : d.unit !== g.unit ? "incorrect-unit" : "correct";

  // line: on the reference axis = both ends of the detected line within 0.5 pt of the reference
  // dimension line, measured across it (extent is judged by the endpoint stage, not here)
  const onAxis = d.line && ge ? Math.abs(d.line.a[Q] - ge[0][Q]) <= LINE_AXIS_TOL && Math.abs(d.line.b[Q] - ge[0][Q]) <= LINE_AXIS_TOL : null;
  const lineDec = d.decisions.line;
  const line: LineOutcome = lineDec === "not-found" ? "none" : lineDec === "ambiguous" ? "multiple-plausible" : onAxis === null ? "no-reference" : onAxis ? "correct" : "incorrect";

  // endpoints
  let endpoints: EndpointOutcome;
  const epDec = d.decisions.endpoints;
  if (!ge) endpoints = "no-reference";
  else if (d.span) {
    const s = [d.span.start[A], d.span.end[A]].sort((x, y) => x - y), t = [ge[0][A], ge[1][A]].sort((x, y) => x - y);
    const ok = Math.abs(s[0] - t[0]) <= ENDPOINT_TOL && Math.abs(s[1] - t[1]) <= ENDPOINT_TOL && Math.abs(d.span.start[Q] - ge[0][Q]) <= ENDPOINT_TOL;
    endpoints = ok ? "correct-pair" : "wrong-pair";
  } else if (epDec === "one-sided" && d.line && d.endpoints) {
    const side = (d.endpoints.left[0] ?? d.endpoints.right[0]);
    const L = dist(d.line.a, d.line.b), u: Point = [(d.line.b[0] - d.line.a[0]) / L, (d.line.b[1] - d.line.a[1]) / L];
    const p: Point = [d.line.a[0] + u[0] * side.at, d.line.a[1] + u[1] * side.at];
    endpoints = ge.some((x) => Math.abs(p[A] - x[A]) <= ENDPOINT_TOL) ? "one-sided-match" : "one-sided-wrong";
  } else endpoints = epDec === "ambiguous" ? "ambiguous" : epDec === "unresolved" ? "unresolved" : "not-attempted";

  // association: scored only when the endpoint pair is correct and the reference can be read
  const a = d.association;
  let association: AssociationOutcome, detail: string | null = null;
  if (!a) association = "not-attempted";
  else if (a.decision !== "associated") association = a.decision;
  else if (endpoints !== "correct-pair" || !refEnds) association = "associated-unscored";
  else {
    const eng: EndRef[] = a.ends.map((e) => (e.kind === "grid" ? { kind: "grid", label: e.labels.join("/") } : { kind: "edge" }));
    const labels = a.ends.map((e) => (e.kind === "grid" ? e.labels : []));
    const m = (r: EndRef, i: number) => r.kind === eng[i].kind && (r.kind === "edge" || labels[i].includes((r as { label: string }).label));
    const ok = (m(refEnds[0], 0) && m(refEnds[1], 1)) || (m(refEnds[0], 1) && m(refEnds[1], 0));
    association = ok ? "correct" : "incorrect";
    detail = `reference ${JSON.stringify(refEnds)} engine ${JSON.stringify(eng)}`;
  }

  const conflict = d.crossView?.conflict ? "cross-view-conflict" : d.covers && !d.covers.agrees ? "chain-disagrees" : "none";
  const overall = d.decisions.overall;
  const fully = parse === "correct" && endpoints === "correct-pair" && (refEnds ? association === "correct" : true);
  const final: FinalOutcome = overall === "acceptable"
    ? (fully && determined ? "correctly-accepted" : "incorrectly-accepted")
    : overall === "hold" ? (determined ? "unnecessarily-held" : "correctly-held")
    : (determined ? "incorrectly-rejected" : "correctly-rejected");

  const marks = d.endpoints?.ends;
  return {
    ...base,
    engine: {
      id: d.id, text: d.text, parsed_value: d.parsed.value, unit: d.unit, unit_basis: d.unitBasis,
      text_anchor: d.textAnchor, text_height: d.textHeight, line: d.line, span: d.span,
      endpoint_decision: epDec, endpoint_reason: d.endpoints?.reason ?? null,
      terminators: marks ? { start: marks[0].kind, end: marks[1].kind } : null,
      terminator_evidence: [...(d.endpoints?.left ?? []), ...(d.endpoints?.right ?? [])].map((t) => `${t.kind} at ${t.at.toFixed(2)}: ${t.evidence}`),
      association: a, scale_region: d.scaleCheck?.region ?? null, scale_check: d.scaleCheck,
      measured_mm: d.measured?.mm ?? null, status: d.status, decisions: d.decisions, reasons: d.reasons,
      cross_view: d.crossView ?? null, covers: d.covers ?? null,
    },
    outcomes: { detection: "found", parse, line, endpoints, association, scale: d.decisions.scale, conflict, overall, final },
    line_on_reference_axis: onAxis,
    association_scorable: refEnds !== null,
    fully_correct: fully,
    final_reason: overall === "acceptable" ? acceptedGates(d).join("; ") : d.reasons.join(" | "),
    association_detail: detail,
  };
}

/** The gates every accepted measurement must have passed (asserted by the accounting checks). */
export function acceptedGates(d: Pick<LinearDimension, "decisions" | "unit" | "crossView" | "covers">): string[] {
  const g = d.decisions;
  return [
    `text ${g.text}`, `parse ${g.parse}`, `unit ${g.unit}`, `line ${g.line}`, `endpoints ${g.endpoints}`,
    `association ${g.association}`, `scale ${g.scale}`,
    d.crossView?.conflict ? "CROSS-VIEW CONFLICT" : "no cross-view conflict",
    d.covers && !d.covers.agrees ? "CHAIN DISAGREES" : "no chain disagreement",
  ];
}

/** Gate failures for an accepted measurement (empty = every required gate passed). */
export function failedAcceptanceGates(d: Pick<LinearDimension, "decisions" | "unit" | "crossView" | "covers">): string[] {
  const g = d.decisions, f: string[] = [];
  if (g.text !== "detected") f.push("text");
  if (g.parse !== "parsed") f.push("parse");
  if (!d.unit || g.unit === "none") f.push("unit");
  if (g.line !== "found" && g.line !== "chosen-by-endpoints") f.push("line");
  if (g.endpoints !== "valid-pair") f.push("endpoints");
  if (g.association !== "associated") f.push("association");
  if (g.scale !== "consistent") f.push("scale");
  if (d.crossView?.conflict) f.push("cross-view conflict");
  if (d.covers && !d.covers.agrees) f.push("chain total");
  return f;
}

export function buildLedger(refs: ReferenceDimension[], pages: PageDimensions[]): LedgerRow[] {
  const m = matchReferences(refs, pages);
  return refs.map((g) => buildLedgerRow(g, m.get(g.gold_id) ?? null));
}
