/**
 * MEASUREMENT ACCURACY LAB — core (pure; no React, no database, no BOQ).
 *
 * Runs two measurement engines on an uploaded drawing, freezes each run (content-hashed, deep-frozen),
 * keeps human verdicts in an append-only hash-chained log, compares both engines against a reference
 * and against those verdicts, and builds a report. It never changes an engine: the current engine is
 * imported as-is and the recovered 1de95f6 engine runs from a frozen copy. Nothing here writes to the
 * BOQ, pricing, exports or the review/apply path.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractPageGeometry as currentGeometry } from "@/lib/review/pdfGeometry";
import { extractLinearDimensions as currentDimensions, relateAcrossPages, type LinearDimension } from "@/lib/review/linearDimensions";
import { extractPageGeometry as baselineGeometry } from "./baselines/engine-1de95f6/pdfGeometry";
import { extractLinearDimensions as baselineDimensions, type LinearDimension as BaselineDimension } from "./baselines/engine-1de95f6/linearDimensions";
import { parseReferenceEnds, type ReferenceDimension } from "@/lib/measurement-quality/ledger";

import { deepFreeze, GENESIS, sha256Hex, stableStringify } from "./hashing";
export { GENESIS, sha256Hex, stableStringify } from "./hashing";

// ── engines ─────────────────────────────────────────────────────────────────
type P = [number, number];
export type LabDecision = "accepted" | "held" | "rejected";
/** One engine measurement in a shape both engines share. */
export interface LabMeasurement {
  id: string;
  page: number;
  text: string;
  value: number;
  unit: string | null;
  textAnchor: P;
  line: { a: P; b: P } | null;
  span: { start: P; end: P; length: number } | null;
  decision: LabDecision;
  /** the engine's own status word, verbatim */
  status: string;
  reasons: string[];
  /** current engine only; null when the engine does not decide what is measured */
  association: { decision: string; measures: string | null; ends: { kind: string; labels?: string[] }[] } | null;
}

export const ENGINES = {
  "engine-1de95f6": {
    label: "Recovered engine (1de95f6)",
    source: "frozen copy of commit 1de95f68f45abed3f8322cb04d786fe707a3f348: linearDimensions.ts sha256 ffd5cbec…, pdfGeometry.ts sha256 19f916d1…",
    decisionRule: "accepted = status 'consistent'; rejected = 'unassociated' (no line or no terminators); held = conflict, ambiguous or unchecked",
  },
  "engine-9ac1f71": {
    label: "Current engine (9ac1f71)",
    source: "src/lib/review engine at commit 9ac1f71, candidate fingerprint 6a3170872cdb8a8d…, core four c7c771d8…",
    decisionRule: "accepted = decisions.overall 'acceptable'; held = 'hold'; rejected = 'reject'",
  },
} as const;
export type EngineId = keyof typeof ENGINES;

const r2 = (p: P): P => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
function fromCurrent(d: LinearDimension): LabMeasurement {
  return {
    id: d.id, page: d.page, text: d.text, value: d.parsed.value, unit: d.unit, textAnchor: r2(d.textAnchor),
    line: d.line ? { a: r2(d.line.a), b: r2(d.line.b) } : null,
    span: d.span ? { start: r2(d.span.start), end: r2(d.span.end), length: Math.round(d.span.length * 1000) / 1000 } : null,
    decision: d.decisions.overall === "acceptable" ? "accepted" : d.decisions.overall === "hold" ? "held" : "rejected",
    status: d.decisions.overall, reasons: [...d.reasons],
    association: d.association ? { decision: d.association.decision, measures: d.association.measures, ends: d.association.ends.map((e) => (e.kind === "grid" ? { kind: "grid", labels: [...e.labels] } : { kind: e.kind })) } : null,
  };
}
function fromBaseline(d: BaselineDimension): LabMeasurement {
  return {
    id: d.id, page: d.page, text: d.text, value: d.parsed.value, unit: d.unit, textAnchor: r2(d.textAnchor),
    line: d.line ? { a: r2(d.line.a), b: r2(d.line.b) } : null,
    span: d.span ? { start: r2(d.span.start), end: r2(d.span.end), length: Math.round(d.span.length * 1000) / 1000 } : null,
    decision: d.status === "consistent" ? "accepted" : d.status === "unassociated" ? "rejected" : "held",
    status: d.status, reasons: [...d.reasons], association: null,
  };
}

