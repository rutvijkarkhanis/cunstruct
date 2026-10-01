// Tests ProjectWorkspace's OWN orchestration (mode derivation from the URL,
// query-param sync on document/mode changes, mobile drill-down state, and
// the mode="review" full-takeover) in isolation from its children — each
// child (WorkspaceSources/WorkspaceCanvas/WorkspaceContext) already has its
// own focused tests, and BoqReviewWorkstation is Phase 9/10's approved,
// untouched implementation (not re-tested here).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectWorkspace from "./ProjectWorkspace";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const obj: Record<string, unknown> = {};
      ["select", "eq", "single"].forEach((m) => { obj[m] = () => obj; });
      (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) =>
        resolve({ data: { id: "proj-1", name: "Srikakulam Apartment" }, error: null });
      return obj;
    },
  },
}));

vi.mock("./BoqReviewWorkstation", () => ({
  default: ({ boqId }: { boqId?: string }) => <div data-testid="embedded-review">Review for {boqId}</div>,
}));

vi.mock("@/components/ops/workspace/WorkspaceSources", () => ({
  default: ({ activeDocumentId, onSelectDocument }: { activeDocumentId: string | null; onSelectDocument: (id: string) => void }) => (
    <div data-testid="sources">
      active:{activeDocumentId ?? "none"}
      <button onClick={() => onSelectDocument("doc-1")}>pick doc-1</button>
    </div>
  ),
}));
vi.mock("@/components/ops/workspace/WorkspaceCanvas", () => ({
  default: ({ documentId, page }: { documentId: string | null; page: number | null }) => (
    <div data-testid="canvas">doc:{documentId ?? "none"} page:{page ?? "none"}</div>
  ),
}));
vi.mock("@/components/ops/workspace/WorkspaceContext", () => ({
  default: ({ mode, onEnterMode }: { mode: string; onEnterMode: (m: string, boq?: string) => void }) => (
    <div data-testid="context">
      mode:{mode}
      <button onClick={() => onEnterMode("review", "boq-1")}>enter review</button>
    </div>
  ),
}));

function renderWorkspace(initialPath: string) {
  const qc = new QueryClient();
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes><Route path="/ops/projects/:id/workspace" element={<ProjectWorkspace />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The shell renders BOTH the desktop (`hidden lg:flex`) and mobile
  // (`flex lg:hidden`) trees at once — jsdom has no real viewport/layout
  // engine to apply those classes, so a component common to both modes can
  // legitimately appear twice. The desktop tree is always first in DOM
  // order (see ProjectWorkspace.tsx), so `[0]` deterministically means
  // "the desktop instance" everywhere below; this is a test-query concern
  // only, not a real duplicate-rendering bug (a real browser shows exactly one).
  return result;
}
const first = (els: HTMLElement[]) => els[0];

describe("ProjectWorkspace — mode derivation from the URL", () => {
  it("defaults to the generic drawing-mode shell with no document selected", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace");
    expect(first(await screen.findAllByTestId("sources"))).toHaveTextContent("active:none");
    expect(first(screen.getAllByTestId("canvas"))).toHaveTextContent("doc:none");
    expect(first(screen.getAllByTestId("context"))).toHaveTextContent("mode:drawing");
  });

  it("initializes activeDocument/page from ?document=&page=", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1&page=3");
    expect(first(await screen.findAllByTestId("sources"))).toHaveTextContent("active:doc-1");
    expect(first(screen.getAllByTestId("canvas"))).toHaveTextContent("doc:doc-1 page:3");
  });

  it("mode=review with a boq fully takes over the body with the existing BoqReviewWorkstation, unmodified", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?mode=review&boq=boq-1");
    expect(await screen.findByTestId("embedded-review")).toHaveTextContent("Review for boq-1");
    // The generic shell (Sources/Canvas/Context) must NOT also render —
    // Review already supplies its own rail/canvas/inspector.
    expect(screen.queryByTestId("sources")).not.toBeInTheDocument();
    expect(screen.queryByTestId("context")).not.toBeInTheDocument();
  });

  it("falls back to the generic shell's own mode switcher when mode=review has no boq (never renders Review with nothing to review)", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?mode=review");
    expect(screen.queryByTestId("embedded-review")).not.toBeInTheDocument();
    expect(first(await screen.findAllByTestId("context"))).toBeInTheDocument();
  });
});

describe("ProjectWorkspace — document selection updates the URL", () => {
  it("selecting a document from Sources sets ?document= and clears any stale page", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?document=old-doc&page=5");
    fireEvent.click(first(await screen.findAllByText("pick doc-1")));
    expect(first(screen.getAllByTestId("canvas"))).toHaveTextContent("doc:doc-1 page:none");
  });
});

describe("ProjectWorkspace — entering a context mode from the panel", () => {
  it("WorkspaceContext's onEnterMode('review', boqId) switches the whole workspace into the Review takeover", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1");
    fireEvent.click(first(await screen.findAllByText("enter review")));
    expect(await screen.findByTestId("embedded-review")).toHaveTextContent("Review for boq-1");
  });
});

describe("Stage C3 — mobile drill-down lands on Context for a non-drawing mode, even with no document selected", () => {
  it("a bare ?mode=boq deep link (e.g. 'Create BOQ' before any document exists) shows Context on mobile, not Sources", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?mode=boq");
    // Desktop always renders all three; on mobile this mode must ALSO show
    // Context — so with nothing forcing it back to Sources, both instances
    // of "context" (desktop + mobile) should be present, and "sources"
    // only once (desktop).
    expect((await screen.findAllByTestId("context")).length).toBe(2);
    expect(screen.getAllByTestId("sources").length).toBe(1);
  });

  it("still defaults to Sources on mobile for the plain drawing mode with no document (unchanged)", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace");
    expect((await screen.findAllByTestId("sources")).length).toBe(2);
    expect(screen.getAllByTestId("context").length).toBe(1);
  });
});

describe("Stage C1 — Workspace's own back link no longer points at the (now self-redirecting) project root", () => {
  it("links back to the projects list, not /ops/projects/:id", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace");
    const backLink = first(await screen.findAllByLabelText("Back to projects"));
    expect(backLink).toHaveAttribute("href", "/ops/projects");
  });
});
