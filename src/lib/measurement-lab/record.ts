/**
 * MEASUREMENT RECORD — the Lab's structured, read-only view of one engine measurement plus its human
 * review history. Pure: it reads a frozen run and the append-only verdict log and never changes either.
 *
 * Every fact is labelled with how much the data supports it:
 *   available   recorded by the engine in the frozen run
 *   derived     computed from recorded facts (e.g. the endpoint distance in drawing units)
 *   missing     not in the frozen run — shown as missing, never guessed
 *   unresolved  the engine or a reviewer flagged a conflict or ambiguity that is still open
 * Nothing here is written to the BOQ, pricing, exports or the review/apply path.
 */
import type { CorrectionEvent, FrozenRun, LabMeasurement } from "./core";

/** Categories the Lab's model can describe. The two engines currently produce linear dimensions only;
 *  the other categories exist so records stay comparable when an engine adds them — none is ever
 *  invented from a linear dimension. */
export type MeasurementCategory = "linear-dimension" | "area" | "perimeter" | "room" | "wall" | "door-window" | "floor-ceiling";
/** Where the CURRENT value comes from. `inferred` is part of the vocabulary but no current engine
 *  produces it. */
export type ValueProvenance = "explicit" | "geometric" | "inferred" | "human-corrected" | "unresolved";
export type EvidenceState = "available" | "derived" | "missing" | "unresolved";
export type ReviewStatus = "not-reviewed" | "correct" | "incorrect" | "unclear";

export interface EvidenceFact { key: string; label: string; state: EvidenceState; value: string | null; note?: string }

/** One verdict, as a change receipt: what the measurement looked like before and after it. */
export interface ChangeReceipt {
  seq: number;
  at: string;
  measurement_id: string;
  reviewer_label: string;
  reviewer_id: string;
  verdict: CorrectionEvent["verdict"];
  previous_status: ReviewStatus;
  note: string;
  value_before: number;
  value_after: number;
  unit: string | null;
  /** true only when this verdict changed the measurement's current value */
  changed_value: boolean;
  /** the hash of the log event, so a receipt can be traced to the tamper-evident log */
  event_hash: string;
}

