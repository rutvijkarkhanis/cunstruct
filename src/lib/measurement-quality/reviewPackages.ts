/**
 * Independent human review: deterministic stratified sampling, blinding, the reviewer response
 * schema, scoring of reviews against engine records, inter-reviewer agreement and adjudication.
 *
 * Nothing here produces a review verdict: verdicts come only from reviewer response files. When two
 * reviewers disagree the item goes to adjudication; it is never settled by taking the engine's answer.
 */
import { z } from "zod";

// ── deterministic randomness ────────────────────────────────────────────────
/** mulberry32: small, well-known, deterministic PRNG. Same seed → same sequence everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
export function blindIds(n: number, rnd: () => number, prefix = "RV-"): string[] {
  const out = new Set<string>();
  while (out.size < n) out.add(prefix + Array.from({ length: 6 }, () => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join(""));
  return [...out];
}

// ── stratified sampling ─────────────────────────────────────────────────────
export interface Stratum { key: string; population: number; sampled: number; inclusionProbability: number }
export interface Sample<T> { items: T[]; strata: Stratum[]; seed: number; method: string }

/**
 * Proportional allocation over the primary stratum key by largest remainder; when n allows, a stratum
 * left empty is given one item, taken from the largest allocation. Inside a stratum, items are taken in seeded-shuffle order,
 * each time preferring the item whose secondary attributes (view, orientation, scale…) are least
 * represented so far. Inclusion probabilities are reported so any population estimate can be weighted.
 */
export function stratifiedSample<T>(pool: readonly T[], n: number, seed: number, primary: (t: T) => string, secondary: ((t: T) => string)[] = []): Sample<T> {
  const rnd = mulberry32(seed);
  const groups = new Map<string, T[]>();
  for (const t of pool) groups.set(primary(t), [...(groups.get(primary(t)) ?? []), t]);
  const keys = [...groups.keys()].sort();
  const N = pool.length;
  n = Math.min(n, N);
  // proportional (largest remainder), then lift empty strata to 1 by taking from the largest allocation
  const size = (k: string) => groups.get(k)!.length;
  const share = keys.map((k) => ({ k, exact: (size(k) / N) * n }));
  const alloc = new Map(share.map((x) => [x.k, Math.floor(x.exact)]));
  let left = n - [...alloc.values()].reduce((s, v) => s + v, 0);
  for (const x of [...share].sort((p, q) => (q.exact % 1) - (p.exact % 1) || p.k.localeCompare(q.k))) { if (left <= 0) break; alloc.set(x.k, alloc.get(x.k)! + 1); left--; }
  if (n >= keys.length) for (const k of keys) if (alloc.get(k) === 0) {
    const donor = [...keys].sort((p, q) => alloc.get(q)! - alloc.get(p)! || p.localeCompare(q))[0];
    alloc.set(donor, alloc.get(donor)! - 1); alloc.set(k, 1);
  }

  const picked: T[] = [];
  const seen = secondary.map(() => new Map<string, number>());
  for (const k of keys) {
    let cand = shuffle(groups.get(k)!, rnd);
    for (let i = 0; i < alloc.get(k)!; i++) {
      const score = (t: T) => secondary.reduce((s, f, j) => s + (seen[j].get(f(t)) ?? 0), 0);
      let best = 0;
      for (let c = 1; c < cand.length; c++) if (score(cand[c]) < score(cand[best])) best = c;
      const t = cand[best];
      cand = cand.filter((_, c) => c !== best);
      secondary.forEach((f, j) => seen[j].set(f(t), (seen[j].get(f(t)) ?? 0) + 1));
      picked.push(t);
    }
  }
  return {
    items: picked, seed,
    method: "proportional allocation (largest remainder; an empty stratum is lifted to 1 from the largest) on the primary key; diversity-greedy on secondary keys within a stratum; mulberry32 seeded shuffle",
    strata: keys.map((k) => ({ key: k, population: groups.get(k)!.length, sampled: alloc.get(k)!, inclusionProbability: alloc.get(k)! / groups.get(k)!.length })),
  };
}

// ── schemas ─────────────────────────────────────────────────────────────────
/** [x, y]. Arrays with a fixed length rather than z.tuple: with this project's compiler settings
 *  z.tuple infers an open "...unknown[]" rest element. */
