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

// The mock's own "current DB state" for boq_line rows — separate from the
// `lines` snapshot a test hands to buildApplyPlan (which is what the
// candidate's diff was computed FROM). Seeding it to the same values as that
// snapshot means "nothing changed since classification" (today's normal
// case, what every pre-existing test here assumes); the compare-and-swap
// regression tests below deliberately seed it differently to simulate a
// write that happened in between.
const boqLineStore = new Map<string, { qty: number; unit: string | null }>();
function seedLine(id: string, qty: number, unit: string | null) {
  boqLineStore.set(id, { qty, unit });
}

// Scope C — source-revision resolution mock state. Mirrors exactly what
// resolveSourceRevisionId (applyReview.ts) reads: project_document's
// current_revision_id (a soft reference, may be stale/missing) and whether
// that id actually exists as a document_revision row BELONGING TO the
// requested document. documentRevisionOwner models real ownership
// (revisionId -> the document_id it actually belongs to) rather than a flat
// set of "known" ids, so a seeded revision that belongs to a DIFFERENT
// document than the one being resolved is correctly rejected by this mock,
// exactly as the real document_revision.document_id FK column would.
// Every test's boq ("boq-1", "boq-42", …) belongs to this project — the
// `single()` mock for the "boq" table below always resolves project_id to
// this constant, so seedDocument's default project_id keeps every
// pre-existing test's documents "same-project" (today's normal case)
// without having to pass it explicitly everywhere. The project-scoping and
// query-error regression tests live in
// applyReviewSourceDocumentIntegrity.test.ts, not this file.
const BOQ_PROJECT_ID = "project-1";
const projectDocumentStore = new Map<string, { current_revision_id: string | null; project_id: string }>();
const documentRevisionOwner = new Map<string, string>();
function seedDocument(documentId: string, currentRevisionId: string | null, projectId: string = BOQ_PROJECT_ID) {
  projectDocumentStore.set(documentId, { current_revision_id: currentRevisionId, project_id: projectId });
}
function seedRevision(revisionId: string, ownerDocumentId: string) {
  documentRevisionOwner.set(revisionId, ownerDocumentId);
}

// Scope E — models analysis_run_source's durable (run, document) -> analyzed
// -revision claim record. A plain array (not a Map) because the real table
// can genuinely hold more than one row for the same (analysis_run_id,
// document_id) — that's exactly the "conflicting records" case Scope E must
// never guess through.
interface RunSourceRow { analysis_run_id: string; document_id: string; status: string; document_revision_id: string | null }
const analysisRunSourceStore: RunSourceRow[] = [];
function seedRunSource(runId: string, documentId: string, revisionId: string | null, status = "SUCCEEDED") {
  analysisRunSourceStore.push({ analysis_run_id: runId, document_id: documentId, status, document_revision_id: revisionId });
}

/** A minimal .select(cols).eq(col, val)... reader for project_document/
 *  document_revision (terminated by .maybeSingle(), as resolveSourceRevisionId's
 *  fallback path always does) and analysis_run_source (terminated by directly
 *  awaiting the chain, as resolveAnalyzedRevisionId's `.not()`-filtered query
 *  does — the real supabase-js builder is thenable without a terminal call).
 *  For document_revision, a row is only returned when BOTH the `id` filter
 *  matches a seeded revision AND (when present) the `document_id` filter
 *  matches that revision's actual owner — mirroring the real FK-backed
 *  column, not just an existence set. */
function selectBuilder(table: string, filters: Record<string, unknown> = {}, excludeNullRevision = false) {
  return {
    eq: (col: string, val: unknown) => selectBuilder(table, { ...filters, [col]: val }, excludeNullRevision),
    not: (_col: string, _op: string, _val: unknown) => selectBuilder(table, filters, true),
    // Only the "boq" table's project_id lookup (documentStillExists's
    // resolveBoqProjectId, applyReview.ts) is ever terminated with .single()
    // rather than .maybeSingle() — mirrors the real supabase-js builder,
    // which exposes both terminators on the same chain.
    single: async () => {
      if (table === "boq") return { data: { project_id: BOQ_PROJECT_ID }, error: null };
      return { data: null, error: null };
    },
    maybeSingle: async () => {
      const id = filters.id as string | undefined;
      if (table === "project_document") {
        const row = id ? projectDocumentStore.get(id) : undefined;
        // N1 — project-scoped: a row whose project_id doesn't match the
        // filter (documentStillExists always supplies one once it has
        // resolved the boq's project) is treated exactly like no row at all,
        // mirroring the real project_document.project_id column.
        if (row && filters.project_id !== undefined && row.project_id !== filters.project_id) {
          return { data: null, error: null };
        }
        return { data: row ?? null, error: null };
      }
      if (table === "document_revision") {
        const owner = id ? documentRevisionOwner.get(id) : undefined;
        const documentIdFilter = filters.document_id as string | undefined;
        const found = owner != null && (documentIdFilter === undefined || owner === documentIdFilter);
        return { data: found ? { id } : null, error: null };
      }
      return { data: null, error: null };
    },
    then: (resolve: (r: { data: unknown; error: null }) => void) => {
      if (table === "analysis_run_source") {
        const rows = analysisRunSourceStore.filter((r) =>
          (filters.analysis_run_id === undefined || r.analysis_run_id === filters.analysis_run_id)
          && (filters.document_id === undefined || r.document_id === filters.document_id)
          && (filters.status === undefined || r.status === filters.status)
          && (!excludeNullRevision || r.document_revision_id != null),
        );
        return resolve({ data: rows.map((r) => ({ document_revision_id: r.document_revision_id })), error: null });
      }
      return resolve({ data: [], error: null });
    },
  };
}

