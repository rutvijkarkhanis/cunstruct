// BOQ LINE IDENTITY CONSTRAINT — permanent regression test for the confirmed
// cross-call NEW_LINE duplication bug found after #133/#134/#135:
//
//   Two SEPARATE, independent applyReviewPlan() calls, each classifying the
//   same review item against a "no existing line yet" snapshot, both
//   classify NEW_LINE and both insert a boq_line row for the identical
//   (boq_id, external_key, resolved scope) identity — #134's
//   createdNewLineIdentities Set is fresh per call and cannot see this.
//
// The fix closes this at the database level: two partial unique indexes
// (20260929000000_boq_line_identity_constraint.sql) make the identity a real
// Postgres invariant, and addReviewItemAsLine (src/lib/applyFinding.ts)
// translates the resulting 23505 into `null` rather than a fabricated
// success — applyReviewPlan then folds it into the existing
// conflictedReviewItemIds/unresolvedCount bucket from #133/#134/#135.
//
// This mock simulates the actual database invariant (not just records
// calls): a boq_line insert is rejected with a realistic 23505 error when it
// collides with an existing row under the SAME rule the migration encodes —
// scoped identity (boq_id, external_key, scope_id) when both are set, or
// unscoped identity (boq_id, external_key) when scope_id is null — so these
// tests exercise the real classifyReviewItem/buildApplyPlan/applyReviewPlan/
// addReviewItemAsLine code against a faithful stand-in for the constraint,
// using the real Srikakulam W1 cross-floor fixture.

import { describe, it, expect, beforeEach, vi } from "vitest";

interface Row { [key: string]: unknown }

const boqRows: Row[] = [{ id: "boq-1", project_id: "proj-1" }];
const boqLines: Row[] = [];
const projectScopes: Row[] = [];
const changeLog: Row[] = [];
let lineIdCounter = 0;
let scopeIdCounter = 0;

function selectBuilder(rows: Row[], filters: Record<string, unknown> = {}) {
  const matches = () => rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
  const builder = {
    eq: (col: string, val: unknown) => selectBuilder(rows, { ...filters, [col]: val }),
    limit: (_n: number) => builder,
    single: async () => {
      const m = matches();
      return m.length ? { data: m[0], error: null } : { data: null, error: { message: "not found" } };
    },
    maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
  };
  return builder;
}

/** Mirrors the exact identity rule the migration encodes as two partial
 *  unique indexes: scoped rows collide on (boq_id, external_key, scope_id)
 *  when both are set; unscoped rows collide on (boq_id, external_key) when
 *  scope_id is null. A row with no external_key is never constrained. */
function findIdentityCollision(row: Row): string | null {
  if (row.external_key == null) return null;
  if (row.scope_id != null) {
    const hit = boqLines.find(
      (l) => l.boq_id === row.boq_id && l.external_key === row.external_key && l.scope_id === row.scope_id,
    );
    return hit ? "boq_line_identity_scoped_idx" : null;
  }
  const hit = boqLines.find(
    (l) => l.boq_id === row.boq_id && l.external_key === row.external_key && l.scope_id == null,
  );
  return hit ? "boq_line_identity_unscoped_idx" : null;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: (_cols: string) => {
        if (table === "boq") return selectBuilder(boqRows);
        if (table === "project_scope") return selectBuilder(projectScopes);
        if (table === "boq_line") return selectBuilder(boqLines);
        return selectBuilder([]);
      },
      insert: (payload: unknown) => {
        const rows = (Array.isArray(payload) ? payload : [payload]) as Row[];
        if (table === "boq_line") {
          const row = rows[0];
          const collidingIndex = findIdentityCollision(row);
          if (collidingIndex) {
            const result = {
              data: null,
              error: { code: "23505", message: `duplicate key value violates unique constraint "${collidingIndex}"` },
            };
            return { select: () => ({ single: async () => result }) };
          }
          const created = { ...row, id: `line-${++lineIdCounter}` };
          boqLines.push(created);
          const result = { data: created, error: null };
          return { select: () => ({ single: async () => result }) };
        }
        if (table === "project_scope") {
          const created = rows.map((r) => ({ ...r, id: `scope-${++scopeIdCounter}` }));
          projectScopes.push(...created);
          const result = { data: created[0], error: null };
          return { select: () => ({ single: async () => result }) };
        }
        changeLog.push(...rows);
        return { then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(onFulfilled) };
      },
      update: (payload: unknown) => ({
        eq: async (_col: string, id: string) => {
          const line = boqLines.find((l) => l.id === id);
          if (line) Object.assign(line, payload);
          return { error: null };
        },
      }),
    }),
  },
}));

