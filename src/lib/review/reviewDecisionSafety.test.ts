// Review decisions are never silently lost:
// - saveReviewDecision with expectedStatus is a compare-and-swap — a decision
//   another reviewer made meanwhile is not overwritten (nothing is saved);
// - reviewDrift tells Apply when any decision changed after it was loaded.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const rows = vi.hoisted(() => ({ items: [] as Row[], log: [] as Row[], logMissing: false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "reviewer-2" } } }) },
    from: (table: string) => ({
      insert: async (row: Row) => {
        if (table !== "boq_line_change_log") throw new Error("unexpected insert");
        if (rows.logMissing) return { error: { code: "42P01", message: "relation does not exist" } };
        rows.log.push(row); return { error: null };
      },
      update: (patch: Row) => {
        const filters: [string, unknown][] = [];
        const q: Record<string, unknown> = {};
        const run = () => {
          const hit = rows.items.filter((r) => filters.every(([c, v]) => r[c] === v));
          hit.forEach((r) => Object.assign(r, patch));
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        };
        q.eq = (c: string, v: unknown) => { filters.push([c, v]); return q; };
        q.select = () => Promise.resolve(run());
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res);
        return q;
      },
    }),
  },
}));
import { ReviewDecisionConflictError, saveReviewDecision } from "./reviewStore";
import { reviewDrift } from "./reviewDrift";

beforeEach(() => { rows.items = [{ id: "ri-1", review_status: "PENDING_REVIEW", review_note: null }]; rows.log = []; rows.logMissing = false; });

describe("saveReviewDecision — guarded", () => {
  it("saves when the item still has the status the reviewer saw", async () => {
    await saveReviewDecision({ itemId: "ri-1", reviewStatus: "VERIFIED", reviewNote: "ok", expectedStatus: "PENDING_REVIEW" });
    expect(rows.items[0]).toMatchObject({ review_status: "VERIFIED", review_note: "ok", reviewed_by: "reviewer-2" });
  });
  it("refuses, writing nothing, when another reviewer decided meanwhile", async () => {
    rows.items[0].review_status = "FLAGGED"; // someone else
    await expect(saveReviewDecision({ itemId: "ri-1", reviewStatus: "VERIFIED", expectedStatus: "PENDING_REVIEW" }))
      .rejects.toBeInstanceOf(ReviewDecisionConflictError);
    expect(rows.items[0].review_status).toBe("FLAGGED");
  });
});

describe("saveReviewDecision — durable decision history", () => {
  it("records the decision (from → to, with the note) in the change log", async () => {
    const r = await saveReviewDecision({ itemId: "ri-1", reviewStatus: "FLAGGED", reviewNote: "Two sources disagree", expectedStatus: "PENDING_REVIEW", boqId: "boq-1" });
    expect(r).toEqual({ historyRecorded: true });
    expect(rows.log).toEqual([expect.objectContaining({ boq_id: "boq-1", boq_line_id: null, review_item_id: "ri-1", field: "review_decision",
      old_value: "PENDING_REVIEW", new_value: "FLAGGED — Two sources disagree", changed_by: "reviewer-2" })]);
  });
  it("without the history table the decision still stands, and says history was not recorded", async () => {
    rows.logMissing = true;
    const r = await saveReviewDecision({ itemId: "ri-1", reviewStatus: "VERIFIED", expectedStatus: "PENDING_REVIEW", boqId: "boq-1" });
    expect(r).toEqual({ historyRecorded: false });
    expect(rows.items[0].review_status).toBe("VERIFIED");
  });
  it("a refused (stale) decision writes no history", async () => {
    rows.items[0].review_status = "FLAGGED";
    await expect(saveReviewDecision({ itemId: "ri-1", reviewStatus: "VERIFIED", expectedStatus: "PENDING_REVIEW", boqId: "boq-1" })).rejects.toThrow();
    expect(rows.log).toEqual([]);
  });
});

describe("reviewDrift", () => {
  const loaded = [{ id: "a", reviewStatus: "VERIFIED" as const }, { id: "b", reviewStatus: "EDITED" as const, reviewer: { quantity: 4 } }];
  it("is empty when nothing changed", () => {
    expect(reviewDrift(loaded, loaded.map((x) => ({ ...x })))).toEqual([]);
  });
  it("names items whose decision or correction changed, and items added or removed", () => {
    expect(reviewDrift(loaded, [{ id: "a", reviewStatus: "FLAGGED" }, { id: "b", reviewStatus: "EDITED", reviewer: { quantity: 4 } }])).toEqual(["a"]);
    expect(reviewDrift(loaded, [{ id: "a", reviewStatus: "VERIFIED" }, { id: "b", reviewStatus: "EDITED", reviewer: { quantity: 5 } }])).toEqual(["b"]);
    expect(reviewDrift(loaded, [{ id: "a", reviewStatus: "VERIFIED" }])).toEqual(["b"]);
    expect(reviewDrift(loaded, [...loaded, { id: "c", reviewStatus: "PENDING_REVIEW" }])).toEqual(["c"]);
  });
});