/** Runs one engine on the given pages of an opened PDF. Returns normalized measurements and the raw output. */
export async function runEngineOn(engine: EngineId, doc: PDFDocumentProxy, pages: number[]): Promise<{ measurements: LabMeasurement[]; raw: unknown }> {
  if (engine === "engine-9ac1f71") {
    const out = [];
    for (const n of pages) out.push(currentDimensions(await currentGeometry(await doc.getPage(n), n)));
    relateAcrossPages(out);
    return { measurements: out.flatMap((p) => p.dimensions.map(fromCurrent)), raw: out };
  }
  const out = [];
  for (const n of pages) out.push(baselineDimensions(await baselineGeometry(await doc.getPage(n), n)));
  return { measurements: out.flatMap((p) => p.dimensions.map(fromBaseline)), raw: out };
}

// ── frozen runs ─────────────────────────────────────────────────────────────
export interface FrozenRun {
  schema: "cunstruct.lab-run.v1";
  run_id: string;
  engine: { id: EngineId; label: string; source: string; decision_rule: string };
  input: { name: string; sha256: string; pages: number[] };
  /** sha256 of the stable JSON of the engine's complete raw output */
  raw_output_sha256: string;
  /** sha256 of the stable JSON of `measurements` — re-checked whenever a run is loaded */
  output_sha256: string;
  counts: Record<LabDecision, number>;
  created_at: string;
  measurements: LabMeasurement[];
}
export async function freezeRun(engine: EngineId, input: { name: string; sha256: string; pages: number[] }, result: { measurements: LabMeasurement[]; raw: unknown }, now = new Date()): Promise<FrozenRun> {
  const output_sha256 = await sha256Hex(stableStringify(result.measurements));
  const counts = { accepted: 0, held: 0, rejected: 0 } as Record<LabDecision, number>;
  for (const m of result.measurements) counts[m.decision]++;
  const e = ENGINES[engine];
  return deepFreeze({
    schema: "cunstruct.lab-run.v1", run_id: `${engine}:${input.sha256.slice(0, 12)}:${output_sha256.slice(0, 12)}`,
    engine: { id: engine, label: e.label, source: e.source, decision_rule: e.decisionRule }, input: { ...input, pages: [...input.pages] },
    raw_output_sha256: await sha256Hex(stableStringify(result.raw)), output_sha256, counts, created_at: now.toISOString(),
    measurements: structuredClone(result.measurements),
  });
}
/** A stored run is trusted only if its measurements still hash to the recorded value. */
export async function verifyRun(run: FrozenRun): Promise<boolean> {
  return (await sha256Hex(stableStringify(run.measurements))) === run.output_sha256;
}

// ── immutable human verdicts ────────────────────────────────────────────────
export type Verdict = "correct" | "incorrect" | "unclear";
/** What the reviewer says the measurement should have been (optional; never applied anywhere). */
export interface MeasurementCorrection { value?: number; unit?: string; start?: P; end?: P; associated_element?: string }
export interface CorrectionEvent {
  seq: number;
  run_id: string;
  measurement_id: string;
  verdict: Verdict;
  note: string;
  /** the authenticated user id (from the signed-in session), never typed by the reviewer */
  reviewer_id: string;
  /** display label only (e.g. email); not used for identity */
  reviewer_label: string;
  correction: MeasurementCorrection | null;
  /** engine evidence was visible: these are lab verdicts, never blind independent reviews */
  blind: false;
  at: string;
  prev_hash: string;
  hash: string;
}
/** Returns a NEW frozen log with the event appended; the input log is never changed. A later verdict
 *  for the same measurement supersedes the earlier one in summaries but both stay in the log. */
