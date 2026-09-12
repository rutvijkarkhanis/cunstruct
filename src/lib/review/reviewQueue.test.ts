import { describe, it, expect } from "vitest";
import {
  buildReviewItems, orderQueue, matchesFilter, reviewSummary,
  diffItem, quantityDelta, isCritical, criticalReasons, effectiveQuantity,
  type ReviewItem,
} from "./reviewQueue";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

const ai = (o: Partial<AnalysisItemV1>): AnalysisItemV1 => ({
  key: o.key ?? o.item ?? "x", item: o.item ?? "Item", quantity: o.quantity ?? 1,
  confidence: o.confidence ?? 0.9, aiStatus: o.aiStatus ?? "MEASURED", ...o,
});

describe("buildReviewItems — duplicate detection", () => {
  it("tags a later identical item as a duplicate of the first", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window", location: "First Floor" }),
      ai({ key: "W2", item: "Window", location: "First Floor" }), // same name+location
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBe("W1");
  });

  it("does NOT flag the same mark code reused across different floors as a duplicate", () => {
    // Stilt / W1, Ground / W1, Typical / W1 — same key, three distinct real
    // items. This is the exact false-positive the unscoped key check produced.
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window", location: "Stilt" }),
      ai({ key: "W1", item: "Window", location: "Ground" }),
      ai({ key: "W1", item: "Window", location: "Typical Floor 1" }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBeUndefined();
    expect(items[2].duplicateOf).toBeUndefined();
  });

  it("still flags the same key in the same location as a duplicate", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window", location: "Ground" }),
      ai({ key: "W1", item: "Window", location: "Ground" }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBe("W1");
  });

  it("still flags the same key as a duplicate when location is blank on both", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window" }),
      ai({ key: "W1", item: "Window" }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBe("W1");
  });

  it("location comparison is case/whitespace insensitive, like the existing item+location check", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window", location: "Ground" }),
      ai({ key: "W1", item: "Window", location: "  GROUND  " }),
    ]);
    expect(items[1].duplicateOf).toBe("W1");
  });
});

describe("orderQueue — attention first, nothing discarded", () => {
  it("puts pending/low-confidence/duplicate/inferred before normal measured, and reviewed last", () => {
    const items = buildReviewItems([
      ai({ key: "A", item: "Measured", quantity: 5, confidence: 0.95, aiStatus: "MEASURED" }),
      ai({ key: "B", item: "PendingQty", quantity: null, aiStatus: "PENDING" }),
      ai({ key: "C", item: "LowConf", quantity: 2, confidence: 0.3 }),
      ai({ key: "D", item: "Inferred", quantity: 1, aiStatus: "INFERRED" }),
    ]);
    items[0].reviewStatus = "VERIFIED"; // reviewed measured → should sink to the end
    const order = orderQueue(items).map((i) => i.ai.key);
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("D"));   // pending before inferred
    expect(order.indexOf("C")).toBeLessThan(order.indexOf("D"));   // low-conf before inferred
    expect(order[order.length - 1]).toBe("A");                     // reviewed kept, at the end
  });
});

describe("isCritical", () => {
  it("flags pending, low confidence, no evidence, or duplicate", () => {
    expect(isCritical({ ai: ai({ quantity: null, aiStatus: "PENDING" }), reviewStatus: "PENDING_REVIEW" })).toBe(true);
    expect(isCritical({ ai: ai({ confidence: 0.4 }), reviewStatus: "PENDING_REVIEW" })).toBe(true);
    expect(isCritical({ ai: ai({ confidence: 0.95, quantity: 3, aiStatus: "MEASURED", source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] } }), reviewStatus: "PENDING_REVIEW" })).toBe(false);
  });
});

describe("criticalReasons — factual, named reasons behind isCritical", () => {
  const measured = (o: Partial<AnalysisItemV1> = {}): ReviewItem => ({ ai: ai({ confidence: 0.95, quantity: 3, aiStatus: "MEASURED", source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] }, ...o }), reviewStatus: "PENDING_REVIEW" });

  it("returns no reasons for a routine, high-confidence, measured item with evidence", () => {
    expect(criticalReasons(measured())).toEqual([]);
  });
  it("names a duplicate", () => {
    expect(criticalReasons({ ...measured(), duplicateOf: "W1" })).toEqual(["Possible duplicate"]);
  });
  it("names a pending/no-quantity item", () => {
    expect(criticalReasons(measured({ quantity: null, aiStatus: "PENDING" }))).toEqual(["Pending — no quantity"]);
  });
  it("names an inferred item", () => {
    expect(criticalReasons(measured({ aiStatus: "INFERRED" }))).toEqual(["Inferred"]);
  });
  it("names low confidence", () => {
    expect(criticalReasons(measured({ confidence: 0.4 }))).toEqual(["Low confidence"]);
  });
  it("names missing evidence", () => {
    expect(criticalReasons(measured({ source: { document: "d", evidence: [] } }))).toEqual(["No evidence"]);
  });
  it("combines every applicable reason, in a stable order", () => {
    const it_: ReviewItem = { ...measured({ aiStatus: "INFERRED", confidence: 0.3, source: { document: "d", evidence: [] } }), duplicateOf: "W1" };
    expect(criticalReasons(it_)).toEqual(["Possible duplicate", "Inferred", "Low confidence", "No evidence"]);
  });
  it("isCritical(it) is exactly criticalReasons(it).length > 0", () => {
    for (const it_ of [measured(), { ...measured(), duplicateOf: "W1" }, measured({ confidence: 0.4 })]) {
      expect(isCritical(it_)).toBe(criticalReasons(it_).length > 0);
    }
  });
});

