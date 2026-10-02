// OBSERVATION BENCHMARK SCORER — deterministic, pure. Scores a simulated or
// real LOCATION-mode observation set against srikakulamObservationBenchmark.ts's
// ground truth. Mirrors benchmarkScorer.ts's exact matching discipline (each
// actual observation matched to at most one expected one) rather than a new
// algorithm — the one-to-one match is itself the proof of cross-floor
// distinctness: two expected observations can never both claim the same
// actual one.
//
// Matching is two passes (see matchObservations()): a PRIMARY pass on
// (mark, scopeHint) — unchanged from the original single-pass matcher — and
// a SECONDARY, fallback-only pass on (mark, page) for whatever the primary
// pass left unmatched. The fallback exists because `scopeHint` is only
// USUALLY the floor: the LOCATION prompt never documents scope_hint's
// semantics in prose (only a single "Ground Floor" example), and a real run
// (the third Srikakulam run) reported room/context strings there instead
// ("Dining Room", "Building Lift") with floor recoverable only via `page`.
// The fallback never touches an expected entry or actual observation the
// primary pass already resolved, so it cannot change any run whose actual
// output already encodes floor in scopeHint (every entry in runs #1/#2
// matches via the primary pass alone — see locationBenchmarkRuns.test.ts's
// dedicated regression tests).

import type { ObservationV1 } from "./observationSchemaV1";
import type { ExpectedObservation, LocationBenchmarkRun } from "./srikakulamObservationBenchmark";

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

function matchObservations(expected: ExpectedObservation[], actual: ObservationV1[]) {
  const usedActual = new Set<number>();
  const matchOf = new Map<string, ObservationV1>();
  const indexOf = new Map<string, number>();

  // Pass 1 — PRIMARY identity: (mark, scopeHint). Exactly the original,
  // single-pass matcher — untouched.
  for (const e of expected) {
    const idx = actual.findIndex(
      (a, i) => !usedActual.has(i) && norm(a.mark) === norm(e.mark) && norm(a.scopeHint) === norm(e.scopeHint),
    );
    if (idx !== -1) {
      usedActual.add(idx);
      matchOf.set(e.id, actual[idx]);
      indexOf.set(e.id, idx);
    }
  }

  // Pass 2 — SECONDARY, page-based fallback. Only considers an expected
  // entry the primary pass left unmatched (and only if it declares
  // `expectedPage`), and only actuals the primary pass left unclaimed. Never
  // reconsiders anything pass 1 already decided, so a run whose actual
  // output already matches everything via (mark, scopeHint) — runs #1/#2 —
  // is structurally unreachable by this pass.
  for (const e of expected) {
    if (matchOf.has(e.id) || e.expectedPage === undefined) continue;
    const idx = actual.findIndex(
      (a, i) => !usedActual.has(i) && norm(a.mark) === norm(e.mark) && a.source?.page === e.expectedPage,
    );
    if (idx !== -1) {
      usedActual.add(idx);
      matchOf.set(e.id, actual[idx]);
      indexOf.set(e.id, idx);
    }
  }

  const falsePositives = actual.filter((_, i) => !usedActual.has(i));
  return { matchOf, indexOf, falsePositives };
}

function ratio(matched: number, total: number): number | null {
  return total === 0 ? null : matched / total;
}

/** A stable, human-readable id for one ACTUAL observation, derived only from
 *  its position in the `actual` array it was scored with — ObservationV1
 *  itself carries no id. Never reused across different `actual` arrays/runs;
 *  only meaningful alongside the same result it was computed for. */
function actualObservationId(index: number): string {
  return `actual#${index}`;
}

/** Identity key for duplicate detection: (observationType, mark, scopeHint),
 *  normalized the same way matchObservations() compares mark/scopeHint.
 *  Deliberately excludes attributes (dimension/specification/material) — two
 *  observations of the same real-world fact reported with different/missing
 *  attributes are still the SAME fact reported twice, not two facts. */
function duplicateIdentityKey(o: ObservationV1): string {
  return `${norm(o.observationType)}|${norm(o.mark)}|${norm(o.scopeHint)}`;
}

/** Finds duplicate observations WITHIN a single ACTUAL array — never
 *  compared against `expected`, never affecting matching or
 *  falsePositiveCount. Two or more actual observations that collide on
 *  `duplicateIdentityKey` mean the run reported the same real-world fact
 *  more than once; every one of them (not just the "extra" copies) is
 *  reported, since which copy is the "original" is arbitrary. Returns ids
 *  sorted by ascending original array index — deterministic, independent of
 *  Map iteration order. */
