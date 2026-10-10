// Drawing-source audit — deleted/unavailable source document at Apply time.
//
// applyReviewPlan.test.ts's own mock never enforces the real FK constraint
// boq_line.source_document_id actually has (references project_document(id)
// — see 20260901000000_project_workspace.sql) — its boq_line insert/update
// mocks succeed unconditionally regardless of payload. That means a genuine
// Postgres foreign-key violation (23503) — e.g. the AI item's source document
// was deleted between analysis and the reviewer clicking Apply — had never
// been exercised against the real applyReviewPlan/sourcePatchFor code path.
//
// Running that scenario against the pre-fix code surfaced a real defect, not
// a hypothetical: applyFinding.ts's OPTIONAL_COL_RE matched the bare
// substring "source_document_id" wherever it appeared — including inside the
// Postgres-generated constraint name of an FK-violation error
// ("boq_line_source_document_id_fkey") — and misread that as "this
// deployment hasn't migrated this column yet." Its fallback then silently
// retried the write with SIX columns stripped (basis, basis_note,
// external_key, measurement_method, quantity_status, scope_id — not just the
// one actually implicated), reporting a clean success with no error and no
// trace of what was dropped. Fixed two ways: (1) OPTIONAL_COL_RE now matches
// only the genuine "column doesn't exist" phrasing, never a bare column
// name; (2) applyReviewPlan's sourcePatchFor now checks the source document
// still exists before proposing it, so the FK write is never attempted in
// the first place — qty/unit (and every other field) still applies cleanly,
// the source is simply omitted, exactly like "no source on the item at all".
//
// This file models the FK honestly: `liveDocuments` is the mock's
// "project_document still exists" set, and the boq_line insert/update mocks
// reject with a realistic 23503 error when source_document_id is set to an
// id NOT in that set — exactly what the real database would do.
//
// Review follow-up (N1/N2): the original fix's documentStillExists checked
// only "does this id exist ANYWHERE in project_document" — not scoped to
// this boq's own project — and discarded the query's error, so a transient
// DB failure read identically to "document deleted". liveDocuments is now a
// documentId -> ownerProjectId map (not a flat set) so the cross-project
// case can be modeled honestly, and projectDocumentQueryError lets a test
// force the existence check itself to fail.
import { describe, it, expect, beforeEach, vi } from "vitest";

interface Call { table: string; op: "insert" | "update"; payload: unknown; lineId?: string }
const calls: Call[] = [];
// Every test's boq ("boq-1") belongs to this project.
const BOQ_PROJECT_ID = "project-1";
// documentId -> the project it actually lives in. Absent entirely = deleted/
// never existed. Present with a DIFFERENT project id = exists, but not in
// this boq's project (N1's cross-project case).
const liveDocuments = new Map<string, string>();
// Set by a test to make the project_document existence check fail with an
// unexpected query error, instead of "not found" — models a transient
// network/RLS failure, never "the document is gone" (N2).
let projectDocumentQueryError: { message: string } | null = null;
const boqLineStore = new Map<string, { qty: number; unit: string | null }>();
function seedLine(id: string, qty: number, unit: string | null) { boqLineStore.set(id, { qty, unit }); }

function fkViolation(column: string) {
  return { code: "23503", message: `insert or update on table "boq_line" violates foreign key constraint "boq_line_${column}_fkey"` };
}

function selectBuilder(table: string, filters: Record<string, unknown> = {}) {
  return {
    eq: (col: string, val: unknown) => selectBuilder(table, { ...filters, [col]: val }),
    not: () => selectBuilder(table, filters),
    // documentStillExists's resolveBoqProjectId call (applyReview.ts) is the
    // only query in this file terminated with .single() rather than
    // .maybeSingle() — mirrors the real supabase-js builder.
    single: async () => {
      if (table === "boq") return { data: { project_id: BOQ_PROJECT_ID }, error: null };
      return { data: null, error: null };
    },
    maybeSingle: async () => {
      const id = filters.id as string | undefined;
      if (table === "project_document") {
        if (projectDocumentQueryError) return { data: null, error: projectDocumentQueryError };
        const ownerProjectId = id ? liveDocuments.get(id) : undefined;
        const found = ownerProjectId != null && (filters.project_id === undefined || ownerProjectId === filters.project_id);
        return { data: found ? { id, current_revision_id: null } : null, error: null };
      }
      return { data: null, error: null };
    },
    then: (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: [], error: null }),
  };
}

