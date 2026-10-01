import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkspaceSources from "./WorkspaceSources";

const DOCS = [
  { id: "doc-1", name: "Ground Floor Plan", doc_type: "Architectural", discipline: "Architectural", status: "uploaded", current_revision_id: "rev-1" },
  { id: "doc-2", name: "Structural Plan", doc_type: "Structural", discipline: "Structural", status: "uploaded", current_revision_id: null },
];
const REVS = [{ id: "rev-1", page_count: 6 }];

vi.mock("@/integrations/supabase/client", () => {
  const chain = (getResult: () => { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order", "in"].forEach((m) => { obj[m] = () => obj; });
    (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve(getResult());
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "project_document") return chain(() => ({ data: DOCS, error: null }));
        if (table === "document_revision") return chain(() => ({ data: REVS, error: null }));
        return chain(() => ({ data: [], error: null }));
      },
    },
  };
});

function renderRail(activeDocumentId: string | null, onSelectDocument = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkspaceSources projectId="proj-1" activeDocumentId={activeDocumentId} onSelectDocument={onSelectDocument} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onSelectDocument;
}

describe("WorkspaceSources", () => {
  it("groups real documents by discipline and shows the current revision's page count", async () => {
    renderRail(null);
    expect(await screen.findByText("Architectural")).toBeInTheDocument();
    expect(await screen.findByText("Structural")).toBeInTheDocument();
    expect(await screen.findByText("Ground Floor Plan")).toBeInTheDocument();
    expect(await screen.findByText("6p")).toBeInTheDocument(); // doc-1's current revision page count
  });

  it("calls onSelectDocument with the document's id when a row is clicked", async () => {
    const onSelectDocument = renderRail(null);
    const row = await screen.findByText("Ground Floor Plan");
    fireEvent.click(row);
    expect(onSelectDocument).toHaveBeenCalledWith("doc-1");
  });

  it("marks the active document distinctly (font-semibold) without altering the others", async () => {
    renderRail("doc-1");
    const activeRow = (await screen.findByText("Ground Floor Plan")).closest("button")!;
    const otherRow = (await screen.findByText("Structural Plan")).closest("button")!;
    expect(activeRow.className).toContain("font-semibold");
    expect(otherRow.className).not.toContain("font-semibold");
  });

  it("exposes a link to the existing Documents page for upload/manage, rather than rebuilding CRUD", async () => {
    renderRail(null);
    const manageLink = await screen.findByLabelText("Manage documents");
    expect(manageLink).toHaveAttribute("href", "/ops/projects/proj-1/documents");
  });
});
