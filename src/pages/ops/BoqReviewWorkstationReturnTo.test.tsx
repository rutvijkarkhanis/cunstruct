// Opened from the project journey (?returnTo=/app/projects/…), the review
// screen leads back there: its back button and "View updated BOQ" go to the
// journey, not the BOQ builder. Only a journey path is honoured; without one
// (or with anything else) the existing destinations are unchanged.
// Harness as BoqReviewWorkstationApplyGate.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import { saveReceipt } from "@/lib/review/applyReceipt";

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

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };
function renderAt(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/ops/projects/:id/boqs/:boqId/review" element={<BoqReviewWorkstation />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const REVIEW = "/ops/projects/proj-1/boqs/boq-1/review";
const RETURN = "/app/projects/proj-1/review?boq=boq-1";

beforeEach(() => {
  window.sessionStorage.clear();
  items = [item("i1", "W1", "VERIFIED"), item("i2", "W2", "PENDING_REVIEW")];
});

describe("Review screen — return to the project journey", () => {
  it("back returns to the journey step it was opened from", async () => {
    renderAt(`${REVIEW}?returnTo=${encodeURIComponent(RETURN)}`);
    fireEvent.click(await screen.findByRole("button", { name: "Back to project" }));
    expect(screen.getByTestId("where")).toHaveTextContent(RETURN);
  });

  it("'View updated BOQ' opens the journey's BOQ step for this BOQ", async () => {
    saveReceipt({ boqId: "boq-1", runId: "run-1", appliedAt: "2026-10-16T10:00:00Z", appliedCount: 1, unresolvedCount: 0, correctedCount: 0,
      reviewedCount: 1, verifiedCount: 1, unauditedCount: 0, conflictedCount: 0, revisionChanged: [], justAppliedLineIds: [] });
    renderAt(`${REVIEW}?returnTo=${encodeURIComponent(RETURN)}`);
    fireEvent.click(await screen.findByRole("button", { name: "View updated BOQ" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/app/projects/proj-1/boq?boq=boq-1");
  });

  it("without a journey returnTo, back still goes to the BOQ builder", async () => {
    renderAt(REVIEW);
    fireEvent.click(await screen.findByRole("button", { name: "Back to BOQ" }));
    // The existing route-relative "../boqs/<id>" (the BOQ builder under the
    // real nested /ops/projects/:id route; flat in this harness).
    expect(screen.getByTestId("where").textContent).toMatch(/\/boqs\/boq-1$/);
    expect(screen.getByTestId("where").textContent).not.toMatch(/^\/app\//);
  });

  // The link Check & finalise builds outside the workbench (ProjectExport):
  // the review screen opens on that item, already decided or not, and back
  // still returns to Check.
  it("opened from Check on one item, it shows that item and leads back to Check", async () => {
    const check = "/app/projects/proj-1/check?boq=boq-1";
    renderAt(`${REVIEW}?returnTo=${encodeURIComponent(check)}&item=i1`);
    expect(await screen.findByText("W1 · Window W1")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Needs review only/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Back to project" }));
    expect(screen.getByTestId("where")).toHaveTextContent(check);
  });

  it("ignores a returnTo outside the journey", async () => {
    renderAt(`${REVIEW}?returnTo=${encodeURIComponent("https://evil.example/app/projects/x")}`);
    fireEvent.click(await screen.findByRole("button", { name: "Back to BOQ" }));
    // The existing route-relative "../boqs/<id>" (the BOQ builder under the
    // real nested /ops/projects/:id route; flat in this harness).
    expect(screen.getByTestId("where").textContent).toMatch(/\/boqs\/boq-1$/);
    expect(screen.getByTestId("where").textContent).not.toMatch(/^\/app\//);
  });
});