const pt = z.array(z.number()).length(2);
const pair = z.array(pt).length(2);
export const REVIEW_RESPONSE_SCHEMA = "cunstruct.review-response.v1";
export const ElementKind = z.enum(["grid-to-grid", "grid-to-edge", "edge-to-edge", "other", "cannot-tell"]);
/** What one end of a dimension is measured to, in a drafter's terms. Everything but "grid" and
 *  "other"/"cannot-tell" is a drawn edge for scoring purposes. */
export const EndType = z.enum(["grid", "wall-face", "column-face", "opening-edge", "slab-or-floor-edge", "stair", "other-drawn-edge", "other", "cannot-tell"]);
export type EndType = z.infer<typeof EndType>;
const MeasuredElement = z.object({
  kind: ElementKind.optional(),
  end1: z.string(),
  end2: z.string(),
  end1_type: EndType.optional(),
  end2_type: EndType.optional(),
}).refine((m) => m.kind !== undefined || (m.end1_type !== undefined && m.end2_type !== undefined), { message: "give element_kind or both end types" });
/** The element kind a reviewer stated, or derived from the two end types when only those were given. */
export function elementKind(m: { kind?: z.infer<typeof ElementKind>; end1_type?: EndType; end2_type?: EndType } | null): z.infer<typeof ElementKind> | null {
  if (!m) return null;
  if (m.end1_type && m.end2_type) {
    const t = [m.end1_type, m.end2_type];
    if (t.includes("cannot-tell")) return "cannot-tell";
    if (t.includes("other")) return "other";
    const g = t.filter((x) => x === "grid").length;
    const derived = g === 2 ? "grid-to-grid" : g === 1 ? "grid-to-edge" : "edge-to-edge";
    if (m.kind && m.kind !== derived) return m.kind; // an explicit kind is the reviewer's own statement
    return derived;
  }
  return m.kind ?? null;
}
/** Grid labels a reviewer named: "grid 7", "7" on an end typed grid, or "grid 7/B". */
export function namedGrids(m: { end1?: string; end2?: string; end1_type?: EndType; end2_type?: EndType } | null): string[] {
  if (!m) return [];
  return ([[m.end1 ?? "", m.end1_type], [m.end2 ?? "", m.end2_type]] as [string, EndType | undefined][]).flatMap(([s, t]) => {
    const g = /grid\s+([A-Za-z0-9'/]+)/i.exec(s)?.[1] ?? (t === "grid" ? s.trim() : "");
    return g ? g.split("/").filter(Boolean) : [];
  });
}
/** The end mark a reviewer sees at one end of the dimension line. */
export const TerminatorMark = z.enum(["tick", "arrowhead", "dot", "extension-line-only", "none", "cannot-tell"]);
export type TerminatorMark = z.infer<typeof TerminatorMark>;
/** The engine's terminator kinds in the reviewer's vocabulary. */
export const ENGINE_MARK: Record<string, TerminatorMark> = { "filled-tick": "tick", "stroke-tick": "tick", arrowhead: "arrowhead", dot: "dot", "extension-stub": "extension-line-only" };

export const ReviewResponse = z.object({
  schema: z.literal(REVIEW_RESPONSE_SCHEMA),
  item_id: z.string().regex(/^RV-[2-9A-HJ-NP-Z]{6}$/),
  reviewer_id: z.string().min(1),
  reviewed_at: z.string().min(10),
  is_dimension: z.enum(["yes", "no", "unsure"]),
  /** null only in responses made before this field existed (v2.0 packages) */
  legibility: z.enum(["legible", "partly-legible", "illegible"]).nullable().default(null),
  printed_value: z.number().nullable(),
  unit: z.enum(["mm", "cm", "m", "in", "none-stated", "unsure"]).nullable(),
  /** page points (PDF, top-left origin, y down — the coordinates printed on every crop's ruler) */
  line: z.object({ a: pt, b: pt }).nullable(),
  endpoints: pair.nullable(),
  /** end marks at End 1 and End 2, in the same order as endpoints */
  end1_mark: TerminatorMark.nullable().default(null),
  end2_mark: TerminatorMark.nullable().default(null),
  measured_element: MeasuredElement.nullable(),
  evidence_sufficient: z.enum(["yes", "no"]),
  ambiguous: z.enum(["yes", "no"]),
  ambiguity_note: z.string().default(""),
  confidence: z.enum(["high", "medium", "low"]),
  explanation: z.string().default(""),
});
export type ReviewResponse = z.infer<typeof ReviewResponse>;

export const Adjudication = ReviewResponse.extend({ adjudicates: z.array(z.string()).min(2), note: z.string().min(1) });
export type Adjudication = z.infer<typeof Adjudication>;

/** Secret answer-key entry (never shipped to reviewers). */
export interface AnswerKeyEntry {
  item_id: string;
  package: "A" | "B" | "C" | "D";
  engine_id: string;
  gold_id: string | null;
  page: number;
  view: string;
  scale_region: string | null;
  orientation: "horizontal" | "vertical" | "oblique" | "unknown";
  measures: string | null;
  engine_status: "acceptable" | "hold" | "reject";
  primary_reason: string | null;
  engine_value: number;
  engine_span: [[number, number], [number, number]] | null;
  engine_ends: { kind: string; labels?: string[] }[] | null;
  /** engine terminator kinds at the span's start and end (null when no pair) */
  engine_marks?: [string, string] | null;
  developer_verdict: string | null;
}

// ── scoring reviews against engine records ──────────────────────────────────
export const ENDPOINT_REVIEW_TOL_PT = 2.0;
const near = (p: readonly number[], q: readonly number[], tol: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
export function samePair(a: readonly (readonly number[])[] | null, b: readonly (readonly number[])[] | null, tol = ENDPOINT_REVIEW_TOL_PT): boolean {
  if (!a || !b) return false;
  return (near(a[0], b[0], tol) && near(a[1], b[1], tol)) || (near(a[0], b[1], tol) && near(a[1], b[0], tol));
}

export type ItemVerdict =
  | "engine-confirmed"          // reviewer: real, unambiguous, sufficient, and value, endpoints, element all match the engine
  | "engine-disputed"           // reviewer: real and determinable, but differs from the engine
  | "reviewer-ambiguous"        // reviewer: the drawing is ambiguous here
  | "insufficient-evidence"     // reviewer: cannot be determined from the drawing
  | "not-a-dimension";

/** The engine's measured element, in the reviewer's vocabulary. */
function engineKind(k: AnswerKeyEntry): string | null {
  return k.measures ?? null;
}
export function verdict(r: ReviewResponse, k: AnswerKeyEntry): { verdict: ItemVerdict; mismatches: string[] } {
  if (r.is_dimension === "no") return { verdict: "not-a-dimension", mismatches: [] };
  if (r.evidence_sufficient === "no" || r.is_dimension === "unsure") return { verdict: "insufficient-evidence", mismatches: [] };
  if (r.ambiguous === "yes") return { verdict: "reviewer-ambiguous", mismatches: [] };
  const m: string[] = [];
  if (r.printed_value !== k.engine_value) m.push("value");
  if (!samePair(r.endpoints, k.engine_span)) m.push("endpoints");
  const ek = engineKind(k);
  if (!r.measured_element || !ek || elementKind(r.measured_element) !== ek) m.push("element");
  else if (k.engine_ends) {
    // grid labels named by the reviewer must match the engine's labels on grid ends
    const grids = k.engine_ends.filter((e) => e.kind === "grid").flatMap((e) => e.labels ?? []);
    if (namedGrids(r.measured_element).some((g) => !grids.includes(g))) m.push("grid label");
  }
  return { verdict: m.length ? "engine-disputed" : "engine-confirmed", mismatches: m };
}

/** Do the reviewer's two end marks match the engine's (order-free, in reviewer vocabulary)?
 *  null when either side did not record both marks. Reported as its own stage; it does not change the verdict. */
export function marksAgree(r: ReviewResponse, k: AnswerKeyEntry): boolean | null {
  if (!r.end1_mark || !r.end2_mark || !k.engine_marks) return null;
  const e = k.engine_marks.map((m) => ENGINE_MARK[m] ?? "cannot-tell").sort().join("|");
  return [r.end1_mark, r.end2_mark].sort().join("|") === e;
}

/** What a reviewed item says about the engine's decision. */
export type DecisionOutcome =
  | "accepted-confirmed" | "accepted-error" | "accepted-unconfirmable"
  | "held-unnecessarily" | "held-recoverable-engine-evidence-wrong" | "held-correctly"
  | "rejected-correctly" | "rejected-recoverable";
export function decisionOutcome(v: ItemVerdict, k: AnswerKeyEntry): DecisionOutcome {
  const determinable = v === "engine-confirmed" || v === "engine-disputed";
  if (k.engine_status === "acceptable") return v === "engine-confirmed" ? "accepted-confirmed" : determinable || v === "not-a-dimension" ? "accepted-error" : "accepted-unconfirmable";
  if (k.engine_status === "hold") return v === "engine-confirmed" ? "held-unnecessarily" : v === "engine-disputed" ? "held-recoverable-engine-evidence-wrong" : "held-correctly";
  return determinable ? "rejected-recoverable" : "rejected-correctly";
}

// ── agreement and adjudication ──────────────────────────────────────────────
export type ReviewState = "single-review" | "agreed" | "needs-adjudication" | "adjudicated";
/** Fields on which two reviewers must agree. */
export function disagreements(a: ReviewResponse, b: ReviewResponse): string[] {
  const d: string[] = [];
  if (a.is_dimension !== b.is_dimension) d.push("is_dimension");
  if (a.printed_value !== b.printed_value) d.push("printed_value");
  if (a.ambiguous !== b.ambiguous) d.push("ambiguous");
  if (a.evidence_sufficient !== b.evidence_sufficient) d.push("evidence_sufficient");
  if (elementKind(a.measured_element) !== elementKind(b.measured_element)) d.push("element_kind");
  if ((a.endpoints || b.endpoints) && !samePair(a.endpoints, b.endpoints)) d.push("endpoints");
  return d;
}

/** Cohen's kappa for two raters' categorical labels on the same items. */
export function cohensKappa(pairs: [string, string][]): number | null {
  if (!pairs.length) return null;
  const cats = [...new Set(pairs.flat())];
  const n = pairs.length;
  const po = pairs.filter(([x, y]) => x === y).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([x]) => x === c).length / n) * (pairs.filter(([, y]) => y === c).length / n), 0);
  return pe === 1 ? (po === 1 ? 1 : null) : (po - pe) / (1 - pe);
}

