// What Apply records about an applied quantity — run through the REAL
// applyReviewPlan against the in-memory database (lib/e2e/inMemorySupabase).
//
// - The applied quantity's basis says what the reviewer did: verified as
//   extracted (REVIEW_VERIFIED) or corrected (REVIEW_CORRECTED). It is never
//   left null ("basis not recorded") after a reviewer has checked it, and a
//   pending result stays PENDING.
// - A reviewer correction the line has no column for (dimension,
//   specification) is kept in the line's change history instead of dropped.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));
import { readTable, resetInMemoryDb } from "@/lib/e2e/inMemorySupabase";
import { applyReviewPlan, buildApplyPlan, type BoqLineForApply } from "./applyReview";
import type { StoredReviewItem } from "./reviewStore";
import { quantityProvenance } from "@/lib/quantity";

const LINE = { id: "line-1", boq_id: "boq-1", description: "Door D1", unit: "nos", qty: 0, quantity_status: "PENDING", basis: "PENDING", external_key: "D1", scope_id: null };
const item = (id: string, key: string, status: StoredReviewItem["reviewStatus"], extra: Partial<StoredReviewItem> = {}): StoredReviewItem => ({
  id, reviewStatus: status,
  ai: { key, item: `Item ${key}`, quantity: 4, unit: "nos", confidence: 0.9, aiStatus: "MEASURED", dimension: "900x2100", source: { document: "GF Plan", page: 1, evidence: [] } } as StoredReviewItem["ai"],
  ...extra,
});

async function apply(items: StoredReviewItem[]) {
  const lines = readTable("boq_line") as unknown as BoqLineForApply[];
  const plan = buildApplyPlan(items, lines);
  return applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(items.map((i) => i.id)) });
}

beforeEach(() => resetInMemoryDb({ boq: [{ id: "boq-1", project_id: null }], boq_line: [{ ...LINE }] }));

describe("Apply records the reviewer's decision as the quantity's basis", () => {
  it("a verified quantity on an existing line: REVIEW_VERIFIED, labelled as such", async () => {
    const res = await apply([item("ri-1", "D1", "VERIFIED")]);
    expect(res.appliedCount).toBe(1);
    const line = readTable("boq_line").find((l) => l.id === "line-1")!;
    // A count ("nos") is recorded as COUNTED — the method, beside the decision.
    expect(line).toMatchObject({ qty: 4, quantity_status: "COUNTED", basis: "REVIEW_VERIFIED" });
    expect(quantityProvenance(line as { basis: string; quantity_status: string }).label).toBe("Counted on drawing, verified in review");
  });

  it("a non-count unit is recorded as MEASURED", async () => {
    await resetInMemoryDb({ boq: [{ id: "boq-1", project_id: null }], boq_line: [{ ...LINE, unit: "sqm", external_key: "F1" }] });
    await apply([item("ri-9", "F1", "EDITED", { reviewer: { quantity: 12.5 }, ai: { ...item("x", "F1", "VERIFIED").ai, unit: "sqm" } })]);
    const line = readTable("boq_line").find((l) => l.id === "line-1")!;
    expect(line).toMatchObject({ qty: 12.5, quantity_status: "MEASURED", basis: "REVIEW_CORRECTED" });
    expect(quantityProvenance(line as { basis: string; quantity_status: string }).label).toBe("Measured on drawing, corrected in review");
  });

  it("a corrected quantity: REVIEW_CORRECTED", async () => {
    await apply([item("ri-1", "D1", "EDITED", { reviewer: { quantity: 6 } })]);
    expect(readTable("boq_line").find((l) => l.id === "line-1")).toMatchObject({ qty: 6, basis: "REVIEW_CORRECTED" });
  });

  it("a new line from a verified item: REVIEW_VERIFIED, still marked as added from review", async () => {
    await apply([item("ri-2", "W1", "VERIFIED")]);
    const added = readTable("boq_line").find((l) => l.external_key === "W1")!;
    expect(added).toMatchObject({ qty: 4, basis: "REVIEW_VERIFIED", basis_note: "Added from drawing analysis review" });
  });

  it("a reviewer who sets the quantity pending leaves it PENDING, never a review basis", async () => {
    await resetInMemoryDb({ boq: [{ id: "boq-1", project_id: null }], boq_line: [{ ...LINE, qty: 3, quantity_status: "MEASURED", basis: "HEURISTIC" }] });
    await apply([item("ri-1", "D1", "EDITED", { reviewer: { quantity: null } })]);
    expect(readTable("boq_line").find((l) => l.id === "line-1")).toMatchObject({ qty: 0, quantity_status: "PENDING", basis: "PENDING" });
  });
});

describe("Apply keeps reviewer corrections the line cannot hold", () => {
  it("a corrected dimension is recorded in the line's change history alongside the quantity", async () => {
    await apply([item("ri-1", "D1", "EDITED", { reviewer: { quantity: 6, dimension: "1000x2100" } })]);
    const log = readTable("boq_line_change_log");
    expect(log).toEqual(expect.arrayContaining([
      expect.objectContaining({ boq_line_id: "line-1", review_item_id: "ri-1", field: "qty", old_value: "pending", new_value: "6" }),
      expect.objectContaining({ boq_line_id: "line-1", review_item_id: "ri-1", field: "dimension", old_value: "900x2100", new_value: "1000x2100" }),
    ]));
  });

  it("…and on a new line", async () => {
    await apply([item("ri-2", "W1", "EDITED", { reviewer: { specification: "Toughened glass" } })]);
    const added = readTable("boq_line").find((l) => l.external_key === "W1")!;
    expect(readTable("boq_line_change_log")).toContainEqual(expect.objectContaining({
      boq_line_id: added.id, review_item_id: "ri-2", field: "specification", new_value: "Toughened glass",
    }));
  });
});