export async function appendVerdict(log: readonly CorrectionEvent[], e: { run_id: string; measurement_id: string; verdict: Verdict; note?: string; reviewer_id: string; reviewer_label?: string; correction?: MeasurementCorrection | null }, now = new Date()): Promise<readonly CorrectionEvent[]> {
  if (!e.reviewer_id?.trim()) throw new Error("an authenticated reviewer is required");
  if (!["correct", "incorrect", "unclear"].includes(e.verdict)) throw new Error(`unknown verdict ${e.verdict}`);
  if (e.verdict !== "correct" && !(e.note ?? "").trim()) throw new Error("say why it is incorrect or unclear");
  if (e.correction && e.verdict !== "incorrect") throw new Error("a corrected measurement belongs to an 'incorrect' verdict");
  const prev = log.length ? log[log.length - 1].hash : GENESIS;
  const body = { seq: log.length, run_id: e.run_id, measurement_id: e.measurement_id, verdict: e.verdict, note: e.note ?? "", reviewer_id: e.reviewer_id.trim(), reviewer_label: (e.reviewer_label ?? "").trim(), correction: e.correction ?? null, blind: false as const, at: now.toISOString(), prev_hash: prev };
  const ev = deepFreeze({ ...body, hash: await sha256Hex(stableStringify(body)) });
  return Object.freeze([...log, ev]);
}
/** Checks the whole chain; returns the first broken seq, or null when intact. */
export async function verifyLog(log: readonly CorrectionEvent[]): Promise<number | null> {
  let prev = GENESIS;
  for (const [i, ev] of log.entries()) {
    const { hash, ...body } = ev;
    if (ev.seq !== i || ev.prev_hash !== prev || (await sha256Hex(stableStringify(body))) !== hash) return i;
    prev = hash;
  }
  return null;
}
export function latestVerdicts(log: readonly CorrectionEvent[], runId: string): Map<string, CorrectionEvent> {
  const m = new Map<string, CorrectionEvent>();
  for (const ev of log) if (ev.run_id === runId) m.set(ev.measurement_id, ev);
  return m;
}

// ── comparison against a reference ──────────────────────────────────────────
// Matching: the nearest unused engine measurement on the same page whose text anchor is within 12 pt
// of the reference text, preferring one with the same printed value. A match with a different value is
// "detected, value wrong" (not "missed"). Line, endpoint and association rules are the ledger's.
export const MATCH_RADIUS_PT = 12, LINE_AXIS_TOL = 0.5, ENDPOINT_TOL = 1.0;
/** Measurable = the reference names one answer (status OK / derivable). Everything else is
 *  non-measurable and is never counted as an ordinary engine failure. */
export type RefOutcome =
  | "correctly-accepted" | "incorrectly-accepted" | "unnecessarily-held" | "correctly-held" | "missed"
  | "accepted-non-measurable" | "not-accepted-non-measurable" | "not-detected-non-measurable";
