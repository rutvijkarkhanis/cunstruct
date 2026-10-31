// Held/rejected population analysis and ranked engineering opportunity register (frozen engine output).
//   npx vite-node --root . scripts/accuracy/mq/analyzeFailures.ts --engine <engine-output.json> --ledger <ledger.json> --out <dir>
//     [--register <judgements.json>] [--historical-held <held_items.json>]
// Counts come from the engine output and the reconciled ledger. Effort and risk ratings come from the
// --register judgements file and are labelled as judgement, not measurement.
import path from "node:path";
import type { LinearDimension, PageDimensions } from "@/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions";
import type { LedgerRow } from "@/lib/measurement-quality/ledger";
import { classifyFailure, FAILURE_CATEGORIES, type FailureCategory } from "@/lib/measurement-quality/failureReasons";
import { args, assertOutsideRepo, need, readJson, toCsv, writeJson, writeText } from "./common";

const a = args();
const out = need(a, "out");
assertOutsideRepo(out);
const pages = readJson<PageDimensions[]>(need(a, "engine"));
const ledger = readJson<{ rows: LedgerRow[] }>(need(a, "ledger")).rows;
const byEngine = new Map(ledger.filter((r) => r.engine).map((r) => [r.engine!.id, r]));
const orient = (d: LinearDimension) => { const l = d.line; if (!l) return "unknown"; const dx = Math.abs(l.b[0] - l.a[0]), dy = Math.abs(l.b[1] - l.a[1]); return dy < 0.05 * dx ? "horizontal" : dx < 0.05 * dy ? "vertical" : "oblique"; };

/** Engine evidence correct up to (not including) the blocking stage, judged against the reference:
 *  line blockers: the line the engine reported lies on the reference axis; endpoint blockers: the line
 *  is correct; association blockers: the endpoint pair is correct; scale and cross-check blockers: the
 *  pair and the association are both correct. It says the blocker is where the work is, not that
 *  resolving it would give the right answer. */
function correctBeforeBlocker(g: LedgerRow, stage: string): boolean {
  const o = g.outcomes;
  if (stage === "line") return g.line_on_reference_axis === true && o.line !== "none";
  if (stage === "endpoints") return o.line === "correct";
  if (stage === "association") return o.endpoints === "correct-pair";
  return o.endpoints === "correct-pair" && o.association === "correct";
}

const pop = pages.flatMap((p) => p.dimensions).filter((d) => d.decisions.overall !== "acceptable").map((d) => {
  const f = classifyFailure(d)!, g = byEngine.get(d.id);
  return {
    id: d.id, page: d.page, value: d.parsed.value, status: d.decisions.overall, primary: f.primary, secondary: f.secondary, soleBlocker: f.soleBlocker, stage: f.stage,
    orientation: orient(d), measures: d.association?.measures ?? null, region: d.scaleCheck?.region ?? null, view: g?.view ?? `p${d.page}`,
    gold_id: g?.measurement_id ?? null, gold_status: g?.reference.status ?? null, gold_final: g?.outcomes.final ?? null, gold_evidence_correct: g ? correctBeforeBlocker(g, f.stage) : null,
    gold_parts: g ? { line: g.outcomes.line, endpoints: g.outcomes.endpoints, association: g.outcomes.association } : null,
  };
});
const cats = Object.keys(FAILURE_CATEGORIES) as FailureCategory[];
const tally = <K extends string>(xs: typeof pop, f: (x: (typeof pop)[number]) => K) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [f(x)]: (m[f(x)] ?? 0) + 1 }), {});

writeText(path.join(out, "held-rejected-classification.csv"), toCsv(
  ["engine_id", "page", "value", "status", "primary_reason", "secondary_reasons", "sole_blocker", "stage", "orientation", "measures", "scale_region", "gold_id", "gold_status", "gold_final_outcome", "gold_evidence_correct_before_blocker"],
  pop.map((x) => [x.id, x.page, x.value, x.status, x.primary, x.secondary.join("|"), x.soleBlocker === null ? "unknown" : x.soleBlocker, x.stage, x.orientation, x.measures ?? "", x.region ?? "", x.gold_id ?? "", x.gold_status ?? "", x.gold_final ?? "", x.gold_evidence_correct ?? ""])));

// historical developer held sample (context only)
const hist = a["historical-held"] ? readJson<{ id: string; page: number; text: string; endpoints_pt: number[][]; why?: string }[]>(a["historical-held"]) : [];
const near = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1;
const all = new Map(pages.flatMap((p) => p.dimensions).map((d) => [d.id, d]));
const histCats = hist.map((h) => {
  const d = [...all.values()].find((x) => x.page === h.page && x.text === h.text && x.span && ((near(x.span.start, h.endpoints_pt[0]) && near(x.span.end, h.endpoints_pt[1])) || (near(x.span.start, h.endpoints_pt[1]) && near(x.span.end, h.endpoints_pt[0]))));
  return { sample_id: h.id, engine_id: d?.id ?? null, primary: d ? classifyFailure(d)?.primary ?? "accepted" : "unmatched" };
});