import { buildApplyPlan, applyReviewPlan } from "./applyReview";
import type { StoredReviewItem } from "./reviewStore";
import { SRIKAKULAM_BENCHMARK, perfectRunFor } from "./srikakulamBenchmark";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

const CASE = SRIKAKULAM_BENCHMARK.find((c) => c.id === "identity-w1-cross-floor")!;
// [stiltW1, groundW1, typicalW1, groundW1Repeat]
const [stiltW1, groundW1] = perfectRunFor(CASE);
const asReviewItem = (id: string, ai: AnalysisItemV1): StoredReviewItem => ({ id, ai, reviewStatus: "VERIFIED" });

beforeEach(() => {
  boqLines.length = 0;
  projectScopes.length = 0;
  changeLog.length = 0;
  lineIdCounter = 0;
  scopeIdCounter = 0;
});

describe("boq_line identity constraint — cross-call NEW_LINE duplication is rejected, not silently duplicated", () => {
  it("(1) exact reproduction: two SEPARATE calls from the same stale empty snapshot — only one line survives", async () => {
    const emptySnapshot: never[] = [];

    const plan1 = buildApplyPlan([asReviewItem("ri-ground-1", groundW1)], emptySnapshot);
    expect(plan1[0].classification).toBe("NEW_LINE");
    const result1 = await applyReviewPlan({ boqId: "boq-1", candidates: plan1, selectedIds: new Set(["ri-ground-1"]) });
    expect(result1.appliedCount).toBe(1);
    expect(result1.conflictedReviewItemIds).toEqual([]);

    // Second, independent call — its own createdNewLineIdentities Set starts
    // empty, unaware call 1 already created this exact line.
    const plan2 = buildApplyPlan([asReviewItem("ri-ground-2", groundW1)], emptySnapshot);
    expect(plan2[0].classification).toBe("NEW_LINE");
    const result2 = await applyReviewPlan({ boqId: "boq-1", candidates: plan2, selectedIds: new Set(["ri-ground-2"]) });

    // The database rejects it — never a fabricated success.
    expect(result2.appliedCount).toBe(0);
    expect(result2.conflictedReviewItemIds).toEqual(["ri-ground-2"]);
    expect(result2.unresolvedCount).toBe(1);

    // Only one boq_line row exists; quantity is not doubled.
    const w1Lines = boqLines.filter((l) => l.external_key === "W1");
    expect(w1Lines).toHaveLength(1);
    expect(w1Lines[0].qty).toBe(7);

    // No fabricated audit entry for the rejected second candidate.
    const qtyRows = changeLog.filter((r) => r.field === "qty");
    expect(qtyRows).toHaveLength(1);
    expect(qtyRows[0]).toEqual(expect.objectContaining({ old_value: null, new_value: "7", review_item_id: "ri-ground-1" }));
  });

  it("(2) different scopes: same external_key, different resolved scopes — both lines allowed, each correctly scoped", async () => {
    const emptySnapshot: never[] = [];

    const planStilt = buildApplyPlan([asReviewItem("ri-stilt", stiltW1)], emptySnapshot);
    const resultStilt = await applyReviewPlan({ boqId: "boq-1", candidates: planStilt, selectedIds: new Set(["ri-stilt"]) });
    expect(resultStilt.appliedCount).toBe(1);

    const planGround = buildApplyPlan([asReviewItem("ri-ground", groundW1)], emptySnapshot);
    const resultGround = await applyReviewPlan({ boqId: "boq-1", candidates: planGround, selectedIds: new Set(["ri-ground"]) });
    expect(resultGround.appliedCount).toBe(1);
    expect(resultGround.conflictedReviewItemIds).toEqual([]);

    const w1Lines = boqLines.filter((l) => l.external_key === "W1");
    expect(w1Lines).toHaveLength(2);
    const stiltLine = w1Lines.find((l) => l.qty === 1)!;
    const groundLine = w1Lines.find((l) => l.qty === 7)!;
    expect(projectScopes.find((s) => s.id === stiltLine.scope_id)?.name).toBe("Stilt");
    expect(projectScopes.find((s) => s.id === groundLine.scope_id)?.name).toBe("Ground");
  });

  it("(3) different external keys, same scope — both lines allowed", async () => {
    const emptySnapshot: never[] = [];
    const itemGround: AnalysisItemV1 = { key: "W1", item: "Window W1", location: "Ground", quantity: 7, confidence: 0.95, aiStatus: "MEASURED" };
    const itemGroundOther: AnalysisItemV1 = { key: "W2", item: "Window W2", location: "Ground", quantity: 5, confidence: 0.95, aiStatus: "MEASURED" };

    const plan1 = buildApplyPlan([asReviewItem("ri-w1", itemGround)], emptySnapshot);
    const result1 = await applyReviewPlan({ boqId: "boq-1", candidates: plan1, selectedIds: new Set(["ri-w1"]) });
    expect(result1.appliedCount).toBe(1);

    const plan2 = buildApplyPlan([asReviewItem("ri-w2", itemGroundOther)], emptySnapshot);
    const result2 = await applyReviewPlan({ boqId: "boq-1", candidates: plan2, selectedIds: new Set(["ri-w2"]) });
    expect(result2.appliedCount).toBe(1);
    expect(result2.conflictedReviewItemIds).toEqual([]);

    const lines = boqLines.filter((l) => l.boq_id === "boq-1");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.external_key).sort()).toEqual(["W1", "W2"]);
    // Same resolved scope reused for both (the "Ground" project_scope), by design.
    expect(new Set(lines.map((l) => l.scope_id)).size).toBe(1);
  });

  it("(4) unscoped identity: two separate calls with NO location — the unscoped partial index rejects the second", async () => {
    const emptySnapshot: never[] = [];
    const unscopedItem = (id: string): AnalysisItemV1 => ({ key: "V1", item: "Ventilator V1", quantity: 5, confidence: 0.95, aiStatus: "MEASURED" });

    const plan1 = buildApplyPlan([asReviewItem("ri-v1-a", unscopedItem("a"))], emptySnapshot);
    expect(plan1[0].newLine?.location).toBeNull();
    const result1 = await applyReviewPlan({ boqId: "boq-1", candidates: plan1, selectedIds: new Set(["ri-v1-a"]) });
    expect(result1.appliedCount).toBe(1);
    expect(boqLines[0].scope_id).toBeNull();

    const plan2 = buildApplyPlan([asReviewItem("ri-v1-b", unscopedItem("b"))], emptySnapshot);
    const result2 = await applyReviewPlan({ boqId: "boq-1", candidates: plan2, selectedIds: new Set(["ri-v1-b"]) });

    expect(result2.appliedCount).toBe(0);
    expect(result2.conflictedReviewItemIds).toEqual(["ri-v1-b"]);

    const v1Lines = boqLines.filter((l) => l.external_key === "V1");
    expect(v1Lines).toHaveLength(1);
    expect(v1Lines[0].qty).toBe(5);
  });
});
