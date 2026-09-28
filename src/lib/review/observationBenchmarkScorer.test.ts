import { describe, it, expect } from "vitest";
import { scoreObservations } from "./observationBenchmarkScorer";
import { SRIKAKULAM_OBSERVATIONS, SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928, OBSERVATION_DISTINCTNESS_PAIRS } from "./srikakulamObservationBenchmark";
import type { ObservationV1 } from "./observationSchemaV1";

/** A "perfect" simulated LOCATION run — one observation per ground-truth
 *  entry, correctly typed/scoped/attributed. Not what a real AI run would
 *  necessarily produce; exists to prove the scorer reports a perfect score
 *  on a perfect run, exactly like benchmarkScorer's own perfectRunFor. */
const perfectRun: ObservationV1[] = SRIKAKULAM_OBSERVATIONS.map((e) => ({
  observationType: e.observationType,
  mark: e.mark,
  scopeHint: e.scopeHint,
  locationText: undefined,
  attributes: { dimension: e.attributes?.dimension, specification: e.attributes?.specification, material: e.attributes?.material },
  evidenceCompleteness: "FULL",
  source: { evidence: [] },
}));

describe("scoreObservations — a perfect run scores perfectly", () => {
  const result = scoreObservations(SRIKAKULAM_OBSERVATIONS, perfectRun, OBSERVATION_DISTINCTNESS_PAIRS);

  it("full scope recall", () => expect(result.scopeRecall).toBe(1));
  it("full observation_type accuracy", () => expect(result.observationTypeAccuracy).toBe(1));
  it("full attribute accuracy", () => expect(result.attributeAccuracy).toBe(1));
  it("no false positives", () => expect(result.falsePositiveCount).toBe(0));
  it("no distinctness failures", () => expect(result.distinctnessFailures).toEqual([]));
});