// register judgements (effort, risk, generalizability, validation data): human-authored inputs
type J = { pattern: FailureCategory; implementation_effort: 1 | 2 | 3; validation_effort: 1 | 2 | 3; false_acceptance_risk: string; generalizability_risk: string; human_resolvability: string; evidence_available: string; required_validation_data: string; note?: string };
const judgements = a.register ? readJson<J[]>(a.register) : [];
const register = cats.filter((c) => pop.some((x) => x.primary === c)).map((c) => {
  const xs = pop.filter((x) => x.primary === c), golds = xs.filter((x) => x.gold_id);
  const goldDetermined = golds.filter((x) => x.gold_status === "OK");
  const goldCorrect = goldDetermined.filter((x) => x.gold_evidence_correct);
  const sole = xs.filter((x) => x.soleBlocker === true).length, unknown = xs.filter((x) => x.soleBlocker === null).length;
  const j = judgements.find((q) => q.pattern === c);
  // expected benefit: sole-blocker items × the Gold-Set-observed share whose engine evidence is correct up to the blocker.
  // With fewer than 3 determined Gold Set items in the pattern the share is not estimated (0.5 used, flagged).
  const share = goldDetermined.length >= 3 ? goldCorrect.length / goldDetermined.length : 0.5;
  // patterns whose later stages were never attempted have no measurable benefit yet (null, ranked last)
  const notOpportunity = Boolean(j?.note?.startsWith("Not an automation opportunity"));
  const benefit = notOpportunity || (sole === 0 && unknown > 0) ? null : sole * share;
  const effort = j ? j.implementation_effort + j.validation_effort : null;
  return {
    pattern: c, description: FAILURE_CATEGORIES[c], stage: xs[0].stage, affected: xs.length, held: xs.filter((x) => x.status === "hold").length, rejected: xs.filter((x) => x.status === "reject").length,
    sole_blocker: sole, sole_blocker_unknown: unknown, also_secondary_in: pop.filter((x) => x.secondary.includes(c)).length,
    pages: tally(xs, (x) => `p${x.page}`), views: tally(xs.filter((x) => x.gold_id), (x) => x.view), orientations: tally(xs, (x) => x.orientation), measures: tally(xs, (x) => x.measures ?? "none"),
    secondary_reasons: tally(xs.filter((x) => x.secondary.length), (x) => x.secondary.join("+")),
    gold: { items: golds.length, determined: goldDetermined.length, evidence_correct_before_blocker: goldCorrect.length, ids: golds.map((x) => `${x.gold_id}${x.gold_evidence_correct ? "✓" : "✗"}(${x.gold_status})`) },
    evidence_share_used: goldDetermined.length >= 3 ? `${goldCorrect.length}/${goldDetermined.length} (Gold Set, developer reference)` : `0.5 assumed (only ${goldDetermined.length} determined Gold Set item(s))`,
    expected_benefit: benefit === null ? null : Math.round(benefit * 10) / 10,
    effort, score: effort && benefit !== null ? Math.round((benefit / effort) * 100) / 100 : null,
    judgement: j ?? null,
  };
}).sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || y.affected - x.affected);

writeJson(path.join(out, "held-rejected-analysis.json"), { population: pop.length, held: pop.filter((x) => x.status === "hold").length, rejected: pop.filter((x) => x.status === "reject").length, by_primary: tally(pop, (x) => x.primary), by_stage: tally(pop, (x) => x.stage), historical_sample: histCats, register, items: pop });

