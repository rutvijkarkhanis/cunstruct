/**
 * Formal metrics over a measurement ledger, each with its own numerator, denominator and the
 * definition of that denominator, plus machine-checked accounting. Definitions are documented in
 * docs/measurement-quality/METRICS.md; no single "overall accuracy" figure is produced.
 */
import type { LedgerRow } from "./ledger";
import { failedAcceptanceGates } from "./ledger";

export interface Metric {
  id: string;
  stage: "detection" | "parsing" | "line" | "endpoints" | "association" | "decision" | "operational";
  numerator: number | null;
  denominator: number | null;
  /** What the denominator counts. */
  of: string;
  /** "end-to-end": over every reference dimension; "conditional": over those that passed an earlier stage. */
  basis: "end-to-end" | "conditional" | "count";
  ids?: string[];
  note?: string;
}

const count = (rows: LedgerRow[], f: (r: LedgerRow) => boolean) => rows.filter(f);

export function computeMetrics(rows: LedgerRow[]): Metric[] {
  const N = rows.length;
  const all = `all ${N} reference dimensions`;
  const m: Metric[] = [];
  const add = (id: string, stage: Metric["stage"], hits: LedgerRow[], denom: number, of: string, basis: Metric["basis"], note?: string, withIds = true) =>
    m.push({ id, stage, numerator: hits.length, denominator: denom, of, basis, ...(withIds ? { ids: hits.map((r) => r.measurement_id) } : {}), ...(note ? { note } : {}) });

  // detection
  const found = count(rows, (r) => r.outcomes.detection === "found");
  add("detection.found", "detection", found, N, all, "end-to-end");
  add("detection.missed", "detection", count(rows, (r) => r.outcomes.detection === "missed"), N, all, "end-to-end");
  m.push({ id: "detection.false_detections", stage: "detection", numerator: null, denominator: null, of: "n/a", basis: "count",
    note: "Not measurable from this reference: the Gold Set is a sample of the drawing's dimensions, not an exhaustive list, so an unmatched engine dimension is not evidence of a false detection." });

  // parsing (conditional on detection)
  const P = found.length;
  add("parse.correct", "parsing", count(found, (r) => r.outcomes.parse === "correct"), P, `${P} detected`, "conditional");
  add("parse.incorrect_value", "parsing", count(found, (r) => r.outcomes.parse === "incorrect-value"), P, `${P} detected`, "conditional");
  add("parse.incorrect_unit", "parsing", count(found, (r) => r.outcomes.parse === "incorrect-unit"), P, `${P} detected`, "conditional");
  m.push({ id: "parse.unparseable_or_ambiguous", stage: "parsing", numerator: null, denominator: null, of: "n/a", basis: "count",
    note: "Not separately observable: the matching rule requires the parsed value to equal the reference value, so an unparseable or misread reference dimension appears as detection.missed." });

  // line (end-to-end; every detected item has exactly one line outcome)
  for (const k of ["correct", "incorrect", "multiple-plausible", "none", "no-reference"] as const)
    add(`line.${k}`, "line", count(rows, (r) => r.outcomes.line === k), N, all, "end-to-end");

  // endpoints: end-to-end, and conditional on a correct line
  const EP = ["correct-pair", "one-sided-match", "one-sided-wrong", "wrong-pair", "ambiguous", "unresolved", "not-attempted", "no-reference"] as const;
  for (const k of EP) add(`endpoints.${k}`, "endpoints", count(rows, (r) => r.outcomes.endpoints === k), N, all, "end-to-end");
  const lineOk = count(rows, (r) => r.outcomes.line === "correct");
  add("endpoints.correct-pair|line-correct", "endpoints", count(lineOk, (r) => r.outcomes.endpoints === "correct-pair"), lineOk.length, `${lineOk.length} with the correct line`, "conditional");

  // association: end-to-end and conditional on a correct endpoint pair
  const AS = ["correct", "incorrect", "ambiguous", "unassociated", "associated-unscored", "not-attempted"] as const;
  for (const k of AS) add(`association.${k}`, "association", count(rows, (r) => r.outcomes.association === k), N, all, "end-to-end");
  const epOk = count(rows, (r) => r.outcomes.endpoints === "correct-pair");
  add("association.correct|endpoints-correct", "association", count(epOk, (r) => r.outcomes.association === "correct"), epOk.length, `${epOk.length} with the correct endpoint pair`, "conditional");

  // decisions
  for (const k of ["acceptable", "hold", "reject", "missed"] as const)
    add(`decision.${k}`, "decision", count(rows, (r) => r.outcomes.overall === k), N, all, "end-to-end");
  for (const k of ["correctly-accepted", "incorrectly-accepted", "correctly-held", "unnecessarily-held", "correctly-rejected", "incorrectly-rejected", "missed"] as const)
    add(`final.${k}`, "decision", count(rows, (r) => r.outcomes.final === k), N, all, "end-to-end");

  add("final.correctly-accepted.association-unscored", "decision", count(rows, (r) => r.outcomes.final === "correctly-accepted" && !r.association_scorable), N, all, "count",
    "Correctly accepted on value and endpoints only: the reference does not state the measured element, so association was not checked.");

  // operational
  const accepted = count(rows, (r) => r.outcomes.overall === "acceptable");
  const det = count(rows, (r) => r.reference_determined);
  add("operational.automatic_acceptance_coverage", "operational", count(rows, (r) => r.outcomes.final === "correctly-accepted"), N, all, "end-to-end",
    "Accepted, fully correct and the reference names one answer.");
  add("operational.automatic_acceptance_coverage|determined", "operational", count(det, (r) => r.outcomes.final === "correctly-accepted"), det.length, `${det.length} whose reference names one unambiguous answer (status OK)`, "conditional");
  add("operational.human_review_burden", "operational", count(rows, (r) => r.outcomes.overall !== "acceptable"), N, all, "end-to-end", "Held, rejected or missed: needs a person.");
  const fa = count(accepted, (r) => r.outcomes.final === "incorrectly-accepted");
  add("operational.false_acceptances", "operational", fa, accepted.length, `${accepted.length} accepted`, "conditional",
    accepted.length ? undefined : "No acceptances: rate undefined.");
  add("operational.missed_automation.evidence_correct", "operational",
    count(rows, (r) => r.outcomes.overall !== "acceptable" && r.reference_determined && r.fully_correct), N, all, "end-to-end",
    "Not accepted, although the reference names one answer and the engine's value, endpoint pair and association all match it.");
  add("operational.missed_automation.evidence_incomplete", "operational",
    count(rows, (r) => r.outcomes.overall !== "acceptable" && r.reference_determined && !r.fully_correct), N, all, "end-to-end",
    "Not accepted, the reference names one answer, but some engine evidence was missing or wrong: holding prevented an error or lost an item.");
  return m;
}

