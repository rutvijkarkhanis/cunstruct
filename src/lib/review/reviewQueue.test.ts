import { describe, it, expect } from "vitest";
import {
  buildReviewItems, orderQueue, matchesFilter, reviewSummary,
  diffItem, quantityDelta, isCritical, effectiveQuantity,
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
