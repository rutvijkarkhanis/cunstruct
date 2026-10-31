// Builds the per-measurement ledger, the metrics and the accounting check from a frozen engine run.
//   npx vite-node --root . scripts/accuracy/mq/buildLedger.ts --engine <engine-output.json> --gold <gold-set.json> --out <dir>
//     [--historical-rows <score2 rows.json>] [--stage2-rows <stage-2 rows.json>] [--claims <historical-claims.json>]
//     [--dev-review <a.json,b.json,...>]   (developer review tile sets for whole-drawing acceptances)
// Exits non-zero when the accounting check finds any violation.
import path from "node:path";
import type { PageDimensions } from "@/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions";
import { buildLedger, type LedgerRow, type ReferenceDimension } from "@/lib/measurement-quality/ledger";
import { checkAccounting, computeMetrics, metric } from "@/lib/measurement-quality/metrics";
import { args, assertOutsideRepo, need, readJson, sha256File, toCsv, writeJson, writeText } from "./common";
import { freezeManifest } from "./fingerprint";

const a = args();
const out = need(a, "out");
assertOutsideRepo(out);
const enginePath = need(a, "engine"), goldPath = need(a, "gold");
const pages = readJson<PageDimensions[]>(enginePath);
const gold = readJson<{ items: (ReferenceDimension | { kind: string; gold_id: string })[]; dataset_role?: string; drawing_sha256?: string; schema?: string }>(goldPath);
const refs = gold.items.filter((i): i is ReferenceDimension => i.kind === "linear_dimension");

const ledger = buildLedger(refs, pages);
const metrics = computeMetrics(ledger);
const violations = checkAccounting(ledger, refs.map((r) => r.gold_id), metrics);
const fm = freezeManifest();
const provenance = {
  engine_output: { file: path.basename(enginePath), sha256: sha256File(enginePath) },
  reference: { file: path.basename(goldPath), sha256: sha256File(goldPath), schema: gold.schema, role: gold.dataset_role, drawing_sha256: gold.drawing_sha256, type: "DEVELOPER-VERIFIED, NOT independently verified" },
  engine: { candidate_fingerprint: fm.candidate.fingerprint, core_four: fm.core_four.fingerprint },
};

const ledgerHash = writeJson(path.join(out, "ledger.json"), { schema: "cunstruct.measurement-ledger.v1", provenance, rows: ledger });
const cols: [string, (r: LedgerRow) => unknown][] = [
  ["measurement_id", (r) => r.measurement_id], ["source_ref", (r) => r.source_ref], ["source_pdf", (r) => r.source_pdf], ["page", (r) => r.page], ["view", (r) => r.view], ["view_scale", (r) => r.view_scale],
  ["ref_printed_text", (r) => r.reference.printed_text], ["ref_value", (r) => r.reference.value], ["ref_unit", (r) => r.reference.unit], ["ref_status", (r) => r.reference.status],
  ["ref_endpoints_pt", (r) => r.reference.endpoints_pt], ["ref_element", (r) => r.reference.associated_element], ["ref_element_original", (r) => r.reference.associated_element_original], ["ref_amended", (r) => r.reference.amendments.length > 0],
  ["engine_id", (r) => r.engine?.id], ["engine_text", (r) => r.engine?.text], ["engine_value", (r) => r.engine?.parsed_value], ["engine_unit", (r) => r.engine?.unit],
  ["engine_line", (r) => r.engine?.line], ["engine_span_start", (r) => r.engine?.span?.start], ["engine_span_end", (r) => r.engine?.span?.end],
  ["engine_endpoint_decision", (r) => r.engine?.endpoint_decision], ["engine_terminators", (r) => r.engine?.terminators && `${r.engine.terminators.start}|${r.engine.terminators.end}`],
  ["engine_association", (r) => r.engine?.association?.decision], ["engine_measures", (r) => r.engine?.association?.measures],
  ["engine_scale_region", (r) => r.engine?.scale_region], ["engine_scale_deviation", (r) => r.engine?.scale_check?.deviation], ["engine_scale_tolerance", (r) => r.engine?.scale_check?.tolerance],
  ["engine_cross_view", (r) => r.engine?.cross_view && `${r.engine.cross_view.grids} ${r.engine.cross_view.values.join("/")}${r.engine.cross_view.conflict ? " CONFLICT" : ""}`],
  ["out_detection", (r) => r.outcomes.detection], ["out_parse", (r) => r.outcomes.parse], ["out_line", (r) => r.outcomes.line], ["out_endpoints", (r) => r.outcomes.endpoints],
  ["out_association", (r) => r.outcomes.association], ["out_scale", (r) => r.outcomes.scale], ["out_conflict", (r) => r.outcomes.conflict], ["out_overall", (r) => r.outcomes.overall], ["out_final", (r) => r.outcomes.final],
  ["fully_correct", (r) => r.fully_correct], ["final_reason", (r) => r.final_reason],
];
writeText(path.join(out, "ledger.csv"), toCsv(cols.map((c) => c[0]), ledger.map((r) => cols.map((c) => c[1](r)))));
const metricsHash = writeJson(path.join(out, "metrics.json"), { schema: "cunstruct.measurement-metrics.v1", provenance, metrics });
writeJson(path.join(out, "accounting.json"), { ok: violations.length === 0, violations });

