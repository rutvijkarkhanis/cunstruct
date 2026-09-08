// APPLY TO BOQ — classification tests.
//
// classifyReviewItem/buildApplyPlan are pure (no I/O), so these tests exercise
// the actual safety rules directly: never eligible unless VERIFIED/EDITED, diff
// against the CURRENT boq_line value (not the AI value), "no change" is its own
// bucket rather than an apply candidate, and a new line is only proposed when
// the item actually carries the data the existing insertion pattern needs.

import { describe, it, expect } from "vitest";
import { classifyReviewItem, buildApplyPlan, type BoqLineForApply } from "./applyReview";
import type { StoredReviewItem } from "./reviewStore";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

const ai = (o: Partial<AnalysisItemV1>): AnalysisItemV1 => ({
  key: o.key ?? o.item ?? "x", item: o.item ?? "Item", quantity: o.quantity ?? 7,
  confidence: o.confidence ?? 0.9, aiStatus: o.aiStatus ?? "MEASURED", ...o,
});

const reviewItem = (o: Partial<StoredReviewItem> & { ai: AnalysisItemV1 }): StoredReviewItem => ({
  id: o.id ?? "ri-1",
  ai: o.ai,
  reviewStatus: o.reviewStatus ?? "PENDING_REVIEW",
  reviewer: o.reviewer,
});

const line = (o: Partial<BoqLineForApply>): BoqLineForApply => ({
  id: o.id ?? "line-1", external_key: o.external_key ?? "W1", qty: o.qty ?? 9,
  unit: o.unit ?? "nos", quantity_status: o.quantity_status ?? "MEASURED",
});

describe("classifyReviewItem — eligibility", () => {
  it("PENDING_REVIEW is never eligible, regardless of the BOQ", () => {
    const it_ = reviewItem({ ai: ai({ key: "W1" }), reviewStatus: "PENDING_REVIEW" });
    const c = classifyReviewItem(it_, [line({ external_key: "W1", qty: 1 })]);
    expect(c.classification).toBe("NOT_ELIGIBLE");
  });
  it("FLAGGED is never eligible", () => {
    const it_ = reviewItem({ ai: ai({ key: "W1" }), reviewStatus: "FLAGGED" });
    expect(classifyReviewItem(it_, []).classification).toBe("NOT_ELIGIBLE");
  });
  it("MARKED_PENDING is never eligible", () => {
    const it_ = reviewItem({ ai: ai({ key: "W1" }), reviewStatus: "MARKED_PENDING" });
    expect(classifyReviewItem(it_, []).classification).toBe("NOT_ELIGIBLE");
  });
});

