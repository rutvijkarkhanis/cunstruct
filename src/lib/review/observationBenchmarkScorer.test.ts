import { describe, it, expect } from "vitest";
import { scoreObservations } from "./observationBenchmarkScorer";
import { SYNTHETIC_OBSERVATIONS, SYNTHETIC_DISTINCTNESS_PAIRS } from "./__fixtures__/syntheticBenchmark";
import { SYNTHETIC_APARTMENT_RUN } from "./__fixtures__/syntheticLocationRuns";

import type { ObservationV1 } from "./observationSchemaV1";
import type { ExpectedObservation } from "./benchmarkTypes";

// An invented reference whose labels carry positions: four First Floor W.R and
// three Second Floor W.I.C with mixed sizes, a Dress on each floor, a Kitchen
// and a Dining room. Used to prove location pairing; it describes no drawing.
const labelled = (id: string, mark: string, scopeHint: string, page: number, dimension: string, x: number, y: number): ExpectedObservation => ({
  id, observationType: "room_or_space", mark, scopeHint, attributes: { dimension }, sourcePage: `p.${page} (synthetic)`, expectedPage: page,
  expectedBox: { bbox: [x, y - 6, x + 30, y], pageSize: { width: 595, height: 842 } },
});
const LABELLED_REF: ExpectedObservation[] = [
  labelled("wr-1", "W.R", "First Floor", 1, "4'x40'", 100, 200),
  labelled("wr-2", "W.R", "First Floor", 1, "4'x40'", 250, 200),
  labelled("wr-3", "W.R", "First Floor", 1, "21'x40'9\"", 400, 200),
  labelled("wr-4", "W.R", "First Floor", 1, "38'x23'", 100, 400),
  labelled("wic-1", "W.I.C", "Second Floor", 2, "55'x23'", 100, 200),
  labelled("wic-2", "W.I.C", "Second Floor", 2, "4'x23'", 250, 200),
  labelled("wic-3", "W.I.C", "Second Floor", 2, "4'x23'", 400, 200),
  labelled("dress-1", "Dress", "First Floor", 1, "40'x23'", 400, 400),
  labelled("dress-2", "Dress", "Second Floor", 2, "40'x23'9\"", 400, 400),
  labelled("kitchen-2", "Kitchen", "Second Floor", 2, "36'x55'", 100, 600),
  labelled("dining-1", "Dining", "First Floor", 1, "34'1\"x53'11\"", 250, 600),
];

/** A "perfect" simulated LOCATION run — one observation per ground-truth
 *  entry, correctly typed/scoped/attributed. Not what a real AI run would
 *  necessarily produce; exists to prove the scorer reports a perfect score
 *  on a perfect run, exactly like benchmarkScorer's own perfectRunFor. */
const perfectRun: ObservationV1[] = SYNTHETIC_OBSERVATIONS.map((e) => ({
  observationType: e.observationType,
  mark: e.mark,
  scopeHint: e.scopeHint,
  locationText: undefined,
  attributes: { dimension: e.attributes?.dimension, specification: e.attributes?.specification, material: e.attributes?.material },
  evidenceCompleteness: "FULL",
  source: { evidence: [] },
}));

describe("scoreObservations — a perfect run scores perfectly", () => {
  const result = scoreObservations(SYNTHETIC_OBSERVATIONS, perfectRun, SYNTHETIC_DISTINCTNESS_PAIRS);

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
      { observationType: "schedule_entry", mark: "W1", scopeHint: "Stilt", attributes: { dimension: "4'x4'", specification: "Aluminium" }, evidenceCompleteness: "FULL", source: { evidence: [] } },
    ];
    const result = scoreObservations(SYNTHETIC_OBSERVATIONS, collapsedRun, SYNTHETIC_DISTINCTNESS_PAIRS);
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
      [SYNTHETIC_OBSERVATIONS[0], { ...SYNTHETIC_OBSERVATIONS[0], id: "stilt-w1-obs-dup" }],
      oneObservationOnly,
      [{ a: "stilt-w1-obs", b: "stilt-w1-obs-dup" }],
    );
    // A one-to-one matcher can only satisfy one of these two identical
    // expectations against a single actual observation — the other must be
    // unmatched, never both silently "matched" to the same index.
    expect(result.unmatchedExpectedIds).toHaveLength(1);
  });
});

