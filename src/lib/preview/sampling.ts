// Sampling sign-off (B7 logic, PREVIEW ONLY).
//
// Method (stated assumptions; not calibrated on real projects):
//
// Line pools — monetary-unit sampling (MUS) at 95% confidence, expecting zero
// errors. Pool book value BV = Σ line amounts (₹). Sample size
// n = ⌈BV × F0 / TE⌉ with F0 = 3.00 (Poisson upper limit for 0 errors at 95%),
// so the sampling interval J = BV / n ≤ TE / F0. Items are selected by
// systematic probability-proportional-to-size selection from a seeded random
// start in [0, J); any line with amount ≥ J is always selected ("top stratum").
// For each selected line the reviewer records the amount they find; the
// misstatement is |book − found| (both directions count). Evaluation:
//   UEL = J·F0 + Σ top-stratum misstatements
//           + Σᵢ tᵢ·J·(Fᵢ − Fᵢ₋₁)   over the other items' taintings tᵢ
//                                     (misstatement ÷ book), largest first,
// with Fᵢ the 95% Poisson upper-limit factors below. Within tolerance when
// UEL ≤ TE; otherwise the sample is widened (n doubled) or, when n reaches the
// pool size, the pool is reviewed in full. More than 10 non-top errors cannot
// be evaluated with this table: the result is "exceeded".
//
// Two line pools are sampled separately (accepted non-key lines; verified
// lines); TE is allocated between them in proportion to book value, and the
// overall UEL is the sum of the pool UELs (conservative).
//
// No-detection regions — attribute sampling: m = min(N, ⌈F0 / tolerable miss
// rate⌉) regions, zero misses accepted; any region found to contain unbilled
// work fails the pool (review every such region).
//
// Key items (amount ≥ materiality) are never sampled: they need 100% review.
// Pending-quantity and no-rate lines cannot be in a monetary pool; they are
// sign-off blockers, not sample items.
import { lineAmount, type EngineLine } from "./types";

/** 95% Poisson upper-limit factors for 0…10 errors. */
export const POISSON_95 = [3.0, 4.75, 6.3, 7.76, 9.16, 10.52, 11.85, 13.15, 14.44, 15.71, 16.97] as const;

/** Deterministic PRNG (mulberry32): the same seed always draws the same sample. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MusItem { id: string; book: number }

export interface MusPlan {
  pool: string;
  bookValue: number;
  tolerableError: number;
  n: number;
  interval: number;
  start: number;
  /** Selected ids, in selection order; top-stratum ids are flagged. */
  selected: { id: string; book: number; topStratum: boolean }[];
  /** True when every item is selected (the pool is reviewed in full). */
  fullReview: boolean;
}

/** Plan an MUS sample. `nOverride` widens an existing plan. */
export function planMus(pool: string, items: MusItem[], tolerableError: number, seed: number, nOverride?: number): MusPlan {
  if (!(tolerableError > 0)) throw new Error("tolerableError must be a positive ₹ amount");
  const priced = items.filter((i) => Number.isFinite(i.book) && i.book > 0);
  const bookValue = priced.reduce((s, i) => s + i.book, 0);
  if (priced.length === 0) return { pool, bookValue: 0, tolerableError, n: 0, interval: 0, start: 0, selected: [], fullReview: true };
  const nNeeded = Math.max(1, Math.ceil((bookValue * POISSON_95[0]) / tolerableError));
  const n = Math.min(nOverride ?? nNeeded, Number.MAX_SAFE_INTEGER);
  const interval = bookValue / n;
  const start = seededRandom(seed)() * interval;
  const selected: MusPlan["selected"] = [];
  let cum = 0;
  let next = start;
  for (const it of priced) {
    const lo = cum;
    cum += it.book;
    if (it.book >= interval) { selected.push({ id: it.id, book: it.book, topStratum: true }); while (next < cum) next += interval; continue; }
    if (next >= lo && next < cum) { selected.push({ id: it.id, book: it.book, topStratum: false }); while (next < cum) next += interval; }
  }
  return { pool, bookValue, tolerableError, n, interval, start, selected, fullReview: selected.length >= priced.length };
}

