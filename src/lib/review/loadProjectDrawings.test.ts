// REGRESSION: rw-drawings must query document_revision by the FK-enforced
// `document_id` column, never by `current_revision_id` directly.
//
// current_revision_id is an intentional soft reference with no foreign key
// (see 20260901000000_project_workspace.sql: "avoids circular FK"). The
// original BoqReviewWorkstation query batched every project document's
// current_revision_id into one `document_revision.id IN (...)` lookup — one
// document with a stale/missing current_revision_id failed that whole batch,
// and because neither query's `error` was checked, the failure silently
// degraded to `[]`, blanking filePath for EVERY document in the project.
//
// This broke a pilot project in production: analysis_run.resolved_document_id
// correctly identified the document (its current revision had file_path present and
// retrievable per the Documents page), yet Review Workstation resolved
// filePath: MISSING for it — because the OTHER document in the project had a
// current_revision_id that didn't survive the id-based batch.

import { describe, it, expect, vi, beforeEach } from "vitest";

interface QueryResult { data: unknown; error: unknown }

const projectDocumentResult = { current: null as QueryResult | null };
const documentRevisionResult = { current: null as QueryResult | null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "project_document") {
        return { select: () => ({ eq: async () => projectDocumentResult.current }) };
      }
      if (table === "document_revision") {
        return { select: () => ({ in: async () => documentRevisionResult.current }) };
      }
      throw new Error(`unexpected table in test: ${table}`);
    },
  },
}));

import { loadProjectDrawings } from "./drawingStorage";

beforeEach(() => {
  projectDocumentResult.current = null;
  documentRevisionResult.current = null;
});

describe("loadProjectDrawings — FK-safe revision lookup", () => {
  it("resolves a healthy document even when another document's current_revision_id is stale/missing", async () => {
    projectDocumentResult.current = {
      data: [
        { id: "doc-healthy", name: "Healthy Drawing", current_revision_id: "rev-healthy" },
        { id: "doc-broken", name: "Broken Drawing", current_revision_id: "rev-does-not-exist" },
      ],
      error: null,
    };
    // document_revision filtered by document_id — a real FK — so the query
    // itself succeeds regardless of doc-broken's dangling reference; it just
    // never appears in the result set.
    documentRevisionResult.current = {
      data: [{ id: "rev-healthy", document_id: "doc-healthy", file_path: "proj/doc-healthy/rev-healthy.pdf", original_filename: "healthy.pdf", page_count: 3, page_titles: null }],
      error: null,
    };

    const drawings = await loadProjectDrawings("proj-1");

    const healthy = drawings.find((d) => d.documentId === "doc-healthy");
    const broken = drawings.find((d) => d.documentId === "doc-broken");
    expect(healthy?.filePath).toBe("proj/doc-healthy/rev-healthy.pdf");
    expect(broken?.filePath).toBeNull(); // its own reference is bad; that's all that fails
  });

  it("selects the current revision client-side, not just any revision for the document", async () => {
    projectDocumentResult.current = {
      data: [{ id: "doc-1", name: "Multi-Revision Drawing", current_revision_id: "rev-2" }],
      error: null,
    };
    // Two revisions for the same document; current_revision_id points at rev-2.
    documentRevisionResult.current = {
      data: [
        { id: "rev-1", document_id: "doc-1", file_path: "proj/doc-1/rev-1-old.pdf", original_filename: "old.pdf", page_count: 5, page_titles: null },
        { id: "rev-2", document_id: "doc-1", file_path: "proj/doc-1/rev-2-current.pdf", original_filename: "current.pdf", page_count: 6, page_titles: null },
      ],
      error: null,
    };

    const drawings = await loadProjectDrawings("proj-1");

    expect(drawings).toHaveLength(1);
    expect(drawings[0].filePath).toBe("proj/doc-1/rev-2-current.pdf");
    expect(drawings[0].originalFilename).toBe("current.pdf");
  });

  it("surfaces a project_document query error instead of silently returning []", async () => {
    projectDocumentResult.current = { data: null, error: new Error("permission denied") };
    await expect(loadProjectDrawings("proj-1")).rejects.toThrow("permission denied");
  });

  it("surfaces a document_revision query error instead of silently returning []", async () => {
    projectDocumentResult.current = {
      data: [{ id: "doc-1", name: "Drawing", current_revision_id: "rev-1" }],
      error: null,
    };
    documentRevisionResult.current = { data: null, error: new Error("malformed filter") };
    await expect(loadProjectDrawings("proj-1")).rejects.toThrow("malformed filter");
  });

  it("reproduces the live pilot case: the document/revision now resolves a filePath", async () => {
    const docId = "0a1b2c3d-0000-4000-8000-000000000001";
    const revId = "0a1b2c3d-0000-4000-8000-000000000002";
    projectDocumentResult.current = {
      data: [
        { id: docId, name: "Architectural drawing", current_revision_id: revId },
        { id: "other-doc-id", name: "Other drawing", current_revision_id: "other-rev-id" },
      ],
      error: null,
    };
    documentRevisionResult.current = {
      data: [
        { id: revId, document_id: docId, file_path: `${docId}/${revId}.pdf`, original_filename: "sample-plans.pdf", page_count: 12, page_titles: null },
        { id: "other-rev-id", document_id: "other-doc-id", file_path: "other-doc-id/other-rev-id.pdf", original_filename: "Other.pdf", page_count: 4, page_titles: null },
      ],
      error: null,
    };

    const drawings = await loadProjectDrawings("sample-project-id");

    const drawing = drawings.find((d) => d.documentId === docId);
    expect(drawing).toBeDefined();
    expect(drawing?.filePath).toBe(`${docId}/${revId}.pdf`);

    // End-to-end: resolveItemDrawing (untouched) must now resolve this item via
    // the resolved_document_id override, exactly as analysis_run recorded it,
    // with a non-null filePath — the exact chain that was broken in production.
    const { resolveItemDrawing } = await import("./documentResolve");
    const resolved = resolveItemDrawing({ evidence: [] }, drawings, docId);
    expect(resolved?.matchedBy).toBe("explicit_override");
    expect(resolved?.filePath).toBe(`${docId}/${revId}.pdf`);
  });
});
