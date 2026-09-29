// BOQ DUPLICATE NEW_LINE PREVENTION — permanent regression test for Bug #1
// found during the same investigation as #132/#133:
//
//   Two selected review items share the same (external_key, resolved
//   location) identity, with no existing boq_line for either yet.
//   classifyReviewItem/buildApplyPlan classify BOTH against the SAME static
//   pre-apply snapshot — neither knows the other is about to create a
//   matching line — so both independently classify NEW_LINE, and
//   applyReviewPlan used to insert TWO separate boq_line rows for the exact
//   same mark, silently doubling its quantity with both reported as
//   successfully applied.
//
// The fix: applyReviewPlan now tracks (external_key, normalized location)
// identities it has already created a NEW_LINE for during the current call.
// A later selected NEW_LINE candidate matching an identity already created
// this call is never inserted — it is left unresolved (the same
// conflictedReviewItemIds/unresolvedCount bucket #133 introduced for the
// same-batch APPLY overwrite), for a fresh apply pass to re-classify against
// the now-existing line. classifyReviewItem/buildApplyPlan stay pure and
// unchanged; different identities and different scopes remain unaffected.
//
// This drives the REAL applyReviewPlan/addReviewItemAsLine/classifyReviewItem
// code through a mocked Supabase boundary (same style as
// scopePreservation.test.ts), using the real Srikakulam W1 cross-floor
// fixture rather than a synthetic one.

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
// perfectRunFor -> [stiltW1, groundW1, typicalW1, groundW1Repeat]. groundW1Repeat
// is the benchmark's own "genuine same-floor repeat" positive control: same
// key, same location, same qty/dimension/spec as groundW1.
const [stiltW1, groundW1, , groundW1Repeat] = perfectRunFor(CASE);

const asReviewItem = (id: string, ai: AnalysisItemV1): StoredReviewItem => ({ id, ai, reviewStatus: "VERIFIED" });

beforeEach(() => {
  boqLines.length = 0;
  projectScopes.length = 0;
  changeLog.length = 0;
  lineIdCounter = 0;
  scopeIdCounter = 0;
});

describe("duplicate NEW_LINE prevention — same-batch identical identity is never inserted twice", () => {
  it("groundW1 + groundW1Repeat, same batch, no existing line -> only ONE boq_line is created", async () => {
    const items: StoredReviewItem[] = [
      asReviewItem("ri-ground", groundW1),
      asReviewItem("ri-ground-repeat", groundW1Repeat),
    ];
    const plan = buildApplyPlan(items, []);
    // Both classify NEW_LINE against the same empty snapshot — the root
    // condition this bug depends on.
    expect(plan[0].classification).toBe("NEW_LINE");
    expect(plan[1].classification).toBe("NEW_LINE");

    const result = await applyReviewPlan({
      boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-ground", "ri-ground-repeat"]),
    });

    // (4) The second, conflicting candidate is never falsely reported applied.
    expect(result.appliedCount).toBe(1);
    expect(result.conflictedReviewItemIds).toEqual(["ri-ground-repeat"]);
    // (5) Truthful, consistent counts.
    expect(result.unresolvedCount).toBe(1);

    // (2) Only one boq_line row exists for this identity.
    const w1Lines = boqLines.filter((l) => l.external_key === "W1");
    expect(w1Lines).toHaveLength(1);
    // (3) The quantity is NOT doubled — it's the real Ground W1 count (7), once.
    expect(w1Lines[0].qty).toBe(7);

    // No insert/audit trace of a second line for the rejected candidate.
    const qtyLogRows = changeLog.filter((r) => r.field === "qty");
    expect(qtyLogRows).toHaveLength(1);
    expect(qtyLogRows[0]).toEqual(expect.objectContaining({ old_value: null, new_value: "7" }));
  });

  it("different identities (different keys) create separate lines normally", async () => {
    const items: StoredReviewItem[] = [
      asReviewItem("ri-c", { key: "C", item: "Item C", quantity: 4, unit: "nos", confidence: 0.9, aiStatus: "MEASURED" }),
      asReviewItem("ri-d", { key: "D", item: "Item D", quantity: 6, unit: "nos", confidence: 0.9, aiStatus: "MEASURED" }),
    ];
    const plan = buildApplyPlan(items, []);
    expect(plan[0].classification).toBe("NEW_LINE");
    expect(plan[1].classification).toBe("NEW_LINE");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-c", "ri-d"]) });

    expect(result.appliedCount).toBe(2);
    expect(result.conflictedReviewItemIds).toEqual([]);
    expect(boqLines).toHaveLength(2);
  });

  it("same external key but different resolved scopes (Stilt vs Ground) remain separate lines", async () => {
    const items: StoredReviewItem[] = [
      asReviewItem("ri-stilt", stiltW1),
      asReviewItem("ri-ground", groundW1),
    ];
    const plan = buildApplyPlan(items, []);
    expect(plan[0].classification).toBe("NEW_LINE");
    expect(plan[1].classification).toBe("NEW_LINE");
    expect(plan[0].newLine?.location).toBe("Stilt");
    expect(plan[1].newLine?.location).toBe("Ground");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-stilt", "ri-ground"]) });

    // Genuinely distinct scopes — never treated as a same-batch duplicate.
    expect(result.appliedCount).toBe(2);
    expect(result.conflictedReviewItemIds).toEqual([]);

    const w1Lines = boqLines.filter((l) => l.external_key === "W1");
    expect(w1Lines).toHaveLength(2);
    expect(w1Lines.map((l) => l.qty).sort()).toEqual([1, 7]);

    const stiltScope = projectScopes.find((s) => s.id === w1Lines.find((l) => l.qty === 1)?.scope_id);
    const groundScope = projectScopes.find((s) => s.id === w1Lines.find((l) => l.qty === 7)?.scope_id);
    expect(stiltScope?.name).toBe("Stilt");
    expect(groundScope?.name).toBe("Ground");
  });
});
