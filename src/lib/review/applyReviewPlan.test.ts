// APPLY TO BOQ — applyReviewPlan integration tests (Blocker 2 fix).
//
// classifyReviewItem/buildApplyPlan are pure and covered in applyReview.test.ts.
// applyReviewPlan is the one function here that actually writes — it calls
// through applyFinding.ts's insertLineResilient/updateLineResilient down to the
// Supabase client, so this file mocks only that client boundary and lets the
// real classification + apply/insert code run, to verify what actually gets
// written to boq_line_change_log for a newly created line: field-level qty/unit
// records, not just a "line_created" provenance row.

import { describe, it, expect, vi, beforeEach } from "vitest";

interface Call { table: string; op: "insert" | "update"; payload: unknown; lineId?: string }
const calls: Call[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      insert: (payload: unknown) => {
        calls.push({ table, op: "insert", payload });
        const result = table === "boq_line" ? { data: { id: "new-line-1" }, error: null } : { error: null };
        return {
          select: () => ({ single: async () => result }),
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled, onRejected),
        };
      },
      update: (payload: unknown) => ({
        eq: async (_col: string, id: string) => {
          calls.push({ table, op: "update", payload, lineId: id });
          return { error: null };
        },
      }),
    }),
  },
}));

import { buildApplyPlan, applyReviewPlan } from "./applyReview";
import type { StoredReviewItem } from "./reviewStore";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

const ai = (o: Partial<AnalysisItemV1>): AnalysisItemV1 => ({
  key: o.key ?? o.item ?? "x", item: o.item ?? "Item", quantity: o.quantity ?? 7,
  confidence: o.confidence ?? 0.9, aiStatus: o.aiStatus ?? "MEASURED", ...o,
});
const reviewItem = (o: Partial<StoredReviewItem> & { ai: AnalysisItemV1 }): StoredReviewItem => ({
  id: o.id ?? "ri-1", ai: o.ai, reviewStatus: o.reviewStatus ?? "PENDING_REVIEW", reviewer: o.reviewer,
});

function changeLogRows(): { field: string; old_value: string | null; new_value: string | null }[] {
  const call = calls.find((c) => c.table === "boq_line_change_log");
  return (call?.payload as { field: string; old_value: string | null; new_value: string | null }[]) ?? [];
}

beforeEach(() => { calls.length = 0; });

describe("applyReviewPlan — NEW_LINE audit logging", () => {
  it("records field-level qty AND unit audit entries, alongside line_created as additional provenance", async () => {
    const it_ = reviewItem({ id: "ri-9", ai: ai({ key: "W9", item: "Window W9", quantity: 4, unit: "nos" }), reviewStatus: "VERIFIED" });
    const plan = buildApplyPlan([it_], []);
    expect(plan[0].classification).toBe("NEW_LINE");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-9"]) });
    expect(result.appliedCount).toBe(1);

    const rows = changeLogRows();
    expect(rows.find((r) => r.field === "qty")).toEqual(expect.objectContaining({ old_value: null, new_value: "4" }));
    expect(rows.find((r) => r.field === "unit")).toEqual(expect.objectContaining({ old_value: null, new_value: "nos" }));
    // line_created is retained as extra provenance, not a substitute for the field-level rows.
    expect(rows.find((r) => r.field === "line_created")).toEqual(expect.objectContaining({ old_value: null, new_value: "Window W9" }));
    expect(rows).toHaveLength(3);
  });

  it("logs qty as 'pending' and never invents a unit row when no unit was written", async () => {
    const it_ = reviewItem({ id: "ri-10", ai: ai({ key: "W10", item: "Window W10", quantity: null, aiStatus: "PENDING", unit: undefined }), reviewStatus: "VERIFIED" });
    const plan = buildApplyPlan([it_], []);
    expect(plan[0].classification).toBe("NEW_LINE");

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-10"]) });

    const rows = changeLogRows();
    expect(rows.find((r) => r.field === "qty")).toEqual(expect.objectContaining({ old_value: null, new_value: "pending" }));
    expect(rows.some((r) => r.field === "unit")).toBe(false);
  });

  it("every logged row carries the created line id, the review item id, and who made the change", async () => {
    const it_ = reviewItem({ id: "ri-11", ai: ai({ key: "W11", item: "Window W11", quantity: 2, unit: "nos" }), reviewStatus: "EDITED" });
    const plan = buildApplyPlan([it_], []);
    await applyReviewPlan({ boqId: "boq-42", candidates: plan, selectedIds: new Set(["ri-11"]) });

    const call = calls.find((c) => c.table === "boq_line_change_log")!;
    const rows = call.payload as { boq_id: string; boq_line_id: string; review_item_id: string; changed_by: string | null }[];
    for (const row of rows) {
      expect(row.boq_id).toBe("boq-42");
      expect(row.boq_line_id).toBe("new-line-1");
      expect(row.review_item_id).toBe("ri-11");
      expect(row.changed_by).toBe("user-1");
    }
  });
});

describe("applyReviewPlan — existing behavior remains intact", () => {
  it("APPLY (matched line) still logs a from/to row per changed field, unchanged from before", async () => {
    const it_ = reviewItem({ id: "ri-1", ai: ai({ key: "W1", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 8 } });
    const plan = buildApplyPlan([it_], [{ id: "line-1", external_key: "W1", qty: 9, unit: "nos", quantity_status: "MEASURED" }]);
    expect(plan[0].classification).toBe("APPLY");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-1"]) });
    expect(result.appliedCount).toBe(1);

    const updateCall = calls.find((c) => c.table === "boq_line" && c.op === "update");
    expect(updateCall?.lineId).toBe("line-1");

    const rows = changeLogRows();
    expect(rows).toEqual([expect.objectContaining({ field: "qty", old_value: "9", new_value: "8", boq_line_id: "line-1" })]);
  });

  it("unselected and ineligible candidates are never written, even when present in the plan", async () => {
    const items: StoredReviewItem[] = [
      reviewItem({ id: "1", ai: ai({ key: "A", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 8 } }), // eligible, NOT selected
      reviewItem({ id: "2", ai: ai({ key: "B", quantity: 7, unit: "nos" }), reviewStatus: "FLAGGED" }), // never eligible
    ];
    const lines = [{ id: "line-1", external_key: "A", qty: 9, unit: "nos", quantity_status: "MEASURED" }];
    const plan = buildApplyPlan(items, lines);

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["2"]) }); // select the ineligible one
    expect(result.appliedCount).toBe(0);
    expect(calls.filter((c) => c.table === "boq_line").length).toBe(0);
    expect(calls.filter((c) => c.table === "boq_line_change_log").length).toBe(0);
  });
});
