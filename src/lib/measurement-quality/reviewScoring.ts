/**
 * Ingestion and statistics for independent review responses: CSV form parsing, roster and
 * assignment validation (unknown reviewers, unassigned items, duplicates, missing answers),
 * submission locking before adjudication, raw agreement, Cohen's kappa (reviewPackages.ts),
 * Wilson intervals, and stratum-weighted estimates for sampled packages.
 *
 * Pure functions; no review verdict is produced here. Synthetic data appears only in tests.
 */
import { z } from "zod";
import { cohensKappa, REVIEW_RESPONSE_SCHEMA, ReviewResponse } from "./reviewPackages";

// ── CSV form → responses ────────────────────────────────────────────────────
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [h = [], ...body] = rows;
  return body.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), r[i] ?? ""])));
}

const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? null : Number(s));
/** One form row → a validated response; null when the row was left unanswered (no is_dimension). */
export function fromFormRow(r: Record<string, string>): ReviewResponse | null {
  if (!r.is_dimension?.trim()) return null;
  const p = (x: string, y: string) => (num(r[x]) === null || num(r[y]) === null ? null : [num(r[x])!, num(r[y])!]);
  const la = p("line_a_x", "line_a_y"), lb = p("line_b_x", "line_b_y"), e1 = p("end1_x", "end1_y"), e2 = p("end2_x", "end2_y");
  const hasElement = r.element_kind?.trim() || (r.end1_type?.trim() && r.end2_type?.trim());
  return ReviewResponse.parse({
    schema: REVIEW_RESPONSE_SCHEMA, item_id: r.item_id?.trim(), reviewer_id: r.reviewer_id?.trim(), reviewed_at: r.reviewed_at?.trim(),
    is_dimension: r.is_dimension.trim(), legibility: r.legibility?.trim() || null,
    end1_mark: r.end1_mark?.trim() || null, end2_mark: r.end2_mark?.trim() || null,
    printed_value: num(r.printed_value), unit: r.unit?.trim() || null,
    line: la && lb ? { a: la, b: lb } : null, endpoints: e1 && e2 ? [e1, e2] : null,
    measured_element: hasElement ? {
      ...(r.element_kind?.trim() ? { kind: r.element_kind.trim() } : {}),
      end1: r.element_end1 ?? "", end2: r.element_end2 ?? "",
      ...(r.end1_type?.trim() ? { end1_type: r.end1_type.trim() } : {}), ...(r.end2_type?.trim() ? { end2_type: r.end2_type.trim() } : {}),
    } : null,
    evidence_sufficient: r.evidence_sufficient?.trim(), ambiguous: r.ambiguous?.trim(), ambiguity_note: r.ambiguity_note ?? "",
    confidence: r.confidence?.trim(), explanation: r.explanation ?? "",
  });
}

// ── roster, assignments, submission locks ───────────────────────────────────
export const Roster = z.object({
  schema: z.literal("cunstruct.review-roster.v1"),
  reviewers: z.array(z.object({
    id: z.string().regex(/^[A-Z][A-Z0-9-]{1,15}$/),
    role: z.enum(["reviewer-1", "reviewer-2", "adjudicator"]),
    /** must be true for any reviewer whose results are reported as independent */
    independent: z.boolean(),
    assigned: z.array(z.string()),
  })).min(1),
});
export type Roster = z.infer<typeof Roster>;

export const SubmissionRegister = z.object({
  schema: z.literal("cunstruct.review-submissions.v1"),
  submissions: z.array(z.object({ reviewer_id: z.string(), file: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), locked_at: z.string().min(10) })),
});
export type SubmissionRegister = z.infer<typeof SubmissionRegister>;

export interface IngestResult {
  accepted: ReviewResponse[];
  errors: string[];
  /** assigned items with no response, per reviewer */
  missing: Record<string, string[]>;
}
/** Validates responses against the roster. Errors (unknown reviewer, adjudicator answering as a
 *  reviewer, unassigned item, duplicate answer) reject the offending responses; missing answers are
 *  reported, never filled. */