/** A chainable update() builder supporting the two shapes updateLineResilient
 *  actually produces: the plain legacy path (`.update(patch).eq("id", id)`,
 *  awaited directly) and the guarded compare-and-swap path (additional
 *  `.eq()`/`.is()` filters, terminated by `.select("id")`) — matching real
 *  PostgREST semantics: a row is updated (and returned) only if it still
 *  matches every filter, and zero rows come back with no error otherwise. */
function updateBuilder(table: string, payload: Record<string, unknown>, filters: Record<string, unknown> = {}) {
  const builder = {
    eq: (col: string, val: unknown) => updateBuilder(table, payload, { ...filters, [col]: val }),
    is: (col: string, val: unknown) => updateBuilder(table, payload, { ...filters, [col]: val }),
    select: (_cols: string) => {
      const id = filters.id as string | undefined;
      const current = id ? boqLineStore.get(id) : undefined;
      const matches = current != null && Object.entries(filters).every(
        ([k, v]) => k === "id" || (current as Record<string, unknown>)[k] === v,
      );
      if (matches && id) {
        boqLineStore.set(id, { ...current, ...payload } as { qty: number; unit: string | null });
        calls.push({ table, op: "update", payload, lineId: id });
        return Promise.resolve({ data: [{ id }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      const id = filters.id as string | undefined;
      if (id) {
        const current = boqLineStore.get(id) ?? { qty: 0, unit: null };
        boqLineStore.set(id, { ...current, ...payload } as { qty: number; unit: string | null });
        calls.push({ table, op: "update", payload, lineId: id });
      }
      return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

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
      update: (payload: Record<string, unknown>) => updateBuilder(table, payload),
      select: (_cols: string) => selectBuilder(table),
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

// Flattens EVERY boq_line_change_log insert across all calls so far — a test
// exercising two SEPARATE applyReviewPlan() invocations produces two such
// inserts, and both must be visible for a truthful cross-call audit check.
function changeLogRows(): { field: string; old_value: string | null; new_value: string | null }[] {
  return calls
    .filter((c) => c.table === "boq_line_change_log")
    .flatMap((c) => c.payload as { field: string; old_value: string | null; new_value: string | null }[]);
}

beforeEach(() => { calls.length = 0; boqLineStore.clear(); projectDocumentStore.clear(); documentRevisionOwner.clear(); analysisRunSourceStore.length = 0; });

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
    const plan = buildApplyPlan([it_], [{ id: "line-1", external_key: "W1", qty: 9, unit: "nos", quantity_status: "MEASURED", scope_name: null }]);
    expect(plan[0].classification).toBe("APPLY");
    seedLine("line-1", 9, "nos");

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
    const lines = [{ id: "line-1", external_key: "A", qty: 9, unit: "nos", quantity_status: "MEASURED", scope_name: null }];
    const plan = buildApplyPlan(items, lines);

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["2"]) }); // select the ineligible one
    expect(result.appliedCount).toBe(0);
    expect(calls.filter((c) => c.table === "boq_line").length).toBe(0);
    expect(calls.filter((c) => c.table === "boq_line_change_log").length).toBe(0);
  });
});