function findDuplicateActualIds(actual: ObservationV1[]): string[] {
  const indicesByKey = new Map<string, number[]>();
  actual.forEach((a, i) => {
    const key = duplicateIdentityKey(a);
    const indices = indicesByKey.get(key);
    if (indices) indices.push(i);
    else indicesByKey.set(key, [i]);
  });

  const duplicateIndices: number[] = [];
  for (const indices of indicesByKey.values()) {
    if (indices.length > 1) duplicateIndices.push(...indices);
  }
  duplicateIndices.sort((a, b) => a - b);
  return duplicateIndices.map(actualObservationId);
}

export interface ObservationCaseResult {
  scopeRecall: number | null;
  observationTypeAccuracy: number | null;
  attributeAccuracy: number | null;
  /** Fraction of graded, matched observations whose `expectedPage` equals
   *  the actual observation's `source?.page` — null when no graded, matched
   *  entry defines `expectedPage` (same "excluded from the denominator"
   *  convention as attributeAccuracy's per-field checks). */
  pageAccuracy: number | null;
  falsePositiveCount: number;
  /** Ids (see actualObservationId()) of every ACTUAL observation that shares
   *  its (observationType, mark, scopeHint) identity with at least one other
   *  actual observation in this same run — i.e. the run extracted the same
   *  real-world fact more than once. Computed purely from `actual`, never
   *  from `expected`, and never folded into falsePositiveCount: whether an
   *  observation is a duplicate and whether it was claimed by an expected
   *  entry are orthogonal questions. Empty for both real audited runs today
   *  — reported, never assumed. */
  duplicateActualIds: string[];
  unmatchedExpectedIds: string[];
  /** Pairs from OBSERVATION_DISTINCTNESS_PAIRS that incorrectly matched the
   *  SAME actual observation index — should always be empty. */
  distinctnessFailures: { a: string; b: string }[];
  /** Ids of `expected` entries with `graded: false` (NOT YET AUDITED) —
   *  excluded from every ratio above, same convention as
   *  benchmarkScorer.ts's BenchmarkReport.ungradedCaseIds. Reported, never
   *  silently dropped. */
  ungradedIds: string[];
  /** Every `expected` entry that carries a `gap` (a known, already-classified
   *  discrepancy — see srikakulamObservationBenchmark.ts's audit-status
   *  convention), whether or not it's graded. */
  gapFlaggedIds: { id: string; gap: NonNullable<ExpectedObservation["gap"]> }[];
}

/** Score one set of expected observations against a real/simulated actual
 *  set, plus the distinctness pairs that must never collapse. Pure.
 *
 * Matching runs over EVERY expected entry (graded or not) — an ungraded
 * entry that genuinely matches a real observation must still claim it,
 * exactly as benchmarkScorer.ts matches every expectedItem in a case
 * regardless of the case's own `graded` flag. Only the RATIOS below (never
 * the matching itself) exclude `graded: false` entries. */