export interface RefScore {
  ref_id: string;
  page: number;
  value: number;
  ref_status: string;
  measurable: boolean;
  measurement_id: string | null;
  detected: boolean;
  value_ok: boolean | null;
  line_ok: boolean | null;
  endpoints_ok: boolean | null;
  association: "correct" | "incorrect" | "not-decided" | "not-scored" | "engine-has-none" | null;
  decision: LabDecision | null;
  outcome: RefOutcome;
}
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function scoreAgainstReference(ms: readonly LabMeasurement[], refs: readonly ReferenceDimension[]): RefScore[] {
  const used = new Set<string>();
  return refs.map((g) => {
    const near = ms.filter((d) => d.page === g.page && !used.has(d.id) && dist(d.textAnchor, g.text_center_pt) <= MATCH_RADIUS_PT);
    const pool = near.some((d) => d.value === g.value) ? near.filter((d) => d.value === g.value) : near;
    const d = pool.length ? pool.reduce((m, x) => (dist(x.textAnchor, g.text_center_pt) < dist(m.textAnchor, g.text_center_pt) ? x : m)) : null;
    const measurable = g.reference_status === "OK";
    const base = { ref_id: g.gold_id, page: g.page, value: g.value, ref_status: g.reference_status, measurable };
    if (!d) return { ...base, measurement_id: null, detected: false, value_ok: null, line_ok: null, endpoints_ok: null, association: null, decision: null, outcome: (measurable ? "missed" : "not-detected-non-measurable") as RefOutcome };
    used.add(d.id);
    const value_ok = d.value === g.value;
    const hz = g.orientation === "horizontal", A = hz ? 0 : 1, Q = hz ? 1 : 0, ge = g.endpoints_pt;
    const line_ok = d.line && ge ? Math.abs(d.line.a[Q] - ge[0][Q]) <= LINE_AXIS_TOL && Math.abs(d.line.b[Q] - ge[0][Q]) <= LINE_AXIS_TOL : ge ? false : null;
    let endpoints_ok: boolean | null = null;
    if (ge && d.span) {
      const s = [d.span.start[A], d.span.end[A]].sort((x, y) => x - y), t = [ge[0][A], ge[1][A]].sort((x, y) => x - y);
      endpoints_ok = Math.abs(s[0] - t[0]) <= ENDPOINT_TOL && Math.abs(s[1] - t[1]) <= ENDPOINT_TOL && Math.abs(d.span.start[Q] - ge[0][Q]) <= ENDPOINT_TOL;
    } else if (ge) endpoints_ok = false;
    let association: RefScore["association"];
    const refEnds = parseReferenceEnds(g.associated_element);
    if (!d.association) association = "engine-has-none";
    else if (d.association.decision !== "associated") association = "not-decided";
    else if (!refEnds || !endpoints_ok) association = "not-scored";
    else {
      const m = (r: (typeof refEnds)[number], e: { kind: string; labels?: string[] }) => r.kind === e.kind && (r.kind === "edge" || (e.labels ?? []).includes((r as { label: string }).label));
      const [e0, e1] = d.association.ends;
      association = (m(refEnds[0], e0) && m(refEnds[1], e1)) || (m(refEnds[0], e1) && m(refEnds[1], e0)) ? "correct" : "incorrect";
    }
    let outcome: RefOutcome;
    if (!measurable) outcome = d.decision === "accepted" ? "accepted-non-measurable" : "not-accepted-non-measurable";
    else if (d.decision === "accepted") outcome = value_ok && endpoints_ok === true && (association === "correct" || association === "engine-has-none") ? "correctly-accepted" : "incorrectly-accepted";
    // not accepted: unnecessary when the engine's evidence was right (value, endpoints, no wrong association)
    else outcome = value_ok && endpoints_ok === true && association !== "incorrect" ? "unnecessarily-held" : "correctly-held";
    return { ...base, measurement_id: d.id, detected: true, value_ok, line_ok, endpoints_ok, association, decision: d.decision, outcome };
  });
}

