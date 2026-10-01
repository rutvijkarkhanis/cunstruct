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

  it("addRevision rejects a blank label without hitting the network", async () => {
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.addRevision("doc-1", "  ", ""); });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Enter a revision label (e.g. Rev B)");
    expect(inserted.document_revision).toBeUndefined();
  });

  it("setCurrentRevision updates project_document.current_revision_id", async () => {
    const { result } = renderDm();
    await waitFor(() => expect(result.current.docs).toBeDefined());
    await act(async () => { await result.current.setCurrentRevision("doc-1", "rev-2"); });
    expect(updated.project_document).toEqual([{ current_revision_id: "rev-2" }]);
  });
});