export function ingest(responses: ReviewResponse[], roster: Roster): IngestResult {
  const errors: string[] = [], accepted: ReviewResponse[] = [];
  const who = new Map(roster.reviewers.map((r) => [r.id, r]));
  const seen = new Map<string, number>();
  for (const r of responses) { const k = `${r.reviewer_id}¦${r.item_id}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  for (const r of responses) {
    const rv = who.get(r.reviewer_id);
    if (!rv) { errors.push(`${r.item_id}: unknown reviewer id "${r.reviewer_id}"`); continue; }
    if (rv.role === "adjudicator") { errors.push(`${r.item_id}: ${r.reviewer_id} is the adjudicator and cannot submit a review`); continue; }
    if (!rv.assigned.includes(r.item_id)) { errors.push(`${r.item_id}: not assigned to ${r.reviewer_id}`); continue; }
    if (seen.get(`${r.reviewer_id}¦${r.item_id}`)! > 1) { errors.push(`${r.item_id}: ${r.reviewer_id} answered more than once — all copies rejected`); continue; }
    accepted.push(r);
  }
  const missing: Record<string, string[]> = {};
  for (const rv of roster.reviewers.filter((x) => x.role !== "adjudicator")) {
    const done = new Set(accepted.filter((r) => r.reviewer_id === rv.id).map((r) => r.item_id));
    missing[rv.id] = rv.assigned.filter((i) => !done.has(i));
  }
  return { accepted, errors: [...new Set(errors)], missing };
}

/** Adjudication may start only when every reviewer's submission is registered (locked) and each
 *  file still has its registered hash. Returns the reasons it may not start (empty = may start). */
export function adjudicationBlockers(roster: Roster, register: SubmissionRegister | null, fileHashes: Record<string, string>): string[] {
  if (!register) return ["no submission register: reviewer submissions are not locked"];
  const out: string[] = [];
  for (const rv of roster.reviewers.filter((r) => r.role !== "adjudicator")) {
    const s = register.submissions.find((x) => x.reviewer_id === rv.id);
    if (!s) { out.push(`${rv.id}: submission not locked`); continue; }
    if (fileHashes[s.file] !== s.sha256) out.push(`${rv.id}: ${s.file} differs from its locked hash`);
  }
  return out;
}

// ── statistics ──────────────────────────────────────────────────────────────
/** Share of items on which two raters gave the same label. */
export function rawAgreement(pairs: [string, string][]): number | null {
  return pairs.length ? pairs.filter(([a, b]) => a === b).length / pairs.length : null;
}

/**
 * Agreement summary for two raters' categorical labels: raw agreement, Cohen's κ, PABAK
 * (prevalence- and bias-adjusted κ = (k·po − 1)/(k − 1) over the k categories used) and each
 * category's share. κ can be low despite high raw agreement when one category dominates (the
 * "kappa paradox"); reporting the prevalences and PABAK beside it keeps that visible.
 */
export function agreementSummary(pairs: [string, string][]) {
  const po = rawAgreement(pairs);
  const cats = [...new Set(pairs.flat())].sort();
  const k = cats.length;
  const prevalence = Object.fromEntries(cats.map((c) => [c, pairs.reduce((t, [a, b]) => t + (a === c ? 1 : 0) + (b === c ? 1 : 0), 0) / (2 * pairs.length)]));
  return {
    n: pairs.length, raw_agreement: po, disagreements: pairs.filter(([a, b]) => a !== b).length,
    /** undefined (null) when fewer than two categories were observed: chance agreement is then 1 */
    kappa: k < 2 ? null : cohensKappa(pairs), pabak: po === null || k < 2 ? null : (k * po - 1) / (k - 1), categories: k, prevalence,
    max_prevalence: k ? Math.max(...Object.values(prevalence)) : null,
  };
}

/** Wilson score interval for x successes in n (95% by default). A census is exact for the items it
 *  covers; the interval only expresses uncertainty when those items are treated as draws from a
 *  wider population of similar drawings, which one drawing set cannot justify on its own. */
export function wilson(x: number, n: number, z = 1.959964): { p: number; low: number; high: number } | null {
  if (n <= 0) return null;
  const p = x / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { p, low: Math.max(0, c - h), high: Math.min(1, c + h) };
}

export interface StratumObs { key: string; population: number; reviewed: number; positive: number }

/** log C(n, k) */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let r = 0;
  for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i);
  return r;
}
/** Hypergeometric P(X = x) for a sample of n from N items of which K are positive. */
function hyperPmf(N: number, K: number, n: number, x: number): number {
  return Math.exp(logChoose(K, x) + logChoose(N - K, n - x) - logChoose(N, n));
}
/**
 * Exact two-sided confidence bounds for the number of positive items K in a finite stratum of N,
 * after observing x positives in a simple random sample of n drawn without replacement (inverting
 * the hypergeometric tails, the finite-population analogue of Clopper-Pearson). Each tail has
 * probability at most alpha/2. Valid for every n ≥ 1, including x = 0 or x = n, and exact (K = x)
 * for a census (n = N).
 */
export function exactStratumBounds(N: number, n: number, x: number, alpha: number): [number, number] {
  if (n === N) return [x, x];
  const kMin = x, kMax = N - (n - x);
  const tailGE = (K: number) => { let p = 0; for (let j = x; j <= Math.min(n, K); j++) p += hyperPmf(N, K, n, j); return p; };
  const tailLE = (K: number) => { let p = 0; for (let j = Math.max(0, n - (N - K)); j <= x; j++) p += hyperPmf(N, K, n, j); return p; };
  let lo = kMin; while (lo < kMax && tailGE(lo) < alpha / 2) lo++;
  let hi = kMax; while (hi > kMin && tailLE(hi) < alpha / 2) hi--;
  return [lo, hi];
}

/**
 * Design-based estimate of how many population items have a property, from a stratified simple
 * random sample drawn without replacement within each stratum (how packages C and D are drawn).
 *
 * - Estimator: T = Σ N_h·p_h, with p_h = x_h/n_h (unbiased for the total).
 * - Variance: the standard unbiased estimator Σ N_h²·(1 − n_h/N_h)·s_h²/n_h, with
 *   s_h² = n_h·p_h(1 − p_h)/(n_h − 1), which simplifies to N_h²(1 − f_h)p_h(1 − p_h)/(n_h − 1).
 *   It is undefined when n_h = 1. When p_h is 0 or 1 it is 0, which is correct as an estimate but
 *   says nothing reliable about uncertainty from a small sample.
 * - Normal-approximation interval: given ONLY when every reviewed stratum has n_h ≥ 2 and
 *   0 < p_h < 1; otherwise null, with the reason recorded. No pseudo-count or epsilon is used.
 * - Exact interval (always given): each reviewed stratum gets an exact hypergeometric interval at
 *   level α/H (Bonferroni over its H reviewed strata); the totals of the bounds form a
 *   simultaneous interval with coverage at least 1 − α. It is conservative, and wide for small
 *   samples, which is the honest statement of what such samples can show.
 * - Strata with no reviewed item are excluded from the estimate and listed: nothing is known about
 *   them from the sample, so no number is extrapolated to them.
 */
export function stratifiedEstimate(strata: StratumObs[], alpha = 0.05) {
  const used = strata.filter((s) => s.reviewed > 0);
  const N = used.reduce((t, s) => t + s.population, 0);
  let T = 0, V = 0;
  const singleItem: string[] = [], allOrNone: string[] = [];
  let lo = 0, hi = 0;
  for (const s of used) {
    const p = s.positive / s.reviewed, fpc = 1 - s.reviewed / s.population;
    T += s.population * p;
    if (s.reviewed >= 2) V += s.population ** 2 * fpc * (p * (1 - p)) / (s.reviewed - 1);
    else if (fpc > 0) singleItem.push(s.key);
    if ((p === 0 || p === 1) && fpc > 0 && s.reviewed >= 2) allOrNone.push(s.key);
    const [l, h] = exactStratumBounds(s.population, s.reviewed, s.positive, alpha / Math.max(1, used.length));
    lo += l; hi += h;
  }
  const z = 1.959964; // two-sided 95%; the normal interval is only reported for alpha = 0.05
  const normalOk = used.length > 0 && !singleItem.length && !allOrNone.length && alpha === 0.05;
  const se = singleItem.length ? null : Math.sqrt(V);
  return {
    estimate: T,
    covered_population: N,
    design_variance: singleItem.length ? null : V,
    normal_interval: normalOk ? [Math.max(0, T - z * se!), Math.min(N, T + z * se!)] as [number, number] : null,
    normal_interval_withheld_because: normalOk ? null
      : [singleItem.length ? `variance undefined for single-review strata (${singleItem.join(", ")})` : "", allOrNone.length ? `all-or-none strata (${allOrNone.join(", ")}): zero estimated variance is not evidence of certainty` : ""].filter(Boolean).join("; ") || "no reviewed strata",
    exact_interval: [lo, hi] as [number, number],
    exact_method: `exact hypergeometric bounds per stratum at level ${alpha}/${Math.max(1, used.length)} (Bonferroni), summed; coverage ≥ ${1 - alpha}, conservative`,
    single_item_strata: singleItem, all_or_none_strata: allOrNone,
    uncovered_strata: strata.filter((s) => s.reviewed === 0).map((s) => s.key),
  };
}