export interface ItemResolution {
  item_id: string;
  state: ReviewState;
  reviewers: string[];
  disagreements: string[];
  /** The response that stands: the single review, the agreed first review, or the adjudication. null while unresolved. */
  final: ReviewResponse | null;
}
export function resolveItems(responses: ReviewResponse[], adjudications: Adjudication[] = []): ItemResolution[] {
  const by = new Map<string, ReviewResponse[]>();
  for (const r of responses) by.set(r.item_id, [...(by.get(r.item_id) ?? []), r]);
  const out: ItemResolution[] = [];
  for (const [id, rs] of [...by].sort(([a], [b]) => a.localeCompare(b))) {
    const reviewers = [...new Set(rs.map((r) => r.reviewer_id))];
    if (reviewers.length !== rs.length) throw new Error(`${id}: a reviewer answered more than once`);
    const adj = adjudications.find((a) => a.item_id === id);
    if (rs.length === 1) { out.push({ item_id: id, state: "single-review", reviewers, disagreements: [], final: rs[0] }); continue; }
    const d = [...new Set(rs.slice(1).flatMap((r) => disagreements(rs[0], r)))];
    if (!d.length) out.push({ item_id: id, state: "agreed", reviewers, disagreements: [], final: rs[0] });
    else if (adj) {
      if (adj.reviewer_id && reviewers.includes(adj.reviewer_id)) throw new Error(`${id}: the adjudicator must not be one of the item's reviewers`);
      out.push({ item_id: id, state: "adjudicated", reviewers, disagreements: d, final: adj });
    } else out.push({ item_id: id, state: "needs-adjudication", reviewers, disagreements: d, final: null });
  }
  return out;
}
