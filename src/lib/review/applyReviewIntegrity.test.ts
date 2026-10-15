// APPLY × BOQ INTEGRITY — two defects seen in the live test (2026-10-14):
//   1. A second analysis run's "D1" (qty 1, location "Entrance Lobby") was
//      classified NEW_LINE although the BOQ already held D1 = 1 scoped
//      "Ground Floor" — applying it would have counted D1 twice.
//   2. Applying "W1" (location "Various rooms") created a project_scope named
//      "Various rooms" from the model's free text.
// A location is trusted as a scope only when it names an existing project
// scope; anything else is left for the reviewer, and Apply never creates one.
//
// SIMULATED: in-memory tables (same stand-in as applyReviewFreshness.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let insertHook: ((table: string, row: Row) => void) | null = null;
let failInsertOn: string | null = null; // a table whose inserts fail (e.g. missing in production)
let nextLine = 1;

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    boq: [{ id: "boq-1", project_id: "project-1" }],
    project_document: [], document_revision: [], analysis_run_source: [], boq_line: [], boq_line_change_log: [], project_scope: [],
  });
  insertHook = null;
  failInsertOn = null;
  nextLine = 1;
}

function query(table: string, filters: ((r: Row) => boolean)[] = []) {
  const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  return {
    eq: (c: string, v: unknown) => query(table, [...filters, (r) => r[c] === v]),
    in: (c: string, vs: unknown[]) => query(table, [...filters, (r) => vs.includes(r[c])]),
    not: (c: string) => query(table, [...filters, (r) => r[c] != null]),
    limit: () => query(table, filters),
    single: async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: rows()[0] ? null : { message: "no rows" } }),
    maybeSingle: async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: null }),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows().map((r) => ({ ...r })), error: null }).then(ok, bad),
  };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: () => query(table),
      insert: (payload: Row | Row[]) => {
        if (table === failInsertOn) {
          return { then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
            Promise.resolve({ error: { code: "PGRST205", message: `Could not find the table 'public.${table}'` } }).then(ok, bad) };
        }
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => (table === "boq_line" ? { id: `line-${nextLine++}`, ...r } : { ...r }));
        db[table].push(...rows);
        for (const r of rows) insertHook?.(table, r);
        const result = { data: { id: rows[0]?.id }, error: null };
        return {
          select: () => ({ single: async () => result }),
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
            Promise.resolve({ error: table === failInsertOn ? { code: "PGRST205", message: `Could not find the table 'public.${table}'` } : null }).then(ok, bad),
        };
      },
    }),
  },
}));

import { buildApplyPlan, applyReviewPlan, classifyReviewItem, type BoqLineForApply } from "./applyReview";
import type { StoredReviewItem } from "./reviewStore";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

function doc(id: string, current: string | null, revisions: string[]) {
  db.project_document.push({ id, project_id: "project-1", name: id.toUpperCase(), current_revision_id: current });
  for (const r of revisions) db.document_revision.push({ id: r, document_id: id, label: r, file_path: `drawings/${r}.pdf` });
}
const claim = (runId: string, documentId: string, revisionId: string) =>
  db.analysis_run_source.push({ analysis_run_id: runId, document_id: documentId, document_revision_id: revisionId, status: "SUCCEEDED" });

const item = (id: string, key: string, documentId?: string): StoredReviewItem => ({
  id, reviewStatus: "VERIFIED",
  ai: {
    key, item: `Item ${key}`, quantity: 3, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    ...(documentId ? { source: { documentId, page: 2, evidence: [] } } : {}),
  } as AnalysisItemV1,
});
const plan = (...items: StoredReviewItem[]) => buildApplyPlan(items, []);
const all = (...ids: string[]) => new Set(ids);

beforeEach(reset);

const reviewed = (id: string, key: string, location: string | null, reviewer?: Record<string, unknown>): StoredReviewItem => ({
  id, reviewStatus: reviewer ? "EDITED" : "VERIFIED",
  ai: { key, item: `Item ${key}`, quantity: 1, unit: "nos", confidence: 0.9, aiStatus: "MEASURED", ...(location ? { location } : {}) } as AnalysisItemV1,
  ...(reviewer ? { reviewer } : {}),
} as StoredReviewItem);
const groundD1: BoqLineForApply = { id: "line-d1", external_key: "D1", qty: 1, unit: "nos", quantity_status: "MEASURED", scope_name: "Ground Floor", source_document_id: "doc-a" } as BoqLineForApply;
const SCOPES = ["Ground Floor", "First Floor"];

