// Regression test — latestLocationRunForDocument(projectId, docId, "") bug
// (Phase A investigation). The content-hash fallback inside
// latestLocationRunForDocument requires the EXACT model preflight resolved
// for this project's LOCATION eligibility (its own doc comment); passing a
// literal empty string there can never match a real analysis_run_source row,
// silently disabling that fallback for every reviewer. This proves
// BoqReviewWorkstation now resolves the real model via fetchPreflight's
// admin-only `internal.model` (same source DocumentLocationExtraction.tsx
// already uses) and passes THAT through, not "".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import type { StoredReviewItem } from "@/lib/review/reviewStore";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const w1: StoredReviewItem = {
  id: "item-w1", reviewStatus: "VERIFIED",
  ai: {
    key: "W1", item: "Window W1", quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    source: { documentId: "doc-1", document: "plan.pdf", page: 1, evidence: [{ bbox: [1, 1, 2, 2], page: 1, claim: "quantity" }] },
  },
};

vi.mock("@/lib/review/reviewStore", () => ({
  latestRunForBoq: vi.fn(async () => ({ id: "run-1", source: "json_import", item_count: 1, created_at: "2026-01-01T00:00:00Z", resolved_document_id: "doc-1" })),
  loadReviewItems: vi.fn(async () => [w1]),
  saveReviewDecision: vi.fn(async () => {}),
  createAnalysisRun: vi.fn(),
  updateResolvedDocument: vi.fn(),
}));

vi.mock("@/lib/review/drawingStorage", () => ({
  loadProjectDrawings: vi.fn(async () => [{ documentId: "doc-1", name: "Ground Floor Plan.pdf", filePath: "proj-1/doc-1/rev-1.pdf", pageCount: 1 }]),
  signedDrawingUrl: vi.fn(async () => "https://signed.example/plan.pdf"),
}));

const latestLocationRunForDocument = vi.fn(async () => ({ status: "NOT_RUN" as const, runId: null, claimedAt: null, completedAt: null, error: null }));
vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: (...args: unknown[]) => latestLocationRunForDocument(...args),
  loadLocationObservations: vi.fn(async () => []),
}));

// The exact admin-only shape fetchPreflight's real edge-function response
// carries — DocumentLocationExtraction.tsx already relies on this same
// `internal.model` field for the identical reason.
const ADMIN_PREFLIGHT = {
  ok: true,
  preflight: { mode: "LOCATION" as const },
  internal: { provider: "openai", model: "gpt-5-location-real-model", contractVersion: "v1", forceReanalyse: false, estimatedCost: { lowUsd: 0, highUsd: 0, basis: "page_count" as const } },
};
const fetchPreflight = vi.fn(async () => ADMIN_PREFLIGHT);
vi.mock("@/lib/ai/analysisClient", () => ({
  fetchPreflight: (...args: unknown[]) => fetchPreflight(...args),
}));

beforeEach(() => {
  latestLocationRunForDocument.mockClear();
  fetchPreflight.mockReset();
  fetchPreflight.mockResolvedValue(ADMIN_PREFLIGHT);
});

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

vi.mock("@/components/review/PdfEvidenceViewer", () => ({ default: () => <div data-testid="pdf-probe" /> }));

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

describe("BoqReviewWorkstation — LOCATION fallback model resolution", () => {
  it("resolves the real model via fetchPreflight's internal.model and passes it to latestLocationRunForDocument, never a hardcoded empty string", async () => {
    renderPage();
    await screen.findByTestId("pdf-probe");
    await waitFor(() => expect(latestLocationRunForDocument).toHaveBeenCalled());
    const [, , model] = latestLocationRunForDocument.mock.calls[0];
    expect(model).toBe("gpt-5-location-real-model");
    expect(model).not.toBe("");
  });

  it("calls fetchPreflight scoped to this project in LOCATION mode with no boqId, same identity DocumentLocationExtraction.tsx's own admin-check query uses", async () => {
    renderPage();
    await waitFor(() => expect(fetchPreflight).toHaveBeenCalledWith({ projectId: "proj-1", boqId: null, mode: "LOCATION" }));
  });

  it("degrades to the empty string (today's exact pre-fix behavior) for a non-admin caller, whose preflight response carries no internal block", async () => {
    fetchPreflight.mockResolvedValue({ ok: true, preflight: { mode: "LOCATION" as const } } as never);
    renderPage();
    await screen.findByTestId("pdf-probe");
    await waitFor(() => expect(latestLocationRunForDocument).toHaveBeenCalled());
    const [, , model] = latestLocationRunForDocument.mock.calls[0];
    expect(model).toBe("");
  });
});
