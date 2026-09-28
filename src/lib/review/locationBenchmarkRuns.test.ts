// MULTI-RUN LOCATION BENCHMARK — proves scoreLocationBenchmark() correctly
// scores a REGISTRY of independently audited LOCATION runs, each against
// only its own actual output, never contaminating one run's result with
// another's expected facts or actual observations.
//
// The second "run" used below (SYNTHETIC_RUN) is deliberately NOT a real
// document's ground truth — it exists only to prove the multi-run MECHANISM
// (independence, aggregation, graded/gap plumbing) the same way the existing
// observationBenchmarkScorer.test.ts's "collapsedRun"/"oneObservationOnly"
// fixtures are synthetic proofs of the single-run matcher's mechanics, never
// a claim about a real drawing. No ground truth is fabricated for any real
// document here.
import { describe, it, expect } from "vitest";
import { scoreObservations, scoreLocationBenchmark } from "./observationBenchmarkScorer";
import {
  LOCATION_BENCHMARK_RUNS,
  SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928,
  SRIKAKULAM_SECOND_FLOOR_LOCATION_RUN,
  type ExpectedObservation,
  type LocationBenchmarkRun,
} from "./srikakulamObservationBenchmark";
import type { ObservationV1 } from "./observationSchemaV1";

const SRIKAKULAM_RUN = LOCATION_BENCHMARK_RUNS.find((r) => r.id === "srikakulam-apartment-20260928")!;
const SECOND_FLOOR_RUN = LOCATION_BENCHMARK_RUNS.find((r) => r.id === "srikakulam-second-floor")!;

/** The real, audited 2026-09-28 production output — identical to the fixture
 *  already used in observationBenchmarkScorer.test.ts's dedicated describe
 *  block, reused here (not redefined differently) to prove this run's score
 *  is IDENTICAL whether scored alone or through the multi-run registry. */