// ── reconciliation ───────────────────────────────────────────────────────────
const ids = (f: (r: LedgerRow) => boolean) => ledger.filter(f).map((r) => r.measurement_id);
const M = (id: string) => metric(metrics, id);
const L: string[] = [];
L.push(`# W976646 baseline reconciliation (recomputed item by item)\n`);
L.push(`Reference: ${path.basename(goldPath)} (sha256 ${provenance.reference.sha256.slice(0, 16)}…) — DEVELOPER-VERIFIED, NOT independently verified.`);
L.push(`Engine output: ${path.basename(enginePath)} (sha256 ${provenance.engine_output.sha256.slice(0, 16)}…), frozen candidate ${fm.candidate.fingerprint.slice(0, 16)}… (core four ${fm.core_four.fingerprint.slice(0, 8)}…).`);
L.push(`Ledger: ledger.json sha256 ${ledgerHash.slice(0, 16)}…; metrics.json sha256 ${metricsHash.slice(0, 16)}…. Accounting check: ${violations.length ? `${violations.length} VIOLATIONS` : "PASS (0 violations)"}.\n`);

// historical per-item comparison (score2 rows)
if (a["historical-rows"]) {
  const hist = readJson<Record<string, unknown>[]>(a["historical-rows"]);
  const hmap = new Map(hist.map((h) => [h.gid as string, h]));
  const diffs: string[] = [];
  const epName = (s: unknown) => (typeof s === "string" && s.startsWith("not-attempted") ? "not-attempted" : s === "no-reference-endpoints" ? "no-reference" : s);
  const asName = (s: unknown) => (s === "wrong" ? "incorrect" : s);
  for (const r of ledger) {
    const h = hmap.get(r.measurement_id);
    if (!h) { diffs.push(`${r.measurement_id}: no historical row`); continue; }
    const pairs: [string, unknown, unknown][] = [
      ["engine id", h.id, r.engine?.id], ["endpoint category", epName(h.ep_cat), r.outcomes.endpoints], ["association", asName(h.assoc), r.outcomes.association],
      ["overall", h.overall, r.outcomes.overall], ["fully correct", h.fully_correct, r.fully_correct],
      ["line on reference axis", h.line_ok, r.line_on_reference_axis ?? false],
    ];
    for (const [k, x, y] of pairs) if (x !== y) diffs.push(`${r.measurement_id}: ${k} historical ${JSON.stringify(x)} recomputed ${JSON.stringify(y)}`);
  }
  L.push(`## Historical scorer rows vs recomputed ledger\n`);
  L.push(`Historical rows: ${path.basename(a["historical-rows"])} (sha256 ${sha256File(a["historical-rows"]).slice(0, 16)}…), ${hist.length} rows. Fields compared per item: engine id, endpoint category, association category, overall decision, fully-correct, line on the reference axis.`);
  L.push(diffs.length ? `**${diffs.length} item-level differences:**\n${diffs.map((d) => `- ${d}`).join("\n")}\n` : `**0 item-level differences across ${ledger.length} items.**\n`);
}

