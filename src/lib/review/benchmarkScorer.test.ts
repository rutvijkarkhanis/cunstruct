import { describe, it, expect } from "vitest";
import { scoreCase, scoreBenchmark } from "./benchmarkScorer";
import { SRIKAKULAM_BENCHMARK, perfectRunFor } from "./srikakulamBenchmark";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

const caseById = (id: string) => {
  const c = SRIKAKULAM_BENCHMARK.find((c) => c.id === id);
  if (!c) throw new Error(`no such benchmark case: ${id}`);
  return c;
};

describe("scoreCase — a flawless extraction scores perfectly", () => {
  for (const c of SRIKAKULAM_BENCHMARK.filter((c) => c.graded)) {
    it(`${c.id}: scores 1.0 on every applicable dimension for a perfect run`, () => {
      const result = scoreCase(c, perfectRunFor(c));
      if (result.scopeRecall != null) expect(result.scopeRecall).toBe(1);
      if (result.quantityAccuracy != null) expect(result.quantityAccuracy).toBe(1);
      if (result.dimensionAccuracy != null) expect(result.dimensionAccuracy).toBe(1);
      if (result.specificationAccuracy != null) expect(result.specificationAccuracy).toBe(1);
      if (result.identityCorrectness != null) expect(result.identityCorrectness).toBe(1);
      expect(result.falsePositiveCount).toBe(0);
      expect(result.unmatchedExpectedIds).toEqual([]);
    });
  }
});

describe("scoreBenchmark — full report over a perfect run", () => {
  it("averages 1.0 on every dimension, excludes the ungraded case, and surfaces every known gap", () => {
    const runs: Record<string, AnalysisItemV1[]> = {};
    for (const c of SRIKAKULAM_BENCHMARK) runs[c.id] = perfectRunFor(c);
    const report = scoreBenchmark(SRIKAKULAM_BENCHMARK, runs);

    expect(report.ungradedCaseIds).toEqual(["typical-floor-schedule-digits"]);
    expect(report.gapFlaggedCases.map((g) => g.id).sort()).toEqual(
      ["slab-total-area", "typical-flat-total-area", "ground-floor-area-conflict", "typical-floor-schedule-digits"].sort(),
    );
    expect(report.averages.scopeRecall).toBe(1);
    expect(report.averages.quantityAccuracy).toBe(1);
    expect(report.averages.dimensionAccuracy).toBe(1);
    expect(report.averages.specificationAccuracy).toBe(1);
    expect(report.averages.identityCorrectness).toBe(1);
    expect(report.totalFalsePositives).toBe(0);
  });
});

describe("scoreCase — sensitivity: the scorer actually catches real failure modes", () => {
  it("scope recall drops when the AI drops an item entirely", () => {
    const c = caseById("stilt-w1");
    const result = scoreCase(c, []); // AI extracted nothing for this case
    expect(result.scopeRecall).toBe(0);
    expect(result.unmatchedExpectedIds).toEqual(["stilt-w1"]);
  });

  it("quantity accuracy drops on a miscounted item, independent of scope recall", () => {
    const c = caseById("ground-v1");
    const wrong: AnalysisItemV1[] = [
      { key: "V1", item: "Ventilator V1", location: "Ground", quantity: 4, confidence: 0.9, aiStatus: "MEASURED" },
    ];
    const result = scoreCase(c, wrong);
    expect(result.scopeRecall).toBe(1); // the item itself was found
    expect(result.quantityAccuracy).toBe(0); // but its count is wrong
  });

  it("flags a hallucinated extra item as a false positive without affecting scope recall", () => {
    const c = caseById("ground-v1");
    const withExtra = [...perfectRunFor(c), { key: "V2", item: "Ventilator V2", location: "Ground", quantity: 1, confidence: 0.5, aiStatus: "MEASURED" as const }];
    const result = scoreCase(c, withExtra);
    expect(result.scopeRecall).toBe(1);
    expect(result.falsePositiveCount).toBe(1);
  });

  it("parking-counts: collapsing two vehicle classes into one row is a real scope-recall failure", () => {
    const c = caseById("parking-counts");
    const collapsed: AnalysisItemV1[] = [
      { key: "PARKING-ALL", item: "Total parking", quantity: 18, confidence: 0.8, aiStatus: "MEASURED" },
    ];
    const result = scoreCase(c, collapsed);
    expect(result.scopeRecall).toBe(0); // neither expected id key-matches "PARKING-ALL"
  });
});

