// REGRESSION — applyDecision() must never silently discard an already-saved
// reviewer correction. Found via a live end-to-end run of the conflicting-
// candidate flow: Save correction (reviewer.quantity = 25101), then Verify —
// applyDecision("VERIFIED") was called with NO `reviewer` in its opts, and the
// old code treated "no reviewer supplied" as "clear it" (`opts.reviewer ??
// null`), wiping reviewer_json back to null on every non-Edit transition
// (Verify, Flag, Mark Pending). This renders the REAL default-exported page.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import type { StoredReviewItem } from "@/lib/review/reviewStore";

const saveReviewDecision = vi.fn(async () => {});
const editedItem: StoredReviewItem = {
  id: "review-item-1",
  reviewStatus: "EDITED",
  reviewer: { quantity: 25101 },
  ai: {
    key: "SLAB-TOTAL", item: "Total slab area", quantity: null, unit: "sqft",
    confidence: null, aiStatus: "PENDING",
    candidates: [
      { value: 25176, unit: "sqft", basis: "Arithmetic sum" },
      { value: 25101, unit: "sqft", basis: "Printed total" },
    ],
  },
};

vi.mock("@/lib/review/reviewStore", () => ({
  latestRunForBoq: vi.fn(async () => ({ id: "run-1", source: "json_import", item_count: 1, created_at: "2026-01-01T00:00:00Z", resolved_document_id: null })),
  loadReviewItems: vi.fn(async () => [editedItem]),
  saveReviewDecision: (args: unknown) => saveReviewDecision(args),
  createAnalysisRun: vi.fn(),
  updateResolvedDocument: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "single", "order", "limit", "in"].forEach((m) => { obj[m] = () => obj; });
    (obj as { then: unknown }).then = (resolve: (r: typeof result) => void) => resolve(result);
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "boq") return chain({ data: { id: "boq-1", name: "Test BOQ", project_id: "proj-1" }, error: null });
        if (table === "projects") return chain({ data: { id: "proj-1", name: "Test Project", project_type: null }, error: null });
        return chain({ data: [], error: null });
      },
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    },
  };
});

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/review/boq-1"]}>
        <Routes><Route path="/review/:boqId" element={<BoqReviewWorkstation />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { saveReviewDecision.mockClear(); });

describe("clicking Verify after a prior Edit preserves the reviewer's correction", () => {
  it("saveReviewDecision is called with the EXISTING reviewer value, not null", async () => {
    renderPage();
    // The fixture item is already EDITED, which the default "needs review"
    // filter excludes — switch to "all" to bring it into view, same as a
    // reviewer would to find an item they already corrected.
    (await screen.findByText("all")).click();
    const verifyBtn = await screen.findByText("Verify", { exact: true });
    await waitFor(() => expect(verifyBtn.closest("button")).not.toBeDisabled());
    verifyBtn.click();

    await waitFor(() => expect(saveReviewDecision).toHaveBeenCalled());
    const call = saveReviewDecision.mock.calls[0][0] as { reviewStatus: string; reviewer: unknown };
    expect(call.reviewStatus).toBe("VERIFIED");
    expect(call.reviewer).toEqual({ quantity: 25101 }); // NOT null — this is the regression
  });
});

describe("clicking Flag or Mark Pending after a prior Edit also preserves the reviewer's correction", () => {
  it("Mark Pending carries the reviewer value forward", async () => {
    renderPage();
    (await screen.findByText("all")).click();
    const pendingBtn = await screen.findByText("Mark Pending", { exact: false });
    pendingBtn.click();

    await waitFor(() => expect(saveReviewDecision).toHaveBeenCalled());
    const call = saveReviewDecision.mock.calls[0][0] as { reviewStatus: string; reviewer: unknown };
    expect(call.reviewStatus).toBe("MARKED_PENDING");
    expect(call.reviewer).toEqual({ quantity: 25101 });
  });
});
