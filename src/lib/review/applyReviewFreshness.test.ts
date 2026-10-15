// APPLY × REVISION FRESHNESS — applyReviewPlan's pre-write freshness gate and
// post-write re-check (revisionFreshness.ts), run through the REAL
// applyReviewPlan against a small mutable stand-in for the Supabase client.
//
// SIMULATED: the "database" below is an in-memory array per table. It proves
// the order of reads and writes inside applyReviewPlan and what is (not)
// written; it does not prove PostgREST/Postgres behaviour, RLS, or real
// concurrency between two browser sessions.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let insertHook: ((table: string, row: Row) => void) | null = null;
let nextLine = 1;

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    boq: [{ id: "boq-1", project_id: "project-1" }],
    project_document: [], document_revision: [], analysis_run_source: [], boq_line: [], boq_line_change_log: [], project_scope: [],
  });
  insertHook = null;
  nextLine = 1;
}

function query(table: string, filters: ((r: Row) => boolean)[] = []) {
  const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  return {
    eq: (c: string, v: unknown) => query(table, [...filters, (r) => r[c] === v]),
    in: (c: string, vs: unknown[]) => query(table, [...filters, (r) => vs.includes(r[c])]),
    not: (c: string) => query(table, [...filters, (r) => r[c] != null]),
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
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => (table === "boq_line" ? { id: `line-${nextLine++}`, ...r } : { ...r }));
        db[table].push(...rows);
        for (const r of rows) insertHook?.(table, r);
        const result = { data: { id: rows[0]?.id }, error: null };
        return {
          select: () => ({ single: async () => result }),
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ error: null }).then(ok, bad),
        };
      },
    }),
  },
}));

import { buildApplyPlan, applyReviewPlan } from "./applyReview";
import { AnalysisRevisionBlockedError, assessRunFreshness, currentRevisionSnapshot } from "./revisionFreshness";
import type { StoredReviewItem } from "./reviewStore";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

function doc(id: string, current: string | null, revisions: string[]) {
  db.project_document.push({ id, project_id: "project-1", name: id.toUpperCase(), current_revision_id: current });
  for (const r of revisions) db.document_revision.push({ id: r, document_id: id, label: r, file_path: `drawings/${r}.pdf` });
}
const claim = (runId: string, documentId: string, revisionId: string) =>
  db.analysis_run_source.push({ analysis_run_id: runId, document_id: documentId, document_revision_id: revisionId, status: "SUCCEEDED" });
const setCurrent = (documentId: string, revisionId: string | null) => {
  db.project_document.find((d) => d.id === documentId)!.current_revision_id = revisionId;
};

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