describe("scoreObservations — cross-floor collapse is caught, not silently passed", () => {
  it("Stilt and Ground W1 collapsed into one observation surfaces as unmatched + a distinctness failure", () => {
    // Only ONE actual observation for what should be TWO distinct floors —
    // simulates an AI run that (incorrectly) merged Stilt and Ground W1.
    const collapsedRun: ObservationV1[] = [
      { observationType: "schedule_entry", mark: "W1", scopeHint: "Stilt", attributes: { dimension: "4'x5'3\"", specification: "UPVC" }, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations(SRIKAKULAM_OBSERVATIONS, collapsedRun, OBSERVATION_DISTINCTNESS_PAIRS);
    expect(result.unmatchedExpectedIds).toContain("ground-w1-obs");
    expect(result.scopeRecall).toBeLessThan(1);
  });

  it("the same actual observation matched to two ground-truth ids is flagged as a distinctness failure", () => {
    // Deliberately construct an actual set that would let a naive (non
    // one-to-one) matcher double-match — proves scoreObservations' matching
    // discipline, not just the fixture above.
    const oneObservationOnly: ObservationV1[] = [
      { observationType: "schedule_entry", mark: "W1", scopeHint: "Stilt", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations(
      [SRIKAKULAM_OBSERVATIONS[0], { ...SRIKAKULAM_OBSERVATIONS[0], id: "stilt-w1-obs-dup" }],
      oneObservationOnly,
      [{ a: "stilt-w1-obs", b: "stilt-w1-obs-dup" }],
    );
    // A one-to-one matcher can only satisfy one of these two identical
    // expectations against a single actual observation — the other must be
    // unmatched, never both silently "matched" to the same index.
    expect(result.unmatchedExpectedIds).toHaveLength(1);
  });
});

// ── The real 2026-09-28 production run (after PR #126) — scored against the
// dedicated per-run fixture, never the full SRIKAKULAM_OBSERVATIONS (which
// would also expect unrelated W1/brickwork facts this run never covered and
// falsely count them as misses). This is the benchmark this run was actually
// built to capture: 9 real, manually audited observations, 8 correct and one
// (Maid Room-1) with a known, already-tracked classification error. ────────
describe("scoreObservations — the real 2026-09-28 apartment production run", () => {
  // The actual persisted output, reproduced field-for-field from the
  // production report — including the classification error PR #126 exposed
  // (Maid Room-1 as "fixture"), never corrected here: this is the ACTUAL run,
  // not what it should have produced.
  const actualRun: ObservationV1[] = [
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

  const distinctnessPairs = [{ a: "stilt-main-entrance-obs", b: "ground-main-entrance-dim-obs" }];
  const result = scoreObservations(SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928, actualRun, distinctnessPairs);

  it("all 9 audited observations are found — full coverage for this run's scope", () => {
    expect(result.scopeRecall).toBe(1);
    expect(result.unmatchedExpectedIds).toEqual([]);
  });

  it("no false positives — every actual observation matched a known, audited fact", () => {
    expect(result.falsePositiveCount).toBe(0);
  });

  it("observation_type accuracy is 8/9 — the one KNOWN, tracked Maid Room-1 classification error, not silently passed", () => {
    expect(result.observationTypeAccuracy).toBeCloseTo(8 / 9);
  });

  it("full attribute (dimension) accuracy — every persisted dimension matches the audited value", () => {
    expect(result.attributeAccuracy).toBe(1);
  });

  it("Main Entrance on Stilt and Ground are kept distinct — no cross-floor collapse", () => {
    expect(result.distinctnessFailures).toEqual([]);
  });

  it("the Maid Room-1 classification error is surfaced via gapFlaggedIds, not hidden", () => {
    expect(result.gapFlaggedIds.map((g) => g.id)).toEqual(["stilt-maid-room-1-obs"]);
    expect(result.gapFlaggedIds[0].gap.category).toBe("A_EXTRACTION_FAILURE");
  });

  it("nothing in this run's fixture is unaudited", () => {
    expect(result.ungradedIds).toEqual([]);
  });
});

// ── Audit-status plumbing (graded/gap) — proves the mechanism itself, not
// just this one document's data. ────────────────────────────────────────────
describe("scoreObservations — graded:false is excluded from every ratio, never silently counted", () => {
  it("an ungraded (not-yet-audited) entry that goes completely unmatched does not drag scopeRecall/observationTypeAccuracy down", () => {
    const expected = [
      { id: "audited-1", observationType: "room_or_space" as const, mark: "A", scopeHint: "Ground", sourcePage: "p.1" },
      { id: "not-yet-audited-1", observationType: "fixture" as const, mark: "B", scopeHint: "Ground", sourcePage: "p.1", graded: false, gap: { category: "D_BENCHMARK_DATA_GAP" as const, note: "not yet manually checked against the drawing" } },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "A", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    // Only the audited entry counts — a perfect 1.0, not penalized for the
    // not-yet-audited one being absent from `actual`.
    expect(result.scopeRecall).toBe(1);
    expect(result.observationTypeAccuracy).toBe(1);
    expect(result.ungradedIds).toEqual(["not-yet-audited-1"]);
  });

  it("an ungraded entry that DOES match a real observation still claims it (matching ignores `graded`) — it just isn't scored", () => {
    const expected = [
      { id: "not-yet-audited-1", observationType: "fixture" as const, mark: "B", scopeHint: "Ground", sourcePage: "p.1", graded: false },
    ];
    const actual: ObservationV1[] = [
      { observationType: "fixture", mark: "B", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    // Claimed, so not a false positive — but excluded from the ratios (both
    // are null/0-of-0 since it was the only expected entry and it's ungraded).
    expect(result.falsePositiveCount).toBe(0);
    expect(result.scopeRecall).toBeNull();
  });
});

// ── Duplicate-observation detection — a purely structural check on the
// ACTUAL array itself (never on `expected`): does this run report the same
// real-world fact more than once? Orthogonal to matching/falsePositiveCount,
// which stay exactly as they were before this field existed. ────────────────
describe("scoreObservations — duplicate detection (actual-array only)", () => {
  it("two actual observations with the same (type, mark, scopeHint) are flagged as duplicates", () => {
    const expected = [
      { id: "only-expected", observationType: "room_or_space" as const, mark: "Kitchen", scopeHint: "Ground", sourcePage: "p.1" },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    expect(result.duplicateActualIds).toEqual(["actual#0", "actual#1"]);
  });

  it("two observations differing only in attributes are still detected as duplicates — identity ignores dimension/specification/material", () => {
    const actual: ObservationV1[] = [
      { observationType: "opening", mark: "W1", scopeHint: "Second Floor", attributes: { dimension: "5'x5'3\"" }, evidenceCompleteness: "FULL", source: { evidence: [] } },
      { observationType: "opening", mark: "W1", scopeHint: "Second Floor", attributes: { dimension: "6'x6'", material: "Wood" }, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations([], actual, []);
    expect(result.duplicateActualIds).toEqual(["actual#0", "actual#1"]);
  });

  it("the same mark reused across DIFFERENT floors is never a duplicate — cross-floor identity reuse (e.g. W1) is legitimate", () => {
    const actual: ObservationV1[] = [
      { observationType: "opening", mark: "W1", scopeHint: "Stilt", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
      { observationType: "opening", mark: "W1", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations([], actual, []);
    expect(result.duplicateActualIds).toEqual([]);
  });

  it("two different marks on the same floor are never a duplicate", () => {
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
      { observationType: "room_or_space", mark: "Dining", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations([], actual, []);
    expect(result.duplicateActualIds).toEqual([]);
  });

  it("a duplicate that is also unmatched still surfaces as a false positive independently — duplicate detection never suppresses or substitutes for falsePositiveCount", () => {
    const expected = [
      { id: "only-one-expected", observationType: "room_or_space" as const, mark: "Kitchen", scopeHint: "Ground", sourcePage: "p.1" },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    // One of the two identical actuals claims the sole expected entry; the
    // other is an unmatched extra — an existing, unrelated false positive.
    expect(result.falsePositiveCount).toBe(1);
    // Both are still reported as duplicates of each other — being claimed by
    // an expected entry doesn't make a copy stop being a duplicate, and being
    // a duplicate doesn't add a second false positive either.
    expect(result.duplicateActualIds).toEqual(["actual#0", "actual#1"]);
  });

  it("duplicate ids are sorted by ascending original actual-array index, regardless of which identity group appears first", () => {
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Dining", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } }, // 0: unique
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } }, // 1: dup group A
      { observationType: "opening", mark: "W1", scopeHint: "Stilt", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } }, // 2: dup group B
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Ground", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } }, // 3: dup group A
      { observationType: "opening", mark: "W1", scopeHint: "Stilt", attributes: {}, evidenceCompleteness: "FULL", source: { evidence: [] } }, // 4: dup group B
    ];
    const result = scoreObservations([], actual, []);
    expect(result.duplicateActualIds).toEqual(["actual#1", "actual#2", "actual#3", "actual#4"]);
  });

  it("the existing perfect-run result (no duplicates in the fixture) reports an empty duplicateActualIds", () => {
    const result = scoreObservations(SRIKAKULAM_OBSERVATIONS, perfectRun, OBSERVATION_DISTINCTNESS_PAIRS);
    expect(result.duplicateActualIds).toEqual([]);
  });
});