export interface Ratio { n: number; of: number; pct: number | null; denominator: string }
const ratio = (n: number, of: number, denominator: string): Ratio => ({ n, of, pct: of ? Math.round((n / of) * 1000) / 10 : null, denominator });
/** Accuracy metrics with explicit denominators. Non-measurable references never enter failure counts. */
export function labMetrics(scores: readonly RefScore[], run: Pick<FrozenRun, "measurements" | "counts">) {
  const M = scores.filter((s) => s.measurable), X = scores.filter((s) => !s.measurable);
  const det = M.filter((s) => s.detected), acc = M.filter((s) => s.decision === "accepted");
  const c = (f: (s: RefScore) => boolean, of: readonly RefScore[] = M) => of.filter(f).length;
  const nm = `measurable reference items (${M.length})`, nd = `detected measurable items (${det.length})`, na = `accepted engine measurements matched to a measurable reference (${acc.length})`;
  return {
    measurable_references: M.length, non_measurable_references: X.length,
    detection_recall: ratio(det.length, M.length, nm),
    value_accuracy: ratio(c((s) => s.value_ok === true, det), det.length, nd),
    line_accuracy: ratio(c((s) => s.line_ok === true, det), det.length, nd),
    endpoint_accuracy: ratio(c((s) => s.endpoints_ok === true, det), det.length, nd),
    association_accuracy: ratio(c((s) => s.association === "correct", det), c((s) => s.association !== "engine-has-none", det), `detected measurable items for which the engine produces an association (${c((s) => s.association !== "engine-has-none", det)})`),
    correct_acceptance_rate: ratio(c((s) => s.outcome === "correctly-accepted"), acc.length, na),
    incorrect_acceptance_rate: ratio(c((s) => s.outcome === "incorrectly-accepted"), acc.length, na),
    correct_coverage: ratio(c((s) => s.outcome === "correctly-accepted"), M.length, nm),
    correctly_held: ratio(c((s) => s.outcome === "correctly-held"), M.length, nm),
    unnecessarily_held: ratio(c((s) => s.outcome === "unnecessarily-held"), M.length, nm),
    missed: ratio(c((s) => s.outcome === "missed"), M.length, nm),
    review_burden_references: ratio(M.length - c((s) => s.outcome === "correctly-accepted"), M.length, `${nm}: everything not correctly accepted needs a person`),
    review_burden_drawing: ratio(run.counts.held + run.counts.rejected, run.measurements.length, `all engine measurements on the drawing (${run.measurements.length})`),
    accepted_on_non_measurable: ratio(c((s) => s.outcome === "accepted-non-measurable", X), X.length, `non-measurable references (${X.length}): the engine accepted what the reference calls ambiguous or not derivable`),
  };
}
export type LabMetrics = ReturnType<typeof labMetrics>;

/** Pairs the two engines' measurements: same page, same printed value, text anchors within 2 pt. */
export function pairEngines(a: readonly LabMeasurement[], b: readonly LabMeasurement[]): { a: LabMeasurement | null; b: LabMeasurement | null }[] {
  const used = new Set<string>(), out: { a: LabMeasurement | null; b: LabMeasurement | null }[] = [];
  for (const x of a) {
    const y = b.find((m) => !used.has(m.id) && m.page === x.page && m.value === x.value && dist(m.textAnchor, x.textAnchor) <= 2) ?? null;
    if (y) used.add(y.id);
    out.push({ a: x, b: y });
  }
  for (const y of b) if (!used.has(y.id)) out.push({ a: null, b: y });
  return out;
}

