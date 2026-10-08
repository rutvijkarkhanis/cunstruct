import { describe, it, expect } from "vitest";
import { buildReconciliationInput } from "./reconciliationInput";
import type { StoredReviewItem } from "./reviewStore";
import type { LocationObservation } from "./locationObservations";

function obs(o: Partial<LocationObservation> & { id: string; mark: string }): LocationObservation {
  return {
    observationType: "opening", scopeHint: null, locationText: null, attributes: {},
    evidence: { evidence: [{ bbox: [0, 0, 1, 1] }] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    ...o,
  };
}

const countableItem: StoredReviewItem = {
  id: "item-1",
  reviewStatus: "PENDING_REVIEW",
  ai: {
    key: "W1", item: "Window W1", quantity: 7, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    source: { documentId: "doc-1", document: "plan.pdf", page: 1, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] },
  },
};

describe("buildReconciliationInput", () => {
  it("W2 worked example: expected 7, 6 physical instances + schedule entry -> AMBER inputs (count mismatch)", () => {
    const observations = [
      ...Array.from({ length: 6 }, (_, i) => obs({ id: `p${i}`, mark: "W1", observationType: "opening" })),
      obs({ id: "sched", mark: "W1", observationType: "schedule_entry" }),
    ];
    const input = buildReconciliationInput(countableItem, observations, true);
    expect(input).toEqual({
      countable: true, expectedQuantity: 7, locationRan: true, physicalLocatedCount: 6,
      hasScheduleEntry: true, hasEvidence: true, criticalReasons: [], explicitlyFlagged: false,
    });
  });

  it("exact match + schedule entry -> every field lines up for GREEN", () => {
    const observations = [
      ...Array.from({ length: 7 }, (_, i) => obs({ id: `p${i}`, mark: "W1", observationType: "opening" })),
      obs({ id: "sched", mark: "W1", observationType: "schedule_entry" }),
    ];
    const input = buildReconciliationInput(countableItem, observations, true);
    expect(input.physicalLocatedCount).toBe(7);
    expect(input.hasScheduleEntry).toBe(true);
    expect(input.expectedQuantity).toBe(7);
  });

  it("locationRan=false is passed straight through, regardless of what's in observations", () => {
    const input = buildReconciliationInput(countableItem, [], false);
    expect(input.locationRan).toBe(false);
    expect(input.physicalLocatedCount).toBe(0);
    expect(input.hasScheduleEntry).toBe(false);
  });

  it("uses the reviewer's override quantity (effectiveQuantity), not the AI's original, once reviewed", () => {
    const edited: StoredReviewItem = { ...countableItem, reviewer: { quantity: 9 } };
    const input = buildReconciliationInput(edited, [], true);
    expect(input.expectedQuantity).toBe(9);
  });

  it("a non-countable unit (sq ft) is reported as not countable, and instance/schedule fields stay honest zeros", () => {
    const slab: StoredReviewItem = {
      id: "item-2", reviewStatus: "PENDING_REVIEW",
      ai: { key: "SLAB", item: "Slab area", quantity: 450, unit: "sq ft", confidence: 0.9, aiStatus: "MEASURED", source: { evidence: [{ bbox: [0, 0, 1, 1] }] } },
    };
    const input = buildReconciliationInput(slab, [], true);
    expect(input.countable).toBe(false);
    expect(input.expectedQuantity).toBe(450);
  });

  it("hasEvidence is false when the item's own source has zero evidence boxes", () => {
    const noEvidence: StoredReviewItem = { ...countableItem, ai: { ...countableItem.ai, source: { evidence: [] } } };
    expect(buildReconciliationInput(noEvidence, [], true).hasEvidence).toBe(false);
  });

  it("explicitlyFlagged mirrors reviewStatus === 'FLAGGED' exactly", () => {
    const flagged: StoredReviewItem = { ...countableItem, reviewStatus: "FLAGGED" };
    expect(buildReconciliationInput(flagged, [], true).explicitlyFlagged).toBe(true);
    expect(buildReconciliationInput(countableItem, [], true).explicitlyFlagged).toBe(false);
  });

  it("criticalReasons comes straight from reviewQueue's own criticalReasons() — a conflicting-candidates item reports it", () => {
    const conflicted: StoredReviewItem = {
      id: "item-3", reviewStatus: "PENDING_REVIEW",
      ai: {
        key: "SLAB-TOTAL", item: "Total slab area", quantity: null, confidence: null, aiStatus: "PENDING",
        candidates: [{ value: 100, unit: "sq ft", basis: "a" }, { value: 110, unit: "sq ft", basis: "b" }],
      },
    };
    const input = buildReconciliationInput(conflicted, [], false);
    expect(input.criticalReasons).toContain("Conflicting sources (2 candidates)");
  });
});
