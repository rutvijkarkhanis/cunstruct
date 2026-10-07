import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkspaceContext from "./WorkspaceContext";

const BOQS = [{ id: "boq-1", name: "Ground Floor BOQ", created_at: "2026-01-01T00:00:00Z" }];
// Mutable per-test fixture for the "boq" table, defaulting to BOQS — lets
// a test add a second, newer BOQ to prove Review's target follows
// analysis, not boqs[0], without disturbing every other test's fixture.
const boqRowsRef = { current: BOQS as { id: string; name: string; created_at: string }[] };
const LINES = [
  { id: "line-1", qty: 10, dsr_rate: 100, custom_rate: null, included: true },
  { id: "line-2", qty: 5, dsr_rate: 50, custom_rate: null, included: false },
];
const LINKED_LINES = [{ id: "line-1", description: "SPC flooring", catalog_product_id: "prod-1", catalog_price: 2500, unit: "sqft", qty: 100 }];
const PRODUCTS = [{ id: "prod-1", name: "SPC Click-Lock Flooring", selling_price: 2500, unit: "sqft", brand: "Acme" }];

function chain(getResult: () => { data: unknown; error: null }) {
  const obj: Record<string, unknown> = {};
  ["select", "eq", "order", "in", "not", "gt", "limit"].forEach((m) => { obj[m] = () => obj; });
  (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve(getResult());
  return obj;
}

// Mutable per-test fixture for useMostRecentlyAnalyzedBoqId's own query —
// null (the default) means no BOQ in this project has been analyzed yet,
// matching every test below unless it opts in, so the pre-existing
// "boq-1" assertions keep exercising the same newest-BOQ fallback as
// before this fix.
const analyzedBoqIdRef = { current: null as string | null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "boq") return chain(() => ({ data: boqRowsRef.current, error: null }));
      if (table === "project_document") return chain(() => ({ data: null, error: null }));
      if (table === "boq_line") return chain(() => ({ data: LINES, error: null }));
      if (table === "analysis_run") {
        return chain(() => ({ data: analyzedBoqIdRef.current ? [{ boq_id: analyzedBoqIdRef.current }] : [], error: null }));
      }
      return chain(() => ({ data: [], error: null }));
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "products_master") return chain(() => ({ data: PRODUCTS, error: null }));
      return chain(() => ({ data: [], error: null }));
    },
  },
}));

afterEach(() => {
  boqRowsRef.current = BOQS;
  analyzedBoqIdRef.current = null;
});

function renderPanel(mode: "drawing" | "boq" | "materials" | "procurement", onEnterMode = vi.fn(), activeBoqId: string | null = null) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkspaceContext mode={mode} projectId="proj-1" activeDocumentId={null} activeBoqId={activeBoqId} onEnterMode={onEnterMode} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onEnterMode;
}

