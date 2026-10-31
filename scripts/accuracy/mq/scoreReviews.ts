// Ingests independent review responses and scores them against the SECRET answer key.
//   npx vite-node --root . scripts/accuracy/mq/scoreReviews.ts --key <answer-key.json> --sampling <sampling.json> --roster <roster.json>
//     --responses <r1.csv|json>[,<r2.csv|json>...] [--register <submissions.json>] [--adjudications <adj.json>] --out <dir>
//     [--label "SYNTHETIC PIPELINE TEST"]
// Every verdict comes from a response file. Unknown reviewers, unassigned items and duplicate answers
// are rejected; missing answers are listed, never filled. Disagreements stay "needs-adjudication";
// adjudication input is accepted only once every reviewer's submission is locked in the register.
import path from "node:path";
import { readFileSync } from "node:fs";
import { Adjudication, cohensKappa, decisionOutcome, disagreements, resolveItems, ReviewResponse, verdict, type AnswerKeyEntry, type DecisionOutcome } from "@/lib/measurement-quality/reviewPackages";
import { adjudicationBlockers, fromFormRow, ingest, parseCsv, rawAgreement, Roster, stratifiedEstimate, SubmissionRegister, wilson } from "@/lib/measurement-quality/reviewScoring";
import { args, assertOutsideRepo, need, readJson, REPO, sha256File, toCsv, writeJson, writeText } from "./common";

/** Malformed responses are rejected one by one with a reason; they never stop the run and are never repaired. */
const malformed: string[] = [];
function load(file: string): ReviewResponse[] {
  const t = readFileSync(file, "utf8");
  const rows: unknown[] = file.endsWith(".csv") ? parseCsv(t) : (() => { const j = JSON.parse(t); return Array.isArray(j) ? j : j.responses; })();
  const out: ReviewResponse[] = [];
  rows.forEach((x, i) => {
    try {
      const r = file.endsWith(".csv") ? fromFormRow(x as Record<string, string>) : ReviewResponse.parse(x);
      if (r) out.push(r);
    } catch (e) {
      const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      malformed.push(`${path.basename(file)} row ${i + 1} (${(x as { item_id?: string }).item_id ?? "?"}): ${issues ? issues.map((q) => `${q.path.join(".")}: ${q.message}`).join("; ") : String(e)}`);
    }
  });
  return out;
}

const a = args();
const out = need(a, "out");
assertOutsideRepo(out);
const label = a.label ?? "";
const key = readJson<{ entries: AnswerKeyEntry[] }>(need(a, "key")).entries;
const sampling = readJson<{ packages: Record<string, { strata?: { key: string; population: number }[]; population: number }> }>(need(a, "sampling"));
const roster = Roster.parse(readJson(need(a, "roster")));
const byId = new Map(key.map((k) => [k.item_id, k]));
const files = need(a, "responses").split(",");
const raw = files.flatMap(load);
for (const r of raw) if (!byId.has(r.item_id)) throw new Error(`response for unknown item ${r.item_id}`);
const ing = ingest(raw, roster);
const { accepted: responses, missing } = ing;
const errors = [...malformed.map((m) => `malformed: ${m}`), ...ing.errors];

let adjudications: Adjudication[] = [];
const register = a.register ? SubmissionRegister.parse(readJson(a.register)) : null;
const blockers = adjudicationBlockers(roster, register, Object.fromEntries(files.map((f) => [path.basename(f), sha256File(f)])));
if (a.adjudications) {
  if (blockers.length) throw new Error(`adjudication refused: ${blockers.join("; ")}`);
  const adjIds = new Set(roster.reviewers.filter((r) => r.role === "adjudicator").map((r) => r.id));
  adjudications = readJson<unknown[]>(a.adjudications).map((x) => Adjudication.parse(x));
  for (const j of adjudications) if (!adjIds.has(j.reviewer_id)) throw new Error(`${j.item_id}: ${j.reviewer_id} is not a rostered adjudicator`);
}
const res = resolveItems(responses, adjudications);
const reviewers = [...new Set(responses.map((r) => r.reviewer_id))].sort();