function updateBuilder(table: string, payload: Record<string, unknown>, filters: Record<string, unknown> = {}) {
  const builder = {
    eq: (col: string, val: unknown) => updateBuilder(table, payload, { ...filters, [col]: val }),
    is: (col: string, val: unknown) => updateBuilder(table, payload, { ...filters, [col]: val }),
    select: () => resolveWrite(),
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      resolveWrite().then(onFulfilled, onRejected),
  };
  async function resolveWrite() {
    const sourceDocId = payload.source_document_id as string | null | undefined;
    if (sourceDocId && !liveDocuments.has(sourceDocId)) return { data: null, error: fkViolation("source_document_id") };
    const id = filters.id as string | undefined;
    if (id) {
      const current = boqLineStore.get(id) ?? { qty: 0, unit: null };
      boqLineStore.set(id, { ...current, ...payload } as typeof current);
      calls.push({ table, op: "update", payload, lineId: id });
    }
    return { data: id ? [{ id }] : [], error: null };
  }
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        const sourceDocId = payload.source_document_id as string | null | undefined;
        if (table === "boq_line" && sourceDocId && !liveDocuments.has(sourceDocId)) {
          const result = { data: null, error: fkViolation("source_document_id") };
          return { select: () => ({ single: async () => result }) };
        }
        calls.push({ table, op: "insert", payload });
        const result = table === "boq_line" ? { data: { id: "new-line-1" }, error: null } : { error: null };
        return {
          select: () => ({ single: async () => result }),
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled, onRejected),
        };
      },
      update: (payload: Record<string, unknown>) => updateBuilder(table, payload),
      select: () => selectBuilder(table),
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

beforeEach(() => {
  calls.length = 0;
  liveDocuments.clear();
  projectDocumentQueryError = null;
  boqLineStore.clear();
});