const L: string[] = [];
const N = pop.length;
L.push(`# Held and rejected measurements — W976646, frozen engine\n`);
L.push(`Population: every non-accepted dimension in the engine output (pages 1, 3, 4): **${N}** = ${pop.filter((x) => x.status === "hold").length} held + ${pop.filter((x) => x.status === "reject").length} rejected (denominator for every count below unless stated). Classification: \`classifyFailure\` (src/lib/measurement-quality/failureReasons.ts) from the engine's own recorded decisions and reasons; primary = earliest blocking stage, secondary kept. Unclassified: ${pop.filter((x) => x.primary === "unclassified").length}/${N}.\n`);
L.push(`"Sole blocker" = the primary reason is the only blocker AND every later stage was evaluated and passed. "Unknown" = later stages were never attempted (line or endpoint failures), so other blockers may exist.\n`);
L.push(`| primary reason | stage | affected | held | rejected | sole blocker | sole unknown | also secondary in | Gold Set: evidence correct up to the blocker / determined (of all) |`);
L.push(`|---|---|---|---|---|---|---|---|---|`);
for (const r of [...register].sort((x, y) => y.affected - x.affected)) L.push(`| ${r.pattern} | ${r.stage} | ${r.affected} | ${r.held} | ${r.rejected} | ${r.sole_blocker} | ${r.sole_blocker_unknown} | ${r.also_secondary_in} | ${r.gold.evidence_correct_before_blocker}/${r.gold.determined} (of ${r.gold.items}) |`);
L.push(`\nBy stage (primary): ${Object.entries(tally(pop, (x) => x.stage)).map(([k, v]) => `${k} ${v}`).join(", ")}. By page: ${Object.entries(tally(pop, (x) => `p${x.page}`)).map(([k, v]) => `${k} ${v}`).join(", ")}. By orientation: ${Object.entries(tally(pop, (x) => x.orientation)).map(([k, v]) => `${k} ${v}`).join(", ")}.\n`);
L.push(`## What is and is not known about correctness\n`);
const gp = pop.filter((x) => x.gold_id);
L.push(`- Only the ${gp.length} Gold Set items among the ${N} have a reference (developer-verified, not independent). Of those, ${gp.filter((x) => x.gold_status === "OK" && x.gold_evidence_correct).length} have a determined reference and engine evidence that is correct up to the blocking stage (line on the reference axis / line correct / endpoint pair correct / pair and association correct, by stage), ${gp.filter((x) => x.gold_status === "OK" && !x.gold_evidence_correct).length} have a determined reference but engine evidence already wrong or missing before the blocker, and ${gp.filter((x) => x.gold_status !== "OK").length} have a reference that is itself a conflict, inconsistency, non-derivable or association-uncertain.`);
L.push(`- For the other ${N - gp.length}, correctness is unknown until the blinded review (packages C and D sample them with recorded inclusion probabilities).`);
L.push(`- Historical developer sample (15 held items reviewed in an earlier session, 13 judged correct-but-held): ${histCats.map((h) => `${h.sample_id}→${h.primary}`).join(", ")}. It was hand-picked, not sampled, so it is context only and is NOT used as a population rate.\n`);
L.push(`## Ranked engineering opportunity register\n`);
L.push(`Score = expected benefit ÷ effort. Expected benefit = sole-blocker count × the share of the pattern's determined Gold Set items whose engine evidence is correct up to the blocking stage (0.5 assumed and flagged when fewer than 3 such items). Effort = implementation (1–3) + validation (1–3). **Counts are measured; effort, risk and generalizability ratings are engineering judgement** (input file: ${a.register ? path.basename(a.register) : "none"}). A pattern's benefit is an upper bound on items that could become acceptable; none would be accepted without independent validation on a second drawing set.\n`);
L.push(`| rank | pattern | affected | sole blocker | evidence share used | benefit | effort | score | false-acceptance risk | generalizability risk | human-resolvable? | validation data needed |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
register.forEach((r, i) => L.push(`| ${i + 1} | ${r.pattern} | ${r.affected} | ${r.sole_blocker}${r.sole_blocker_unknown ? ` (+${r.sole_blocker_unknown} unknown)` : ""} | ${r.evidence_share_used} | ${r.expected_benefit ?? (r.judgement?.note?.startsWith("Not an automation opportunity") ? "n/a (correct hold)" : "unknown")} | ${r.effort ?? "—"} | ${r.score ?? "—"} | ${r.judgement?.false_acceptance_risk ?? "—"} | ${r.judgement?.generalizability_risk ?? "—"} | ${r.judgement?.human_resolvability ?? "—"} | ${r.judgement?.required_validation_data ?? "—"} |`));
L.push(`\n### Pattern detail\n`);
for (const r of register) L.push(`- **${r.pattern}** — ${r.description}. Pages ${JSON.stringify(r.pages)}; orientations ${JSON.stringify(r.orientations)}; measures ${JSON.stringify(r.measures)}; with secondary ${JSON.stringify(r.secondary_reasons)}. Gold Set: ${r.gold.ids.join(", ") || "none"}. Evidence the engine records: ${r.judgement?.evidence_available ?? "—"}.${r.judgement?.note ? ` Note: ${r.judgement.note}` : ""}`);
writeText(path.join(out, "HELD-REJECTED-ANALYSIS.md"), L.join("\n") + "\n");
console.log(`population ${N}; patterns ${register.length}; top: ${register.slice(0, 5).map((r) => `${r.pattern}(${r.score})`).join(", ")}`);