const scored = res.filter((r) => r.final).map((r) => {
  const k = byId.get(r.item_id)!, v = verdict(r.final!, k);
  return { item_id: r.item_id, package: k.package, state: r.state, ...v, outcome: decisionOutcome(v.verdict, k), page: k.page, view: k.view, scale_region: k.scale_region, measures: k.measures, primary_reason: k.primary_reason };
});
const count = (pkg: string, o: DecisionOutcome[]) => scored.filter((s) => s.package === pkg && o.includes(s.outcome)).length;
const reviewed = (pkg: string) => scored.filter((s) => s.package === pkg).length;
const total = (pkg: string) => key.filter((k) => k.package === pkg).length;

// agreement on items both of the first two reviewers answered
const r1 = roster.reviewers.find((r) => r.role === "reviewer-1")?.id, r2 = roster.reviewers.find((r) => r.role === "reviewer-2")?.id;
const pairs: { id: string; a: ReviewResponse; b: ReviewResponse }[] = [];
for (const id of new Set(responses.map((r) => r.item_id))) {
  const x = responses.find((r) => r.item_id === id && r.reviewer_id === r1), y = responses.find((r) => r.item_id === id && r.reviewer_id === r2);
  if (x && y) pairs.push({ id, a: x, b: y });
}
const vpairs = pairs.map((p) => [verdict(p.a, byId.get(p.id)!).verdict, verdict(p.b, byId.get(p.id)!).verdict] as [string, string]);
const kappa = cohensKappa(vpairs), agree = rawAgreement(vpairs);
const dis = pairs.map((p) => ({ ...p, d: disagreements(p.a, p.b) })).filter((p) => p.d.length);
const groupBy = (f: (k: AnswerKeyEntry) => string) => {
  const m = new Map<string, [number, number]>();
  for (const p of pairs) { const g = f(byId.get(p.id)!); const v = m.get(g) ?? [0, 0]; v[1]++; if (disagreements(p.a, p.b).length) v[0]++; m.set(g, v); }
  return [...m].sort().map(([g, [d, n]]) => `${g}: ${d}/${n}`).join("; ") || "n/a";
};
const pct = (w: ReturnType<typeof wilson>) => (w ? `${(w.low * 100).toFixed(1)}%–${(w.high * 100).toFixed(1)}%` : "n/a");
function weighted(pkg: string, o: DecisionOutcome[]): string {
  const strata = sampling.packages[pkg]?.strata;
  if (!strata) return "n/a";
  const obs = strata.map((s) => { const xs = scored.filter((x) => x.package === pkg && x.primary_reason === s.key); return { key: s.key, population: s.population, reviewed: xs.length, positive: xs.filter((x) => o.includes(x.outcome)).length }; });
  if (!obs.some((s) => s.reviewed)) return "n/a (no resolved reviews)";
  const e = stratifiedEstimate(obs);
  const iv = e.normal_interval ? `normal-approx. 95% ${e.normal_interval[0].toFixed(1)}–${e.normal_interval[1].toFixed(1)}` : `normal interval withheld: ${e.normal_interval_withheld_because}`;
  return `${e.estimate.toFixed(1)} of ${e.covered_population} (exact simultaneous ≥95% interval ${e.exact_interval[0]}–${e.exact_interval[1]}; ${iv}${e.uncovered_strata.length ? `; strata with no resolved review, not estimated: ${e.uncovered_strata.join(", ")}` : ""})`;
}
const aErr = count("A", ["accepted-error"]), aRev = reviewed("A");
const fill: Record<string, string> = {
  LABEL: label ? `\n> **${label}** — not an independent result.\n` : "",
  REVIEWERS: reviewers.join(", ") || "none", RESPONSES: String(responses.length), REJECTED: String(errors.length),
  MISSING: Object.entries(missing).map(([k, v]) => `${k} ${v.length}`).join(", "),
  ITEMS_TOTAL: String(key.length),
  A_TOTAL: String(total("A")), A_REVIEWED: String(aRev), A_CONFIRMED: String(count("A", ["accepted-confirmed"])), A_ERRORS: String(aErr), A_UNCONFIRMABLE: String(count("A", ["accepted-unconfirmable"])),
  A_WILSON: pct(wilson(aErr, aRev)),
  B_TOTAL: String(total("B")), B_REVIEWED: String(reviewed("B")), B_UNNECESSARY: String(count("B", ["held-unnecessarily"])), B_ENGINE_WRONG: String(count("B", ["held-recoverable-engine-evidence-wrong", "rejected-recoverable"])), B_CORRECT: String(count("B", ["held-correctly", "rejected-correctly"])),
  C_TOTAL: String(total("C")), C_REVIEWED: String(reviewed("C")), C_UNNECESSARY: String(count("C", ["held-unnecessarily"])), C_ENGINE_WRONG: String(count("C", ["held-recoverable-engine-evidence-wrong"])), C_CORRECT: String(count("C", ["held-correctly"])),
  C_POPULATION: String(sampling.packages.C?.population ?? "?"),
  D_TOTAL: String(total("D")), D_REVIEWED: String(reviewed("D")), D_CORRECT: String(count("D", ["rejected-correctly"])), D_RECOVERABLE: String(count("D", ["rejected-recoverable"])), D_POPULATION: String(sampling.packages.D?.population ?? "?"),
  PAIRS: String(pairs.length), KAPPA: kappa === null ? "n/a" : kappa.toFixed(3), AGREE: agree === null ? "n/a" : `${(agree * 100).toFixed(1)}%`, DISAGREE: String(dis.length),
  DIS_BY_TYPE: groupBy((k) => k.measures ?? "none"), DIS_BY_VIEW: groupBy((k) => k.view), DIS_BY_SCALE: groupBy((k) => k.scale_region ?? "none"),
  STATES: ["single-review", "agreed", "needs-adjudication", "adjudicated"].map((s) => `${s} ${res.filter((r) => r.state === s).length}`).join(", "),
  A_ERROR_IDS: scored.filter((s) => s.outcome === "accepted-error").map((s) => `${s.item_id} (${s.mismatches.join(", ") || s.verdict})`).join("; ") || "none",
  WEIGHTED_C: weighted("C", ["held-unnecessarily"]), WEIGHTED_D: weighted("D", ["rejected-correctly"]),
  ADJ_STATUS: blockers.length ? `not yet possible (${blockers.join("; ")})` : "submissions locked; adjudication may proceed",
};
const tpl = readFileSync(path.join(REPO, "docs/measurement-quality/INDEPENDENT-EVALUATION-REPORT-TEMPLATE.md"), "utf8");
writeText(path.join(out, "INDEPENDENT-EVALUATION-REPORT.md"), tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k] ?? `{{${k}}}`));
writeJson(path.join(out, "review-resolution.json"), { label: label || null, reviewers, ingest_errors: errors, missing, resolution: res, scored, disagreements: dis.map((p) => ({ item_id: p.id, fields: p.d })) });

// adjudication packet: only once both submissions are locked; shows both answers, never the engine's
if (!blockers.length && dis.length) {
  const flat = (r: ReviewResponse) => [r.is_dimension, r.printed_value, r.unit, JSON.stringify(r.endpoints), JSON.stringify(r.measured_element), r.evidence_sufficient, r.ambiguous, r.confidence, r.explanation];
  const cols = ["is_dimension", "printed_value", "unit", "endpoints", "element", "evidence_sufficient", "ambiguous", "confidence", "explanation"];
  writeText(path.join(out, "adjudication-packet.csv"), toCsv(["item_id", "disagreeing_fields", ...cols.map((c) => `R1_${c}`), ...cols.map((c) => `R2_${c}`)],
    dis.map((p) => [p.id, p.d.join("|"), ...flat(p.a), ...flat(p.b)])));
}
console.log(`${label ? `[${label}] ` : ""}responses ${responses.length} accepted, ${errors.length} rejected; missing ${fill.MISSING}; resolved ${scored.length}/${key.length}; ${fill.STATES}; agreement ${fill.AGREE}, kappa ${fill.KAPPA}; adjudication ${fill.ADJ_STATUS}`);
if (errors.length) console.log(errors.slice(0, 10).join("\n"));
