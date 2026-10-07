// Tests ProjectWorkspace's OWN orchestration (mode derivation from the URL,
// query-param sync on document/mode changes, mobile drill-down state, and
// the mode="review" full-takeover) in isolation from its children — each
// child (WorkspaceSources/WorkspaceCanvas/WorkspaceContext) already has its
// own focused tests, and BoqReviewWorkstation is Phase 9/10's approved,
// untouched implementation (not re-tested here).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient, useQuery } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ProjectWorkspace from "./ProjectWorkspace";

// Mutable per-test fixture for the "boq" table specifically — the mobile
// "Review & Identify" CTA (ProjectWorkspace's own useProjectBoqs call) must
// be able to see BOTH "a BOQ exists" and "no BOQ yet" without the generic
// single-row stub below (used for every other table) getting in the way.
// vi.hoisted so the mock factory (which vi.mock hoists above these imports)
// can close over it.
const { boqRowsRef, analyzedBoqIdRef } = vi.hoisted(() => ({
  boqRowsRef: { current: [{ id: "boq-1", name: "Main BOQ", created_at: "2024-01-01" }] as { id: string; name: string; created_at: string }[] },
  // Which boq_id mostRecentlyAnalyzedBoqId should "find" — null means no
  // BOQ in this project has been analyzed yet (the pre-existing default,
  // so every test that doesn't set this keeps exercising the newest-BOQ
  // fallback exactly as before this fix).
  analyzedBoqIdRef: { current: null as string | null },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const obj: Record<string, unknown> = {};
      ["select", "eq", "single", "order", "not", "gt", "limit"].forEach((m) => { obj[m] = () => obj; });
      (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => {
        if (table === "boq") return resolve({ data: boqRowsRef.current, error: null });
        if (table === "projects") return resolve({ data: { id: "proj-1", name: "Srikakulam Apartment" }, error: null });
        // Backs useMostRecentlyAnalyzedBoqId's own query (project-scoped,
        // item_count > 0, boq_id not null, newest first, limit 1) — the
        // real filtering/ordering happens in reviewStore.ts itself and is
        // covered by reviewStore.test.ts; here we just hand back the one
        // row (or none) the test fixture says should "win".
        if (table === "analysis_run") {
          return resolve({ data: analyzedBoqIdRef.current ? [{ boq_id: analyzedBoqIdRef.current, created_at: "2099-01-01" }] : [], error: null });
        }
        // Everything else this tree queries (e.g. ShareLinksDialog's own
        // "project_share_link" via useShareLinks, mounted unconditionally
        // regardless of the dialog's open state) expects a list, not a
        // single row — an empty array here, not the "projects" object
        // above, so list.map()/list.length in a component this test
        // doesn't otherwise mock never throws.
        return resolve({ data: [], error: null });
      };
      return obj;
    },
  },
}));

