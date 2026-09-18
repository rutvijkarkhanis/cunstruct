// OBSERVATION BENCHMARK SCORER — deterministic, pure. Scores a simulated or
// real LOCATION-mode observation set against srikakulamObservationBenchmark.ts's
// ground truth. Mirrors benchmarkScorer.ts's exact matching discipline (each
// actual observation matched to at most one expected one) rather than a new
// algorithm — the one-to-one match is itself the proof of cross-floor
// distinctness: two expected observations can never both claim the same
// actual one.

import type { ObservationV1 } from "./observationSchemaV1";
import type { ExpectedObservation } from "./srikakulamObservationBenchmark";

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

function matchObservations(expected: ExpectedObservation[], actual: ObservationV1[]) {
  const usedActual = new Set<number>();
  const matchOf = new Map<string, ObservationV1>();
  const indexOf = new Map<string, number>();

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
  const falsePositives = actual.filter((_, i) => !usedActual.has(i));
  return { matchOf, indexOf, falsePositives };
}

function ratio(matched: number, total: number): number | null {
  return total === 0 ? null : matched / total;
}

export interface ObservationCaseResult {
  scopeRecall: number | null;
  observationTypeAccuracy: number | null;
  attributeAccuracy: number | null;
  falsePositiveCount: number;
  unmatchedExpectedIds: string[];
  /** Pairs from OBSERVATION_DISTINCTNESS_PAIRS that incorrectly matched the
   *  SAME actual observation index — should always be empty. */
  distinctnessFailures: { a: string; b: string }[];
}

/** Score one set of expected observations against a real/simulated actual
 *  set, plus the distinctness pairs that must never collapse. Pure. */
export function scoreObservations(
  expected: ExpectedObservation[],
  actual: ObservationV1[],
  distinctnessPairs: { a: string; b: string }[],
): ObservationCaseResult {
  const { matchOf, indexOf, falsePositives } = matchObservations(expected, actual);
  const unmatchedExpectedIds = expected.filter((e) => !matchOf.has(e.id)).map((e) => e.id);

  let typeOk = 0;
  let attrOk = 0, attrTotal = 0;
  for (const e of expected) {
    const a = matchOf.get(e.id);
    if (a && a.observationType === e.observationType) typeOk++;
    if (e.attributes?.dimension) {
      attrTotal++;
      if (a && norm(a.attributes.dimension) === norm(e.attributes.dimension)) attrOk++;
    }
    if (e.attributes?.specification) {
      attrTotal++;
      if (a && norm(a.attributes.specification) === norm(e.attributes.specification)) attrOk++;
    }
  }

  const distinctnessFailures = distinctnessPairs.filter((p) => {
    const ia = indexOf.get(p.a);
    const ib = indexOf.get(p.b);
    return ia != null && ib != null && ia === ib;
  });

  return {
    scopeRecall: ratio(expected.length - unmatchedExpectedIds.length, expected.length),
    observationTypeAccuracy: ratio(typeOk, expected.length - unmatchedExpectedIds.length),
    attributeAccuracy: ratio(attrOk, attrTotal),
    falsePositiveCount: falsePositives.length,
    unmatchedExpectedIds,
    distinctnessFailures,
  };
}
