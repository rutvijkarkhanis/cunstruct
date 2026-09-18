import { describe, it, expect } from "vitest";
import { scoreObservations } from "./observationBenchmarkScorer";
import { SRIKAKULAM_OBSERVATIONS, OBSERVATION_DISTINCTNESS_PAIRS } from "./srikakulamObservationBenchmark";
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
