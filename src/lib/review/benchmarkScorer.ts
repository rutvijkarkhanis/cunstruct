// BENCHMARK SCORER — deterministic, pure. Scores a simulated or real analysis
// run against one Srikakulam benchmark case (srikakulamBenchmark.ts).
//
// Identity correctness is measured by running the case's items through the
// REAL, production buildReviewItems() from reviewQueue.ts — not a
// reimplementation — so this benchmark exercises the actual duplicate-
// detection code path, including whatever it does today (Fix A's key+location
// scoping).
//
// A gap-classified case (case.gap set) is never folded into the pass/fail
// averages for the dimension its gap concerns — see BenchmarkCase.gap in
// srikakulamBenchmark.ts. An ungraded case (graded:false) is excluded from
// every average entirely and only reported by id.

import type { AnalysisItemV1 } from "./analysisSchemaV1";
import { buildReviewItems } from "./reviewQueue";
import type { BenchmarkCase, CaseGap, ExpectedItem } from "./srikakulamBenchmark";

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

/** Match each expected item to at most one actual item: prefer an exact
 *  key+location match; fall back to key+item-text when location is missing or
 *  wrong on the actual side (this fallback is deliberate — a mismatched
 *  location is exactly the extraction failure this benchmark exists to catch,
 *  not a reason to also fail scope recall for the same root cause twice). */
function matchItems(expected: ExpectedItem[], actual: AnalysisItemV1[]) {
  const usedActual = new Set<number>();
  const matchOf = new Map<string, AnalysisItemV1>(); // expected.id -> actual item
  const indexOf = new Map<string, number>();          // expected.id -> actual index

  for (const e of expected) {
    let idx = actual.findIndex(
      (a, i) => !usedActual.has(i) && norm(a.key) === norm(e.key) && norm(a.location) === norm(e.location),
    );
    if (idx === -1) {
      idx = actual.findIndex(
        (a, i) => !usedActual.has(i) && norm(a.key) === norm(e.key) && norm(a.item) === norm(e.item),
      );
    }
    if (idx !== -1) {
      usedActual.add(idx);
      matchOf.set(e.id, actual[idx]);
      indexOf.set(e.id, idx);
    }
  }
  const falsePositives = actual.filter((_, i) => !usedActual.has(i));
  return { matchOf, indexOf, falsePositives };
}

/** Fraction of `matched`/`total` matches expressed as 0..1, or null when
 *  there was nothing to check (never reported as a misleading 0 or 100). */
function ratio(matched: number, total: number): number | null {
  return total === 0 ? null : matched / total;
}

export interface IdentityFailure {
  a: string;
  b: string;
  expected: boolean;
  actual: boolean;
}

export interface CaseResult {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  graded: boolean;
  gap?: CaseGap;
  scopeRecall: number | null;
  quantityAccuracy: number | null;
  dimensionAccuracy: number | null;
  specificationAccuracy: number | null;
  falsePositiveCount: number;
  unmatchedExpectedIds: string[];
  identityCorrectness: number | null;
  identityFailures: IdentityFailure[];
}

