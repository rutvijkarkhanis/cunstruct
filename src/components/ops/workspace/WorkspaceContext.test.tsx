import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkspaceContext from "./WorkspaceContext";

const BOQS = [{ id: "boq-1", name: "Ground Floor BOQ", created_at: "2026-01-01T00:00:00Z" }];
const LINES = [
  { id: "line-1", qty: 10, dsr_rate: 100, custom_rate: null, included: true },
  { id: "line-2", qty: 5, dsr_rate: 50, custom_rate: null, included: false },
];
const LINKED_LINES = [{ id: "line-1", description: "SPC flooring", catalog_product_id: "prod-1", catalog_price: 2500, unit: "sqft", qty: 100 }];
const PRODUCTS = [{ id: "prod-1", name: "SPC Click-Lock Flooring", selling_price: 2500, unit: "sqft", brand: "Acme" }];

function chain(getResult: () => { data: unknown; error: null }) {
  const obj: Record<string, unknown> = {};
  ["select", "eq", "order", "in", "not"].forEach((m) => { obj[m] = () => obj; });
  (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve(getResult());
  return obj;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "boq") return chain(() => ({ data: BOQS, error: null }));
      if (table === "project_document") return chain(() => ({ data: null, error: null }));
      if (table === "boq_line") return chain(() => ({ data: LINES, error: null }));
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
});

describe("WorkspaceContext — mode=boq (Stage C3: real selector/creator, not a rebuilt editor)", () => {
  it("shows a lightweight summary computed from real boq_line rows, not the full editor", async () => {
    renderPanel("boq");
    expect(await screen.findByText("Ground Floor BOQ")).toBeInTheDocument();
    // base total = 10*100 (included) ; the excluded line (5*50) must NOT be counted
    expect(await screen.findByText(/2 lines · ₹1,000 base \(excl\. markup\)/)).toBeInTheDocument();
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
