// Shared document-management hook — Phase 11 Stage C2. These tests exercise
// the mutation layer directly (no UI), proving the extraction preserves the
// exact persistence semantics ProjectDocuments.tsx relied on before the
// extraction (same query keys, same toast copy, same confirm() gate).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDocumentManagement } from "./useDocumentManagement";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const FOLDER = { id: "folder-1", project_id: "proj-1", parent_id: null, name: "Floor 2", sort: 0, created_at: "2026-01-01T00:00:00Z" };
const DOC = { id: "doc-1", project_id: "proj-1", name: "Ground Floor Plan", doc_type: "Architectural", discipline: "Architectural", current_revision_id: "rev-1", status: "uploaded", folder_id: null, created_at: "2026-01-01T00:00:00Z" };
const REV = { id: "rev-1", document_id: "doc-1", label: "Rev A", revision_date: null, source: "upload", file_path: "proj-1/doc-1/rev-1.pdf", external_url: null, page_count: 3, status: "uploaded", created_at: "2026-01-01T00:00:00Z" };

let folders: unknown[] = [FOLDER];
let docs: unknown[] = [DOC];
let revs: unknown[] = [REV];

const inserted: Record<string, unknown[]> = {};
const updated: Record<string, unknown[]> = {};
const deleted: Record<string, unknown[]> = {};

// Scope G — the boq_line reference-count check deleteDocument() now runs
// before confirming. Modeled separately from the generic `chain()` helper
// below so the exact filter column/value reaching `.eq()` can be asserted —
// proving the query is actually scoped to this document, not merely that
// *some* count was requested.
let boqLineCount: number | null = 0;
let boqLineCountError: { message: string } | null = null;
const boqLineEqCalls: { col: string; val: unknown }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string, getResult: () => { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order", "in"].forEach((m) => { obj[m] = () => obj; });
    obj.insert = (payload: unknown) => { (inserted[table] ??= []).push(payload); return obj; };
    obj.update = (payload: unknown) => { (updated[table] ??= []).push(payload); return obj; };
    obj.delete = () => { (deleted[table] ??= []).push(true); return obj; };
    obj.single = () => obj;
    (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve(getResult());
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "document_folder") return chain(table, () => ({ data: table in inserted ? { id: "new-folder-id" } : folders, error: null }));
        if (table === "project_document") return chain(table, () => ({ data: docs, error: null }));
        if (table === "document_revision") return chain(table, () => ({ data: revs, error: null }));
        if (table === "boq_line") {
          const obj: Record<string, unknown> = {};
          obj.select = () => obj;
          obj.eq = (col: string, val: unknown) => { boqLineEqCalls.push({ col, val }); return obj; };
          (obj as { then: unknown }).then = (resolve: (r: { data: null; error: unknown; count: number | null }) => void) =>
            resolve({ data: null, error: boqLineCountError, count: boqLineCountError ? null : boqLineCount });
          return obj;
        }
        return chain(table, () => ({ data: [], error: null }));
      },
    },
  };
});

