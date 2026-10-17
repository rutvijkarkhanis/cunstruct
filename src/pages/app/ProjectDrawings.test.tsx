// Drawings step: reuses the existing list/viewer/drawer, keeps the open
// drawing in the URL, and labels its revision without doubling "Rev".
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProjectDrawings from "./ProjectDrawings";

vi.mock("@/lib/review/reviewStore", () => ({
  loadReviewItems: async (runId: string) => (runId === "run-1" ? [{
    id: "ri-1", reviewStatus: "VERIFIED",
    ai: { key: "W1", item: "Window W1", quantity: 4, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
      source: { documentId: "d1", document: "Ground Floor Plan", page: 2, evidence: [{ bbox: [1, 2, 3, 4], page: 2 }, { bbox: [5, 6, 7, 8], page: 2 }] } },
  }] : []),
}));
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

vi.mock("@/components/app/projectShellContext", () => ({ useProjectShell: () => ({ projectId: "p1" }) }));
vi.mock("@/hooks/useDocumentManagement", () => ({
  useDocumentManagement: () => ({
    docs: [{ id: "d1", name: "Ground Floor Plan", current_revision_id: "r1" }],
    revsFor: () => [{ id: "r1", label: "Rev A", page_count: 3 }],
  }),
}));
vi.mock("@/components/ops/workspace/WorkspaceSources", () => ({
  default: ({ onSelectDocument }: { onSelectDocument: (id: string) => void }) => <button onClick={() => onSelectDocument("d1")}>Ground Floor Plan</button>,
}));
vi.mock("@/components/ops/workspace/WorkspaceCanvas", () => ({
  default: ({ documentId, page, evidence }: { documentId: string | null; page: number | null; evidence?: { boxes: unknown[] } | null }) =>
    <div data-testid="canvas">{documentId ?? "none"}{page ? ` p${page}` : ""}{evidence ? ` boxes:${evidence.boxes.length}` : ""}</div>,
}));
vi.mock("@/components/ops/workspace/WorkspaceSourceManager", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Manage sources" /> : null),
}));

const Where = () => <div data-testid="where">{useLocation().search}</div>;

describe("ProjectDrawings", () => {
  it("opens the selected drawing in the existing viewer and keeps it in the URL with ?boq", () => {
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={["/x?boq=b1"]}><ProjectDrawings /><Where /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByTestId("canvas")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Ground Floor Plan" }));
    expect(screen.getByTestId("canvas")).toHaveTextContent("d1");
    expect(screen.getByTestId("where")).toHaveTextContent("?boq=b1&document=d1");
  });

  it("shows the current revision once, never 'Rev Rev'", () => {
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={["/x?document=d1"]}><ProjectDrawings /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "Ground Floor Plan" })).toBeInTheDocument();
    expect(screen.getByText("Rev A")).toBeInTheDocument();
    expect(screen.queryByText(/Rev Rev/)).toBeNull();
    expect(screen.getByText("· 3 pages")).toBeInTheDocument();
  });

  it("opens a BOQ source link on its page", () => {
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={["/x?document=d1&page=3"]}><ProjectDrawings /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByTestId("canvas")).toHaveTextContent("d1 p3");
  });

  it("opens the existing upload/manage drawer", () => {
    render(<QueryClientProvider client={qc()}><MemoryRouter><ProjectDrawings /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Upload or manage/ }));
    expect(screen.getByRole("dialog", { name: "Manage sources" })).toBeInTheDocument();
  });

  it("draws a BOQ line's recorded region from its review item, with a way back to the BOQ", async () => {
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={["/x?boq=b1&document=d1&item=ri-1&run=run-1"]}><ProjectDrawings /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/Showing the region recorded for “Window W1” \(verified in review\)/)).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toHaveTextContent("d1 p2 boxes:2");
    expect(screen.getByRole("link", { name: "Back to the BOQ" })).toHaveAttribute("href", "/boq?boq=b1");
  });

  it("never draws a region from another drawing", async () => {
    vi.resetModules();
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={["/x?document=d9&item=ri-1&run=run-1"]}><ProjectDrawings /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/not on this drawing/)).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).not.toHaveTextContent("boxes");
  });
});