// ── Same-batch APPLY conflict: two selected candidates targeting the SAME
// existing boq_line, both classified against one static pre-apply snapshot.
// Reproduces the confirmed bug: applying both used to silently last-write-win
// (final qty = the second candidate's value, the first's approved correction
// gone with no warning, both reported as successfully applied, and the
// second's audit row recorded a false "from" value). ────────────────────────
describe("applyReviewPlan — same-batch APPLY conflict on the same line is never silently applied", () => {
  it("qty: existing W1 qty=1, candidate A -> 8, candidate B -> 10 — only A applies, B is rejected, not last-write-wins", async () => {
    const items: StoredReviewItem[] = [
      reviewItem({ id: "ri-A", ai: ai({ key: "W1", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 8 } }),
      reviewItem({ id: "ri-B", ai: ai({ key: "W1", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 10 } }),
    ];
    const lines = [{ id: "line-1", external_key: "W1", qty: 1, unit: "nos", quantity_status: "MEASURED", scope_name: null }];
    const plan = buildApplyPlan(items, lines);
    seedLine("line-1", 1, "nos");

    // Both classify against the SAME static snapshot — this is the root
    // condition the bug depends on, asserted here so a future change to
    // classifyReviewItem that accidentally "fixes" this at the wrong layer
    // doesn't silently invalidate what this test is actually proving.
    expect(plan[0].classification).toBe("APPLY");
    expect(plan[1].classification).toBe("APPLY");
    expect(plan[0].matchedLineId).toBe("line-1");
    expect(plan[1].matchedLineId).toBe("line-1");
    expect(plan[0].changes.find((c) => c.field === "qty")).toEqual({ field: "qty", from: "1", to: "8" });
    expect(plan[1].changes.find((c) => c.field === "qty")).toEqual({ field: "qty", from: "1", to: "10" });

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-A", "ri-B"]) });

    // The two candidates can never both report successful application.
    expect(result.appliedCount).toBe(1);
    expect(result.conflictedReviewItemIds).toEqual(["ri-B"]);
    expect(result.unresolvedCount).toBe(1);

    // Exactly one write reached boq_line, for the FIRST candidate's value —
    // never last-write-wins, never both, never neither.
    const updateCalls = calls.filter((c) => c.table === "boq_line" && c.op === "update");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].lineId).toBe("line-1");
    expect((updateCalls[0].payload as { qty: number }).qty).toBe(8);

    // Truthful audit trail: exactly one qty row, 1 -> 8. No row for B's
    // rejected 1 -> 10 (never fabricated), and no row anywhere claims the
    // line went to 10.
    const rows = changeLogRows();
    expect(rows).toEqual([expect.objectContaining({ field: "qty", old_value: "1", new_value: "8", boq_line_id: "line-1" })]);
    expect(rows.some((r) => r.new_value === "10")).toBe(false);
  });

  it("unit: a line-level conflict blocks a later candidate even when it changes a DIFFERENT field than the first", async () => {
    const items: StoredReviewItem[] = [
      reviewItem({ id: "ri-A2", ai: ai({ key: "W2", quantity: 5, unit: "nos" }), reviewStatus: "EDITED", reviewer: { unit: "sqft" } }),
      reviewItem({ id: "ri-B2", ai: ai({ key: "W2", quantity: 5, unit: "nos" }), reviewStatus: "EDITED", reviewer: { unit: "sqm" } }),
    ];
    const lines = [{ id: "line-2", external_key: "W2", qty: 5, unit: "nos", quantity_status: "MEASURED", scope_name: null }];
    const plan = buildApplyPlan(items, lines);
    seedLine("line-2", 5, "nos");
    expect(plan[0].classification).toBe("APPLY");
    expect(plan[1].classification).toBe("APPLY");
    expect(plan[0].matchedLineId).toBe("line-2");
    expect(plan[1].matchedLineId).toBe("line-2");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-A2", "ri-B2"]) });

    expect(result.appliedCount).toBe(1);
    expect(result.conflictedReviewItemIds).toEqual(["ri-B2"]);

    const updateCalls = calls.filter((c) => c.table === "boq_line" && c.op === "update" && c.lineId === "line-2");
    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0].payload as { unit: string }).unit).toBe("sqft");

    const rows = changeLogRows();
    expect(rows).toEqual([expect.objectContaining({ field: "unit", old_value: "nos", new_value: "sqft" })]);
    expect(rows.some((r) => r.new_value === "sqm")).toBe(false);
  });

  it("candidates matching DIFFERENT lines never conflict — both apply normally", async () => {
    const items: StoredReviewItem[] = [
      reviewItem({ id: "ri-C", ai: ai({ key: "C", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 8 } }),
      reviewItem({ id: "ri-D", ai: ai({ key: "D", quantity: 3, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 5 } }),
    ];
    const lines = [
      { id: "line-c", external_key: "C", qty: 9, unit: "nos", quantity_status: "MEASURED", scope_name: null },
      { id: "line-d", external_key: "D", qty: 3, unit: "nos", quantity_status: "MEASURED", scope_name: null },
    ];
    const plan = buildApplyPlan(items, lines);
    seedLine("line-c", 9, "nos");
    seedLine("line-d", 3, "nos");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-C", "ri-D"]) });
    expect(result.appliedCount).toBe(2);
    expect(result.conflictedReviewItemIds).toEqual([]);
  });
});