export interface MeasurementRecord {
  id: string;
  category: MeasurementCategory;
  engine: { id: string; label: string; run_id: string; output_sha256: string };
  source: { drawing_name: string; drawing_sha256: string; page: number };
  /** the engine's value, exactly as frozen */
  engine_value: number;
  unit: string | null;
  /** the value after human review (a correction never changes the frozen engine value) */
  current_value: number;
  provenance: ValueProvenance;
  extraction: { decision: LabMeasurement["decision"]; status: string; reasons: readonly string[] };
  evidence: EvidenceFact[];
  verification: { status: ReviewStatus; latest: CorrectionEvent | null; receipts: ChangeReceipt[] };
  /** true when the frozen run has a page position for this measurement (the printed text anchor) */
  location_linkable: boolean;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const pt = (p: readonly [number, number]) => `(${fmt(p[0])}, ${fmt(p[1])}) pt`;
const finitePoint = (p: readonly number[] | null | undefined) => !!p && p.length === 2 && p.every(Number.isFinite);

/** The receipts for one measurement, oldest first. Value rules: an `incorrect` verdict with a corrected
 *  value makes that the current value; any later verdict without one returns the current value to the
 *  engine's value (the reviewer now accepts it, or is unsure of it). */
export function receiptsFor(m: LabMeasurement, runId: string, log: readonly CorrectionEvent[]): ChangeReceipt[] {
  const out: ChangeReceipt[] = [];
  let status: ReviewStatus = "not-reviewed", value = m.value;
  for (const e of log) {
    if (e.run_id !== runId || e.measurement_id !== m.id) continue;
    const after = e.verdict === "incorrect" && typeof e.correction?.value === "number" && Number.isFinite(e.correction.value) ? e.correction.value : m.value;
    out.push({
      seq: e.seq, at: e.at, measurement_id: m.id, reviewer_label: e.reviewer_label || e.reviewer_id, reviewer_id: e.reviewer_id, verdict: e.verdict,
      previous_status: status, note: e.note, value_before: value, value_after: after, unit: e.correction?.unit ?? m.unit, changed_value: after !== value, event_hash: e.hash,
    });
    status = e.verdict; value = after;
  }
  return out;
}

/** Every receipt for a run, newest first — the drawing-level "What changed?" view. */
export function changesForRun(run: FrozenRun, log: readonly CorrectionEvent[]): ChangeReceipt[] {
  const byId = new Map(run.measurements.map((m) => [m.id, m]));
  const touched = [...new Set(log.filter((e) => e.run_id === run.run_id).map((e) => e.measurement_id))];
  return touched.flatMap((id) => (byId.has(id) ? receiptsFor(byId.get(id)!, run.run_id, log) : [])).sort((a, b) => b.seq - a.seq);
}

export function describeMeasurement(m: LabMeasurement, run: FrozenRun, log: readonly CorrectionEvent[]): MeasurementRecord {
  const receipts = receiptsFor(m, run.run_id, log);
  const last = receipts[receipts.length - 1];
  const latest = last ? log.find((e) => e.hash === last.event_hash) ?? null : null;
  const status: ReviewStatus = last ? last.verdict : "not-reviewed";
  const current = last ? last.value_after : m.value;
  const provenance: ValueProvenance =
    status === "incorrect" && current !== m.value ? "human-corrected"
      : status === "unclear" ? "unresolved"
        : status === "not-reviewed" && m.decision !== "accepted" ? "unresolved"
          : "explicit";

  const evidence: EvidenceFact[] = [];
  evidence.push(m.text.trim()
    ? { key: "text", label: "Printed dimension text", state: "available", value: `“${m.text}”` }
    : { key: "text", label: "Printed dimension text", state: "missing", value: null, note: "no printed text recorded" });
  evidence.push({ key: "value", label: "Value read from the text", state: "available", value: `${fmt(m.value)} ${m.unit ?? "(no unit printed or noted)"}`, note: "parsed from the printed text, not scaled from geometry" });
  evidence.push(finitePoint(m.textAnchor)
    ? { key: "location", label: "Text location", state: "available", value: `page ${m.page} · ${pt(m.textAnchor)}` }
    : { key: "location", label: "Text location", state: "missing", value: null, note: "no page position in the frozen run" });
  evidence.push(m.line
    ? { key: "line", label: "Dimension line", state: "available", value: `${pt(m.line.a)} → ${pt(m.line.b)}` }
    : { key: "line", label: "Dimension line", state: "missing", value: null, note: "the engine found no dimension line for this text" });
  evidence.push(m.span
    ? { key: "endpoints", label: "Endpoints", state: "available", value: `${pt(m.span.start)} → ${pt(m.span.end)}` }
    : { key: "endpoints", label: "Endpoints", state: "missing", value: null, note: "the engine found no endpoints" });
  if (m.span) evidence.push({ key: "span", label: "Endpoint distance on the sheet", state: "derived", value: `${fmt(m.span.length)} pt`, note: "drawing units, not a real-world length" });
  evidence.push({ key: "scale", label: "Scale used", state: "missing", value: null, note: "not recorded in the frozen run; the value comes from the printed text" });
  evidence.push(m.association
    ? { key: "association", label: "Associated element", state: m.association.decision === "associated" ? "available" : "unresolved", value: `${m.association.decision}${m.association.measures ? ` · ${m.association.measures}` : ""}${m.association.ends.length ? ` · ${m.association.ends.map((e) => (e.kind === "grid" ? `grid ${(e.labels ?? []).join("/")}` : e.kind)).join(" ↔ ")}` : ""}` }
    : { key: "association", label: "Associated element", state: "missing", value: null, note: run.engine.id === "engine-1de95f6" ? "this engine does not associate dimensions with elements" : "the engine recorded no association" });
  const open = m.decision !== "accepted" || m.reasons.length > 0;
  evidence.push(open
    ? { key: "conflicts", label: "Conflicts or ambiguity", state: m.decision === "accepted" ? "available" : "unresolved", value: `engine ${m.decision} (${m.status})`, note: m.reasons.join(" | ") || undefined }
    : { key: "conflicts", label: "Conflicts or ambiguity", state: "available", value: "none reported by the engine" });

  return {
    id: m.id, category: "linear-dimension",
    engine: { id: run.engine.id, label: run.engine.label, run_id: run.run_id, output_sha256: run.output_sha256 },
    source: { drawing_name: run.input.name, drawing_sha256: run.input.sha256, page: m.page },
    engine_value: m.value, unit: m.unit, current_value: current, provenance,
    extraction: { decision: m.decision, status: m.status, reasons: m.reasons },
    evidence, verification: { status, latest, receipts }, location_linkable: finitePoint(m.textAnchor),
  };
}
