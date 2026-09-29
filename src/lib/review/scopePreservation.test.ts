// BOQ SCOPE PRESERVATION — permanent regression test for the cross-scope
// overwrite bug found during the pipeline-weakness investigation:
//
//   1. classifyReviewItem's single-candidate branch matched by external_key
//      alone, never checking the item's location against the one existing
//      line's scope.
//   2. addReviewItemAsLine created new BOQ lines with no scope_id at all,
//      even when the review item carried a meaningful location.
//   3. Net effect: reviewing "W1 / Stilt / qty 1" created an unscoped line;
//      reviewing "W1 / Ground / qty 7" afterwards saw exactly one candidate
//      (that same line) and silently overwrote qty 1 -> 7. Stilt's real
//      quantity was lost, with no AMBIGUOUS warning at any point.
//
// The fix: addReviewItemAsLine now resolves/persists a scope_id from the
// item's location (applyReview.ts's resolveScopeIdForLocation), and
// classifyReviewItem's single-candidate branch now refuses to match when the
// one existing line already carries an EXPLICIT, different scope — falling
// through to NEW_LINE (itself now scoped) instead of a silent overwrite.
//
// This drives the REAL applyReviewPlan/addReviewItemAsLine/classifyReviewItem
// code through a mocked Supabase boundary (same style as
// applyReviewPlan.test.ts), using the real Srikakulam W1 cross-floor fixture
// rather than a synthetic one.

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
          const created = rows.map((r) => ({ ...r, id: `line-${++lineIdCounter}` }));
          boqLines.push(...created);
          const result = { data: created[0], error: null };
          return { select: () => ({ single: async () => result }) };
        }
        if (table === "project_scope") {
          const created = rows.map((r) => ({ ...r, id: `scope-${++scopeIdCounter}` }));
          projectScopes.push(...created);
          const result = { data: created[0], error: null };
          return { select: () => ({ single: async () => result }) };
        }
        // boq_line_change_log — fire-and-forget insert, no .select() chained.
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

const CASE = SRIKAKULAM_BENCHMARK.find((c) => c.id === "identity-w1-cross-floor")!;
const [stiltW1, groundW1] = perfectRunFor(CASE);

const asReviewItem = (id: string, ai: (typeof stiltW1)): StoredReviewItem => ({ id, ai, reviewStatus: "VERIFIED" });

/** Mirrors what the real app's boqLines query does: join scope_id -> project_scope.name. */
function currentBoqLinesForApply() {
  return boqLines.map((l) => {
    const scope = projectScopes.find((s) => s.id === l.scope_id);
    return {
      id: l.id as string,
      external_key: l.external_key as string | null,
      qty: l.qty as number,
      unit: l.unit as string | null,
      quantity_status: l.quantity_status as string | null,
      scope_name: (scope?.name as string | undefined) ?? null,
    };
  });
}

beforeEach(() => {
  boqLines.length = 0;
  projectScopes.length = 0;
  changeLog.length = 0;
  lineIdCounter = 0;
  scopeIdCounter = 0;
});

describe("scope preservation — sequential floor-by-floor apply never merges scopes", () => {
  it("Stilt W1 arrives first and creates a new, Stilt-scoped line", async () => {
    const plan = buildApplyPlan([asReviewItem("ri-stilt", stiltW1)], []);
    expect(plan[0].classification).toBe("NEW_LINE");
    expect(plan[0].newLine?.location).toBe("Stilt");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-stilt"]) });
    expect(result.appliedCount).toBe(1);

    expect(boqLines).toHaveLength(1);
    expect(boqLines[0].qty).toBe(1);
    expect(boqLines[0].scope_id).toBeTruthy();

    const scope = projectScopes.find((s) => s.id === boqLines[0].scope_id);
    expect(scope?.name).toBe("Stilt");
  });

  it("Ground W1 arriving second is never an unqualified single-candidate APPLY to the Stilt line", async () => {
    // Step 1: apply Stilt (creates the unprotected-before-the-fix line).
    const stiltPlan = buildApplyPlan([asReviewItem("ri-stilt", stiltW1)], []);
    await applyReviewPlan({ boqId: "boq-1", candidates: stiltPlan, selectedIds: new Set(["ri-stilt"]) });
    const stiltLineId = boqLines[0].id as string;

    // Step 2: classify Ground against the CURRENT boq_line state (one line,
    // now scoped to Stilt) — the exact scenario that used to silently overwrite.
    const linesAfterStilt = currentBoqLinesForApply();
    const groundPlan = buildApplyPlan([asReviewItem("ri-ground", groundW1)], linesAfterStilt);

    expect(groundPlan[0].classification).not.toBe("APPLY");
    expect(groundPlan[0].matchedLineId).not.toBe(stiltLineId);
    expect(groundPlan[0].classification).toBe("NEW_LINE");
    expect(groundPlan[0].newLine?.location).toBe("Ground");

    // Step 3: apply Ground — it must create its OWN line, never touch Stilt's.
    const result = await applyReviewPlan({ boqId: "boq-1", candidates: groundPlan, selectedIds: new Set(["ri-ground"]) });
    expect(result.appliedCount).toBe(1);

    expect(boqLines).toHaveLength(2);
    const stiltLine = boqLines.find((l) => l.id === stiltLineId)!;
    const groundLine = boqLines.find((l) => l.id !== stiltLineId)!;

    // (e) The Stilt quantity must remain 1.
    expect(stiltLine.qty).toBe(1);
    // (f) The Ground quantity must not overwrite the Stilt line — it lives on its own line.
    expect(groundLine.qty).toBe(7);
    expect(groundLine.id).not.toBe(stiltLine.id);

    const groundScope = projectScopes.find((s) => s.id === groundLine.scope_id);
    expect(groundScope?.name).toBe("Ground");
  });

  it("no boq_line_change_log entry ever records a Stilt->Ground qty overwrite", async () => {
    const stiltPlan = buildApplyPlan([asReviewItem("ri-stilt", stiltW1)], []);
    await applyReviewPlan({ boqId: "boq-1", candidates: stiltPlan, selectedIds: new Set(["ri-stilt"]) });

    const linesAfterStilt = currentBoqLinesForApply();
    const groundPlan = buildApplyPlan([asReviewItem("ri-ground", groundW1)], linesAfterStilt);
    await applyReviewPlan({ boqId: "boq-1", candidates: groundPlan, selectedIds: new Set(["ri-ground"]) });

    const qtyOverwrite = changeLog.find((r) => r.field === "qty" && r.old_value === "1" && r.new_value === "7");
    expect(qtyOverwrite).toBeUndefined();
  });
});
