// Stage C1 — canonical navigation + routing.
//
// Mirrors just the relevant slice of App.tsx's real route tree (index
// redirect + the specialized children) rather than mounting the whole app,
// so these tests exercise ProjectLayout's actual redirect/nav logic without
// needing every unrelated provider App.tsx wires up.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import ProjectLayout from "./ProjectLayout";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const obj: Record<string, unknown> = {};
      ["select", "eq", "single"].forEach((m) => { obj[m] = () => obj; });
      (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) =>
        resolve({ data: { id: "proj-1", name: "Srikakulam Apartment", client_name: null, location: null, project_type: null, status: "active" }, error: null });
      return obj;
    },
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderProjectRoutes(initialPath: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          <Route path="/ops/projects/:id" element={<ProjectLayout />}>
            <Route index element={<Navigate to="workspace" replace />} />
            <Route path="workspace" element={<div data-testid="workspace-stub">Workspace</div>} />
            <Route path="documents" element={<div data-testid="documents-stub">Documents</div>} />
            <Route path="boqs" element={<div data-testid="boqs-stub">BOQ list</div>} />
            <Route path="boqs/:boqId" element={<div data-testid="boq-builder-stub">BOQ builder</div>} />
            <Route path="boqs/:boqId/review" element={<div data-testid="review-stub">Review</div>} />
            <Route path="procurement" element={<div data-testid="procurement-stub">Procurement</div>} />
            <Route path="activity" element={<div data-testid="activity-stub">Activity</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Stage C1 — project root redirect", () => {
  it("redirects the bare project route to Workspace", async () => {
    renderProjectRoutes("/ops/projects/proj-1");
    expect(await screen.findByTestId("workspace-stub")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/proj-1/workspace");
  });

  it("preserves the project id through the redirect for a different id", async () => {
    renderProjectRoutes("/ops/projects/another-project-999");
    expect(await screen.findByTestId("workspace-stub")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/another-project-999/workspace");
  });

  it("does not redirect specialized routes — they render directly", async () => {
    renderProjectRoutes("/ops/projects/proj-1/documents");
    expect(await screen.findByTestId("documents-stub")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/proj-1/documents");
  });

  it.each([
    ["/ops/projects/proj-1/boqs", "boqs-stub"],
    ["/ops/projects/proj-1/boqs/boq-1", "boq-builder-stub"],
    ["/ops/projects/proj-1/boqs/boq-1/review", "review-stub"],
    ["/ops/projects/proj-1/procurement", "procurement-stub"],
    ["/ops/projects/proj-1/activity", "activity-stub"],
  ])("%s remains a direct, un-redirected deep link", async (path, testId) => {
    renderProjectRoutes(path);
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(path);
  });
});

describe("Stage C1 — navigation no longer recreates the old dashboard tab bar", () => {
  it("shows exactly Workspace (primary) and Activity (separate), nothing else", async () => {
    renderProjectRoutes("/ops/projects/proj-1/documents");
    await screen.findByTestId("documents-stub");
    expect(screen.getByRole("link", { name: /Workspace/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Activity/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Overview$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Documents$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^BOQs$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Procurement$/ })).not.toBeInTheDocument();
  });

  it("Workspace link points at the workspace route", async () => {
    renderProjectRoutes("/ops/projects/proj-1/activity");
    await screen.findByTestId("activity-stub");
    expect(screen.getByRole("link", { name: /Workspace/ })).toHaveAttribute("href", "/ops/projects/proj-1/workspace");
  });

  it("the project-level nav chrome is suppressed while actually inside Workspace (full-bleed, same as Review)", async () => {
    renderProjectRoutes("/ops/projects/proj-1/workspace");
    await screen.findByTestId("workspace-stub");
    expect(screen.queryByRole("link", { name: /Workspace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Activity/ })).not.toBeInTheDocument();
  });
});