describe("applyReviewPlan — source document deleted between analysis and Apply (real FK behavior modeled)", () => {
  it("NEW_LINE: a deleted source document is omitted, never attempted — every other field still writes correctly", async () => {
    // doc-1 deliberately NOT added to liveDocuments — it was deleted after analysis ran.
    const it_ = reviewItem({
      id: "ri-1",
      ai: ai({ key: "W1", item: "Window W1", quantity: 4, unit: "nos", source: { documentId: "doc-1", page: 3, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([it_], []);
    expect(plan[0].classification).toBe("NEW_LINE");
    expect(plan[0].source).toEqual({ documentId: "doc-1", page: 3 }); // classification itself can't know the document is gone — no I/O

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-1"]) });
    expect(result).toEqual({ appliedCount: 1, skippedNoChange: 0, unresolvedCount: 0, conflictedReviewItemIds: [] });

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    // The source columns are correctly omitted/null — but nothing else was
    // silently dropped. Before the fix, external_key/basis/measurement_method/
    // quantity_status/scope_id were ALSO stripped by the same misfired fallback.
    expect(row.source_document_id ?? null).toBeNull();
    expect(row.source_revision_id ?? null).toBeNull();
    expect(row.source_page ?? null).toBeNull();
    expect(row.external_key).toBe("W1");
    expect(row.quantity_status).toBe("MEASURED");
    expect(row.qty).toBe(4);
    expect(row.unit).toBe("nos");
  });

  it("APPLY (matched line): a deleted source document is omitted — the qty/unit update for THIS line still succeeds", async () => {
    seedLine("line-1", 7, "nos");
    const it_ = reviewItem({
      id: "ri-2",
      ai: ai({ key: "W2", item: "Window W2", quantity: 10, unit: "nos", source: { documentId: "doc-gone", page: 1, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([it_], [{ id: "line-1", external_key: "W2", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: null, source_document_id: null }]);
    expect(plan[0].classification).toBe("APPLY");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-2"]) });
    expect(result.appliedCount).toBe(1);
    expect(result.conflictedReviewItemIds).toEqual([]);
    expect(boqLineStore.get("line-1")?.qty).toBe(10); // the qty change still applied

    const row = calls.find((c) => c.table === "boq_line" && c.op === "update")!.payload as Record<string, unknown>;
    expect(row).not.toHaveProperty("source_document_id");
  });

  it("one candidate's deleted source document does not abort a different, unrelated candidate in the same batch", async () => {
    liveDocuments.set("doc-live", BOQ_PROJECT_ID);
    const staleItem = reviewItem({
      id: "ri-3",
      ai: ai({ key: "W3", item: "Window W3", quantity: 2, unit: "nos", source: { documentId: "doc-gone", page: 1, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const liveItem = reviewItem({
      id: "ri-4",
      ai: ai({ key: "W4", item: "Window W4", quantity: 5, unit: "nos", source: { documentId: "doc-live", page: 2, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([staleItem, liveItem], []);
    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-3", "ri-4"]) });

    expect(result.appliedCount).toBe(2);
    expect(result.conflictedReviewItemIds).toEqual([]);
    const inserts = calls.filter((c) => c.table === "boq_line" && c.op === "insert").map((c) => c.payload as Record<string, unknown>);
    expect(inserts.find((r) => r.external_key === "W3")?.source_document_id ?? null).toBeNull();
    expect(inserts.find((r) => r.external_key === "W4")?.source_document_id).toBe("doc-live");
  });
});

// ── Review follow-up: documentStillExists must be project-scoped (N1) and
// must never mistake an unexpected query error for "document deleted" (N2). ──
describe("applyReviewPlan — source document existence check is project-scoped and error-safe", () => {
  it("N1: a document that exists in THIS boq's own project is accepted as live — provenance is written", async () => {
    liveDocuments.set("doc-same-project", BOQ_PROJECT_ID);
    const it_ = reviewItem({
      id: "ri-9",
      ai: ai({ key: "W9", item: "Window W9", quantity: 5, unit: "nos", source: { documentId: "doc-same-project", page: 2, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([it_], []);
    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-9"]) });
    expect(result.appliedCount).toBe(1);

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_document_id).toBe("doc-same-project");
  });

  it("N1: a document that exists GLOBALLY but belongs to a DIFFERENT project is treated as not verified — source omitted, qty/unit still applies", async () => {
    // "doc-cross-project" is genuinely live in project_document — just not in
    // THIS boq's project. A pre-fix, unscoped existence check would have
    // accepted it (the id exists "somewhere") and attempted to write it as
    // this boq's provenance, which the real project_document.project_id-scoped
    // world never intends.
    liveDocuments.set("doc-cross-project", "project-OTHER");
    seedLine("line-10", 6, "nos");
    const it_ = reviewItem({
      id: "ri-10",
      ai: ai({ key: "W10", item: "Window W10", quantity: 9, unit: "nos", source: { documentId: "doc-cross-project", page: 4, evidence: [] } }),
      reviewStatus: "EDITED", reviewer: { quantity: 9 },
    });
    const lines = [{ id: "line-10", external_key: "W10", qty: 6, unit: "nos", quantity_status: "MEASURED", scope_name: null, source_document_id: null }];
    const plan = buildApplyPlan([it_], lines);
    expect(plan[0].classification).toBe("APPLY");

    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-10"]) });
    expect(result.appliedCount).toBe(1);
    expect(boqLineStore.get("line-10")?.qty).toBe(9); // the qty change still applied

    const row = calls.find((c) => c.table === "boq_line" && c.op === "update")!.payload as Record<string, unknown>;
    expect(row).not.toHaveProperty("source_document_id");
  });

  it("N1: a document id that doesn't exist at all (in any project) is treated as not verified, same as before", async () => {
    // liveDocuments deliberately has no entry for "doc-never-existed".
    const it_ = reviewItem({
      id: "ri-11",
      ai: ai({ key: "W11", item: "Window W11", quantity: 3, unit: "nos", source: { documentId: "doc-never-existed", page: 1, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([it_], []);
    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-11"]) });
    expect(result.appliedCount).toBe(1);

    const row = calls.find((c) => c.table === "boq_line" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(row.source_document_id).toBeNull();
    expect(row.external_key).toBe("W11");
    expect(row.qty).toBe(3);
  });

  it("N2: an unexpected query error on the existence check is surfaced, never silently read as 'document deleted' — the whole batch fails instead of reporting a false partial success", async () => {
    projectDocumentQueryError = { message: "fetch failed: network error" };
    const failingItem = reviewItem({
      id: "ri-12",
      ai: ai({ key: "W12", item: "Window W12", quantity: 2, unit: "nos", source: { documentId: "doc-err", page: 1, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    // An unrelated, otherwise-trivially-successful candidate with NO source
    // at all, queued right after the failing one — if the query error were
    // ever swallowed instead of thrown, this candidate would still "apply"
    // and the call would resolve with appliedCount: 1, silently hiding that
    // the first candidate's source check actually failed with a real error.
    const healthyItem = reviewItem({
      id: "ri-13",
      ai: ai({ key: "W13", item: "Window W13", quantity: 4, unit: "nos" }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([failingItem, healthyItem], []);

    await expect(
      applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-12", "ri-13"]) }),
    ).rejects.toMatchObject({ message: "fetch failed: network error" });

    // The whole call rejected before returning any ApplyResult — so there is
    // no appliedCount for the caller to misread as success, and neither
    // candidate (including the unrelated healthy one) was ever written.
    expect(calls.filter((c) => c.table === "boq_line")).toHaveLength(0);
  });
});