// ── The page-based fallback (added for runs whose scope hints name rooms) —
// proves the mechanism itself: a SECONDARY (mark, page) match, tried only for
// whatever the PRIMARY (mark, scopeHint) pass left unmatched, never
// reconsidering anything the primary pass already resolved. ────────────────
describe("scoreObservations — page-based fallback matching", () => {
  it("a wrong page never prevents a PRIMARY (mark, scopeHint) match — the fallback is not why this succeeds", () => {
    const expected = [
      { id: "e1", observationType: "room_or_space" as const, mark: "Living", scopeHint: "Ground Floor", sourcePage: "p.2", expectedPage: 2 },
    ];
    // Correct mark + scopeHint, but a WRONG page — the primary pass must
    // still match on (mark, scopeHint) alone, exactly as before this change.
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Living", scopeHint: "Ground Floor", attributes: {}, evidenceCompleteness: "FULL", source: { page: 9, evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    expect(result.scopeRecall).toBe(1);
    expect(result.unmatchedExpectedIds).toEqual([]);
    // The wrong page is still visible — via pageAccuracy, not via a failure
    // to match. Matching and page-correctness stay separate questions.
    expect(result.pageAccuracy).toBe(0);
  });

  it("when scopeHint doesn't agree but mark and page do, the fallback finds the entry", () => {
    const expected = [
      { id: "e1", observationType: "room_or_space" as const, mark: "Dining", scopeHint: "First Floor", sourcePage: "p.1", expectedPage: 1 },
    ];
    // scopeHint here names a room/context ("Dining Room"), not the floor —
    // exactly that run shape. Primary pass fails; fallback must
    // still find it via (mark, page).
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Dining", scopeHint: "Dining Room", attributes: {}, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    expect(result.scopeRecall).toBe(1);
    expect(result.unmatchedExpectedIds).toEqual([]);
  });

  it("the fallback still requires the mark to agree — page alone is never enough", () => {
    const expected = [
      { id: "e1", observationType: "room_or_space" as const, mark: "Dining", scopeHint: "First Floor", sourcePage: "p.1", expectedPage: 1 },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Kitchen", attributes: {}, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    expect(result.unmatchedExpectedIds).toEqual(["e1"]);
    expect(result.falsePositiveCount).toBe(1);
  });

  it("an expected entry with no expectedPage is never matched via the fallback, even if mark coincidentally agrees", () => {
    const expected = [
      { id: "e1", observationType: "room_or_space" as const, mark: "Dining", scopeHint: "First Floor", sourcePage: "unclear which page" },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Dining", scopeHint: "Dining Room", attributes: {}, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    expect(result.unmatchedExpectedIds).toEqual(["e1"]);
    expect(result.falsePositiveCount).toBe(1);
  });

  it("the fallback never reconsiders an actual the primary pass already claimed for a DIFFERENT expected entry", () => {
    // Two expected entries share the same mark on different floors. The
    // primary pass correctly claims the sole actual for the First Floor
    // entry (matching scopeHint); the fallback must NOT then also hand that
    // same actual to the Second Floor entry just because its page happens to
    // coincidentally agree with a wrong expectation.
    const expected = [
      { id: "first-floor-dining", observationType: "room_or_space" as const, mark: "Dining", scopeHint: "First Floor", sourcePage: "p.1", expectedPage: 1 },
      { id: "second-floor-dining", observationType: "room_or_space" as const, mark: "Dining", scopeHint: "Second Floor", sourcePage: "p.1", expectedPage: 1 },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Dining", scopeHint: "First Floor", attributes: {}, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    // The primary pass claims the actual for first-floor-dining. Only one
    // actual exists, so second-floor-dining's fallback attempt finds nothing
    // left to claim — one-to-one discipline holds across both passes.
    expect(result.unmatchedExpectedIds).toEqual(["second-floor-dining"]);
    expect(result.falsePositiveCount).toBe(0);
  });

  it("when NEITHER scopeHint NOR (mark, page) agree, the entry correctly stays unmatched", () => {
    const expected = [
      { id: "e1", observationType: "room_or_space" as const, mark: "Dining", scopeHint: "First Floor", sourcePage: "p.1", expectedPage: 1 },
    ];
    const actual: ObservationV1[] = [
      { observationType: "room_or_space", mark: "Dining", scopeHint: "Dining Room", attributes: {}, evidenceCompleteness: "FULL", source: { page: 9, evidence: [] } },
    ];
    const result = scoreObservations(expected, actual, []);
    expect(result.unmatchedExpectedIds).toEqual(["e1"]);
    expect(result.falsePositiveCount).toBe(1);
  });
});

// ── Run A (synthetic apartment run) — scored against the
// dedicated per-run fixture, never the full SYNTHETIC_OBSERVATIONS (which
// would also expect unrelated W1/brickwork facts this run never covered and
// falsely count them as misses). This is the benchmark this run was actually
// built to capture: 9 observations, 8 correct and one
// (Maid Room-1) with a known, already-tracked classification error. ────────
describe("scoreObservations — run A, an apartment run with one known classification error", () => {
  // The actual persisted output, reproduced field-for-field from the
  // run — including its known classification error
  // (Maid Room-1 as "fixture"), never corrected here: this is the ACTUAL run,
  // not what it should have produced.
  const actualRun: ObservationV1[] = [
    { observationType: "room_or_space", mark: "Living", scopeHint: "Ground Floor", attributes: { dimension: "45'1\"x47'11\"" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
    { observationType: "room_or_space", mark: "Dining", scopeHint: "Ground Floor", attributes: { dimension: "24'5\"x51'7\"" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
    { observationType: "equipment", mark: "Lift", scopeHint: "Ground Floor", attributes: { dimension: "21'x4'9\"" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
    { observationType: "opening", mark: "Main Entrance", scopeHint: "Stilt Floor", attributes: { dimension: "51'1\" wide" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    { observationType: "fixture", mark: "Maid Room-1", scopeHint: "Stilt Floor", attributes: { dimension: "40'9\"x4'6\"" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    { observationType: "other_construction_fact", mark: "Security Gate", scopeHint: "Stilt Floor", attributes: { dimension: "19' wide" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    { observationType: "dimension_annotation", mark: "Main Entrance", scopeHint: "Ground Floor", attributes: { dimension: "4'9\" wide" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
    { observationType: "structural_element", mark: "Car Parking", scopeHint: "Stilt Floor", attributes: { dimension: "13'11\"x54'" }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    { observationType: "room_or_space", mark: "Gym", scopeHint: "Ground Floor", attributes: { dimension: "51'6\"x53'7\"" }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
  ];

  const distinctnessPairs = [{ a: "stilt-main-entrance-obs", b: "ground-main-entrance-dim-obs" }];
  const result = scoreObservations(SYNTHETIC_APARTMENT_RUN, actualRun, distinctnessPairs);

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
      { observationType: "opening", mark: "W1", scopeHint: "Second Floor", attributes: { dimension: "40'x40'6\"" }, evidenceCompleteness: "FULL", source: { evidence: [] } },
      { observationType: "opening", mark: "W1", scopeHint: "Second Floor", attributes: { dimension: "4'x4'", material: "Wood" }, evidenceCompleteness: "FULL", source: { evidence: [] } },
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
    const result = scoreObservations(SYNTHETIC_OBSERVATIONS, perfectRun, SYNTHETIC_DISTINCTNESS_PAIRS);
    expect(result.duplicateActualIds).toEqual([]);
  });
});

// Regression — repeated room labels. Plans often carry several W.R / W.I.C /
// DRESS labels per floor. Once scope_hint is the floor, two
// correctly reported W.R rooms share (type, mark, scopeHint); if their
// evidence boxes are in different places they are two spaces, not one fact
// reported twice. Only provably separate instances are exempt: overlapping
// boxes, or a copy with no box at all, still count as duplicates.
describe("scoreObservations — repeated labels at different drawing locations", () => {
  const expected = [
    { id: "only-expected", observationType: "room_or_space" as const, mark: "Dining", scopeHint: "First Floor", sourcePage: "p.1" },
  ];
  const wr = (evidence: { bbox: [number, number, number, number]; page?: number }[], page = 1): ObservationV1 => ({
    observationType: "room_or_space", mark: "W.R", scopeHint: "First Floor", attributes: {},
    evidenceCompleteness: evidence.length ? "FULL" : "LIMITED", source: { page, evidence },
  });

  it("two W.R labels with separate evidence boxes on the same page are not duplicates", () => {
    const actual = [wr([{ bbox: [100, 100, 140, 120] }]), wr([{ bbox: [400, 300, 440, 320] }])];
    expect(scoreObservations(expected, actual, []).duplicateActualIds).toEqual([]);
  });

  it("the same W.R reported on two different pages is not a duplicate", () => {
    const actual = [wr([{ bbox: [100, 100, 140, 120], page: 1 }]), wr([{ bbox: [100, 100, 140, 120], page: 2 }], 2)];
    expect(scoreObservations(expected, actual, []).duplicateActualIds).toEqual([]);
  });

  it("two W.R observations whose boxes overlap are still duplicates", () => {
    const actual = [wr([{ bbox: [100, 100, 140, 120] }]), wr([{ bbox: [110, 105, 150, 125] }])];
    expect(scoreObservations(expected, actual, []).duplicateActualIds).toEqual(["actual#0", "actual#1"]);
  });

  it("a copy with no evidence box can't be shown to be separate, so it is still a duplicate", () => {
    const actual = [wr([{ bbox: [100, 100, 140, 120] }]), wr([])];
    expect(scoreObservations(expected, actual, []).duplicateActualIds).toEqual(["actual#0", "actual#1"]);
  });

  it("with three W.R, only the overlapping pair is flagged; the separate one is not", () => {
    const actual = [wr([{ bbox: [100, 100, 140, 120] }]), wr([{ bbox: [400, 300, 440, 320] }]), wr([{ bbox: [105, 102, 145, 122] }])];
    expect(scoreObservations(expected, actual, []).duplicateActualIds).toEqual(["actual#0", "actual#2"]);
  });
});

describe("scoreObservations — repeated labels are paired by location, not array order", () => {
  const pick = (mark: string, floor: string) => LABELLED_REF.filter((e) => e.mark === mark && e.scopeHint === floor);
  // An actual observation reported exactly where an expected label is, carrying that room's own dimension.
  const at = (e: (typeof LABELLED_REF)[number], scale = 1): ObservationV1 => ({
    observationType: "room_or_space", mark: e.mark, scopeHint: e.scopeHint, attributes: { dimension: e.attributes!.dimension },
    evidenceCompleteness: "FULL",
    source: {
      page: e.expectedPage, evidence: [{ bbox: e.expectedBox!.bbox.map((v) => v * scale) as [number, number, number, number], page: e.expectedPage }],
      ...(scale !== 1 ? { pageSize: { width: 595 * scale, height: 842 * scale } } : {}),
    },
  });

  it("four First Floor W.R reported in reverse order are each graded against their own dimension", () => {
    const expected = pick("W.R", "First Floor");
    expect(expected.map((e) => e.attributes!.dimension)).toEqual(["4'x40'", "4'x40'", "21'x40'9\"", "38'x23'"]);
    const r = scoreObservations(expected, [...expected].reverse().map((e) => at(e)), []);
    expect(r.scopeRecall).toBe(1);
    expect(r.attributeAccuracy).toBe(1);
  });

  it("three Second Floor W.I.C (55'x23' and two 4'x23') are paired by location", () => {
    const expected = pick("W.I.C", "Second Floor");
    const r = scoreObservations(expected, [expected[2], expected[0], expected[1]].map((e) => at(e)), []);
    expect(r.attributeAccuracy).toBe(1);
  });

  it("a wrong dimension is still caught: W.R at the 21'x40'9\" location reported as 4'x40' fails only that room", () => {
    const expected = pick("W.R", "First Floor");
    const actual = expected.map((e) => at(e));
    actual[2] = { ...actual[2], attributes: { dimension: "4'x40'" } };
    const r = scoreObservations(expected, [...actual].reverse(), []);
    expect(r.attributeAccuracy).toBe(3 / 4);
  });

  it("Dress on each floor matches its own floor's Dress, even when listed the other way round", () => {
    const expected = [...pick("Dress", "First Floor"), ...pick("Dress", "Second Floor")];
    const r = scoreObservations(expected, [at(expected[1]), at(expected[0])], []);
    expect(r.scopeRecall).toBe(1);
    expect(r.pageAccuracy).toBe(1);
  });

  it("boxes in a declared, scaled page space (2x) are normalised before pairing", () => {
    const expected = pick("W.R", "First Floor");
    const r = scoreObservations(expected, [...expected].reverse().map((e) => at(e, 2)), []);
    expect(r.attributeAccuracy).toBe(1);
  });
});
describe("scoreObservations — evidence edge cases", () => {
  const pick = (mark: string, floor: string) => LABELLED_REF.filter((e) => e.mark === mark && e.scopeHint === floor);
  const room = (mark: string, floor: string, page: number, evidence: { bbox: [number, number, number, number]; page?: number }[], pageSize?: { width: number; height: number }, dimension?: string): ObservationV1 => ({
    observationType: "room_or_space", mark, scopeHint: floor, attributes: dimension ? { dimension } : {},
    evidenceCompleteness: evidence.length ? "FULL" : "LIMITED", source: { page, evidence, ...(pageSize ? { pageSize } : {}) },
  });

  it("an observation with no evidence box still matches by mark and floor (falls back from location pairing)", () => {
    const [kitchen] = pick("Kitchen", "Second Floor");
    const r = scoreObservations([kitchen], [room("Kitchen", "Second Floor", 2, [], undefined, "36'x55'")], []);
    expect(r.scopeRecall).toBe(1);
    expect(r.attributeAccuracy).toBe(1);
  });

  it("a box on the wrong page is not used for location pairing, and the page mismatch is scored", () => {
    const [kitchen] = pick("Kitchen", "Second Floor");
    const r = scoreObservations([kitchen], [room("Kitchen", "Second Floor", 1, [{ bbox: kitchen.expectedBox!.bbox, page: 1 }])], []);
    expect(r.scopeRecall).toBe(1);
    expect(r.pageAccuracy).toBe(0);
  });

  it("the same W.R reported twice, once in a 2x declared page space, is still a duplicate", () => {
    const [wr] = pick("W.R", "First Floor");
    const b = wr.expectedBox!.bbox;
    const actual = [
      room("W.R", "First Floor", 1, [{ bbox: b, page: 1 }], { width: 595, height: 842 }),
      room("W.R", "First Floor", 1, [{ bbox: b.map((v) => v * 2) as [number, number, number, number], page: 1 }], { width: 1190, height: 1684 }),
    ];
    expect(scoreObservations([wr], actual, []).duplicateActualIds).toEqual(["actual#0", "actual#1"]);
  });

  it("two separate W.R in different declared page spaces are not duplicates", () => {
    const [a, b] = pick("W.R", "First Floor");
    const actual = [
      room("W.R", "First Floor", 1, [{ bbox: a.expectedBox!.bbox, page: 1 }], { width: 595, height: 842 }),
      room("W.R", "First Floor", 1, [{ bbox: b.expectedBox!.bbox.map((v) => v * 2) as [number, number, number, number], page: 1 }], { width: 1190, height: 1684 }),
    ];
    expect(scoreObservations([a, b], actual, []).duplicateActualIds).toEqual([]);
  });
});
describe("scoreObservations — dimension comparison ignores formatting only", () => {
  const [dining] = LABELLED_REF.filter((e) => e.mark === "Dining" && e.scopeHint === "First Floor");
  const withDim = (dimension: string): ObservationV1 => ({
    observationType: "room_or_space", mark: "Dining", scopeHint: "First Floor", attributes: { dimension },
    evidenceCompleteness: "FULL", source: { page: 1, evidence: [{ bbox: dining.expectedBox!.bbox, page: 1 }] },
  });

  it.each([`34'1" X 53'11"`, `34'1"×53'11"`, `34’1” x 53’11”`, ` 34'1"  x  53'11" `])("%s matches 34'1\"x53'11\"", (d) => {
    expect(scoreObservations([dining], [withDim(d)], []).attributeAccuracy).toBe(1);
  });

  it.each([`34'1" X 53'9"`, `53'11" X 34'1"`, `34'1"`])("%s does not match", (d) => {
    expect(scoreObservations([dining], [withDim(d)], []).attributeAccuracy).toBe(0);
  });
});
describe("scoreObservations — location pairing only to the nearest label", () => {
  const [wr0, wr1] = LABELLED_REF.filter((e) => e.mark === "W.R" && e.scopeHint === "First Floor");
  const copyAt = (bbox: [number, number, number, number]): ObservationV1 => ({
    observationType: "room_or_space", mark: "W.R", scopeHint: "First Floor", attributes: {},
    evidenceCompleteness: "FULL", source: { page: 1, evidence: [{ bbox, page: 1 }] },
  });

  it("two copies at the first W.R cover one room, leave the second missed, and count one extra", () => {
    const r = scoreObservations([wr0, wr1], [copyAt(wr0.expectedBox!.bbox), copyAt(wr0.expectedBox!.bbox)], []);
    expect(r.scopeRecall).toBe(1 / 2);
    expect(r.unmatchedExpectedIds).toEqual([wr1.id]);
    expect(r.falsePositiveCount).toBe(1);
    expect(r.duplicateActualIds).toEqual(["actual#0", "actual#1"]);
  });

  it("an unboxed W.R still matches a remaining W.R by name and floor", () => {
    const unboxed: ObservationV1 = { ...copyAt(wr0.expectedBox!.bbox), evidenceCompleteness: "LIMITED", source: { page: 1, evidence: [] } };
    const r = scoreObservations([wr0, wr1], [copyAt(wr0.expectedBox!.bbox), unboxed], []);
    expect(r.scopeRecall).toBe(1);
  });
});