describe("criticalReasons / priority — conflicting sources (candidates)", () => {
  const withCandidates = (n: number) => ai({
    quantity: null, aiStatus: "PENDING",
    candidates: Array.from({ length: n }, (_, i) => ({ value: i + 1, basis: `source ${i + 1}` })),
  });

  it("names a conflict with its candidate count", () => {
    expect(criticalReasons({ ai: withCandidates(3), reviewStatus: "PENDING_REVIEW" }))
      .toContain("Conflicting sources (3 candidates)");
  });

  it("does not flag a single candidate as a conflict", () => {
    expect(criticalReasons({ ai: withCandidates(1), reviewStatus: "PENDING_REVIEW" }))
      .not.toContain(expect.stringContaining("Conflicting sources"));
  });

  it("does not flag an item with no candidates at all", () => {
    expect(criticalReasons({ ai: ai({ quantity: 5 }), reviewStatus: "PENDING_REVIEW" }))
      .not.toEqual(expect.arrayContaining([expect.stringContaining("Conflicting sources")]));
  });

  it("sorts a conflicting item ahead of a plain pending item, but behind a duplicate", () => {
    const items = buildReviewItems([
      ai({ key: "A", item: "Plain", quantity: null, aiStatus: "PENDING" }),
      ai({ key: "B", item: "Conflict", quantity: null, aiStatus: "PENDING", candidates: [{ value: 1, basis: "x" }, { value: 2, basis: "y" }] }),
      ai({ key: "C", item: "Dup1", location: "Loc" }),
      ai({ key: "D", item: "Dup1", location: "Loc" }), // flagged duplicateOf "Dup1"@"Loc"
    ]);
    const order = orderQueue(items).map((i) => i.ai.key);
    expect(order.indexOf("D")).toBeLessThan(order.indexOf("B")); // duplicate before conflict
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("A")); // conflict before plain pending
  });

  it("combines with other reasons rather than replacing them", () => {
    const it_ = { ai: withCandidates(2), reviewStatus: "PENDING_REVIEW" as const };
    const reasons = criticalReasons(it_);
    expect(reasons).toContain("Conflicting sources (2 candidates)");
    expect(reasons).toContain("Pending — no quantity"); // candidates always leave quantity null
  });
});

describe("filters", () => {
  const base = buildReviewItems([ai({ key: "A" }), ai({ key: "B" })]);
  it("NEEDS_REVIEW excludes reviewed items but keeps them under ALL", () => {
    base[0].reviewStatus = "VERIFIED";
    expect(base.filter((i) => matchesFilter(i, "NEEDS_REVIEW")).map((i) => i.ai.key)).toEqual(["B"]);
    expect(base.filter((i) => matchesFilter(i, "ALL"))).toHaveLength(2);
    expect(base.filter((i) => matchesFilter(i, "VERIFIED")).map((i) => i.ai.key)).toEqual(["A"]);
  });
});

describe("reviewSummary + progress", () => {
  it("counts each status and computes completion %", () => {
    const items = buildReviewItems([ai({ key: "A" }), ai({ key: "B" }), ai({ key: "C" }), ai({ key: "D" })]);
    items[0].reviewStatus = "VERIFIED";
    items[1].reviewStatus = "EDITED";
    items[2].reviewStatus = "MARKED_PENDING";
    const s = reviewSummary(items);
    expect(s).toMatchObject({ total: 4, verified: 1, edited: 1, markedPending: 1, remaining: 1 });
    expect(s.completionPct).toBe(75);
  });
});

describe("AI vs reviewer values are both retained", () => {
  const item: ReviewItem = { ai: ai({ key: "W1", quantity: 3, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 4 } };
  it("effectiveQuantity uses the reviewer value without erasing the AI value", () => {
    expect(effectiveQuantity(item)).toBe(4);
    expect(item.ai.quantity).toBe(3); // AI value preserved
  });
  it("diffItem exposes the AI→reviewer difference", () => {
    expect(diffItem(item)).toEqual([{ field: "quantity", aiValue: "3", reviewerValue: "4" }]);
  });
  it("quantityDelta shows a signed correction", () => {
    expect(quantityDelta(item)).toBe("+1 correction");
  });
});
