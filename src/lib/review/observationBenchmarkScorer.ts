// OBSERVATION BENCHMARK SCORER — deterministic, pure. Scores a simulated or
// real LOCATION-mode observation set against an audited ground truth
// (ExpectedObservation, benchmarkTypes.ts). Mirrors benchmarkScorer.ts's exact matching discipline (each
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
// reported room/context strings there instead
// ("Dining Room", "Building Lift") with floor recoverable only via `page`.
// The fallback never touches an expected entry or actual observation the
// primary pass already resolved, so it cannot change any run whose actual
// output already encodes floor in scopeHint (every entry in runs #1/#2
// matches via the primary pass alone — see locationBenchmarkRuns.test.ts's
// dedicated regression tests).

import type { ObservationV1 } from "./observationSchemaV1";
import type { ExpectedObservation, LocationBenchmarkRun } from "./benchmarkTypes";

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

/** Dimension text compared on content only: whitespace, the separator (x, X,
 *  ×) and typographic quote marks are ignored; numbers and their order are not.
 *  `14'2" X 12'4"` (as printed) equals `14'2"x12'4"`. */
export function normalizeDimension(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[’′‘]/g, "'").replace(/[”″“]/g, '"').replace(/×/g, "x").replace(/\s+/g, "");
}

/** Box centre as a fraction of its page, so boxes in different declared page
 *  spaces compare directly. */
function centre(bbox: [number, number, number, number], page: { width: number; height: number }): [number, number] {
  return [(bbox[0] + bbox[2]) / 2 / page.width, (bbox[1] + bbox[3]) / 2 / page.height];
}

