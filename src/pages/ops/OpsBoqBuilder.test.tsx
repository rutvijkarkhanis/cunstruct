// Mobile nav fix: from the BOQ editor, the "Drawing" word in the pipeline
// breadcrumb must be a real, clickable control that returns to the one
// screen that actually has the drawing canvas + Click-to-Identify (the
// Review Workstation at `boqs/:boqId/review`) — not just inert text. Mirrors
// ProjectLayout.test.tsx's convention: mount the real route tree with
// MemoryRouter/Routes (not a mocked useNavigate) so this proves the actual
// `navigate("review")` call lands on the real nested route, preserving the
// project id.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import OpsBoqBuilder from "./OpsBoqBuilder";

const BOQ_ROW = {
  id: "boq-1", name: "Elevation & Facade", status: "draft",
  project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null,
};
const PROJECT_ROW = {
  id: "proj-1", name: "Srikakulam Apartment", area_sqft: null, floors: null,
  client_name: null, location: null, project_type: null, scope: null,
};

// Generic per-table query-builder stand-in — every chained method just
// returns itself; `.single()` resolves a fixed row, anything else (the
// plain awaited chain, e.g. boq_line's `.order("sort")`) resolves via
// `.then`. Good enough to get OpsBoqBuilder past its data-loading guard
// without pulling in a real Supabase client, same technique
// ProjectLayout.test.tsx already uses for its own `vi.mock`.
function chain(table: string) {
  const row: Record<string, unknown> = table === "boq" ? BOQ_ROW : table === "projects" ? PROJECT_ROW : null;
  const obj: Record<string, unknown> = {};
  ["select", "eq", "order", "limit", "in", "or", "neq"].forEach((m) => { obj[m] = () => obj; });
  obj.single = () => Promise.resolve({ data: row, error: null });
  obj.then = (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: row ? [row] : [], error: null });
  return obj;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain(table) },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderBoqBuilder() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <LocationProbe />
        <Routes>
          <Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} />
          <Route path="/ops/projects/:id/boqs/:boqId/review" element={<div data-testid="review-stub">Review Workstation</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OpsBoqBuilder — mobile nav back to the drawing", () => {
  it("renders the pipeline breadcrumb with 'Drawing' as a real button, not plain text", async () => {
    renderBoqBuilder();
    const drawingControl = await screen.findByRole("button", { name: /drawing/i });
    expect(drawingControl.tagName).toBe("BUTTON");
  });

  it("clicking 'Drawing' navigates to the Review Workstation, preserving the project and BOQ id", async () => {
    renderBoqBuilder();
    const drawingControl = await screen.findByRole("button", { name: /drawing/i });
    fireEvent.click(drawingControl);
    expect(await screen.findByTestId("review-stub")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/proj-1/boqs/boq-1/review");
  });

  it("'Drawing' and 'Review Analysis' go to the same place — no duplicate drawing page introduced", async () => {
    const first = renderBoqBuilder();
    const drawing = await screen.findByRole("button", { name: /drawing/i });
    fireEvent.click(drawing);
    const afterDrawing = screen.getByTestId("location").textContent;
    first.unmount();

    renderBoqBuilder();
    // Disambiguate from the desktop toolbar's separate "Review Analysis"
    // button (no trailing arrow) — this is specifically the breadcrumb's own link.
    const reviewLink = await screen.findByRole("button", { name: /review analysis →/i });
    fireEvent.click(reviewLink);
    const afterReview = screen.getByTestId("location").textContent;

    expect(afterDrawing).toBe(afterReview);
  });

  it("leaves the other breadcrumb steps (Generate, Review, Apply, BOQ, Export) as plain text — no scope creep into unroutable steps", async () => {
    renderBoqBuilder();
    await screen.findByRole("button", { name: /drawing/i });
    for (const word of ["Generate", "Apply", "Export"]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${word}$`, "i") })).not.toBeInTheDocument();
    }
  });

  it("the top-left back arrow still returns to the Workspace's BOQ context (unchanged desktop behavior)", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
          <LocationProbe />
          <Routes>
            <Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} />
            <Route path="/ops/projects/:id/workspace" element={<div data-testid="workspace-stub">Workspace</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const backButton = await screen.findByRole("button", { name: /back to workspace/i });
    fireEvent.click(backButton);
    expect(await screen.findByTestId("workspace-stub")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/proj-1/workspace");
  });
});
