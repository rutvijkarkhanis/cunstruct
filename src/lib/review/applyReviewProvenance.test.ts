// APPLY × SOURCE PROVENANCE — applyReviewPlan attributes a line to the run's
// verified analysis_run_source document, never to the model's own
// source.documentId. Regression for the live failure where gpt-4o-mini wrote
// a filename ("arab-creators-shop-drawings-sample-set.pdf") as documentId and
// Apply failed with Postgres 22P02.
//
// SIMULATED: in-memory tables, same stand-in as applyReviewFreshness.test.ts.
// Proves what is (not) written; not PostgREST/Postgres behaviour or RLS.

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

import { buildApplyPlan, applyReviewPlan, SourceProvenanceError } from "./applyReview";
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

const FILENAME = "arab-creators-shop-drawings-sample-set.pdf";

describe("applyReviewPlan — source provenance from the verified run source", () => {
  it("valid: the model's id is the claimed document — written with that document and the analysed revision", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    claim("run-1", "doc-a", "rev-a1");
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1", "doc-a")), selectedIds: all("ri-1"), runId: "run-1" });
    expect(res.appliedCount).toBe(1);
    expect(db.boq_line[0]).toMatchObject({ source_document_id: "doc-a", source_revision_id: "rev-a1", source_page: "2" });
  });

  it("malformed: a filename as documentId (the live failure) — attributed to the run's single verified document", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    claim("run-1", "doc-a", "rev-a1");
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1", FILENAME)), selectedIds: all("ri-1"), runId: "run-1" });
    expect(res.appliedCount).toBe(1);
    expect(db.boq_line).toHaveLength(1);
    expect(db.boq_line[0]).toMatchObject({ source_document_id: "doc-a", source_revision_id: "rev-a1", source_page: "2" });
    expect(JSON.stringify(db.boq_line)).not.toContain(FILENAME);
  });

  it("missing: no source on the item — the new line is attributed to the run's single verified document, page unknown", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    claim("run-1", "doc-a", "rev-a1");
    await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1")), selectedIds: all("ri-1"), runId: "run-1" });
    expect(db.boq_line[0]).toMatchObject({ source_document_id: "doc-a", source_revision_id: "rev-a1", source_page: null });
  });

  it("ambiguous: several verified documents and a filename — refused, nothing written", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    doc("doc-b", "rev-b1", ["rev-b1"]);
    claim("run-1", "doc-a", "rev-a1");
    claim("run-1", "doc-b", "rev-b1");
    const err = await applyReviewPlan({
      boqId: "boq-1", candidates: plan(item("ri-ok", "W1", "doc-b"), item("ri-bad", "D1", FILENAME)), selectedIds: all("ri-ok", "ri-bad"), runId: "run-1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceProvenanceError);
    expect((err as SourceProvenanceError).reviewItemIds).toEqual(["ri-bad"]);
    expect(err.message).toContain("Nothing was applied");
    expect(db.boq_line).toHaveLength(0); // the resolvable item is not written either
    expect(db.boq_line_change_log).toHaveLength(0);
  });

  it("ambiguous: several verified documents and no source on a new line — refused, nothing written", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    doc("doc-b", "rev-b1", ["rev-b1"]);
    claim("run-1", "doc-a", "rev-a1");
    claim("run-1", "doc-b", "rev-b1");
    const err = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1")), selectedIds: all("ri-1"), runId: "run-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceProvenanceError);
    expect(db.boq_line).toHaveLength(0);
  });

  it("several verified documents and an exact id for one of them — written with that document", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    doc("doc-b", "rev-b1", ["rev-b1"]);
    claim("run-1", "doc-a", "rev-a1");
    claim("run-1", "doc-b", "rev-b1");
    await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "W1", "doc-b")), selectedIds: all("ri-1"), runId: "run-1" });
    expect(db.boq_line[0]).toMatchObject({ source_document_id: "doc-b", source_revision_id: "rev-b1" });
  });

  it("a claim for a document of another project is not verified provenance — refused, nothing written", async () => {
    db.project_document.push({ id: "doc-x", project_id: "project-2", name: "X", current_revision_id: "rev-x1" });
    db.document_revision.push({ id: "rev-x1", document_id: "doc-x" });
    claim("run-1", "doc-x", "rev-x1");
    const err = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1", FILENAME)), selectedIds: all("ri-1"), runId: "run-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error); // the freshness gate refuses it first (unknown source)
    expect(db.boq_line).toHaveLength(0);
  });

  it("run with no claims (json_import): an unknown id is refused instead of failing in the database", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    const err = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1", FILENAME)), selectedIds: all("ri-1"), runId: "run-j" }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceProvenanceError);
    expect(db.boq_line).toHaveLength(0);
  });

  it("run with no claims (json_import): a real project document id is still blocked by the freshness gate (unchanged)", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    const err = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1", "doc-a")), selectedIds: all("ri-1"), runId: "run-j" }).catch((e) => e);
    expect(err).not.toBeInstanceOf(SourceProvenanceError);
    expect(err).toBeInstanceOf(Error);
    expect(db.boq_line).toHaveLength(0);
  });

  it("nothing selected: no provenance lookup failure and no write", async () => {
    claim("run-1", "doc-a", "rev-a1");
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1", FILENAME)), selectedIds: all(), runId: "run-1" });
    expect(res.appliedCount).toBe(0);
    expect(db.boq_line).toHaveLength(0);
  });
});

describe("applyReviewPlan — audit-log write failure is reported, never silent", () => {
  it("missing boq_line_change_log: the line is saved and the item is reported unaudited", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    claim("run-1", "doc-a", "rev-a1");
    failInsertOn = "boq_line_change_log";
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1", "doc-a"), item("ri-2", "FS1", "doc-a")), selectedIds: all("ri-1", "ri-2"), runId: "run-1" });
    expect(res.appliedCount).toBe(2);
    expect(db.boq_line).toHaveLength(2);
    expect(db.boq_line_change_log).toHaveLength(0);
    expect(res.auditLogFailedReviewItemIds).toEqual(["ri-1", "ri-2"]);
  });

  it("audit rows written: nothing reported unaudited", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]);
    claim("run-1", "doc-a", "rev-a1");
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan(item("ri-1", "D1", "doc-a")), selectedIds: all("ri-1"), runId: "run-1" });
    expect(res.auditLogFailedReviewItemIds).toEqual([]);
    expect(db.boq_line_change_log.length).toBeGreaterThan(0);
  });
});