/** Score one case's simulated/real analysis output. Pure; no I/O. */
export function scoreCase(c: BenchmarkCase, actual: AnalysisItemV1[]): CaseResult {
  const { matchOf, indexOf, falsePositives } = matchItems(c.expectedItems, actual);
  const unmatchedExpectedIds = c.expectedItems.filter((e) => !matchOf.has(e.id)).map((e) => e.id);

  let qtyOk = 0, qtyTotal = 0;
  let dimOk = 0, dimTotal = 0;
  let specOk = 0, specTotal = 0;
  for (const e of c.expectedItems) {
    const a = matchOf.get(e.id);
    if (e.quantity != null) {
      qtyTotal++;
      if (a && a.quantity === e.quantity) qtyOk++;
    }
    if (e.dimension) {
      dimTotal++;
      if (a && norm(a.dimension) === norm(e.dimension)) dimOk++;
    }
    if (e.specification) {
      specTotal++;
      if (a && norm(a.specification) === norm(e.specification)) specOk++;
    }
  }

  let identityCorrectness: number | null = null;
  const identityFailures: IdentityFailure[] = [];
  if (c.duplicateExpectations?.length) {
    const reviewItems = buildReviewItems(actual);
    let correct = 0;
    for (const d of c.duplicateExpectations) {
      const ia = indexOf.get(d.a);
      const ib = indexOf.get(d.b);
      if (ia == null || ib == null) continue; // can't judge an unmatched item's identity handling
      const aKey = actual[ia].key;
      const bKey = actual[ib].key;
      // Pairwise-linked when either later item's duplicateOf traces to the
      // earlier item's key. Assumes no third item in the case shares the same
      // scoped (key+location) identity as this pair — true for every case in
      // srikakulamBenchmark.ts today.
      const linked =
        (ib > ia && reviewItems[ib].duplicateOf === aKey) ||
        (ia > ib && reviewItems[ia].duplicateOf === bKey);
      const isCorrect = linked === d.shouldBeDuplicate;
      if (isCorrect) correct++;
      else identityFailures.push({ a: d.a, b: d.b, expected: d.shouldBeDuplicate, actual: linked });
    }
    identityCorrectness = ratio(correct, c.duplicateExpectations.length);
  }

  return {
    id: c.id,
    tier: c.tier,
    title: c.title,
    graded: c.graded,
    gap: c.gap,
    scopeRecall: ratio(c.expectedItems.length - unmatchedExpectedIds.length, c.expectedItems.length),
    quantityAccuracy: ratio(qtyOk, qtyTotal),
    dimensionAccuracy: ratio(dimOk, dimTotal),
    specificationAccuracy: ratio(specOk, specTotal),
    falsePositiveCount: falsePositives.length,
    unmatchedExpectedIds,
    identityCorrectness,
    identityFailures,
  };
}

export interface BenchmarkReport {
  results: CaseResult[];
  /** Cases excluded from every average below — either a confirmed D_BENCHMARK_DATA_GAP
   *  (ground truth unconfirmed) or, per dimension, a case whose gap concerns that
   *  exact dimension (e.g. a C_CAPABILITY_GAP case is excluded from its own metric,
   *  but still counted for any dimension its gap doesn't concern). */
  ungradedCaseIds: string[];
  gapFlaggedCases: { id: string; gap: CaseGap }[];
  averages: {
    scopeRecall: number | null;
    quantityAccuracy: number | null;
    dimensionAccuracy: number | null;
    specificationAccuracy: number | null;
    identityCorrectness: number | null;
  };
  totalFalsePositives: number;
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

/** Score every case and roll up graded-only averages. `runs` supplies the
 *  actual AnalysisItemV1[] for each case id; a case with no entry scores as an
 *  empty run (100% false negatives, never silently skipped). */
export function scoreBenchmark(cases: BenchmarkCase[], runs: Record<string, AnalysisItemV1[]>): BenchmarkReport {
  const results = cases.map((c) => scoreCase(c, runs[c.id] ?? []));
  const gradedResults = results.filter((r) => r.graded);

  const collect = (sel: (r: CaseResult) => number | null) =>
    gradedResults.map(sel).filter((v): v is number => v != null);

  return {
    results,
    ungradedCaseIds: results.filter((r) => !r.graded).map((r) => r.id),
    gapFlaggedCases: results.filter((r) => r.gap).map((r) => ({ id: r.id, gap: r.gap as CaseGap })),
    averages: {
      scopeRecall: average(collect((r) => r.scopeRecall)),
      quantityAccuracy: average(collect((r) => r.quantityAccuracy)),
      dimensionAccuracy: average(collect((r) => r.dimensionAccuracy)),
      specificationAccuracy: average(collect((r) => r.specificationAccuracy)),
      identityCorrectness: average(collect((r) => r.identityCorrectness)),
    },
    totalFalsePositives: gradedResults.reduce((s, r) => s + r.falsePositiveCount, 0),
  };
}
