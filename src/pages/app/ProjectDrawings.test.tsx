// Drawings step: reuses the existing list/viewer/drawer, keeps the open
// drawing in the URL, and labels its revision without doubling "Rev".
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import ProjectDrawings from "./ProjectDrawings";

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
  default: ({ documentId }: { documentId: string | null }) => <div data-testid="canvas">{documentId ?? "none"}</div>,
}));
vi.mock("@/components/ops/workspace/WorkspaceSourceManager", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Manage sources" /> : null),
}));

const Where = () => <div data-testid="where">{useLocation().search}</div>;

describe("ProjectDrawings", () => {
  it("opens the selected drawing in the existing viewer and keeps it in the URL with ?boq", () => {
    render(<MemoryRouter initialEntries={["/x?boq=b1"]}><ProjectDrawings /><Where /></MemoryRouter>);
    expect(screen.getByTestId("canvas")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Ground Floor Plan" }));
    expect(screen.getByTestId("canvas")).toHaveTextContent("d1");
    expect(screen.getByTestId("where")).toHaveTextContent("?boq=b1&document=d1");
  });

  it("shows the current revision once, never 'Rev Rev'", () => {
    render(<MemoryRouter initialEntries={["/x?document=d1"]}><ProjectDrawings /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Ground Floor Plan" })).toBeInTheDocument();
    expect(screen.getByText("Rev A")).toBeInTheDocument();
    expect(screen.queryByText(/Rev Rev/)).toBeNull();
    expect(screen.getByText("· 3 pages")).toBeInTheDocument();
  });

  it("opens the existing upload/manage drawer", () => {
    render(<MemoryRouter><ProjectDrawings /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Upload or manage/ }));
    expect(screen.getByRole("dialog", { name: "Manage sources" })).toBeInTheDocument();
  });
});