export function metric(ms: Metric[], id: string): Metric {
  const x = ms.find((q) => q.id === id);
  if (!x) throw new Error(`no metric ${id}`);
  return x;
}

/** Machine-checked accounting. Returns every violation found (empty = the ledger accounts). */
export function checkAccounting(rows: LedgerRow[], referenceIds: string[], metrics: Metric[] = computeMetrics(rows)): string[] {
  const v: string[] = [];
  const ids = rows.map((r) => r.measurement_id);
  const seen = new Set<string>();
  for (const id of ids) { if (seen.has(id)) v.push(`${id}: more than one result row`); seen.add(id); }
  for (const id of referenceIds) if (!seen.has(id)) v.push(`${id}: reference has no result row`);
  for (const id of ids) if (!referenceIds.includes(id)) v.push(`${id}: result row with no reference`);
  const engineIds = rows.map((r) => r.engine?.id).filter(Boolean) as string[];
  if (new Set(engineIds).size !== engineIds.length) v.push("an engine dimension is matched to more than one reference");

  for (const r of rows) {
    const o = r.outcomes;
    for (const [stage, val] of Object.entries(o)) if (val == null || val === "") v.push(`${r.measurement_id}: no ${stage} outcome`);
    if (o.overall === "missed" ? r.engine !== null : r.engine === null) v.push(`${r.measurement_id}: detection and engine record disagree`);
    if (r.engine) {
      if (o.overall !== r.engine.decisions.overall) v.push(`${r.measurement_id}: overall outcome differs from the engine's decision`);
      if (o.overall === "acceptable") {
        const f = failedAcceptanceGates({ decisions: r.engine.decisions, unit: r.engine.unit as never, crossView: r.engine.cross_view ?? undefined, covers: r.engine.covers ?? undefined });
        if (f.length) v.push(`${r.measurement_id}: accepted but failed gates: ${f.join(", ")}`);
      }
      if ((o.overall === "hold" || o.overall === "reject") && !r.engine.reasons.some((s) => s.trim())) v.push(`${r.measurement_id}: ${o.overall} without an explicit reason`);
    }
    if (o.association === "correct" && o.endpoints !== "correct-pair") v.push(`${r.measurement_id}: association scored correct without a correct endpoint pair`);
    if (o.endpoints === "correct-pair" && o.detection !== "found") v.push(`${r.measurement_id}: endpoints without detection`);
    // traceability: every reference names its source document, page and a verification statement
    if (!r.source_pdf || !/^[0-9a-f]{64}$/.test(r.source_sha256) || !(r.page >= 1) || !r.reference.verification) v.push(`${r.measurement_id}: reference not traceable to source evidence`);
    if (r.reference.amendments.length && r.reference.associated_element_original === r.reference.associated_element && r.reference.amendments.some((a) => a.field === "associated_element"))
      v.push(`${r.measurement_id}: amended reference lost its original value`);
  }

  // mutually exclusive groups must sum to their denominators
  const groups = ["detection.", "line.", "endpoints.", "association.", "decision.", "final."];
  for (const g of groups) {
    const ms = metrics.filter((x) => x.id.startsWith(g) && !x.id.includes("|") && x.basis === "end-to-end");
    const sum = ms.reduce((s, x) => s + (x.numerator ?? 0), 0);
    const denom = ms[0]?.denominator;
    if (g === "detection.") { if (sum !== rows.length) v.push(`detection categories sum to ${sum}, not ${rows.length}`); continue; }
    // stages after detection: missed items carry "not-applicable", which has no metric of its own
    const missed = rows.filter((r) => r.outcomes.detection === "missed").length;
    const expect = g === "decision." || g === "final." ? rows.length : rows.length - missed;
    if (sum !== expect || denom !== rows.length) v.push(`${g} categories sum to ${sum}, expected ${expect} (denominator ${denom})`);
    const all = ms.flatMap((x) => x.ids ?? []);
    if (new Set(all).size !== all.length) v.push(`${g} an item is counted in more than one category`);
  }
  const parse = metrics.filter((x) => x.id.startsWith("parse.") && x.numerator !== null);
  const found = metric(metrics, "detection.found").numerator!;
  if (parse.reduce((s, x) => s + x.numerator!, 0) !== found) v.push("parse categories do not sum to the detected count");
  return v;
}