describe("classifyReviewItem — diffs against the CURRENT boq_line value, not the AI value", () => {
  it("AI=7, reviewer=8, current BOQ=9 → shows 9 → 8 (not 7 → 8)", () => {
    const it_ = reviewItem({
      ai: ai({ key: "W1", quantity: 7, unit: "nos" }),
      reviewStatus: "EDITED",
      reviewer: { quantity: 8 },
    });
    const c = classifyReviewItem(it_, [line({ external_key: "W1", qty: 9, unit: "nos" })]);
    expect(c.classification).toBe("APPLY");
    const qtyChange = c.changes.find((f) => f.field === "qty");
    expect(qtyChange).toEqual({ field: "qty", from: "9", to: "8" });
  });

  it("re-diffs correctly on a second pass once the BOQ line has changed (e.g. after a prior apply)", () => {
    const it_ = reviewItem({ ai: ai({ key: "W1", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 8 } });
    const first = classifyReviewItem(it_, [line({ external_key: "W1", qty: 9 })]);
    expect(first.changes.find((f) => f.field === "qty")).toEqual({ field: "qty", from: "9", to: "8" });
    // Simulate the line now reflecting the applied value.
    const second = classifyReviewItem(it_, [line({ external_key: "W1", qty: 8 })]);
    expect(second.classification).toBe("NO_CHANGE");
  });
});

describe("classifyReviewItem — no genuine change is never an apply candidate", () => {
  it("classifies as NO_CHANGE when the effective value already equals the current BOQ value", () => {
    const it_ = reviewItem({ ai: ai({ key: "W1", quantity: 9, unit: "nos" }), reviewStatus: "VERIFIED" });
    const c = classifyReviewItem(it_, [line({ external_key: "W1", qty: 9, unit: "nos" })]);
    expect(c.classification).toBe("NO_CHANGE");
    expect(c.changes).toEqual([]);
  });
  it("unit-only difference is still a genuine change", () => {
    const it_ = reviewItem({ ai: ai({ key: "W1", quantity: 9, unit: "sqft" }), reviewStatus: "VERIFIED" });
    const c = classifyReviewItem(it_, [line({ external_key: "W1", qty: 9, unit: "nos" })]);
    expect(c.classification).toBe("APPLY");
    expect(c.changes).toEqual([{ field: "unit", from: "nos", to: "sqft" }]);
  });
  it("a PENDING effective quantity matched against an already-pending line is NO_CHANGE", () => {
    const it_ = reviewItem({ ai: ai({ key: "W1", quantity: null, aiStatus: "PENDING", unit: "nos" }), reviewStatus: "VERIFIED" });
    const c = classifyReviewItem(it_, [line({ external_key: "W1", qty: 0, unit: "nos", quantity_status: "PENDING" })]);
    expect(c.classification).toBe("NO_CHANGE");
  });
  it("resolving a pending line to a real quantity is a genuine change", () => {
    const it_ = reviewItem({ ai: ai({ key: "W1", quantity: 5, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 5 } });
    const c = classifyReviewItem(it_, [line({ external_key: "W1", qty: 0, unit: "nos", quantity_status: "PENDING" })]);
    expect(c.classification).toBe("APPLY");
    expect(c.changes.find((f) => f.field === "qty")).toEqual({ field: "qty", from: "pending", to: "5" });
  });
});

describe("classifyReviewItem — new-line creation never fabricates data", () => {
  it("proposes NEW_LINE when no external_key matches, using only the item's own data", () => {
    const it_ = reviewItem({ ai: ai({ key: "W9", item: "Window W9", quantity: 4, unit: "nos" }), reviewStatus: "VERIFIED" });
    const c = classifyReviewItem(it_, [line({ external_key: "W1" })]);
    expect(c.classification).toBe("NEW_LINE");
    expect(c.newLine).toEqual({ description: "Window W9", unit: "nos", qty: 4, pending: false });
  });
  it("a PENDING item still proposes a new line, with pending semantics (never a fabricated quantity)", () => {
    const it_ = reviewItem({ ai: ai({ key: "W9", item: "Window W9", quantity: null, aiStatus: "PENDING" }), reviewStatus: "VERIFIED" });
    const c = classifyReviewItem(it_, []);
    expect(c.classification).toBe("NEW_LINE");
    expect(c.newLine).toMatchObject({ pending: true, qty: 0 });
  });
  it("CANNOT_APPLY when the item has no description to create a line from", () => {
    const it_ = reviewItem({ ai: ai({ key: "W9", item: "" }), reviewStatus: "VERIFIED" });
    const c = classifyReviewItem(it_, []);
    expect(c.classification).toBe("CANNOT_APPLY");
    expect(c.reason).toMatch(/Cannot apply automatically/);
  });
});

describe("buildApplyPlan", () => {
  it("classifies a mixed batch independently, item by item", () => {
    const items: StoredReviewItem[] = [
      reviewItem({ id: "1", ai: ai({ key: "A", quantity: 9, unit: "nos" }), reviewStatus: "VERIFIED" }),
      reviewItem({ id: "2", ai: ai({ key: "B" }), reviewStatus: "PENDING_REVIEW" }),
      reviewItem({ id: "3", ai: ai({ key: "C" }), reviewStatus: "FLAGGED" }),
      reviewItem({ id: "4", ai: ai({ key: "D", quantity: 3, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 5 } }),
    ];
    const lines: BoqLineForApply[] = [
      line({ external_key: "A", qty: 9, unit: "nos" }),   // no change
      line({ external_key: "D", qty: 3, unit: "nos" }),   // qty 3 -> 5
    ];
    const plan = buildApplyPlan(items, lines);
    expect(plan.map((c) => c.classification)).toEqual(["NO_CHANGE", "NOT_ELIGIBLE", "NOT_ELIGIBLE", "APPLY"]);
  });
});
