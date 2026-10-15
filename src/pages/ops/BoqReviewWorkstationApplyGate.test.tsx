// Apply-to-BOQ in the real Review workstation: an unfinished review is never
// applied (dialog says so, Apply is disabled, the BOQ write is never called),
// the dialog has an accessible title, and a finished Apply leaves a receipt
// that survives a remount (reload) in the same tab until dismissed.
// Harness as BoqReviewWorkstationIdentify.test.tsx: real component, network
// modules mocked, applyReviewPlan (the BOQ-mutating call) is a spy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import { applyReviewPlan } from "@/lib/review/applyReview";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import { receiptStorageKey } from "@/lib/review/applyReceipt";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

const item = (id: string, key: string, reviewStatus: StoredReviewItem["reviewStatus"]): StoredReviewItem => ({
  id, reviewStatus,
  ai: {
    key, item: `Window ${key}`, quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    source: { documentId: "doc-1", document: "plan.pdf", page: 1, evidence: [{ bbox: [1, 1, 2, 2], page: 1, claim: "quantity" }] },
  },
});
let items: StoredReviewItem[] = [];

vi.mock("@/lib/review/reviewStore", () => ({
  latestRunForBoq: vi.fn(async () => ({ id: "run-1", source: "json_import", item_count: 2, created_at: "2026-01-01T00:00:00Z", resolved_document_id: "doc-1" })),
  loadReviewItems: vi.fn(async () => items),
  saveReviewDecision: vi.fn(async () => {}),
  createAnalysisRun: vi.fn(),
  updateResolvedDocument: vi.fn(),
}));
vi.mock("@/lib/review/drawingStorage", () => ({
  loadProjectDrawings: vi.fn(async () => [{ documentId: "doc-1", name: "Ground Floor Plan.pdf", filePath: "proj-1/doc-1/rev-1.pdf", pageCount: 1 }]),
  signedDrawingUrl: vi.fn(async () => "https://signed.example/plan.pdf"),
}));
vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => []),
}));
vi.mock("@/lib/review/applyReview", async () => {
  const actual = await vi.importActual<typeof import("@/lib/review/applyReview")>("@/lib/review/applyReview");
  return { ...actual, applyReviewPlan: vi.fn() };
});
vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "single", "order", "limit", "in", "maybeSingle"].forEach((m) => { obj[m] = () => obj; });
    (obj as { then: unknown }).then = (resolve: (r: typeof result) => void) => resolve(result);
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "boq") return chain({ data: { id: "boq-1", name: "Test BOQ", project_id: "proj-1" }, error: null });
        if (table === "projects") return chain({ data: { id: "proj-1", name: "Test Project", project_type: null }, error: null });
        if (table === "project_document") return chain({ data: [{ id: "doc-1", name: "doc-1", current_revision_id: "rev-doc-1" }], error: null });
        if (table === "document_revision") return chain({ data: [{ id: "rev-doc-1", document_id: "doc-1", label: "Rev A" }], error: null });
        if (table === "analysis_run_source") return chain({ data: [{ document_id: "doc-1", document_revision_id: "rev-doc-1", status: "SUCCEEDED" }], error: null });
        return chain({ data: [], error: null });
      },
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    },
  };
});
vi.mock("@/components/review/PdfEvidenceViewer", () => ({ default: () => <div data-testid="pdf-probe" /> }));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/review/boq-1"]}>
        <Routes><Route path="/review/:boqId" element={<BoqReviewWorkstation />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const applyDialog = () => screen.getByRole("dialog", { name: "Apply reviewed quantities" });

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(applyReviewPlan).mockReset().mockResolvedValue({
    appliedCount: 1, unresolvedCount: 0, conflictedReviewItemIds: [], auditLogFailedReviewItemIds: [],
  } as unknown as Awaited<ReturnType<typeof applyReviewPlan>>);
});

describe("Apply — unfinished review is never applied", () => {
  beforeEach(() => { items = [item("i1", "W1", "VERIFIED"), item("i2", "W2", "PENDING_REVIEW")]; });

  it("opens with a titled dialog that says the review is not finished, and keeps Apply disabled", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Apply \(1\)$/ }));
    const dialog = applyDialog();
    expect(within(dialog).getByText("Review not finished")).toBeInTheDocument();
    expect(within(dialog).queryByText("Review complete")).toBeNull();
    expect(within(dialog).getByText(/1 item still needs a review decision/)).toBeInTheDocument();
    const apply = within(dialog).getByRole("button", { name: /Apply 1 to BOQ/ });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(applyReviewPlan).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue reviewing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Apply — finished review, persistent receipt", () => {
  beforeEach(() => { items = [item("i1", "W1", "VERIFIED"), item("i2", "W2", "FLAGGED")]; });

  it("applies, then keeps a receipt on screen and across a remount until dismissed", async () => {
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Review complete.*Apply to BOQ/ }));
    const dialog = applyDialog();
    expect(within(dialog).getByText("Review complete")).toBeInTheDocument();
    const apply = within(dialog).getByRole("button", { name: /Apply 1 to BOQ/ });
    await waitFor(() => expect(apply).toBeEnabled()); // once revision freshness is confirmed
    await act(async () => { fireEvent.click(apply); });
    expect(applyReviewPlan).toHaveBeenCalledTimes(1);

    const receipt = await screen.findByRole("region", { name: /Applied 1 change to the BOQ/ });
    expect(within(receipt).getByText(/2 items reviewed · 1 verified · 0 corrected/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(receiptStorageKey("boq-1"))).not.toBeNull();

    unmount();
    renderPage();
    const again = await screen.findByRole("region", { name: /Applied 1 change to the BOQ/ });
    fireEvent.click(within(again).getByRole("button", { name: "Dismiss apply result" }));
    expect(screen.queryByRole("region", { name: /Applied 1 change/ })).toBeNull();
    expect(window.sessionStorage.getItem(receiptStorageKey("boq-1"))).toBeNull();
  });

  it("keeps the unaudited-history warning on the receipt", async () => {
    vi.mocked(applyReviewPlan).mockResolvedValue({
      appliedCount: 1, unresolvedCount: 0, conflictedReviewItemIds: [], auditLogFailedReviewItemIds: ["i1"],
    } as unknown as Awaited<ReturnType<typeof applyReviewPlan>>);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Review complete.*Apply to BOQ/ }));
    const apply = within(applyDialog()).getByRole("button", { name: /Apply 1 to BOQ/ });
    await waitFor(() => expect(apply).toBeEnabled());
    await act(async () => { fireEvent.click(apply); });
    const receipt = await screen.findByRole("region", { name: /Applied 1 change/ });
    expect(within(receipt).getByText(/Change history was NOT recorded for 1 item/)).toBeInTheDocument();
  });
});