function matchObservations(expected: ExpectedObservation[], actual: ObservationV1[]) {
  const usedActual = new Set<number>();
  const matchOf = new Map<string, ObservationV1>();
  const indexOf = new Map<string, number>();

  // Pass 0 — LOCATION: expected entries with a recorded label position
  // (`expectedBox`) are paired with same-mark observations boxed on the same
  // page, nearest first — so repeated labels (several W.R on one floor) pair
  // by where they are, not by array order. A no-op for fixtures without
  // expectedBox (runs #1/#2/#3 v1). Everything left falls through to pass 1.
  const located: { e: ExpectedObservation; i: number; d: number }[] = [];
  for (const e of expected) {
    if (!e.expectedBox || e.expectedPage === undefined) continue;
    const box0 = e.expectedBox;
    const ec = centre(box0.bbox, box0.pageSize);
    actual.forEach((a, i) => {
      if (norm(a.mark) !== norm(e.mark)) return;
      for (const box of a.source?.evidence ?? []) {
        if ((box.page ?? a.source?.page) !== e.expectedPage) continue;
        const ac = centre(box.bbox, a.source?.pageSize ?? box0.pageSize);
        located.push({ e, i, d: Math.hypot(ec[0] - ac[0], ec[1] - ac[1]) });
      }
    });
  }
  // An observation may only pair with the label it is nearest to: a second
  // copy reported at an already-claimed label is a duplicate, never credit
  // for a different, farther room of the same name.
  const nearestFor = new Map<number, { id: string; d: number }>();
  for (const { e, i, d } of located) {
    const cur = nearestFor.get(i);
    if (!cur || d < cur.d) nearestFor.set(i, { id: e.id, d });
  }
  located.sort((p, q) => p.d - q.d);
  for (const { e, i } of located) {
    if (nearestFor.get(i)!.id !== e.id || matchOf.has(e.id) || usedActual.has(i)) continue;
    usedActual.add(i);
    matchOf.set(e.id, actual[i]);
    indexOf.set(e.id, i);
  }
  // Observations placed by location are decided here: one left unpaired must
  // not be re-paired by array order below.
  const locationDecided = new Set(nearestFor.keys());

  // Pass 1 — PRIMARY identity: (mark, scopeHint). Exactly the original,
  // single-pass matcher — untouched.
  for (const e of expected) {
    if (matchOf.has(e.id)) continue;
    const idx = actual.findIndex(
      (a, i) => !usedActual.has(i) && !locationDecided.has(i) && norm(a.mark) === norm(e.mark) && norm(a.scopeHint) === norm(e.scopeHint),
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
      (a, i) => !usedActual.has(i) && !locationDecided.has(i) && norm(a.mark) === norm(e.mark) && a.source?.page === e.expectedPage,
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

/** True only when both observations have evidence boxes and none of one's
 *  boxes overlaps any of the other's on the same page. */
function atSeparateLocations(a: ObservationV1, b: ObservationV1): boolean {
  // Compare as fractions of the declared page space when both declare one;
  // when only one does, the two spaces can't be related, so nothing is proved.
  const sa = a.source?.pageSize, sb = b.source?.pageSize;
  if (!!sa !== !!sb) return false;
  const boxes = (o: ObservationV1) => {
    const s = o.source?.pageSize ?? { width: 1, height: 1 };
    return (o.source?.evidence ?? []).map((e) => ({
      page: e.page ?? o.source?.page,
      bbox: [e.bbox[0] / s.width, e.bbox[1] / s.height, e.bbox[2] / s.width, e.bbox[3] / s.height],
    }));
  };
  const ba = boxes(a), bb = boxes(b);
  if (ba.length === 0 || bb.length === 0) return false;
  return !ba.some((p) => bb.some((q) =>
    p.page === q.page &&
    p.bbox[0] < q.bbox[2] && q.bbox[0] < p.bbox[2] && p.bbox[1] < q.bbox[3] && q.bbox[1] < p.bbox[3]));
}

/** Finds duplicate observations WITHIN a single ACTUAL array — never
 *  compared against `expected`, never affecting matching or
 *  falsePositiveCount. Two or more actual observations that collide on
 *  `duplicateIdentityKey` mean the run reported the same real-world fact
 *  more than once — unless their evidence boxes show separate drawing
 *  locations (see atSeparateLocations); every one of them (not just the "extra" copies) is
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

  // Within an identity group, a pair is a duplicate unless their evidence
  // proves two separate drawing locations (a repeated label such as two W.R
  // rooms on one floor). No box on either side proves nothing.
  const duplicate = new Set<number>();
  for (const indices of indicesByKey.values()) {
    for (let x = 0; x < indices.length; x++) {
      for (let y = x + 1; y < indices.length; y++) {
        if (!atSeparateLocations(actual[indices[x]], actual[indices[y]])) {
          duplicate.add(indices[x]);
          duplicate.add(indices[y]);
        }
      }
    }
  }
  const duplicateIndices = [...duplicate];
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
  /** Which actual observation (by array index) each matched expected entry
   *  was paired with — for per-room reporting. */
  matchedPairs: { expectedId: string; actualIndex: number }[];
  /** Pairs from OBSERVATION_DISTINCTNESS_PAIRS that incorrectly matched the
   *  SAME actual observation index — should always be empty. */
  distinctnessFailures: { a: string; b: string }[];
  /** Ids of `expected` entries with `graded: false` (NOT YET AUDITED) —
   *  excluded from every ratio above, same convention as
   *  benchmarkScorer.ts's BenchmarkReport.ungradedCaseIds. Reported, never
   *  silently dropped. */
  ungradedIds: string[];
  /** Every `expected` entry that carries a `gap` (a known, already-classified
   *  discrepancy — see ExpectedObservation's audit-status fields in
   *  benchmarkTypes.ts), whether or not it's graded. */
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
      if (a && normalizeDimension(a.attributes.dimension) === normalizeDimension(e.attributes.dimension)) attrOk++;
    }
    if (e.attributes?.specification) {
      attrTotal++;
      if (a && norm(a.attributes.specification) === norm(e.attributes.specification)) attrOk++;
    }
    // Added for a run's D1 case: a confirmed
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
    matchedPairs: expected.filter((e) => indexOf.has(e.id)).map((e) => ({ expectedId: e.id, actualIndex: indexOf.get(e.id)! })),
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