afterEach(() => {
  // Reset to the "has a BOQ, nothing analyzed" default so one test's
  // override never leaks into the next.
  boqRowsRef.current = [{ id: "boq-1", name: "Main BOQ", created_at: "2024-01-01" }];
  analyzedBoqIdRef.current = null;
});

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
// ProjectWorkspace.tsx and WorkspaceContext's own DrawingHome both import
// the real useProjectBoqs from this hook module — mocked here with its
// real implementation (backed by the same mocked supabase "boq" table the
// rest of this file already drives via boqRowsRef via a real useQuery),
// not a stub that always says "yes" or "no", so the mobile CTA tests below
// can actually flip "has a BOQ" / "no BOQ yet" by setting boqRowsRef.
vi.mock("@/hooks/useProjectBoqs", () => ({
  useProjectBoqs: (projectId: string) => useQuery({
    queryKey: ["workspace-project-boqs", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("boq").select("id, name, created_at").eq("project_id", projectId).order("created_at", { ascending: false });
      return data ?? [];
    },
  }),
  // Real query shape (project-scoped analysis_run, item_count > 0, boq_id
  // not null, newest first) against the same mocked supabase client, so
  // this test file drives the real selection contract via analyzedBoqIdRef
  // rather than a hardcoded yes/no stub.
  useMostRecentlyAnalyzedBoqId: (projectId: string) => useQuery({
    queryKey: ["workspace-most-analyzed-boq", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("analysis_run")
        .select("boq_id, created_at").eq("project_id", projectId)
        .gt("item_count", 0).not("boq_id", "is", null)
        .order("created_at", { ascending: false }).limit(1);
      return (data as { boq_id: string }[] | null)?.[0]?.boq_id ?? null;
    },
  }),
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

describe("ProjectWorkspace — mobile 'Review & Identify' CTA on the drawing canvas", () => {
  // Mobile lands on the "canvas" pane by default once a document is
  // selected (see initialMobilePanel) — this is the exact pane the live
  // bug report described as showing "Evidence coordinates unavailable"
  // with no visible way to reach Identify.
  it("appears on the mobile canvas pane when the project has a BOQ", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1");
    expect(await screen.findByRole("button", { name: /review & identify/i })).toBeInTheDocument();
  });

  it("tapping it enters the existing Review/BoqReviewWorkstation takeover, preserving the project id and the BOQ id", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1");
    const cta = await screen.findByRole("button", { name: /review & identify/i });
    fireEvent.click(cta);
    // BoqReviewWorkstation is mocked above to echo its boqId prop — this
    // proves the CTA reused the real onEnterMode("review", boqId) path
    // (not a new navigation state), landing on the SAME takeover the
    // Context panel's own "Review" button uses, with the project id still
    // in the route (MemoryRouter would 404 otherwise) and the real BOQ id
    // ("boq-1" from the mocked "boq" table row) carried through.
    expect(await screen.findByTestId("embedded-review")).toHaveTextContent("Review for boq-1");
  });

  it("with multiple BOQs where only one has analysis, selects the ANALYZED boq — not boqs[0] (newest-created)", async () => {
    boqRowsRef.current = [
      { id: "boq-new-no-analysis", name: "Newly created BOQ", created_at: "2026-03-01" },
      { id: "boq-old-analyzed", name: "Elevation & Facade", created_at: "2026-01-01" },
    ];
    analyzedBoqIdRef.current = "boq-old-analyzed";
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1");
    const cta = await screen.findByRole("button", { name: /review & identify/i });
    fireEvent.click(cta);
    expect(await screen.findByTestId("embedded-review")).toHaveTextContent("Review for boq-old-analyzed");
  });

  it("with multiple BOQs and NONE analyzed, falls back to boqs[0] (newest-created) — the pre-existing behavior", async () => {
    boqRowsRef.current = [
      { id: "boq-newest", name: "Newest BOQ", created_at: "2026-03-01" },
      { id: "boq-older", name: "Older BOQ", created_at: "2026-01-01" },
    ];
    // analyzedBoqIdRef stays null (afterEach default) — nothing analyzed yet.
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1");
    const cta = await screen.findByRole("button", { name: /review & identify/i });
    fireEvent.click(cta);
    expect(await screen.findByTestId("embedded-review")).toHaveTextContent("Review for boq-newest");
  });

  it("does NOT appear when the project has no BOQ yet", async () => {
    boqRowsRef.current = [];
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1");
    expect(first(await screen.findAllByTestId("canvas"))).toHaveTextContent("doc:doc-1 page:none"); // canvas pane has rendered
    expect(screen.queryByRole("button", { name: /review & identify/i })).not.toBeInTheDocument();
  });

  it("leaves the rest of the mobile canvas pane (Sources/Context nav, the drawing itself) unchanged", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1");
    expect(first(await screen.findAllByTestId("canvas"))).toHaveTextContent("doc:doc-1 page:none");
    // Two of each: the always-present header icon buttons (aria-label=
    // "Sources"/"Context") plus this pane's own "← Sources"/"Context →"
    // nav row — unrelated to this change, just confirming neither was
    // removed by the new banner sitting between that row and the canvas.
    expect(screen.getAllByRole("button", { name: /^sources$/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^context$/i })).toHaveLength(2);
  });

  it("does not add this CTA anywhere in the desktop layout (desktop already shows Review permanently in the right rail)", async () => {
    renderWorkspace("/ops/projects/proj-1/workspace?document=doc-1");
    await screen.findByRole("button", { name: /review & identify/i });
    // Exactly one — the mobile canvas pane's banner. Desktop's own
    // always-visible "Review" entry lives inside the (mocked) Context
    // component, not as a second copy of this CTA.
    expect(screen.getAllByRole("button", { name: /review & identify/i })).toHaveLength(1);
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