export type MusFinding = { id: string; found: number };

export interface MusEvaluation {
  pool: string;
  /** False until every selected item has a finding. */
  complete: boolean;
  awaiting: string[];
  errors: number;
  /** Projected misstatement (taintings × J, plus top-stratum actuals). */
  projected: number;
  /** Upper error limit at 95%, or null when it cannot be evaluated (incomplete, or > 10 errors). */
  uel: number | null;
  withinTolerance: boolean | null;
  /** "widen" when UEL > TE and the pool is not yet fully reviewed. */
  recommendation: "none" | "widen" | "review_all";
}

export function evaluateMus(plan: MusPlan, findings: MusFinding[]): MusEvaluation {
  const byId = new Map(findings.map((f) => [f.id, f.found]));
  const awaiting = plan.selected.filter((s) => !byId.has(s.id)).map((s) => s.id);
  const base = { pool: plan.pool, awaiting };
  if (awaiting.length) return { ...base, complete: false, errors: 0, projected: 0, uel: null, withinTolerance: null, recommendation: "none" };
  let topErr = 0;
  const taints: number[] = [];
  for (const s of plan.selected) {
    const mis = Math.abs(s.book - byId.get(s.id)!);
    if (mis === 0) continue;
    if (s.topStratum || plan.fullReview) topErr += mis;
    else taints.push(Math.min(1, mis / s.book));
  }
  taints.sort((a, b) => b - a);
  const errors = taints.length + plan.selected.filter((s) => (s.topStratum || plan.fullReview) && Math.abs(s.book - byId.get(s.id)!) > 0).length;
  const projected = round(topErr + taints.reduce((s, t) => s + t * plan.interval, 0));
  if (plan.fullReview) {
    // Every item checked: no sampling risk; the misstatement is known exactly.
    const within = topErr <= plan.tolerableError;
    return { ...base, complete: true, errors, projected, uel: round(topErr), withinTolerance: within, recommendation: within ? "none" : "review_all" };
  }
  if (taints.length > POISSON_95.length - 1) return { ...base, complete: true, errors, projected, uel: null, withinTolerance: false, recommendation: "review_all" };
  let uel = plan.interval * POISSON_95[0] + topErr;
  taints.forEach((t, i) => { uel += t * plan.interval * (POISSON_95[i + 1] - POISSON_95[i]); });
  uel = round(uel);
  const within = uel <= plan.tolerableError;
  return { ...base, complete: true, errors, projected, uel, withinTolerance: within, recommendation: within ? "none" : "widen" };
}

/** Widen: double n (capped at the pool size, which means full review). */
export function widenMus(plan: MusPlan, items: MusItem[], seed: number): MusPlan {
  const count = items.filter((i) => i.book > 0).length;
  return planMus(plan.pool, items, plan.tolerableError, seed, Math.min(count, Math.max(plan.n * 2, plan.n + 1)));
}

export interface AttributePlan { pool: string; population: number; m: number; selected: string[]; tolerableRate: number }

/** Attribute sample of region ids (zero misses expected). */
export function planAttribute(pool: string, ids: string[], tolerableRate: number, seed: number): AttributePlan {
  if (!(tolerableRate > 0 && tolerableRate < 1)) throw new Error("tolerableRate must be between 0 and 1");
  const m = Math.min(ids.length, Math.ceil(POISSON_95[0] / tolerableRate));
  const rnd = seededRandom(seed);
  const shuffled = [...ids].sort();
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  return { pool, population: ids.length, m, selected: shuffled.slice(0, m), tolerableRate };
}

export function evaluateAttribute(plan: AttributePlan, missesFound: Record<string, boolean>): { complete: boolean; misses: number; passed: boolean | null } {
  const done = plan.selected.every((id) => id in missesFound);
  const misses = plan.selected.filter((id) => missesFound[id]).length;
  return { complete: done, misses, passed: done ? misses === 0 : null };
}