const SRIKAKULAM_ACTUAL_RUN: ObservationV1[] = [
  { observationType: "room_or_space", mark: "Living", scopeHint: "Ground Floor", attributes: { dimension: "24'2\"x21'4\"" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
  { observationType: "room_or_space", mark: "Dining", scopeHint: "Ground Floor", attributes: { dimension: "29'10\"x15'8\"" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
  { observationType: "equipment", mark: "Lift", scopeHint: "Ground Floor", attributes: { dimension: "7'x6'6\"" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
  { observationType: "opening", mark: "Main Entrance", scopeHint: "Stilt Floor", attributes: { dimension: "15'2\" wide" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "fixture", mark: "Maid Room-1", scopeHint: "Stilt Floor", attributes: { dimension: "5'6\"x6'3\"" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "other_construction_fact", mark: "Security Gate", scopeHint: "Stilt Floor", attributes: { dimension: "10' wide" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "dimension_annotation", mark: "Main Entrance", scopeHint: "Ground Floor", attributes: { dimension: "6'6\" wide" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
  { observationType: "structural_element", mark: "Car Parking", scopeHint: "Stilt Floor", attributes: { dimension: "19'4\"x37'" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "room_or_space", mark: "Gym", scopeHint: "Ground Floor", attributes: { dimension: "15'3\"x12'8\"" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
];

/** The real, audited Second Floor production output — exactly the 8
 *  observations the real run persisted (field-for-field, including the
 *  actual "Wood" material misreport on D1 — this is the ACTUAL output, not
 *  the corrected expectation). The 11 manually verified coverage misses
 *  (Pooja, Lift, Utility, Wet Kitchen, Storage, Children Bedroom-1/2, Great
 *  Room, W.I.C, W.R, Dress) are deliberately NOT represented here — they were
 *  never extracted, so there is no actual observation for them at all. */
const SECOND_FLOOR_ACTUAL_RUN: ObservationV1[] = [
  { observationType: "room_or_space", mark: "Dining", scopeHint: "Second Floor", attributes: { dimension: "17'8\"x15'4\"" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "room_or_space", mark: "Master Bedroom", scopeHint: "Second Floor", attributes: { dimension: "16'6\"x13'3\"" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Second Floor", attributes: { dimension: "22'2\"x11'" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "room_or_space", mark: "Guest Bedroom", scopeHint: "Second Floor", attributes: { dimension: "18'6\"x14'" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "room_or_space", mark: "Media Room", scopeHint: "Second Floor", attributes: { dimension: "15'7\"x10'6\"" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "room_or_space", mark: "Living", scopeHint: "Second Floor", attributes: { dimension: "17'8\"x15'6\"" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
  { observationType: "opening", mark: "W1", scopeHint: "Second Floor", attributes: { dimension: "5'x5'3\"", specification: "UPVC" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
  // The ACTUAL misreport: material "Wood" — the confirmed gap this run exists
  // to represent. Dimension is correctly reported.
  { observationType: "opening", mark: "D1", scopeHint: "Second Floor", attributes: { dimension: "3'6\"x7'9\"", material: "Wood" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
];

// A second, SYNTHETIC run — a different (fictional) document, one audited
// observation, deliberately with a not-yet-audited second entry so the
// aggregate-averages test below can prove ungraded entries don't leak
// across runs either.
const SYNTHETIC_EXPECTED: ExpectedObservation[] = [
  { id: "synthetic-kitchen-obs", observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground Floor", attributes: { dimension: "10'x12'" }, sourcePage: "p.3 (synthetic fixture, not a real document)" },
  {
    id: "synthetic-not-yet-audited-obs",
    observationType: "fixture",
    mark: "Water Heater",
    scopeHint: "Ground Floor",
    sourcePage: "p.3 (synthetic fixture, not a real document)",
    graded: false,
    gap: { category: "D_BENCHMARK_DATA_GAP", note: "Synthetic placeholder for a not-yet-audited fact — never scored." },
  },
];
const SYNTHETIC_RUN: LocationBenchmarkRun = {
  id: "synthetic-test-run",
  title: "Synthetic run (test fixture only, not a real document)",
  documentDescription: "Synthetic — exists only to prove multi-run independence, never a real drawing.",
  expectedObservations: SYNTHETIC_EXPECTED,
  distinctnessPairs: [],
};

describe("scoreLocationBenchmark — existing Srikakulam benchmark scores unchanged", () => {
  it("scoring the Srikakulam run through the registry produces IDENTICAL results to calling scoreObservations() directly", () => {
    const direct = scoreObservations(SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928, SRIKAKULAM_ACTUAL_RUN, SRIKAKULAM_RUN.distinctnessPairs);
    const report = scoreLocationBenchmark([SRIKAKULAM_RUN], { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN });
    const wrapped = report.results[0];

    expect(wrapped.scopeRecall).toBe(direct.scopeRecall);
    expect(wrapped.observationTypeAccuracy).toBe(direct.observationTypeAccuracy);
    expect(wrapped.attributeAccuracy).toBe(direct.attributeAccuracy);
    expect(wrapped.falsePositiveCount).toBe(direct.falsePositiveCount);
    expect(wrapped.unmatchedExpectedIds).toEqual(direct.unmatchedExpectedIds);
    expect(wrapped.distinctnessFailures).toEqual(direct.distinctnessFailures);
    expect(wrapped.ungradedIds).toEqual(direct.ungradedIds);
    expect(wrapped.gapFlaggedIds).toEqual(direct.gapFlaggedIds);
  });

  it("still shows full coverage (9/9), 8/9 classification accuracy, and the Maid Room-1 gap — the exact same numbers as the single-run test", () => {
    const report = scoreLocationBenchmark([SRIKAKULAM_RUN], { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN });
    const r = report.results[0];
    expect(r.scopeRecall).toBe(1);
    expect(r.observationTypeAccuracy).toBeCloseTo(8 / 9);
    expect(r.attributeAccuracy).toBe(1);
    expect(r.gapFlaggedIds.map((g) => g.id)).toEqual(["stilt-maid-room-1-obs"]);
  });
});

describe("scoreLocationBenchmark — each run is scored independently", () => {
  it("a perfect second run and an imperfect first run produce two independent, correct results — not averaged together at the per-run level", () => {
    const syntheticActual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground Floor", attributes: { dimension: "10'x12'" }, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const report = scoreLocationBenchmark(
      [SRIKAKULAM_RUN, SYNTHETIC_RUN],
      { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN, [SYNTHETIC_RUN.id]: syntheticActual },
    );
    const srikakulamResult = report.results.find((r) => r.runId === SRIKAKULAM_RUN.id)!;
    const syntheticResult = report.results.find((r) => r.runId === SYNTHETIC_RUN.id)!;

    // The Srikakulam run's known classification miss is untouched by the
    // synthetic run being perfect.
    expect(srikakulamResult.observationTypeAccuracy).toBeCloseTo(8 / 9);
    // The synthetic run's one graded entry is perfectly matched — untouched
    // by the Srikakulam run's own miss.
    expect(syntheticResult.scopeRecall).toBe(1);
    expect(syntheticResult.observationTypeAccuracy).toBe(1);
  });
});

describe("scoreLocationBenchmark — one run's expected facts can never become false negatives for another run", () => {
  it("the synthetic run's actual output being completely EMPTY does not affect the Srikakulam run's own (perfect) coverage", () => {
    const report = scoreLocationBenchmark(
      [SRIKAKULAM_RUN, SYNTHETIC_RUN],
      { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN, [SYNTHETIC_RUN.id]: [] },
    );
    const srikakulamResult = report.results.find((r) => r.runId === SRIKAKULAM_RUN.id)!;
    const syntheticResult = report.results.find((r) => r.runId === SYNTHETIC_RUN.id)!;

    // Srikakulam's own 9 facts are all still found — the synthetic run
    // producing nothing has zero effect on it.
    expect(srikakulamResult.scopeRecall).toBe(1);
    expect(srikakulamResult.unmatchedExpectedIds).toEqual([]);
    // The synthetic run's own graded fact is correctly reported as missing —
    // for ITSELF, never smeared into the Srikakulam run's result.
    expect(syntheticResult.unmatchedExpectedIds).toEqual(["synthetic-kitchen-obs"]);
    expect(syntheticResult.scopeRecall).toBe(0);
  });

  it("a run with NO entry at all in actualByRunId scores as an empty run for itself, never falls back to another run's actual output", () => {
    const report = scoreLocationBenchmark([SRIKAKULAM_RUN, SYNTHETIC_RUN], { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN });
    const syntheticResult = report.results.find((r) => r.runId === SYNTHETIC_RUN.id)!;
    expect(syntheticResult.unmatchedExpectedIds).toEqual(["synthetic-kitchen-obs"]);
    expect(syntheticResult.falsePositiveCount).toBe(0); // never "matched" against Srikakulam's actual observations
  });
});

describe("scoreLocationBenchmark — ungraded facts do not affect accuracy ratios, at the aggregate level too", () => {
  it("the synthetic run's not-yet-audited entry is excluded from its own ratios AND from the cross-run averages", () => {
    const syntheticActual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground Floor", attributes: { dimension: "10'x12'" }, evidenceCompleteness: "FULL", source: { evidence: [] } },
      // The model reports the not-yet-audited Water Heater fact too, but
      // with the WRONG observationType relative to what's on file
      // ("equipment" vs. the expected "fixture") — deliberately, so that if
      // the scorer ever stopped excluding ungraded entries from the ratio,
      // this test would catch it (the per-run accuracy would drop below 1).
      // It still gets CLAIMED (matching ignores `graded`), so it's never a
      // false positive either.
      { observationType: "equipment", mark: "Water Heater", scopeHint: "Ground Floor", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const report = scoreLocationBenchmark(
      [SRIKAKULAM_RUN, SYNTHETIC_RUN],
      { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN, [SYNTHETIC_RUN.id]: syntheticActual },
    );
    const syntheticResult = report.results.find((r) => r.runId === SYNTHETIC_RUN.id)!;

    // Perfect 1.0 despite the wrongly-typed Water Heater actual — it's
    // ungraded, so it never enters the ratio at all (were it included, this
    // would be 0.5, not 1).
    expect(syntheticResult.scopeRecall).toBe(1);
    expect(syntheticResult.observationTypeAccuracy).toBe(1);
    expect(syntheticResult.falsePositiveCount).toBe(0);
    expect(syntheticResult.ungradedIds).toEqual(["synthetic-not-yet-audited-obs"]);

    // Cross-run averages: a simple average of each run's OWN ratio — the
    // Srikakulam run's pre-existing 8/9 classification miss (unrelated to
    // this test) is still there, and the synthetic run contributes a clean
    // 1 (never dragged down by its excluded ungraded entry).
    expect(report.averages.scopeRecall).toBe(1);
    expect(report.averages.observationTypeAccuracy).toBeCloseTo((8 / 9 + 1) / 2);
  });
});

describe("scoreLocationBenchmark — confirmed gaps remain visible, per run", () => {
  it("gapFlaggedByRun attributes the Maid Room-1 gap to the Srikakulam run only — the synthetic run's own gap goes to its own entry", () => {
    const report = scoreLocationBenchmark(
      [SRIKAKULAM_RUN, SYNTHETIC_RUN],
      { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN, [SYNTHETIC_RUN.id]: [] },
    );
    const srikakulamGaps = report.gapFlaggedByRun.find((g) => g.runId === SRIKAKULAM_RUN.id)!;
    const syntheticGaps = report.gapFlaggedByRun.find((g) => g.runId === SYNTHETIC_RUN.id)!;

    expect(srikakulamGaps.gaps.map((g) => g.id)).toEqual(["stilt-maid-room-1-obs"]);
    expect(syntheticGaps.gaps.map((g) => g.id)).toEqual(["synthetic-not-yet-audited-obs"]);
  });

  it("ungradedByRun likewise never mixes runs", () => {
    const report = scoreLocationBenchmark(
      [SRIKAKULAM_RUN, SYNTHETIC_RUN],
      { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN, [SYNTHETIC_RUN.id]: [] },
    );
    const srikakulamUngraded = report.ungradedByRun.find((u) => u.runId === SRIKAKULAM_RUN.id)!;
    const syntheticUngraded = report.ungradedByRun.find((u) => u.runId === SYNTHETIC_RUN.id)!;
    expect(srikakulamUngraded.ids).toEqual([]); // nothing ungraded in the real run
    expect(syntheticUngraded.ids).toEqual(["synthetic-not-yet-audited-obs"]);
  });
});

// ── The SECOND real production run (Srikakulam Second Floor) — scored on its
// own, and together with the FIRST real run, to prove genuine cross-document
// independence with two real, manually audited data sets (not a synthetic
// stand-in). Total expected entries for this run: 8 extracted-and-audited +
// 11 manually verified coverage misses (8 with a confirmed dimension, 3
// identity-only) = 19. ───────────────────────────────────────────────────
describe("scoreLocationBenchmark — the real Second Floor production run scores independently", () => {
  const result = scoreObservations(SECOND_FLOOR_RUN.expectedObservations, SECOND_FLOOR_ACTUAL_RUN, SECOND_FLOOR_RUN.distinctnessPairs);

  it("coverage: 8 of 19 audited facts were extracted — the 11 manually verified misses reduce scopeRecall, never silently ignored", () => {
    expect(SECOND_FLOOR_RUN.expectedObservations).toHaveLength(19);
    expect(result.scopeRecall).toBeCloseTo(8 / 19);
    expect(result.unmatchedExpectedIds.sort()).toEqual(
      [
        "secondfloor-pooja-obs", "secondfloor-lift-obs", "secondfloor-utility-obs", "secondfloor-wet-kitchen-obs",
        "secondfloor-storage-obs", "secondfloor-children-bedroom-1-obs", "secondfloor-children-bedroom-2-obs",
        "secondfloor-great-room-obs", "secondfloor-wic-obs", "secondfloor-wr-obs", "secondfloor-dress-obs",
      ].sort(),
    );
  });

  it("no false positives — every persisted observation matches a manually audited fact", () => {
    expect(result.falsePositiveCount).toBe(0);
  });

  it("classification accuracy is a clean 1.0 for the 8 MATCHED facts — D1's confirmed issue is attribute-level, never a type-level failure", () => {
    // All 8 extracted observations (including D1 itself) were audited as
    // correctly CLASSIFIED — this run's only confirmed discrepancy is D1's
    // material, which must never depress observationTypeAccuracy.
    expect(result.observationTypeAccuracy).toBe(1);
  });

  it("D1's material gap is visible in attributeAccuracy without being counted as a coverage or classification failure", () => {
    // 18 attribute checks total (6 room dimensions + W1 dimension+spec + D1
    // dimension+material + 8 coverage-miss dimensions); only D1's material
    // fails (production said "Wood", audited value is "Granite/Marble") —
    // every other attribute check, including D1's own dimension, is correct.
    expect(result.attributeAccuracy).toBeCloseTo(9 / 18);
    expect(result.gapFlaggedIds).toEqual([{
      id: "secondfloor-d1-obs",
      gap: { category: "A_EXTRACTION_FAILURE", note: expect.stringContaining("material") },
    }]);
    // D1 itself IS matched (it was extracted) — its gap is an attribute
    // problem on a real, found observation, not a coverage miss.
    expect(result.unmatchedExpectedIds).not.toContain("secondfloor-d1-obs");
  });

  it("nothing in this run is marked not-yet-audited — every entry, extracted or missed, was manually verified", () => {
    expect(result.ungradedIds).toEqual([]);
  });
});

describe("scoreLocationBenchmark — both real runs together: no leakage between documents", () => {
  const report = scoreLocationBenchmark(
    [SRIKAKULAM_RUN, SECOND_FLOOR_RUN],
    { [SRIKAKULAM_RUN.id]: SRIKAKULAM_ACTUAL_RUN, [SECOND_FLOOR_RUN.id]: SECOND_FLOOR_ACTUAL_RUN },
  );
  const srikakulamResult = report.results.find((r) => r.runId === SRIKAKULAM_RUN.id)!;
  const secondFloorResult = report.results.find((r) => r.runId === SECOND_FLOOR_RUN.id)!;

  it("Srikakulam Rev A scores EXACTLY as before — unaffected by the Second Floor run's much lower coverage", () => {
    expect(srikakulamResult.scopeRecall).toBe(1);
    expect(srikakulamResult.observationTypeAccuracy).toBeCloseTo(8 / 9);
    expect(srikakulamResult.attributeAccuracy).toBe(1);
    expect(srikakulamResult.unmatchedExpectedIds).toEqual([]);
  });

  it("Second Floor scores its own (much lower) coverage — unaffected by Rev A being near-perfect", () => {
    expect(secondFloorResult.scopeRecall).toBeCloseTo(8 / 19);
    expect(secondFloorResult.unmatchedExpectedIds).toHaveLength(11);
  });

  it("no cross-document false positives — Second Floor's actual output never matches a Rev A expected id, or vice versa", () => {
    // Proven structurally: falsePositiveCount for each run counts only
    // ACTUAL observations passed for THAT run's own actualByRunId entry —
    // Second Floor's 8 real observations were never passed to Rev A's
    // scoreObservations call, and vice versa (see scoreLocationBenchmark's
    // own implementation). This assertion is the outward, black-box proof.
    expect(srikakulamResult.falsePositiveCount).toBe(0);
    expect(secondFloorResult.falsePositiveCount).toBe(0);
  });

  it("gaps and ungraded ids stay correctly attributed per run across two real documents", () => {
    const srikakulamGaps = report.gapFlaggedByRun.find((g) => g.runId === SRIKAKULAM_RUN.id)!;
    const secondFloorGaps = report.gapFlaggedByRun.find((g) => g.runId === SECOND_FLOOR_RUN.id)!;
    expect(srikakulamGaps.gaps.map((g) => g.id)).toEqual(["stilt-maid-room-1-obs"]);
    expect(secondFloorGaps.gaps.map((g) => g.id)).toEqual(["secondfloor-d1-obs"]);
  });

  it("the aggregate average blends both runs' own ratios — neither run's number is silently substituted for the other's", () => {
    expect(report.averages.scopeRecall).toBeCloseTo((1 + 8 / 19) / 2);
  });
});

// ── Page accuracy — `expectedPage` (backfilled from each entry's own
// `sourcePage` text, never independently re-derived) compared against the
// matched actual observation's `source?.page`. Both real fixtures' actual
// runs already carry the correct page per entry, so a perfect 1.0 here is
// not a new assertion about the drawings — it's proof the new metric reports
// what was already true. ────────────────────────────────────────────────────
describe("scoreObservations — page accuracy", () => {
  it("both real LOCATION runs report page accuracy 1.0", () => {
    const srikakulamResult = scoreObservations(SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928, SRIKAKULAM_ACTUAL_RUN, SRIKAKULAM_RUN.distinctnessPairs);
    const secondFloorResult = scoreObservations(SECOND_FLOOR_RUN.expectedObservations, SECOND_FLOOR_ACTUAL_RUN, SECOND_FLOOR_RUN.distinctnessPairs);
    expect(srikakulamResult.pageAccuracy).toBe(1);
    expect(secondFloorResult.pageAccuracy).toBe(1);
  });

  it("an intentionally incorrect page is detected and lowers page accuracy", () => {
    // Same actual run as the perfect case above, except Living's page is
    // deliberately wrong (2 -> 3) — every other entry's page is untouched.
    const actualWithWrongPage: ObservationV1[] = SRIKAKULAM_ACTUAL_RUN.map((o) =>
      o.mark === "Living" ? { ...o, source: { ...o.source, page: 3 } } : o,
    );
    const result = scoreObservations(SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928, actualWithWrongPage, SRIKAKULAM_RUN.distinctnessPairs);
    expect(result.pageAccuracy).toBeCloseTo(8 / 9);
  });

  it("an observation without expectedPage is excluded from the denominator", () => {
    const expected: ExpectedObservation[] = [
      { id: "with-page", observationType: "room_or_space", mark: "A", scopeHint: "Ground", sourcePage: "p.1", expectedPage: 1 },
      { id: "without-page", observationType: "room_or_space", mark: "B", scopeHint: "Ground", sourcePage: "unclear which page" },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "A", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
      // Deliberately a DIFFERENT page than "A" — if this entry were wrongly
      // included in the denominator (it has no expectedPage to compare
      // against), it could only ever count as neither right nor wrong; it
      // must not appear in the ratio at all.
      { observationType: "room_or_space", mark: "B", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { page: 9, evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    // Only "with-page" enters the ratio, and it's correct — a clean 1.0, not
    // diluted or contaminated by "without-page".
    expect(result.pageAccuracy).toBe(1);
  });

  it("an ungraded observation is excluded from page accuracy, even with a wrong matched page", () => {
    const expected: ExpectedObservation[] = [
      { id: "audited-with-page", observationType: "room_or_space", mark: "A", scopeHint: "Ground", sourcePage: "p.1", expectedPage: 1 },
      {
        id: "not-yet-audited-with-page",
        observationType: "fixture",
        mark: "B",
        scopeHint: "Ground",
        sourcePage: "p.1",
        expectedPage: 1,
        graded: false,
        gap: { category: "D_BENCHMARK_DATA_GAP", note: "not yet manually checked against the drawing" },
      },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "A", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
      // Wrong page for the ungraded entry — must not drag pageAccuracy down
      // from its otherwise-perfect 1.0, since ungraded entries never enter
      // any ratio.
      { observationType: "fixture", mark: "B", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { page: 5, evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    expect(result.pageAccuracy).toBe(1);
    expect(result.ungradedIds).toEqual(["not-yet-audited-with-page"]);
  });
});

// ── Duplicate-observation detection on the two REAL production runs —
// neither run's actual output has ever contained a repeated fact, so both
// honestly report zero. This proves the field is wired into the real-run
// path, not just the synthetic mechanism tests in
// observationBenchmarkScorer.test.ts. ───────────────────────────────────────
describe("scoreObservations — duplicate detection on the real runs", () => {
  it("real Rev A reports zero duplicate observations", () => {
    const result = scoreObservations(SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928, SRIKAKULAM_ACTUAL_RUN, SRIKAKULAM_RUN.distinctnessPairs);
    expect(result.duplicateActualIds).toEqual([]);
  });

  it("real Second Floor reports zero duplicate observations", () => {
    const result = scoreObservations(SECOND_FLOOR_RUN.expectedObservations, SECOND_FLOOR_ACTUAL_RUN, SECOND_FLOOR_RUN.distinctnessPairs);
    expect(result.duplicateActualIds).toEqual([]);
  });

  it("adding duplicate detection left every other real-run metric exactly as it was", () => {
    const result = scoreObservations(SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928, SRIKAKULAM_ACTUAL_RUN, SRIKAKULAM_RUN.distinctnessPairs);
    expect(result.scopeRecall).toBe(1);
    expect(result.observationTypeAccuracy).toBeCloseTo(8 / 9);
    expect(result.attributeAccuracy).toBe(1);
    expect(result.pageAccuracy).toBe(1);
    expect(result.falsePositiveCount).toBe(0);
    expect(result.distinctnessFailures).toEqual([]);
  });
});