export function scoreObservations(
  expected: ExpectedObservation[],
  actual: ObservationV1[],
  distinctnessPairs: { a: string; b: string }[],
): ObservationCaseResult {
  const { matchOf, indexOf, falsePositives } = matchObservations(expected, actual);
  const gradedExpected = expected.filter((e) => e.graded !== false);
  const unmatchedExpectedIds = gradedExpected.filter((e) => !matchOf.has(e.id)).map((e) => e.id);

  let typeOk = 0;
  let attrOk = 0, attrTotal = 0;
  let pageOk = 0, pageTotal = 0;
  for (const e of gradedExpected) {
    const a = matchOf.get(e.id);
    if (a && a.observationType === e.observationType) typeOk++;
    if (a && e.expectedPage !== undefined) {
      pageTotal++;
      if (a.source?.page === e.expectedPage) pageOk++;
    }
    if (e.attributes?.dimension) {
      attrTotal++;
      if (a && norm(a.attributes.dimension) === norm(e.attributes.dimension)) attrOk++;
    }
    if (e.attributes?.specification) {
      attrTotal++;
      if (a && norm(a.attributes.specification) === norm(e.attributes.specification)) attrOk++;
    }
    // Added for the Srikakulam Second Floor run's D1 case: a confirmed
    // material-only discrepancy (existence/type/scope/dimension all correct;
    // only the material attribute is wrong) had no way to surface in
    // attributeAccuracy before this, since `material` was never checked —
    // same pattern as dimension/specification above, not a new mechanism.
    if (e.attributes?.material) {
      attrTotal++;
      if (a && norm(a.attributes.material) === norm(e.attributes.material)) attrOk++;
    }
  }

  const distinctnessFailures = distinctnessPairs.filter((p) => {
    const ia = indexOf.get(p.a);
    const ib = indexOf.get(p.b);
    return ia != null && ib != null && ia === ib;
  });

  return {
    scopeRecall: ratio(gradedExpected.length - unmatchedExpectedIds.length, gradedExpected.length),
    observationTypeAccuracy: ratio(typeOk, gradedExpected.length - unmatchedExpectedIds.length),
    attributeAccuracy: ratio(attrOk, attrTotal),
    pageAccuracy: ratio(pageOk, pageTotal),
    falsePositiveCount: falsePositives.length,
    duplicateActualIds: findDuplicateActualIds(actual),
    unmatchedExpectedIds,
    distinctnessFailures,
    ungradedIds: expected.filter((e) => e.graded === false).map((e) => e.id),
    gapFlaggedIds: expected.filter((e): e is ExpectedObservation & { gap: NonNullable<ExpectedObservation["gap"]> } => !!e.gap)
      .map((e) => ({ id: e.id, gap: e.gap })),
  };
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

export interface LocationRunResult extends ObservationCaseResult {
  runId: string;
  title: string;
}

export interface LocationBenchmarkReport {
  results: LocationRunResult[];
  /** Each metric averaged across every run's own result — a run with no
   *  gradable entries for that metric (null) is excluded from that metric's
   *  average, same convention as ratio()/benchmarkScorer.ts's average(). */
  averages: {
    scopeRecall: number | null;
    observationTypeAccuracy: number | null;
    attributeAccuracy: number | null;
  };
  totalFalsePositives: number;
  /** Distinctness failures across every run, tagged with which run produced
   *  them — should always be empty. */
  distinctnessFailures: { runId: string; a: string; b: string }[];
  /** Not-yet-audited entries, per run — reported, never silently dropped. */
  ungradedByRun: { runId: string; ids: string[] }[];
  /** Confirmed discrepancies (gaps), per run — reported, never hidden. */
  gapFlaggedByRun: { runId: string; gaps: ObservationCaseResult["gapFlaggedIds"] }[];
}

/**
 * Scores a REGISTRY of independently audited LOCATION runs — each run's
 * `expectedObservations`/`distinctnessPairs` scored ONLY against that run's
 * own actual output (`actualByRunId[run.id]`), via the exact same
 * scoreObservations() a single run already uses. A run with no entry in
 * `actualByRunId` scores as an empty run (100% false negatives for its own
 * graded entries), never silently skipped — same convention as
 * benchmarkScorer.ts's scoreBenchmark().
 *
 * One run's expected facts can NEVER become a false negative for another
 * run: each call to scoreObservations() below only ever sees one run's own
 * `expectedObservations` array, never another run's.
 */
export function scoreLocationBenchmark(
  runs: LocationBenchmarkRun[],
  actualByRunId: Record<string, ObservationV1[]>,
): LocationBenchmarkReport {
  const results: LocationRunResult[] = runs.map((run) => ({
    runId: run.id,
    title: run.title,
    ...scoreObservations(run.expectedObservations, actualByRunId[run.id] ?? [], run.distinctnessPairs),
  }));

  const collect = (sel: (r: LocationRunResult) => number | null) =>
    results.map(sel).filter((v): v is number => v != null);

  return {
    results,
    averages: {
      scopeRecall: average(collect((r) => r.scopeRecall)),
      observationTypeAccuracy: average(collect((r) => r.observationTypeAccuracy)),
      attributeAccuracy: average(collect((r) => r.attributeAccuracy)),
    },
    totalFalsePositives: results.reduce((s, r) => s + r.falsePositiveCount, 0),
    distinctnessFailures: results.flatMap((r) => r.distinctnessFailures.map((f) => ({ runId: r.runId, ...f }))),
    ungradedByRun: results.map((r) => ({ runId: r.runId, ids: r.ungradedIds })),
    gapFlaggedByRun: results.map((r) => ({ runId: r.runId, gaps: r.gapFlaggedIds })),
  };
}