// ── report ──────────────────────────────────────────────────────────────────
export interface LabReportInput {
  drawing: { name: string; sha256: string; pages: number[] };
  runs: [FrozenRun, FrozenRun];
  /** a reference file (e.g. the developer Gold Set) or the founder's locked blind reference */
  reference?: { name: string; sha256: string; type: string; items: readonly ReferenceDimension[] };
  log: readonly CorrectionEvent[];
  logIntact: boolean;
}
const OUTCOMES: RefOutcome[] = ["correctly-accepted", "incorrectly-accepted", "unnecessarily-held", "correctly-held", "missed", "accepted-non-measurable", "not-accepted-non-measurable", "not-detected-non-measurable"];
export function buildLabReport(x: LabReportInput) {
  const json = buildLabJson(x);
  return { json, markdown: reportMarkdown(json) };
}
export type LabReportJson = ReturnType<typeof buildLabJson>;
function buildLabJson(x: LabReportInput) {
  const scores = x.reference ? x.runs.map((r) => scoreAgainstReference(r.measurements, x.reference!.items)) : null;
  const pairs = pairEngines(x.runs[0].measurements, x.runs[1].measurements);
  const pairTable: Record<string, number> = {};
  for (const p of pairs) { const k = `${p.a?.decision ?? "absent"} → ${p.b?.decision ?? "absent"}`; pairTable[k] = (pairTable[k] ?? 0) + 1; }
  const human = x.runs.map((r) => {
    const v = latestVerdicts(x.log, r.run_id), byDec: Record<string, Record<Verdict, number>> = {};
    for (const m of r.measurements) { const ev = v.get(m.id); if (!ev) continue; (byDec[m.decision] ??= { correct: 0, incorrect: 0, unclear: 0 })[ev.verdict]++; }
    return { run_id: r.run_id, verified: v.size, of: r.measurements.length, by_decision: byDec,
      accepted_marked_incorrect: r.measurements.filter((m) => m.decision === "accepted" && v.get(m.id)?.verdict === "incorrect").map((m) => m.id),
      corrections: [...v.values()].filter((e) => e.correction).length };
  });
  const rank: Record<RefOutcome, number> = { "correctly-accepted": 3, "unnecessarily-held": 2, "correctly-held": 1, missed: 0, "incorrectly-accepted": -1, "accepted-non-measurable": -1, "not-accepted-non-measurable": 1, "not-detected-non-measurable": 0 };
  const change = (o: RefOutcome, n: RefOutcome) => (o === n ? "same" : rank[n] > rank[o] ? "improved" : rank[n] < rank[o] ? "regressed" : "changed");
  return {
    schema: "cunstruct.lab-report.v2", drawing: x.drawing,
    runs: x.runs.map((r) => ({ run_id: r.run_id, engine: r.engine, output_sha256: r.output_sha256, raw_output_sha256: r.raw_output_sha256, counts: r.counts, total: r.measurements.length })),
    reference: x.reference ? { name: x.reference.name, sha256: x.reference.sha256, type: x.reference.type, items: x.reference.items.length } : null,
    metrics: scores ? x.runs.map((r, i) => ({ engine: r.engine.id, ...labMetrics(scores[i], r) })) : null,
    outcomes: scores ? x.runs.map((r, i) => ({ engine: r.engine.id, ...Object.fromEntries(OUTCOMES.map((o) => [o, scores[i].filter((s) => s.outcome === o).length])), incorrectly_accepted_ids: scores[i].filter((s) => s.outcome === "incorrectly-accepted").map((s) => s.ref_id) })) : null,
    per_reference: scores ? scores[0].map((a, i) => ({ ref: a.ref_id, page: a.page, value: a.value, ref_status: a.ref_status, old: a, new: scores[1][i], change: change(a.outcome, scores[1][i].outcome) })) : [],
    engine_pairing: pairTable, human_verdicts: human,
    correction_log: { events: x.log.length, chain_intact: x.logIntact, head: x.log.length ? x.log[x.log.length - 1].hash : GENESIS },
  };
}

