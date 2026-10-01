// WorkspaceSourceManager — the Workspace's source-management drawer, Phase
// 11 Stage C2. Consumes the SAME useDocumentManagement hook the existing
// Documents page uses; these tests prove the drawer's own UI contract
// (folder creation, deletion, revision UI, selection) without re-testing the
// hook's persistence logic itself (see useDocumentManagement.test.tsx).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkspaceSourceManager from "./WorkspaceSourceManager";

const FOLDER = { id: "folder-1", project_id: "proj-1", parent_id: null, name: "Floor 2", sort: 0 };
const DOC_IN_FOLDER = { id: "doc-1", project_id: "proj-1", name: "Plan A", doc_type: "Architectural", discipline: "Architectural", current_revision_id: "rev-1", status: "uploaded", folder_id: "folder-1" };
const UNFILED_DOC = { id: "doc-2", project_id: "proj-1", name: "Plan B", doc_type: "Structural", discipline: "Structural", current_revision_id: null, status: "uploaded", folder_id: null };
const REV = { id: "rev-1", document_id: "doc-1", label: "Rev A", source: "upload", file_path: "proj-1/doc-1/rev-1.pdf", page_count: 3, status: "uploaded" };

const inserted: Record<string, unknown[]> = {};
let confirmReturn = true;

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string, getResult: () => { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order", "in"].forEach((m) => { obj[m] = () => obj; });
    obj.insert = (payload: unknown) => { (inserted[table] ??= []).push(payload); return obj; };
    obj.update = () => obj;
    obj.delete = () => obj;
    obj.single = () => obj;
    (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve(getResult());
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "document_folder") return chain(table, () => ({ data: [FOLDER], error: null }));
        if (table === "project_document") return chain(table, () => ({ data: [DOC_IN_FOLDER, UNFILED_DOC], error: null }));
        if (table === "document_revision") return chain(table, () => ({ data: [REV], error: null }));
        return chain(table, () => ({ data: [], error: null }));
      },
    },
  };
});

function renderDrawer(onSelectDocument = vi.fn(), onOpenChange = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkspaceSourceManager
          projectId="proj-1"
          open={true}
          onOpenChange={onOpenChange}
          activeDocumentId={null}
          onSelectDocument={onSelectDocument}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSelectDocument, onOpenChange };
}

describe("WorkspaceSourceManager", () => {
  beforeEach(() => {
    Object.keys(inserted).forEach((k) => delete inserted[k]);
    confirmReturn = true;
    vi.spyOn(window, "confirm").mockImplementation(() => confirmReturn);
  });

  it("renders the folder tree and unfiled documents from the same shared data the Documents page reads", async () => {
    renderDrawer();
    expect(await screen.findByText("Floor 2")).toBeInTheDocument();
    expect(await screen.findByText("Plan A")).toBeInTheDocument();
    expect(await screen.findByText("Unfiled")).toBeInTheDocument();
    expect(await screen.findByText("Plan B")).toBeInTheDocument();
  });

  it("creating a folder inserts via the shared hook with the trimmed name", async () => {
    renderDrawer();
    fireEvent.click(await screen.findByRole("button", { name: /New folder/i }));
    fireEvent.change(screen.getByPlaceholderText("Folder name, e.g. Floor 2"), { target: { value: "  Floor 3  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(inserted.document_folder).toEqual([{ project_id: "proj-1", name: "Floor 3", parent_id: null }]));
  });

  it("selecting a document closes the drawer and reports the document id, preserving Workspace's canvas context", async () => {
    const { onSelectDocument, onOpenChange } = renderDrawer();
    fireEvent.click(await screen.findByText("Plan A"));
    expect(onSelectDocument).toHaveBeenCalledWith("doc-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("expanding a document's revisions shows its current revision and an 'Add revision' affordance (no rename — not supported anywhere today)", async () => {
    renderDrawer();
    await screen.findByText("Plan A");
    const planARow = (await screen.findByTestId("source-manager-doc-doc-1"));
    fireEvent.click(within(planARow).getByLabelText("Toggle revisions"));
    await waitFor(() => expect(within(planARow).getAllByText("Rev A").length).toBeGreaterThan(1));
    expect(within(planARow).getByText("current")).toBeInTheDocument();
    expect(within(planARow).getByRole("button", { name: /Add revision/i })).toBeInTheDocument();
    expect(screen.queryByText(/rename/i)).not.toBeInTheDocument();
  });

  it("deleting a document asks for confirmation first", async () => {
    confirmReturn = false;
    renderDrawer();
    fireEvent.click(await screen.findByLabelText("Delete Plan A"));
    expect(window.confirm).toHaveBeenCalledWith(
      'Delete "Plan A" and its uploaded file? Existing analysis review history is kept.',
    );
  });

  it("Stage C4 — no longer links out to a separate Documents page (that route now redirects back into this same drawer)", async () => {
    renderDrawer();
    await screen.findByText("Plan A");
    expect(screen.queryByText("Open full Documents page")).not.toBeInTheDocument();
  });
});