// ── Cross-call stale-snapshot guard: two SEPARATE applyReviewPlan() calls
// (not one batch — #133's in-memory modifiedLineIds Set is fresh on every
// invocation and can't see across calls). Each call's plan is built from its
// own snapshot; the compare-and-swap in applyReviewQtyUnit/updateLineResilient
// is what has to catch a snapshot that went stale between calls. Reproduces
// the confirmed bug: two independent apply operations against the same line,
// both computed from qty=9, used to let the second silently overwrite the
// first with a false audit "old_value". ─────────────────────────────────────
describe("applyReviewPlan — cross-call stale-snapshot guard (compare-and-swap)", () => {
  it("qty: second, independent apply call is rejected when the row changed since ITS classification", async () => {
    const lines = [{ id: "line-1", external_key: "W1", qty: 9, unit: "nos", quantity_status: "MEASURED", scope_name: null }];
    seedLine("line-1", 9, "nos");

    // Call 1: item A, classified from qty=9, applies 9 -> 8.
    const itemA = reviewItem({ id: "ri-A", ai: ai({ key: "W1", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 8 } });
    const planA = buildApplyPlan([itemA], lines);
    const resultA = await applyReviewPlan({ boqId: "boq-1", candidates: planA, selectedIds: new Set(["ri-A"]) });
    expect(resultA.appliedCount).toBe(1);
    expect(resultA.conflictedReviewItemIds).toEqual([]);
    expect(boqLineStore.get("line-1")?.qty).toBe(8);

    // Call 2: item B, classified from the SAME (now stale) snapshot qty=9 —
    // a fresh, independent applyReviewPlan() invocation, so its own
    // modifiedLineIds Set starts empty and knows nothing about call 1.
    const itemB = reviewItem({ id: "ri-B", ai: ai({ key: "W1", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 12 } });
    const planB = buildApplyPlan([itemB], lines);
    expect(planB[0].changes.find((c) => c.field === "qty")).toEqual({ field: "qty", from: "9", to: "12" });

    const resultB = await applyReviewPlan({ boqId: "boq-1", candidates: planB, selectedIds: new Set(["ri-B"]) });

    // Must NOT overwrite — appliedCount/unresolvedCount are truthful.
    expect(resultB.appliedCount).toBe(0);
    expect(resultB.conflictedReviewItemIds).toEqual(["ri-B"]);
    expect(resultB.unresolvedCount).toBe(1);

    // Final qty remains A's value.
    expect(boqLineStore.get("line-1")?.qty).toBe(8);

    // No fabricated audit entry for the rejected second update — only A's
    // original, truthful row exists.
    const rows = changeLogRows();
    expect(rows).toEqual([expect.objectContaining({ field: "qty", old_value: "9", new_value: "8" })]);
    expect(rows.some((r) => r.new_value === "12")).toBe(false);
  });

  it("qty: a plan built from a REFRESHED snapshot applies normally, with truthful audit history for both operations", async () => {
    const staleLines = [{ id: "line-1", external_key: "W1", qty: 9, unit: "nos", quantity_status: "MEASURED", scope_name: null }];
    seedLine("line-1", 9, "nos");

    const itemA = reviewItem({ id: "ri-A", ai: ai({ key: "W1", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 8 } });
    const planA = buildApplyPlan([itemA], staleLines);
    await applyReviewPlan({ boqId: "boq-1", candidates: planA, selectedIds: new Set(["ri-A"]) });
    expect(boqLineStore.get("line-1")?.qty).toBe(8);

    // Second plan built from a REFRESHED snapshot (qty=8, matching reality).
    const refreshedLines = [{ id: "line-1", external_key: "W1", qty: 8, unit: "nos", quantity_status: "MEASURED", scope_name: null }];
    const itemB = reviewItem({ id: "ri-B", ai: ai({ key: "W1", quantity: 7, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 12 } });
    const planB = buildApplyPlan([itemB], refreshedLines);
    expect(planB[0].changes.find((c) => c.field === "qty")).toEqual({ field: "qty", from: "8", to: "12" });

    const resultB = await applyReviewPlan({ boqId: "boq-1", candidates: planB, selectedIds: new Set(["ri-B"]) });
    expect(resultB.appliedCount).toBe(1);
    expect(resultB.conflictedReviewItemIds).toEqual([]);
    expect(boqLineStore.get("line-1")?.qty).toBe(12);

    const rows = changeLogRows();
    expect(rows).toEqual([
      expect.objectContaining({ field: "qty", old_value: "9", new_value: "8" }),
      expect.objectContaining({ field: "qty", old_value: "8", new_value: "12" }),
    ]);
  });

  it("unit: stale unit state cannot silently overwrite a newer unit change made by a separate call", async () => {
    const lines = [{ id: "line-2", external_key: "W2", qty: 5, unit: "nos", quantity_status: "MEASURED", scope_name: null }];
    seedLine("line-2", 5, "nos");

    const itemA = reviewItem({ id: "ri-A2", ai: ai({ key: "W2", quantity: 5, unit: "nos" }), reviewStatus: "EDITED", reviewer: { unit: "sqft" } });
    const planA = buildApplyPlan([itemA], lines);
    const resultA = await applyReviewPlan({ boqId: "boq-1", candidates: planA, selectedIds: new Set(["ri-A2"]) });
    expect(resultA.appliedCount).toBe(1);
    expect(boqLineStore.get("line-2")?.unit).toBe("sqft");

    // Second, separate call — classified from the SAME stale snapshot
    // (unit still "nos"), unaware line-2 was already changed to "sqft".
    const itemB = reviewItem({ id: "ri-B2", ai: ai({ key: "W2", quantity: 5, unit: "nos" }), reviewStatus: "EDITED", reviewer: { unit: "sqm" } });
    const planB = buildApplyPlan([itemB], lines);
    const resultB = await applyReviewPlan({ boqId: "boq-1", candidates: planB, selectedIds: new Set(["ri-B2"]) });

    expect(resultB.appliedCount).toBe(0);
    expect(resultB.conflictedReviewItemIds).toEqual(["ri-B2"]);
    // The newer unit change ("sqft") survives — never silently overwritten.
    expect(boqLineStore.get("line-2")?.unit).toBe("sqft");

    const rows = changeLogRows();
    expect(rows).toEqual([expect.objectContaining({ field: "unit", old_value: "nos", new_value: "sqft" })]);
    expect(rows.some((r) => r.new_value === "sqm")).toBe(false);
  });
});

// ── Scope C — drawing-evidence traceability: the actual write, including
// source_revision_id resolution against project_document/document_revision. ──
describe("applyReviewPlan — source traceability (Scope C)", () => {
  it("NEW_LINE: a valid source resolves document_id/revision_id/page and writes all three", async () => {
    seedDocument("doc-1", "rev-1");
    seedRevision("rev-1", "doc-1");
    const it_ = reviewItem({
      id: "ri-src-1",
      ai: ai({ key: "W20", item: "Window W20", quantity: 4, unit: "nos", source: { documentId: "doc-1", page: 7, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([it_], []);
    expect(plan[0].classification).toBe("NEW_LINE");
    expect(plan[0].source).toEqual({ documentId: "doc-1", page: 7 });

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-src-1"]) });

    const insertCall = calls.find((c) => c.table === "boq_line" && c.op === "insert")!;
    const row = insertCall.payload as Record<string, unknown>;
    expect(row.source_document_id).toBe("doc-1");
    expect(row.source_revision_id).toBe("rev-1");
    expect(row.source_page).toBe("7");
  });

  it("NEW_LINE: a document whose current_revision_id does not resolve to a real revision writes a null revision, never a guess", async () => {
    seedDocument("doc-1", "rev-stale"); // points at a revision that doesn't actually exist
    // seedRevision("rev-stale") deliberately NOT called
    const it_ = reviewItem({
      id: "ri-src-2",
      ai: ai({ key: "W21", item: "Window W21", quantity: 4, unit: "nos", source: { documentId: "doc-1", page: 2, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([it_], []);
    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-src-2"]) });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_document_id).toBe("doc-1");
    expect(row.source_revision_id).toBeNull();
    expect(row.source_page).toBe("2");
  });

  it("NEW_LINE: no source on the item writes all three source columns as null — never fabricated", async () => {
    const it_ = reviewItem({ id: "ri-src-3", ai: ai({ key: "W22", item: "Window W22", quantity: 4, unit: "nos" }), reviewStatus: "VERIFIED" });
    const plan = buildApplyPlan([it_], []);
    expect(plan[0].source).toBeUndefined();
    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-src-3"]) });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_document_id).toBeNull();
    expect(row.source_revision_id).toBeNull();
    expect(row.source_page).toBeNull();
  });

  it("APPLY (matched line with no existing source): the update patch includes the resolved source columns", async () => {
    seedDocument("doc-2", "rev-2");
    seedRevision("rev-2", "doc-2");
    const it_ = reviewItem({
      id: "ri-src-4",
      ai: ai({ key: "W23", quantity: 7, unit: "nos", source: { documentId: "doc-2", page: 1, evidence: [] } }),
      reviewStatus: "EDITED", reviewer: { quantity: 8 },
    });
    const lines = [{ id: "line-src-1", external_key: "W23", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: null, source_document_id: null }];
    const plan = buildApplyPlan([it_], lines);
    expect(plan[0].classification).toBe("APPLY");
    expect(plan[0].source).toEqual({ documentId: "doc-2", page: 1 });
    seedLine("line-src-1", 7, "nos");

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-src-4"]) });

    const updateCall = calls.find((c) => c.table === "boq_line" && c.op === "update")!;
    const patch = updateCall.payload as Record<string, unknown>;
    expect(patch.source_document_id).toBe("doc-2");
    expect(patch.source_revision_id).toBe("rev-2");
    expect(patch.source_page).toBe("1");
    // The qty change this patch rides along with is still applied correctly.
    expect(patch.qty).toBe(8);
  });

  it("APPLY (matched line ALREADY has a source): preserved — the update patch carries no source keys at all, even though the item has a different source", async () => {
    seedDocument("doc-3", "rev-3");
    seedRevision("rev-3", "doc-3");
    const it_ = reviewItem({
      id: "ri-src-5",
      ai: ai({ key: "W24", quantity: 7, unit: "nos", source: { documentId: "doc-3", page: 9, evidence: [] } }),
      reviewStatus: "EDITED", reviewer: { quantity: 8 },
    });
    const lines = [{ id: "line-src-2", external_key: "W24", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: null, source_document_id: "doc-already-set" }];
    const plan = buildApplyPlan([it_], lines);
    expect(plan[0].source).toBeUndefined(); // classifyReviewItem already refused to propose one
    seedLine("line-src-2", 7, "nos");

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-src-5"]) });

    const updateCall = calls.find((c) => c.table === "boq_line" && c.op === "update")!;
    const patch = updateCall.payload as Record<string, unknown>;
    expect("source_document_id" in patch).toBe(false);
    expect("source_revision_id" in patch).toBe(false);
    expect("source_page" in patch).toBe(false);
    // Confirms this preserved-source case still applies qty correctly —
    // preserving provenance never blocks the actual reviewed change.
    expect(patch.qty).toBe(8);
  });

  it("source_revision_id is resolved at most once per distinct documentId across multiple candidates in one call", async () => {
    seedDocument("doc-shared", "rev-shared");
    seedRevision("rev-shared", "doc-shared");
    const items: StoredReviewItem[] = [
      reviewItem({ id: "ri-s1", ai: ai({ key: "W30", item: "A", quantity: 1, unit: "nos", source: { documentId: "doc-shared", page: 1, evidence: [] } }), reviewStatus: "VERIFIED" }),
      reviewItem({ id: "ri-s2", ai: ai({ key: "W31", item: "B", quantity: 1, unit: "nos", source: { documentId: "doc-shared", page: 2, evidence: [] } }), reviewStatus: "VERIFIED" }),
    ];
    const plan = buildApplyPlan(items, []);
    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-s1", "ri-s2"]) });
    expect(result.appliedCount).toBe(2);

    // Both candidates share one documentId — both resolved rows must agree
    // on the same revision (the per-call cache never lets two candidates
    // for the same document silently diverge on separate lookups).
    const insertRows = calls.filter((c) => c.table === "boq_line" && c.op === "insert").map((c) => c.payload as Record<string, unknown>);
    expect(insertRows).toHaveLength(2);
    expect(insertRows.every((r) => r.source_revision_id === "rev-shared")).toBe(true);
  });

  it("NEW_LINE: a revision that exists but belongs to a DIFFERENT document is rejected — source_revision_id is null, never the mismatched id", async () => {
    // doc-A's current_revision_id is stale/corrupted: it points at a real
    // document_revision row, but one that actually belongs to doc-B. This is
    // the exact scenario resolveSourceRevisionId's own doc comment (applyReview.ts)
    // says it guards against.
    seedDocument("doc-A", "rev-for-doc-B");
    seedRevision("rev-for-doc-B", "doc-B"); // owned by doc-B, not doc-A
    const it_ = reviewItem({
      id: "ri-src-6",
      ai: ai({ key: "W40", item: "Window W40", quantity: 4, unit: "nos", source: { documentId: "doc-A", page: 3, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([it_], []);
    expect(plan[0].classification).toBe("NEW_LINE");
    expect(plan[0].source).toEqual({ documentId: "doc-A", page: 3 });

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-src-6"]) });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    // source_document_id/page are the requested document's own data — preserved
    // even though the revision lookup failed ownership.
    expect(row.source_document_id).toBe("doc-A");
    expect(row.source_page).toBe("3");
    // THE FIX: never the mismatched "rev-for-doc-B" — treated identically to
    // "doesn't exist at all".
    expect(row.source_revision_id).toBeNull();
    expect(row.source_revision_id).not.toBe("rev-for-doc-B");
    // The ownership check is a pure addition to source-column resolution: it
    // changes nothing about row-identity, classification, or the actual
    // quantity/unit written for this new line.
    expect(result.appliedCount).toBe(1);
    expect(row.qty).toBe(4);
    expect(row.unit).toBe("nos");
    expect(row.external_key).toBe("W40");
  });

  it("APPLY: a mismatched revision is rejected (null) without disturbing the qty/unit compare-and-swap or classification for the matched line", async () => {
    // Same stale cross-document pointer as above, but on the APPLY (matched
    // line) path rather than NEW_LINE — proves the ownership check behaves
    // identically on both write paths and never interferes with the
    // pre-existing compare-and-swap guard the qty/unit write rides on.
    seedDocument("doc-A2", "rev-for-doc-B2");
    seedRevision("rev-for-doc-B2", "doc-B2");
    const it_ = reviewItem({
      id: "ri-src-7",
      ai: ai({ key: "W41", quantity: 7, unit: "nos", source: { documentId: "doc-A2", page: 5, evidence: [] } }),
      reviewStatus: "EDITED", reviewer: { quantity: 9 },
    });
    const lines = [{ id: "line-src-3", external_key: "W41", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: null, source_document_id: null }];
    const plan = buildApplyPlan([it_], lines);
    expect(plan[0].classification).toBe("APPLY");
    seedLine("line-src-3", 7, "nos");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-src-7"]) });

    expect(result.appliedCount).toBe(1);
    const updateCall = calls.find((c) => c.table === "boq_line" && c.op === "update")!;
    const patch = updateCall.payload as Record<string, unknown>;
    expect(patch.source_document_id).toBe("doc-A2");
    expect(patch.source_page).toBe("5");
    expect(patch.source_revision_id).toBeNull();
    expect(patch.source_revision_id).not.toBe("rev-for-doc-B2");
    // The reviewed quantity change is still applied correctly — the ownership
    // check never blocks or alters the underlying qty/unit write.
    expect(patch.qty).toBe(9);
  });
});

// ── Scope E — exact analyzed revision, resolved from analysis_run_source,
// preferred over the Scope C current-revision-at-apply-time fallback. ───────
describe("applyReviewPlan — exact analyzed revision (Scope E)", () => {
  it("revision drift: the run's analyzed revision (A) is persisted even though the document's current revision is now B", async () => {
    seedDocument("doc-e1", "rev-e1-B"); // B is CURRENT at apply time
    seedRevision("rev-e1-A", "doc-e1"); // the revision actually analyzed — no longer current
    seedRevision("rev-e1-B", "doc-e1");
    seedRunSource("run-e1", "doc-e1", "rev-e1-A"); // durable record: run-e1 analyzed rev-e1-A

    const it_ = reviewItem({
      id: "ri-e1", reviewStatus: "VERIFIED",
      ai: ai({ key: "W-e1", item: "Window — drift", quantity: 4, source: { documentId: "doc-e1", page: 2, evidence: [] } }),
    });
    const plan = buildApplyPlan([it_], []);
    expect(plan[0].classification).toBe("NEW_LINE");

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-e1"]), runId: "run-e1" });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_revision_id).toBe("rev-e1-A");
    expect(row.source_revision_id).not.toBe("rev-e1-B");
    expect(row.source_document_id).toBe("doc-e1");
    expect(row.source_page).toBe("2");
  });

  it("a run-source claim naming a revision owned by a DIFFERENT document is rejected — never persisted, never used in place of the (absent) fallback", async () => {
    seedDocument("doc-e2", null); // no current revision either — isolates the ownership rejection
    seedRevision("rev-e2-foreign", "doc-OTHER"); // exists, but NOT owned by doc-e2
    seedRunSource("run-e2", "doc-e2", "rev-e2-foreign");

    const it_ = reviewItem({
      id: "ri-e2", reviewStatus: "VERIFIED",
      ai: ai({ key: "W-e2", item: "Window — cross-doc claim", quantity: 3, source: { documentId: "doc-e2", page: 5, evidence: [] } }),
    });
    const plan = buildApplyPlan([it_], []);

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-e2"]), runId: "run-e2" });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_revision_id).toBeNull();
    expect(row.source_revision_id).not.toBe("rev-e2-foreign");
    expect(row.source_document_id).toBe("doc-e2");
    expect(row.source_page).toBe("5");
  });

  it("no analysis_run_source record at all: the existing current-revision fallback behaves exactly as before Scope E", async () => {
    seedDocument("doc-e3", "rev-e3-current");
    seedRevision("rev-e3-current", "doc-e3");
    // Deliberately no seedRunSource call — models a json_import run, or an
    // ai_api run from before this plumbing existed.

    const it_ = reviewItem({
      id: "ri-e3", reviewStatus: "VERIFIED",
      ai: ai({ key: "W-e3", item: "Window — no run-source row", quantity: 1, source: { documentId: "doc-e3", page: null, evidence: [] } }),
    });
    const plan = buildApplyPlan([it_], []);

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-e3"]), runId: "run-e3-unclaimed" });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_revision_id).toBe("rev-e3-current");
  });

  it("a run-source claim with no SUCCEEDED status is never trusted, even if it names an otherwise-valid revision — falls back safely", async () => {
    seedDocument("doc-e4", "rev-e4-current");
    seedRevision("rev-e4-current", "doc-e4");
    seedRevision("rev-e4-failed-claim", "doc-e4"); // a real, owned revision — but the claim for it never succeeded
    seedRunSource("run-e4", "doc-e4", "rev-e4-failed-claim", "FAILED");

    const it_ = reviewItem({
      id: "ri-e4", reviewStatus: "VERIFIED",
      ai: ai({ key: "W-e4", item: "Window — unsucceeded claim", quantity: 2, source: { documentId: "doc-e4", page: 1, evidence: [] } }),
    });
    const plan = buildApplyPlan([it_], []);

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-e4"]), runId: "run-e4" });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    // The FAILED claim's revision is never used — the safe fallback (current
    // revision) is used instead, exactly as if no claim existed at all.
    expect(row.source_revision_id).toBe("rev-e4-current");
    expect(row.source_revision_id).not.toBe("rev-e4-failed-claim");
  });

  it("conflicting run-source records (two DIFFERENT revisions for the same run+document) never arbitrarily pick one, and never fall back to current-revision either", async () => {
    seedDocument("doc-e5", "rev-e5-current");
    seedRevision("rev-e5-current", "doc-e5");
    seedRevision("rev-e5-X", "doc-e5");
    seedRevision("rev-e5-Y", "doc-e5");
    seedRunSource("run-e5", "doc-e5", "rev-e5-X");
    seedRunSource("run-e5", "doc-e5", "rev-e5-Y"); // contradicts the row above — same run+document, different revision

    const it_ = reviewItem({
      id: "ri-e5", reviewStatus: "VERIFIED",
      ai: ai({ key: "W-e5", item: "Window — conflicting claims", quantity: 6, source: { documentId: "doc-e5", page: 9, evidence: [] } }),
    });
    const plan = buildApplyPlan([it_], []);

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-e5"]), runId: "run-e5" });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_revision_id).toBeNull();
    expect(row.source_revision_id).not.toBe("rev-e5-X");
    expect(row.source_revision_id).not.toBe("rev-e5-Y");
    // Critically, NOT the fallback either — conflicting evidence stops here,
    // it does not quietly resolve to "whatever is current right now."
    expect(row.source_revision_id).not.toBe("rev-e5-current");
    // Document/page provenance is still preserved despite the revision conflict.
    expect(row.source_document_id).toBe("doc-e5");
    expect(row.source_page).toBe("9");
  });

  it("APPLY (matched line ALREADY has a source): preserved under Scope E exactly as under Scope C — the update patch carries no source keys at all, even with a perfectly valid run-source claim available", async () => {
    seedDocument("doc-e6", "rev-e6-current");
    seedRevision("rev-e6-current", "doc-e6");
    seedRevision("rev-e6-analyzed", "doc-e6");
    seedRunSource("run-e6", "doc-e6", "rev-e6-analyzed"); // a valid, resolvable claim — but must still be ignored

    const it_ = reviewItem({
      id: "ri-e6",
      ai: ai({ key: "W-e6", quantity: 11, unit: "nos", source: { documentId: "doc-e6", page: 4, evidence: [] } }),
      reviewStatus: "EDITED", reviewer: { quantity: 11 },
    });
    const lines = [{ id: "line-e6", external_key: "W-e6", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: null, source_document_id: "doc-already-sourced" }];
    const plan = buildApplyPlan([it_], lines);
    expect(plan[0].classification).toBe("APPLY");
    expect(plan[0].source).toBeUndefined(); // preserve-by-default already decided this upstream of any revision resolution
    seedLine("line-e6", 7, "nos");

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-e6"]), runId: "run-e6" });

    const updateCall = calls.find((c) => c.table === "boq_line" && c.op === "update")!;
    const patch = updateCall.payload as Record<string, unknown>;
    expect("source_document_id" in patch).toBe(false);
    expect("source_revision_id" in patch).toBe(false);
    expect("source_page" in patch).toBe(false);
    expect(patch.qty).toBe(11);
  });

  it("NEW_LINE: document, page, and the exact analyzed revision are all persisted together", async () => {
    seedDocument("doc-e7", "rev-e7-current");
    seedRevision("rev-e7-current", "doc-e7");
    seedRevision("rev-e7-analyzed", "doc-e7");
    seedRunSource("run-e7", "doc-e7", "rev-e7-analyzed");

    const it_ = reviewItem({
      id: "ri-e7", reviewStatus: "VERIFIED",
      ai: ai({ key: "W-e7", item: "Window — full triple", quantity: 8, source: { documentId: "doc-e7", page: 12, evidence: [] } }),
    });
    const plan = buildApplyPlan([it_], []);

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-e7"]), runId: "run-e7" });
    expect(result.appliedCount).toBe(1);

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_document_id).toBe("doc-e7");
    expect(row.source_page).toBe("12");
    expect(row.source_revision_id).toBe("rev-e7-analyzed");
  });

  it("multiple analysis runs over the SAME document: a review item from run A never uses run B's analyzed-revision record", async () => {
    seedDocument("doc-e8", "rev-e8-current");
    seedRevision("rev-e8-current", "doc-e8");
    seedRevision("rev-e8-A", "doc-e8");
    seedRevision("rev-e8-B", "doc-e8");
    seedRunSource("run-e8-A", "doc-e8", "rev-e8-A");
    seedRunSource("run-e8-B", "doc-e8", "rev-e8-B");

    const itemA = reviewItem({
      id: "ri-e8-A", reviewStatus: "VERIFIED",
      ai: ai({ key: "W-e8-A", item: "Window — run A", quantity: 1, source: { documentId: "doc-e8", page: 1, evidence: [] } }),
    });
    const planA = buildApplyPlan([itemA], []);
    await applyReviewPlan({ boqId: "boq-1", candidates: planA, selectedIds: new Set(["ri-e8-A"]), runId: "run-e8-A" });
    const rowA = calls.filter((c) => c.table === "boq_line" && c.op === "insert").at(-1)!.payload as Record<string, unknown>;
    expect(rowA.source_revision_id).toBe("rev-e8-A");

    const itemB = reviewItem({
      id: "ri-e8-B", reviewStatus: "VERIFIED",
      ai: ai({ key: "W-e8-B", item: "Window — run B", quantity: 1, source: { documentId: "doc-e8", page: 1, evidence: [] } }),
    });
    const planB = buildApplyPlan([itemB], []);
    await applyReviewPlan({ boqId: "boq-1", candidates: planB, selectedIds: new Set(["ri-e8-B"]), runId: "run-e8-B" });
    const rowB = calls.filter((c) => c.table === "boq_line" && c.op === "insert").at(-1)!.payload as Record<string, unknown>;
    expect(rowB.source_revision_id).toBe("rev-e8-B");
    expect(rowB.source_revision_id).not.toBe("rev-e8-A");
  });
});