// ── Pools and the sign-off record ───────────────────────────────────────────

export interface SamplingPools { acceptedNonKey: MusItem[]; verified: MusItem[]; keyIds: string[]; blocked: { pending: string[]; noRate: string[] } }

/** Split lines into the sampling pools. Key items and unpriceable lines never enter a monetary pool. */
export function buildPools(lines: EngineLine[], materialityThreshold: number): SamplingPools {
  const pools: SamplingPools = { acceptedNonKey: [], verified: [], keyIds: [], blocked: { pending: [], noRate: [] } };
  for (const l of lines) {
    if (l.quantityState === "pending") { pools.blocked.pending.push(l.id); continue; }
    const amount = lineAmount(l);
    if (amount == null) { pools.blocked.noRate.push(l.id); continue; }
    if (amount >= materialityThreshold) { pools.keyIds.push(l.id); continue; }
    if (l.reviewState === "verified") pools.verified.push({ id: l.id, book: amount });
    else if (l.reviewState === "accepted" || l.reviewState === "corrected") pools.acceptedNonKey.push({ id: l.id, book: amount });
  }
  return pools;
}

/** Allocate TE between pools in proportion to book value. */
export function allocateTolerable(total: number, pools: MusItem[][]): number[] {
  const bv = pools.map((p) => p.reduce((s, i) => s + i.book, 0));
  const sum = bv.reduce((s, x) => s + x, 0);
  return bv.map((b) => (sum === 0 ? 0 : (total * b) / sum));
}

/** What a reviewer's check of a line depended on; a change resets the verification. */
export const verificationKey = (l: EngineLine, drawingRevision: string) =>
  JSON.stringify([l.quantity, l.quantityState, l.unit, l.rate, l.description, drawingRevision]);

export interface SignOffRecord {
  reviewer: string;
  at: string;
  drawingRevision: string;
  /** Line id → verificationKey at the time of the check. */
  checked: Record<string, string>;
}

export function recordSignOff(reviewer: string, at: string, drawingRevision: string, lines: EngineLine[]): SignOffRecord {
  if (!reviewer.trim()) throw new Error("A sign-off must name the reviewer");
  return { reviewer, at, drawingRevision, checked: Object.fromEntries(lines.map((l) => [l.id, verificationKey(l, drawingRevision)])) };
}

/** Lines whose inputs (or drawing revision) changed since the record: their verification resets. */
export function staleLines(record: SignOffRecord, lines: EngineLine[], drawingRevision: string): string[] {
  return lines.filter((l) => l.id in record.checked && record.checked[l.id] !== verificationKey(l, drawingRevision)).map((l) => l.id);
}

export interface SignOffInput {
  keyItemsUnverified: number;
  pendingQuantities: number;
  linesWithoutRate: number;
  coverageCleared: boolean;
  sampling: { evaluated: boolean; withinTolerance: boolean | null };
  /** The engineering preview never certifies (plan v1.2 §2A). */
  previewMode: boolean;
}

/** Every reason sign-off is not allowed. Empty only when all conditions hold. */
export function signOffBlockers(s: SignOffInput): string[] {
  const b: string[] = [];
  if (s.previewMode) b.push("Engineering preview: certification is never issued here");
  if (s.keyItemsUnverified > 0) b.push(`${s.keyItemsUnverified} key item(s) not yet verified (100% review required)`);
  if (s.pendingQuantities > 0) b.push(`${s.pendingQuantities} line(s) with a pending quantity`);
  if (s.linesWithoutRate > 0) b.push(`${s.linesWithoutRate} line(s) with no DSR match: market rate needed`);
  if (!s.coverageCleared) b.push("Coverage gaps not all resolved or excluded with a reason");
  if (!s.sampling.evaluated) b.push("Sample not yet fully checked");
  else if (s.sampling.withinTolerance === false) b.push("Sample upper error limit exceeds tolerable error: widen the sample");
  return b;
}

const round = (n: number) => Math.round(n);