describe("scoreCase — identity correctness (Fix A) on the flagship cross-floor case", () => {
  const c = caseById("identity-w1-cross-floor");

  it("a perfect run (location correctly reported) keeps all three floors distinct and still catches the same-floor repeat", () => {
    const result = scoreCase(c, perfectRunFor(c));
    expect(result.identityCorrectness).toBe(1);
    expect(result.identityFailures).toEqual([]);
  });

  it("EXPOSES A REAL GAP: if the AI extraction drops location (not a Fix A regression — an upstream extraction failure), the false-duplicate bug resurfaces", () => {
    // Same scenario Fix A protects against, EXCEPT every item's location is
    // blank — i.e. the AI itself failed to report which floor each W1 is on.
    // Fix A's key+location scoping degrades to a bare-key comparison whenever
    // location is missing, so this is expected to fail identity correctness —
    // and it must be attributed to extraction (no location reported), not to
    // a defect in the review-queue scoping logic itself.
    const noLocation: AnalysisItemV1[] = perfectRunFor(c).map((i) => ({ ...i, location: undefined }));
    const result = scoreCase(c, noLocation);
    expect(result.identityCorrectness).toBeLessThan(1);
    // The three genuinely-distinct floors get wrongly linked once location is gone.
    const wronglyLinked = result.identityFailures.filter((f) => f.expected === false && f.actual === true);
    expect(wronglyLinked.length).toBeGreaterThan(0);
  });

  it("still catches a genuine same-floor, same-key repeat (positive control) even with the Fix A scoping active", () => {
    const result = scoreCase(c, perfectRunFor(c));
    const repeatFailure = result.identityFailures.find((f) => f.a === "ground-w1-id" && f.b === "ground-w1-repeat");
    expect(repeatFailure).toBeUndefined(); // no failure recorded means it was correctly linked
  });
});

describe("scoreCase — ground-floor-room-scope: repetition without collapsing near-duplicates", () => {
  it("four distinct Guest Bedrooms are not mistaken for duplicates of each other", () => {
    const c = caseById("ground-floor-room-scope");
    const result = scoreCase(c, perfectRunFor(c));
    expect(result.identityCorrectness).toBe(1);
  });

  it("EXPOSES A GAP: if the AI collapses the four Guest Bedrooms into one row, scope recall correctly shows only 1/4 found — a scope failure, not an identity one", () => {
    const c = caseById("ground-floor-room-scope");
    const collapsed = perfectRunFor(c).filter((i) => i.item !== "Guest Bedroom 2" && i.item !== "Guest Bedroom 3" && i.item !== "Guest Bedroom 4");
    const result = scoreCase(c, collapsed);
    expect(result.scopeRecall).toBeLessThan(1);
    expect(result.unmatchedExpectedIds).toEqual(["gb2", "gb3", "gb4"]);
  });
});

describe("the D_BENCHMARK_DATA_GAP case is reported but never scored", () => {
  it("typical-floor-schedule-digits has no expected items and is excluded from grading", () => {
    const c = caseById("typical-floor-schedule-digits");
    expect(c.graded).toBe(false);
    expect(c.expectedItems).toEqual([]);
    const result = scoreCase(c, []);
    expect(result.scopeRecall).toBeNull(); // nothing to grade, not a 0
  });
});