function renderDm(projectId = "proj-1") {
  const qc = new QueryClient();
  return renderHook(() => useDocumentManagement(projectId), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

describe("useDocumentManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    folders = [FOLDER];
    docs = [DOC];
    revs = [REV];
    Object.keys(inserted).forEach((k) => delete inserted[k]);
    Object.keys(updated).forEach((k) => delete updated[k]);
    Object.keys(deleted).forEach((k) => delete deleted[k]);
    boqLineCount = 0;
    boqLineCountError = null;
    boqLineEqCalls.length = 0;
  });

  it("loads folders/docs grouped by folder, with the current revision resolvable via revsFor", async () => {
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toEqual([DOC]));
    expect(result.current.folderTree).toHaveLength(1);
    expect(result.current.folderTree[0].name).toBe("Floor 2");
    expect(result.current.revsFor("doc-1")).toEqual([REV]);
    expect(result.current.unfiledDocs).toEqual([DOC]); // DOC.folder_id is null
  });

  it("createFolder rejects a blank name without hitting the network", async () => {
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.createFolder("   ", null); });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Enter a folder name");
    expect(inserted.document_folder).toBeUndefined();
  });

  it("createFolder inserts with the trimmed name and the given parent, then toasts success", async () => {
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.createFolder("  Floor 3  ", "folder-1"); });
    expect(ok).toBe(true);
    expect(inserted.document_folder).toEqual([{ project_id: "proj-1", name: "Floor 3", parent_id: "folder-1" }]);
    expect(toast.success).toHaveBeenCalledWith("Folder created");
  });

  it("deleteDocument asks for confirmation and does nothing when declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(confirmSpy).toHaveBeenCalledWith(`Delete "${DOC.name}" and its uploaded file? Existing analysis review history is kept.`);
    expect(deleted.project_document).toBeUndefined();
    confirmSpy.mockRestore();
  });

  it("deleteDocument removes the document row when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(deleted.project_document).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith(`Deleted ${DOC.name}`);
  });

  // ── Scope G — warn before deleting a document referenced by BOQ lines ──────

  it("deleteDocument queries boq_line filtered by THIS document's id, not merely requesting some count", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(boqLineEqCalls).toEqual([{ col: "source_document_id", val: DOC.id }]);
  });

  it("zero references: the confirmation text is byte-identical to before Scope G, and deletion proceeds", async () => {
    boqLineCount = 0;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(confirmSpy).toHaveBeenCalledWith(`Delete "${DOC.name}" and its uploaded file? Existing analysis review history is kept.`);
    expect(deleted.project_document).toHaveLength(1);
  });

  it("one reference: the confirmation explicitly warns, in the singular, that one BOQ line will lose its drawing-source reference", async () => {
    boqLineCount = 1;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(confirmSpy).toHaveBeenCalledWith(
      `Delete "${DOC.name}" and its uploaded file? This will remove the drawing-source reference from 1 BOQ line. Existing analysis review history is kept.`,
    );
  });

  it("multiple references: the confirmation shows the exact count with plural wording", async () => {
    boqLineCount = 3;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(confirmSpy).toHaveBeenCalledWith(
      `Delete "${DOC.name}" and its uploaded file? This will remove the drawing-source reference from 3 BOQ lines. Existing analysis review history is kept.`,
    );
  });

  it("declining with references present deletes nothing", async () => {
    boqLineCount = 2;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleted.project_document).toBeUndefined();
  });

  it("confirming with references present proceeds through the existing deletion flow unchanged", async () => {
    boqLineCount = 2;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(deleted.project_document).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith(`Deleted ${DOC.name}`);
  });

  it("a count-query error aborts deletion safely — never silently shown the zero-reference confirmation", async () => {
    boqLineCountError = { message: "network error" };
    const confirmSpy = vi.spyOn(window, "confirm");
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleted.project_document).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith("Could not check whether BOQ lines reference this document. Delete cancelled — please try again.");
  });

  it("an indeterminate count (null, no error) aborts deletion safely, exactly like a count-query error", async () => {
    boqLineCount = null;
    const confirmSpy = vi.spyOn(window, "confirm");
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.deleteDocument(DOC); });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleted.project_document).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith("Could not check whether BOQ lines reference this document. Delete cancelled — please try again.");
  });

  it("addRevision rejects a blank label without hitting the network", async () => {
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.addRevision("doc-1", "  ", ""); });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Enter a revision label (e.g. Rev B)");
    expect(inserted.document_revision).toBeUndefined();
  });

  // Documents EXISTING behavior, unchanged by the WorkspaceCanvas loading-state
  // fix: a non-blank label with a blank URL is accepted — the only required
  // field is the label (see the blank-label rejection above) — and the
  // inserted revision never gets a file_path at all. This is exactly the
  // state WorkspaceCanvas.test.tsx's "no file path" cases model: a revision
  // that resolves successfully but has nothing to render, which the viewer
  // must show accurately rather than mistake for still-loading.
  it("addRevision with a non-blank label and a blank URL succeeds, and the inserted revision has no file_path — the only state a viewer can later find genuinely fileless", async () => {
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.addRevision("doc-1", "Rev B", ""); });
    expect(ok).toBe(true);
    expect(inserted.document_revision).toEqual([
      { document_id: "doc-1", label: "Rev B", source: "paste", external_url: null, status: "draft" },
    ]);
    expect("file_path" in (inserted.document_revision![0] as object)).toBe(false);
    // Still immediately set as the document's current revision — same code
    // path as any other added revision, file or not (this mock's
    // document_revision chain doesn't model per-insert return values, so the
    // exact id isn't asserted here — see setCurrentRevision's own test for
    // that update call's shape).
    expect(updated.project_document).toHaveLength(1);
  });

  it("setCurrentRevision updates project_document.current_revision_id", async () => {
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.setCurrentRevision("doc-1", "rev-2"); });
    expect(updated.project_document).toEqual([{ current_revision_id: "rev-2" }]);
  });
});
