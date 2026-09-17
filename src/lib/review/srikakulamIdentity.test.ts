// SRIKAKULAM IDENTITY REGRESSION — extends the existing
// `identity-w1-cross-floor` benchmark case (srikakulamBenchmark.ts) past
// reviewQueue.buildReviewItems()'s in-run duplicate detection (already
// covered by benchmarkScorer.ts) and into the actual BOQ-matching layer,
// applyReview.classifyReviewItem — the layer that previously had NO scope
// awareness at all (a bare `external_key === item.ai.key` match). This is
// the real fix for the case this benchmark case exists to describe: W1
// reused across Stilt/Ground/a Typical floor must never collide, and a
// genuine same-floor repeat must still resolve to the same line.

import { describe, it, expect } from "vitest";
import { classifyReviewItem, type BoqLineForApply } from "./applyReview";
import type { StoredReviewItem } from "./reviewStore";
import { SRIKAKULAM_BENCHMARK, perfectRunFor } from "./srikakulamBenchmark";

const CASE = SRIKAKULAM_BENCHMARK.find((c) => c.id === "identity-w1-cross-floor")!;
const [stiltW1, groundW1, typicalW1, groundW1Repeat] = perfectRunFor(CASE);

const asReviewItem = (ai: (typeof stiltW1)): StoredReviewItem => ({
  id: ai.key + "-" + (ai.location ?? ""),
  ai,
  reviewStatus: "VERIFIED",
});

describe("Srikakulam identity-w1-cross-floor — real BOQ-matching layer (classifyReviewItem)", () => {
  // One BOQ line per floor the drawing set actually distinguishes, exactly as
  // a consolidated multi-floor BOQ would store them today: same external_key,
  // scope_name carrying the floor. This is the fixture reproducing the bug
  // `applyReview.ts`'s bare `external_key === key` match could not resolve.
  const lines: BoqLineForApply[] = [
    { id: "line-stilt", external_key: "W1", qty: 1, unit: "nos", quantity_status: "MEASURED", scope_name: "Stilt" },
    { id: "line-ground", external_key: "W1", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: "Ground" },
    { id: "line-typical", external_key: "W1", qty: 0, unit: "nos", quantity_status: "PENDING", scope_name: "Typical Floor 1" },
  ];

  it("Stilt W1 resolves to the Stilt line only", () => {
    const c = classifyReviewItem(asReviewItem(stiltW1), lines);
    expect(c.matchedLineId).toBe("line-stilt");
    expect(c.classification).not.toBe("AMBIGUOUS");
  });

  it("Ground W1 resolves to the Ground line only", () => {
    const c = classifyReviewItem(asReviewItem(groundW1), lines);
    expect(c.matchedLineId).toBe("line-ground");
    expect(c.classification).not.toBe("AMBIGUOUS");
  });

  it("Typical W1 resolves to the Typical line only", () => {
    const c = classifyReviewItem(asReviewItem(typicalW1), lines);
    expect(c.matchedLineId).toBe("line-typical");
    expect(c.classification).not.toBe("AMBIGUOUS");
  });

  it("the genuine same-floor repeat resolves to the SAME Ground line as ground-w1-id, not a different one", () => {
    const first = classifyReviewItem(asReviewItem(groundW1), lines);
    const repeat = classifyReviewItem(asReviewItem(groundW1Repeat), lines);
    expect(repeat.matchedLineId).toBe(first.matchedLineId);
    expect(repeat.matchedLineId).toBe("line-ground");
  });

  it("none of the three distinct-floor items are ever misassigned to another floor's line", () => {
    const stilt = classifyReviewItem(asReviewItem(stiltW1), lines);
    const ground = classifyReviewItem(asReviewItem(groundW1), lines);
    const typical = classifyReviewItem(asReviewItem(typicalW1), lines);
    const matched = [stilt.matchedLineId, ground.matchedLineId, typical.matchedLineId];
    expect(new Set(matched).size).toBe(3); // three distinct lines, never collapsed or crossed
  });

  it("two same-scope Ground W1 candidates with no further discriminator -> AMBIGUOUS, never first-match", () => {
    const ambiguousLines: BoqLineForApply[] = [
      { id: "line-ground-a", external_key: "W1", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: "Ground" },
      { id: "line-ground-b", external_key: "W1", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: "Ground" },
    ];
    const c = classifyReviewItem(asReviewItem(groundW1), ambiguousLines);
    expect(c.classification).toBe("AMBIGUOUS");
    expect(c.matchedLineId).toBeNull();
    expect(c.candidateLineIds).toEqual(["line-ground-a", "line-ground-b"]);
  });
});