// stage 2 intersection
let stage2: { n: number; cp: number; extra: string[]; lost: string[]; ids: string[] } | null = null;
if (a["stage2-rows"]) {
  const s2 = new Set(readJson<{ gid: string; line_ok?: boolean }[]>(a["stage2-rows"]).filter((r) => r.line_ok).map((r) => r.gid));
  const cp = new Set(ids((r) => r.outcomes.endpoints === "correct-pair"));
  stage2 = { n: s2.size, cp: [...s2].filter((g) => cp.has(g)).length, extra: [...cp].filter((g) => !s2.has(g)).sort(), lost: [...s2].filter((g) => !cp.has(g)).sort(), ids: [...s2].filter((g) => cp.has(g)).sort() };
}

// whole drawing
const allDims = pages.flatMap((p) => p.dimensions);
const goldEngineIds = new Set(ledger.map((r) => r.engine?.id).filter(Boolean));
const accepted = allDims.filter((d) => d.decisions.overall === "acceptable");
const nonGold = accepted.filter((d) => !goldEngineIds.has(d.id));
const byMeasure = (ds: typeof allDims) => Object.entries(ds.reduce<Record<string, number>>((m, d) => ({ ...m, [d.association?.measures ?? "none"]: (m[d.association?.measures ?? "none"] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(", ");
let devCover: { file: string; matched: string[] }[] = [];
if (a["dev-review"]) {
  const near = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1.0;
  devCover = a["dev-review"].split(",").map((f) => {
    const items = readJson<{ page: number; text: string; endpoints_pt: number[][]; dim_id?: string }[]>(f);
    const matched = nonGold.filter((d) => items.some((it) => it.dim_id === d.id || (it.page === d.page && it.text === d.text && d.span &&
      ((near(d.span.start, it.endpoints_pt[0]) && near(d.span.end, it.endpoints_pt[1])) || (near(d.span.start, it.endpoints_pt[1]) && near(d.span.end, it.endpoints_pt[0])))))).map((d) => d.id);
    return { file: path.basename(f), matched };
  });
}
const covered = new Set(devCover.flatMap((c) => c.matched));
const whole = {
  total: allDims.length, accepted: accepted.length, held: allDims.filter((d) => d.decisions.overall === "hold").length, rejected: allDims.filter((d) => d.decisions.overall === "reject").length,
  gold_matched: goldEngineIds.size, gold_accepted: accepted.filter((d) => goldEngineIds.has(d.id)).length, non_gold_accepted: nonGold.length,
  non_gold_with_dev_review_tile: covered.size,
};

// historical summary claims, each recomputed from the ledger
type Claim = { claim: string; value: string; source: string; recompute: string };
const claimValue = (spec: string): string => {
  if (spec.startsWith("metric:")) { const m = M(spec.slice(7)); return `${m.numerator}/${m.denominator}`; }
  if (spec === "decision-split") return `${M("decision.acceptable").numerator}/${M("decision.hold").numerator}/${M("decision.reject").numerator}`;
  if (spec === "held-expected") { // score2's HELD_EXPECTED statuses: not accepted / all with that status
    const hx = ledger.filter((r) => ["CONFLICT", "GEOMETRY-INCONSISTENT", "NOT-DERIVABLE"].includes(r.reference.status));
    return `${hx.filter((r) => r.outcomes.overall !== "acceptable").length}/${hx.length}`;
  }
  if (spec === "axis") return `${ledger.filter((r) => r.line_on_reference_axis).length}/${ledger.length}`;
  if (spec === "stage2") return stage2 ? `${stage2.cp}/${stage2.n}` : "n/a";
  if (spec.startsWith("whole:")) return String(whole[spec.slice(6) as keyof typeof whole] ?? "n/a");
  return "n/a";
};
const claimRows = (claims: Claim[]) => claims.map((c) => {
  const got = claimValue(c.recompute);
  const status = got === c.value ? "RECONCILED (identical)" : got === "n/a" ? "UNRECONCILED (cannot be recomputed)" : "DIFFERS — recomputed value supersedes";
  return `| ${c.claim} | ${c.value} | ${c.source} | ${got} | ${status} |`;
});

L.push(`## Reconciliation questions\n`);
const cpIds = ids((r) => r.outcomes.endpoints === "correct-pair");
L.push(`**1. Stage 2 correct-line items with correct endpoints.** ${stage2 ? `Stage 2 had ${stage2.n} items with the correct line (historical rows ${path.basename(a["stage2-rows"])}). Of these, ${stage2.cp} have a correct endpoint pair in the frozen run: ${stage2.ids.join(", ")}. The ${stage2.lost.length} Stage-2 correct-line items WITHOUT a correct pair now: ${stage2.lost.map((g) => { const r = ledger.find((x) => x.measurement_id === g)!; return `${g} (line ${r.outcomes.line}, endpoints ${r.outcomes.endpoints}, reference ${r.reference.status})`; }).join("; ")}.` : "Stage 2 rows not supplied: UNRECONCILED."}\n`);
L.push(`**2. The extra items explaining ${cpIds.length} correct pairs overall.** ${stage2 ? `${stage2.extra.length} correct-pair items were NOT correct-line items at Stage 2: ${stage2.extra.map((g) => { const r = ledger.find((x) => x.measurement_id === g)!; return `${g} (line now ${r.outcomes.line}, ${r.engine?.decisions.line})`; }).join("; ")}. ${stage2.cp} + ${stage2.extra.length} = ${stage2.cp + stage2.extra.length}.` : "UNRECONCILED."}\n`);
const asOk = ledger.filter((r) => r.outcomes.association === "correct");
L.push(`**3. The ${asOk.length} correct associations** (denominator: all ${ledger.length}; every one has a correct endpoint pair, by definition): ${asOk.map((r) => r.measurement_id).join(", ")}.\n`);
const asOkNotAcc = asOk.filter((r) => r.outcomes.overall !== "acceptable");
L.push(`**4. Correct association but not accepted:** ${asOkNotAcc.length ? asOkNotAcc.map((r) => `${r.measurement_id} (${r.outcomes.overall}; reference status ${r.reference.status}; reasons: ${r.engine?.reasons.join(" | ")})`).join("; ") : "none"}. ${asOk.length} − ${asOkNotAcc.length} = ${asOk.length - asOkNotAcc.length} = accepted count ${M("decision.acceptable").numerator}.\n`);
L.push(`**5. Mutually exclusive decisions (all ${ledger.length}):** accepted ${M("decision.acceptable").numerator}, held ${M("decision.hold").numerator}, rejected ${M("decision.reject").numerator}, missed ${M("decision.missed").numerator}. Final outcome vs reference: ${["correctly-accepted", "incorrectly-accepted", "correctly-held", "unnecessarily-held", "correctly-rejected", "incorrectly-rejected", "missed"].map((k) => `${k} ${M("final." + k).numerator}`).join(", ")}.\n`);
L.push(`**6. Mutually exclusive endpoint outcomes (all ${ledger.length}):** ${["correct-pair", "wrong-pair", "one-sided-match", "one-sided-wrong", "ambiguous", "unresolved", "not-attempted", "no-reference"].map((k) => `${k} ${M("endpoints." + k).numerator}`).join(", ")}. Line outcomes: ${["correct", "incorrect", "multiple-plausible", "none", "no-reference"].map((k) => `${k} ${M("line." + k).numerator}`).join(", ")}. Endpoint pair correct given a correct line: ${M("endpoints.correct-pair|line-correct").numerator}/${M("endpoints.correct-pair|line-correct").denominator}; correct pairs whose line was called ambiguous but resolved by terminators ('chosen-by-endpoints'): ${ledger.filter((r) => r.outcomes.endpoints === "correct-pair" && r.engine?.decisions.line === "chosen-by-endpoints").map((r) => r.measurement_id).join(", ") || "none"}.\n`);
const axisNotCorrect = ledger.filter((r) => r.line_on_reference_axis && r.outcomes.line !== "correct");
L.push(`**6a. Line definition.** The historical scorer counted a line as correct whenever the line the engine reported lies on the reference axis (${ledger.filter((r) => r.line_on_reference_axis).length}/${ledger.length}), including ${axisNotCorrect.length} whose line decision was 'ambiguous' (the engine itself said several lines were equally plausible and did not use it): ${axisNotCorrect.map((r) => r.measurement_id).join(", ") || "none"}. The formal metric (METRICS.md) puts those in 'multiple-plausible', so line.correct = ${M("line.correct").numerator}/${M("line.correct").denominator}. Same items, different category definition; both figures are reproducible from the ledger (field line_on_reference_axis).\n`);
L.push(`**7. Gold Set vs whole drawing.** The engine output has ${whole.total} dimensions on pages ${pages.map((p) => p.page).join(", ")}: accepted ${whole.accepted}, held ${whole.held}, rejected ${whole.rejected}. The ${ledger.length} Gold Set items match ${whole.gold_matched} of them; ${whole.gold_accepted} of the ${whole.accepted} acceptances are Gold Set items and ${whole.non_gold_accepted} are not (${byMeasure(nonGold)}). ${devCover.length ? `Developer review tile sets covering the ${whole.non_gold_accepted} non-Gold acceptances: ${devCover.map((c) => `${c.file} ${c.matched.length}`).join(", ")}; distinct covered ${whole.non_gold_with_dev_review_tile}/${whole.non_gold_accepted}${whole.non_gold_with_dev_review_tile === whole.non_gold_accepted ? "" : ` — NOT COVERED: ${nonGold.filter((d) => !covered.has(d.id)).map((d) => d.id).join(", ")}`}. The developer's 'correct' verdicts for these were given in the session conversation after viewing the tiles; no signed per-item verdict file exists, so "116/116 correct" is a developer statement, not an independent result.` : ""}\n`);
if (a.claims) {
  L.push(`## Historical summary claims vs recomputed\n\n| claim | historical | source | recomputed | status |\n|---|---|---|---|---|`);
  L.push(...claimRows(readJson<Claim[]>(a.claims)), "");
}
if (violations.length) L.push(`## ACCOUNTING VIOLATIONS\n${violations.map((v) => `- ${v}`).join("\n")}\n`);
writeText(path.join(out, "RECONCILIATION.md"), L.join("\n") + "\n");
writeJson(path.join(out, "whole-drawing.json"), { ...whole, non_gold_accepted_ids: nonGold.map((d) => d.id), dev_review_cover: devCover });

console.log(`ledger ${ledger.length} rows  sha ${ledgerHash.slice(0, 16)}  accounting ${violations.length ? "FAIL " + violations.length : "PASS"}`);
for (const k of ["detection.found", "parse.correct", "line.correct", "endpoints.correct-pair", "association.correct", "decision.acceptable", "decision.hold", "decision.reject", "final.incorrectly-accepted"]) { const m = M(k); console.log(`  ${k.padEnd(32)} ${m.numerator}/${m.denominator}`); }
if (violations.length) { console.log(violations.join("\n")); process.exit(1); }
