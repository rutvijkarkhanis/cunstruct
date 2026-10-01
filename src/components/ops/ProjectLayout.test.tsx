// Stage C1 — canonical navigation + routing.
// Stage C4 — Documents/BOQs list retire in favor of redirecting into
// Workspace; specialized BOQ/Review/Activity/Procurement routes, and the
// new secondary "boqs/manage" surface, must NOT redirect.
//
// Mirrors just the relevant slice of App.tsx's real route tree (index
// redirect + the specialized children, including the real C4 <Navigate>
// redirects) rather than mounting the whole app, so these tests exercise
// ProjectLayout's actual redirect/nav logic without needing every unrelated
// provider App.tsx wires up.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, Navigate, useLocation, useSearchParams } from "react-router-dom";
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
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

/** Stands in for ProjectWorkspace.tsx — just enough to show which ?mode= a
 *  redirect actually landed on, without pulling in the real component's
 *  Supabase/React Query dependencies. */
function WorkspaceStub() {
  const [params] = useSearchParams();
  return <div data-testid="workspace-stub">Workspace mode={params.get("mode") ?? "(none)"}</div>;
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
            <Route path="workspace" element={<WorkspaceStub />} />
            <Route path="documents" element={<Navigate to="../workspace?mode=documents" replace />} />
            <Route path="boqs" element={<Navigate to="../workspace?mode=boq" replace />} />
            <Route path="boqs/manage" element={<div data-testid="boqs-manage-stub">BOQ manage</div>} />
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
    renderProjectRoutes("/ops/projects/proj-1/boqs/manage");
    expect(await screen.findByTestId("boqs-manage-stub")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/proj-1/boqs/manage");
  });

  it.each([
    ["/ops/projects/proj-1/boqs/manage", "boqs-manage-stub"],
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

describe("Stage C4 — Documents and BOQs list redirect into Workspace", () => {
  it("/documents redirects to /workspace?mode=documents, preserving the project id", async () => {
    renderProjectRoutes("/ops/projects/proj-1/documents");
    expect(await screen.findByTestId("workspace-stub")).toHaveTextContent("mode=documents");
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/proj-1/workspace?mode=documents");
  });

  it("/boqs redirects to /workspace?mode=boq, preserving the project id", async () => {
    renderProjectRoutes("/ops/projects/proj-1/boqs");
    expect(await screen.findByTestId("workspace-stub")).toHaveTextContent("mode=boq");
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/proj-1/workspace?mode=boq");
  });

  it("preserves the project id through the /documents redirect for a different id", async () => {
    renderProjectRoutes("/ops/projects/another-project-999/documents");
    expect(await screen.findByTestId("workspace-stub")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/ops/projects/another-project-999/workspace?mode=documents");
  });
});

describe("Stage C1 — navigation no longer recreates the old dashboard tab bar", () => {
  it("shows exactly Workspace (primary) and Activity (separate), nothing else", async () => {
    renderProjectRoutes("/ops/projects/proj-1/boqs/manage");
    await screen.findByTestId("boqs-manage-stub");
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

describe("Stage C5B — OpsBoqBuilder is the dedicated full-screen BOQ editing mode", () => {
  it("suppresses the project-level nav chrome on the bare BOQ editor route (full-bleed, same as Workspace and Review)", async () => {
    renderProjectRoutes("/ops/projects/proj-1/boqs/boq-1");
    await screen.findByTestId("boq-builder-stub");
    expect(screen.queryByRole("link", { name: /Workspace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Activity/ })).not.toBeInTheDocument();
  });

  it("does NOT suppress chrome for the separate /boqs/manage admin surface", async () => {
    renderProjectRoutes("/ops/projects/proj-1/boqs/manage");
    await screen.findByTestId("boqs-manage-stub");
    expect(screen.getByRole("link", { name: /Workspace/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Activity/ })).toBeInTheDocument();
  });

  it("still suppresses chrome for the BOQ review route (already full-bleed, unaffected)", async () => {
    renderProjectRoutes("/ops/projects/proj-1/boqs/boq-1/review");
    await screen.findByTestId("review-stub");
    expect(screen.queryByRole("link", { name: /Workspace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Activity/ })).not.toBeInTheDocument();
  });
});