describe("applyReviewPlan — revision freshness gate", () => {
  it("current AI run: Apply proceeds and records the analysed revision (existing valid behaviour unchanged)", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    claim("run-1", "doc-a", "rev-a1");

    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-a")), selectedIds: all("ri-1"), runId: "run-1" });

    expect(res.appliedCount).toBe(1);
    expect(res.revisionChangedDuringApply).toEqual([]);
    expect(db.boq_line).toHaveLength(1);
    expect(db.boq_line[0]).toMatchObject({ source_document_id: "doc-a", source_revision_id: "rev-a1", source_page: "2", qty: 3 });
    expect(db.boq_line_change_log.length).toBeGreaterThan(0);
  });

  it("superseded AI run: refused before any write, naming the analysed and the current revision", async () => {
    doc("doc-a", "rev-a2", ["rev-a1", "rev-a2"]);
    claim("run-1", "doc-a", "rev-a1");

    const err = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-a")), selectedIds: all("ri-1"), runId: "run-1" }).catch((e) => e);

    expect(err).toBeInstanceOf(AnalysisRevisionBlockedError);
    expect(err.message).toContain("this analysis read rev-a1, but the current revision is now rev-a2");
    expect(err.message).toContain("Re-analyse");
    expect(db.boq_line).toHaveLength(0);
    expect(db.boq_line_change_log).toHaveLength(0);
  });

  it("unknown-provenance JSON import (no run-source claim): refused — never attributed to the current revision", async () => {
    doc("doc-a", "rev-a2", ["rev-a1", "rev-a2"]);
    // json_import creates no analysis_run_source rows.

    const err = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-a")), selectedIds: all("ri-1"), runId: "run-json" }).catch((e) => e);

    expect(err).toBeInstanceOf(AnalysisRevisionBlockedError);
    expect((err as AnalysisRevisionBlockedError).freshness.sources).toMatchObject([{ documentId: "doc-a", state: "unknown", analyzedRevision: null }]);
    expect(db.boq_line).toHaveLength(0);
  });

  it("JSON import whose items name no document and has no re-linked drawing: no provenance is claimed, so Apply proceeds with no source", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);

    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1")), selectedIds: all("ri-1"), runId: "run-json", referencedDocumentIds: [] });

    expect(res.appliedCount).toBe(1);
    expect(db.boq_line[0]).toMatchObject({ source_document_id: null, source_revision_id: null });
  });

  it("a document the reviewer's evidence resolved to (referencedDocumentIds) is assessed even when no candidate carries its id", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    // JSON item resolved to doc-a by filename in the workstation; no claim exists.

    const err = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1")), selectedIds: all("ri-1"), runId: "run-json", referencedDocumentIds: ["doc-a"] }).catch((e) => e);

    expect(err).toBeInstanceOf(AnalysisRevisionBlockedError);
    expect(db.boq_line).toHaveLength(0);
  });

  it("multiple documents with mixed freshness: one superseded source blocks the whole Apply, even for items from the current source", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    doc("doc-b", "rev-b2", ["rev-b1", "rev-b2"]);
    claim("run-1", "doc-a", "rev-a1");
    claim("run-1", "doc-b", "rev-b1");

    // Only doc-a's item is selected — doc-b is still one of the run's sources.
    const err = await applyReviewPlan({
      boqId: "boq-1", candidates: plan(item("ri-a", "WA", "doc-a"), item("ri-b", "WB", "doc-b")), selectedIds: all("ri-a"), runId: "run-1",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AnalysisRevisionBlockedError);
    expect((err as AnalysisRevisionBlockedError).freshness.sources.map((s) => [s.documentId, s.state])).toEqual([["doc-a", "current"], ["doc-b", "superseded"]]);
    expect(err.message).toContain("DOC-B");
    expect(err.message).not.toContain("DOC-A");
    expect(db.boq_line).toHaveLength(0);
  });

  it("multiple documents, one known-current and one unknown: the unknown source is not hidden by the valid one", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    doc("doc-c", "rev-c1", ["rev-c1"]);
    claim("run-1", "doc-a", "rev-a1");

    const err = await applyReviewPlan({
      boqId: "boq-1", candidates: plan(item("ri-a", "WA", "doc-a"), item("ri-c", "WC", "doc-c")), selectedIds: all("ri-a", "ri-c"), runId: "run-1",
    }).catch((e) => e);

    expect((err as AnalysisRevisionBlockedError).freshness.sources.map((s) => [s.documentId, s.state])).toEqual([["doc-a", "current"], ["doc-c", "unknown"]]);
    expect(db.boq_line).toHaveLength(0);
  });

  it("race — revision changes between the reviewer's freshness check and Apply: refused before any write", async () => {
    doc("doc-a", "rev-a1", ["rev-a1", "rev-a2"]);
    claim("run-1", "doc-a", "rev-a1");
    const shown = await assessRunFreshness({ runId: "run-1", projectId: "project-1", referencedDocumentIds: ["doc-a"] });
    expect(shown.applyBlocked).toBe(false);

    setCurrent("doc-a", "rev-a2"); // someone switches the current revision while the dialog is open

    const err = await applyReviewPlan({
      boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-a")), selectedIds: all("ri-1"), runId: "run-1",
      referencedDocumentIds: ["doc-a"], expectedCurrentRevisionIds: currentRevisionSnapshot(shown),
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AnalysisRevisionBlockedError);
    expect(db.boq_line).toHaveLength(0);
  });

  it("race — a snapshot that differs from what Apply re-reads is refused even when the re-read alone would pass", async () => {
    doc("doc-a", "rev-a1", ["rev-a1", "rev-a0"]);
    claim("run-1", "doc-a", "rev-a1");

    const err = await applyReviewPlan({
      boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-a")), selectedIds: all("ri-1"), runId: "run-1",
      expectedCurrentRevisionIds: { "doc-a": "rev-a0" }, // the reviewer was shown a different current revision
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AnalysisRevisionBlockedError);
    expect(err.message).toContain("changed after this review was checked");
    expect(db.boq_line).toHaveLength(0);
  });

  it("race — revision changes WHILE Apply is writing: reported in the result, and the written line still records the analysed revision", async () => {
    doc("doc-a", "rev-a1", ["rev-a1", "rev-a2"]);
    claim("run-1", "doc-a", "rev-a1");
    insertHook = (table) => { if (table === "boq_line") setCurrent("doc-a", "rev-a2"); };

    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-a")), selectedIds: all("ri-1"), runId: "run-1" });

    expect(res.appliedCount).toBe(1);
    expect(res.revisionChangedDuringApply).toEqual(["DOC-A"]);
    expect(db.boq_line[0].source_revision_id).toBe("rev-a1"); // never the newer revision
  });

  it("no runId (the offline harness / legacy callers): no freshness queries and behaviour exactly as before", async () => {
    doc("doc-a", "rev-a2", ["rev-a1", "rev-a2"]);

    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-a")), selectedIds: all("ri-1") });

    expect(res.appliedCount).toBe(1);
    expect(res.revisionChangedDuringApply).toBeUndefined();
    expect(db.boq_line[0]).toMatchObject({ source_document_id: "doc-a", source_revision_id: "rev-a2" });
  });

  it("nothing selected: no freshness check and no writes", async () => {
    doc("doc-a", "rev-a2", ["rev-a1", "rev-a2"]);
    claim("run-1", "doc-a", "rev-a1");

    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-a")), selectedIds: all(), runId: "run-1" });

    expect(res.appliedCount).toBe(0);
    expect(db.boq_line).toHaveLength(0);
  });
});