describe("repeated analysis never silently double-counts an existing mark", () => {
  it("live reproduction: same mark, room-name location -> AMBIGUOUS against the existing line, not NEW_LINE", () => {
    const c = classifyReviewItem(reviewed("ri", "D1", "Entrance Lobby"), [groundD1], SCOPES);
    expect(c.classification).toBe("AMBIGUOUS");
    expect(c.candidateLineIds).toEqual(["line-d1"]);
    expect(c.reason).toContain("Entrance Lobby");
  });

  it("same mark with no location -> AMBIGUOUS (with or without the scope list)", () => {
    expect(classifyReviewItem(reviewed("ri", "D1", null), [groundD1], SCOPES).classification).toBe("AMBIGUOUS");
    expect(classifyReviewItem(reviewed("ri", "D1", null), [groundD1]).classification).toBe("AMBIGUOUS");
  });

  it("same mark on ANOTHER existing scope is a genuinely different line -> NEW_LINE", () => {
    const c = classifyReviewItem(reviewed("ri", "D1", "First Floor"), [groundD1], SCOPES);
    expect(c.classification).toBe("NEW_LINE");
    expect(c.newLine?.location).toBe("First Floor");
  });

  it("reviewer resolves it by setting the location to the existing scope -> matched, no second line", () => {
    const c = classifyReviewItem(reviewed("ri", "D1", "Entrance Lobby", { location: "Ground Floor" }), [groundD1], SCOPES);
    expect(c.classification).toBe("NO_CHANGE");
    expect(c.matchedLineId).toBe("line-d1");
  });

  it("Apply of an AMBIGUOUS candidate writes nothing even if its id is selected", async () => {
    db.boq_line.push({ id: "line-d1", boq_id: "boq-1", external_key: "D1", qty: 1, unit: "nos" });
    const plan = buildApplyPlan([reviewed("ri", "D1", "Entrance Lobby")], [groundD1], SCOPES);
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: all("ri") });
    expect(res.appliedCount).toBe(0);
    expect(db.boq_line).toHaveLength(1);
  });
});

describe("unverified location text never creates a project scope", () => {
  it("live reproduction: a new line located 'Various rooms' -> CANNOT_APPLY until resolved", () => {
    const c = classifyReviewItem(reviewed("ri", "W1", "Various rooms"), [], SCOPES);
    expect(c.classification).toBe("CANNOT_APPLY");
    expect(c.reason).toContain("Various rooms");
  });

  it("resolved by the reviewer: an existing scope is used; a cleared location gives an unscoped line", () => {
    const toScope = classifyReviewItem(reviewed("ri", "W1", "Various rooms", { location: "Ground Floor" }), [], SCOPES);
    expect(toScope.classification).toBe("NEW_LINE");
    expect(toScope.newLine?.location).toBe("Ground Floor");
    expect(toScope.unsupportedChanges).toEqual([]);
    const cleared = classifyReviewItem(reviewed("ri", "W1", "Various rooms", { location: "" }), [], SCOPES);
    expect(cleared.classification).toBe("NEW_LINE");
    expect(cleared.newLine?.location).toBeNull();
  });

  it("Apply (even from a plan built without the scope list) creates no scope and writes no line for unknown text", async () => {
    const plan = buildApplyPlan([reviewed("ri", "W1", "Various rooms")], []);
    expect(plan[0].classification).toBe("NEW_LINE"); // legacy caller: no scope list to judge by
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: all("ri") });
    expect(res.appliedCount).toBe(0);
    expect(res.conflictedReviewItemIds).toEqual(["ri"]);
    expect(db.project_scope).toHaveLength(0);
    expect(db.boq_line).toHaveLength(0);
  });

  it("Apply files a new line under the existing scope it names, creating nothing", async () => {
    db.project_scope.push({ id: "scope-g", project_id: "project-1", name: "Ground Floor" });
    const plan = buildApplyPlan([reviewed("ri", "W1", "Ground Floor")], [], SCOPES);
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: all("ri") });
    expect(res.appliedCount).toBe(1);
    expect(db.project_scope).toHaveLength(1);
    expect(db.boq_line[0]).toMatchObject({ external_key: "W1", scope_id: "scope-g", qty: 1 });
  });
});