const pct = (r: Ratio) => `${r.n}/${r.of}${r.pct === null ? "" : ` (${r.pct}%)`}`;
function reportMarkdown(j: LabReportJson): string {
  const L: string[] = [];
  const [ra, rb] = j.runs;
  L.push(`# Measurement Lab report — ${j.drawing.name}`, "");
  L.push(`Drawing sha256 \`${j.drawing.sha256}\`, pages ${j.drawing.pages.join(", ")}. Both engines ran unchanged on the same bytes; each run is frozen and content-hashed.`, "");
  L.push("| engine | run | output sha256 | measurements | accepted | held | rejected |", "|---|---|---|---|---|---|---|");
  for (const r of j.runs) L.push(`| ${r.engine.label} | \`${r.run_id}\` | \`${r.output_sha256.slice(0, 16)}…\` | ${r.total} | ${r.counts.accepted} | ${r.counts.held} | ${r.counts.rejected} |`);
  L.push("", `Decision rules — ${ra.engine.label}: ${ra.engine.decision_rule}. ${rb.engine.label}: ${rb.engine.decision_rule}.`, "");
  if (j.reference && j.metrics && j.outcomes) {
    const [ma, mb] = j.metrics, [oa, ob] = j.outcomes;
    L.push(`## Accuracy against the reference`, "", `Reference: ${j.reference.name} (sha256 \`${j.reference.sha256.slice(0, 16)}…\`), ${j.reference.items} items — **${j.reference.type}**.`,
      `${ma.measurable_references} measurable (the reference names one answer); ${ma.non_measurable_references} ambiguous / not derivable / conflicting — reported separately, never as engine failures.`, "");
    const row = (label: string, k: keyof typeof ma) => L.push(`| ${label} | ${pct(ma[k] as Ratio)} | ${pct(mb[k] as Ratio)} | ${(mb[k] as Ratio).denominator} |`);
    L.push(`| metric | ${ra.engine.label} | ${rb.engine.label} | denominator |`, "|---|---|---|---|");
    row("detection recall", "detection_recall"); row("value accuracy", "value_accuracy"); row("dimension-line accuracy (line on the reference axis)", "line_accuracy");
    row("endpoint accuracy", "endpoint_accuracy");
    L.push(`| element association accuracy | ${ma.association_accuracy.of ? pct(ma.association_accuracy) : "not produced by this engine"} | ${pct(mb.association_accuracy)} | ${mb.association_accuracy.denominator} |`);
    row("correct acceptance rate", "correct_acceptance_rate"); row("**incorrect acceptance rate**", "incorrect_acceptance_rate"); row("**correct coverage**", "correct_coverage");
    row("correctly held (engine evidence wrong, not accepted)", "correctly_held"); row("unnecessarily held (evidence right, not accepted)", "unnecessarily_held"); row("missed (not detected)", "missed");
    row("review burden (reference items)", "review_burden_references"); row("review burden (whole drawing)", "review_burden_drawing"); row("accepted although the reference is non-measurable", "accepted_on_non_measurable");
    L.push("", `Detection recall is not overall accuracy. Value accuracy is conditional on detection (a measurement is matched by text position, so a misread value counts here, not as a miss).`,
      `Incorrectly accepted — ${ra.engine.label}: ${oa.incorrectly_accepted_ids.join(", ") || "none"}; ${rb.engine.label}: ${ob.incorrectly_accepted_ids.join(", ") || "none"}.`,
      `The old engine decides no measured element, so its acceptances are judged on value and endpoints only.`, "");
    const ch: Record<string, string[]> = {};
    for (const p of j.per_reference) (ch[p.change] ??= []).push(`${p.ref} (${p.value}: ${p.old.outcome} → ${p.new.outcome})`);
    L.push("### Where each succeeds and fails (per reference item, old → new)", "");
    for (const k of ["improved", "regressed", "changed", "same"]) if (ch[k]) L.push(`**${k}** (${ch[k].length}): ${k === "same" ? `${ch[k].length} items with the same outcome` : ch[k].join("; ")}`, "");
  } else L.push("No reference loaded: accuracy against a reference is not available.", "");
  L.push("## Old vs new on every measurement (paired by page, value and text position within 2 pt)", "", "| old → new | count |", "|---|---|");
  for (const [k, v] of Object.entries(j.engine_pairing).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push("", "## Human verdicts recorded in the lab", "");
  L.push(`Correction log: ${j.correction_log.events} events, hash chain ${j.correction_log.chain_intact ? "intact" : "**BROKEN**"} (head \`${j.correction_log.head.slice(0, 16)}…\`). Lab verdicts are made with engine overlays visible: they are **not** blind independent reviews.`, "");
  for (const h of j.human_verdicts) L.push(`- ${h.run_id}: ${h.verified}/${h.of} verified; ${Object.entries(h.by_decision).map(([d, v]) => `${d}: ${v.correct} correct, ${v.incorrect} incorrect, ${v.unclear} unclear`).join("; ") || "none yet"}; accepted but marked incorrect: ${h.accepted_marked_incorrect.join(", ") || "none"}; corrections recorded: ${h.corrections}.`);
  L.push("", "Scope: one drawing. Nothing here shows that either engine generalizes, and nothing here changes a BOQ.");
  return L.join("\n") + "\n";
}