describe("WorkspaceContext — mode=drawing (home)", () => {
  it("enables context buttons once a real BOQ exists and calls onEnterMode with it", async () => {
    const onEnterMode = renderPanel("drawing");
    const reviewBtn = await screen.findByRole("button", { name: /Review/ });
    await waitFor(() => expect(reviewBtn).not.toBeDisabled());
    fireEvent.click(reviewBtn);
    expect(onEnterMode).toHaveBeenCalledWith("review", "boq-1");
  });

  // Same BOQ-selection rule as ProjectWorkspace's mobile "Review & Identify"
  // CTA (both call useMostRecentlyAnalyzedBoqId) — proving this desktop
  // "Review" button picks the SAME boq a real project with multiple BOQs
  // would, not the independent boqs[0] heuristic it used before this fix.
  it("Review targets the analyzed BOQ, not boqs[0], when a newer-but-unanalyzed BOQ also exists", async () => {
    boqRowsRef.current = [
      { id: "boq-newer-no-analysis", name: "Newer BOQ", created_at: "2026-03-01T00:00:00Z" },
      { id: "boq-1", name: "Ground Floor BOQ", created_at: "2026-01-01T00:00:00Z" },
    ];
    analyzedBoqIdRef.current = "boq-1";
    const onEnterMode = renderPanel("drawing");
    const reviewBtn = await screen.findByRole("button", { name: /Review/ });
    await waitFor(() => expect(reviewBtn).not.toBeDisabled());
    fireEvent.click(reviewBtn);
    expect(onEnterMode).toHaveBeenCalledWith("review", "boq-1");
  });

  it("still falls back to boqs[0] (newest-created) when nothing is analyzed — unchanged pre-existing behavior", async () => {
    boqRowsRef.current = [
      { id: "boq-newest", name: "Newest BOQ", created_at: "2026-03-01T00:00:00Z" },
      { id: "boq-older", name: "Older BOQ", created_at: "2026-01-01T00:00:00Z" },
    ];
    // analyzedBoqIdRef stays null (afterEach default).
    const onEnterMode = renderPanel("drawing");
    const reviewBtn = await screen.findByRole("button", { name: /Review/ });
    await waitFor(() => expect(reviewBtn).not.toBeDisabled());
    fireEvent.click(reviewBtn);
    expect(onEnterMode).toHaveBeenCalledWith("review", "boq-newest");
  });

  it("the BOQ/Materials buttons' own newest-BOQ default is untouched by this fix", async () => {
    boqRowsRef.current = [
      { id: "boq-newer-no-analysis", name: "Newer BOQ", created_at: "2026-03-01T00:00:00Z" },
      { id: "boq-1", name: "Ground Floor BOQ", created_at: "2026-01-01T00:00:00Z" },
    ];
    analyzedBoqIdRef.current = "boq-1";
    const onEnterMode = renderPanel("drawing");
    // Wait for the boqs query to actually settle (via the Review button's
    // disabled state, same signal the other tests use) before clicking —
    // "BOQ" has no disabled state of its own to wait on, but reads the
    // same defaultBoq, which is only populated once this resolves.
    await waitFor(() => expect(screen.getByRole("button", { name: /Review/ })).not.toBeDisabled());
    const boqBtn = screen.getByRole("button", { name: /^BOQ$/ });
    fireEvent.click(boqBtn);
    // "BOQ" (unlike "Review") was never about analysis — it still opens
    // whatever boqs[0] is, same as before this change.
    expect(onEnterMode).toHaveBeenCalledWith("boq", "boq-newer-no-analysis");
  });
});

describe("WorkspaceContext — mode=boq (Stage C3/C5A: real selector/creator, not a rebuilt editor)", () => {
  it("shows a lightweight summary computed from real boq_line rows, not the full editor", async () => {
    renderPanel("boq");
    expect(await screen.findByText("Ground Floor BOQ")).toBeInTheDocument();
    expect(await screen.findByText("2 lines")).toBeInTheDocument();
    // Subtotal = 10*100 (included); the excluded line (5*50) must NOT be
    // counted. Grand Total applies the default commercial waterfall
    // (contingency 3% + overhead 15% + cess 1% + GST 18%) via the SAME
    // computeCommercials() OpsBoqBuilder itself uses — 1000 -> 1407 — never a
    // second, competing calculation, and never mislabeled as each other.
    expect(await screen.findByText("Subtotal")).toBeInTheDocument();
    // "₹1,000" also appears in the line-item preview (line-1's own amount is
    // coincidentally the same figure as the subtotal here) — assert presence
    // via getAllByText rather than requiring a single match.
    expect((await screen.findAllByText("₹1,000")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Grand Total")).toBeInTheDocument();
    expect(await screen.findByText("₹1,407")).toBeInTheDocument();
  });

  it("links to the existing full BOQ editor rather than rebuilding it", async () => {
    renderPanel("boq");
    const link = await screen.findByText("Open BOQ");
    expect(link.closest("a")).toHaveAttribute("href", "/ops/projects/proj-1/boqs/boq-1");
  });
});

describe("WorkspaceContext — mode=materials (honest, data-backed only)", () => {
  it("shows the real catalog_product_id linkage joined to the real catalog", async () => {
    vi.mocked(await import("@/integrations/supabase/client")).supabase.from = ((table: string) => {
      if (table === "boq") return chain(() => ({ data: BOQS, error: null }));
      if (table === "boq_line") return chain(() => ({ data: LINKED_LINES, error: null }));
      return chain(() => ({ data: [], error: null }));
    }) as never;
    renderPanel("materials");
    expect(await screen.findByText("SPC Click-Lock Flooring")).toBeInTheDocument();
  });
});

describe("WorkspaceContext — mode=procurement (honest placeholder)", () => {
  it("never fabricates procurement data — states plainly that it isn't connected yet", async () => {
    renderPanel("procurement");
    expect(await screen.findByText(/Procurement workflows are not connected to this project workspace yet/)).toBeInTheDocument();
  });
});
