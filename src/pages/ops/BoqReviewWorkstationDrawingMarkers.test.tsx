// Integration tests for the Category/Type/Instance annotation layer
// (Section 3-8 of the reference-adoption plan): real production wiring in
// BoqReviewWorkstation, from category/type/instance selection through to the
// exact `markers`/`markerContextLabel` PdfEvidenceViewer receives. Real
// drawingMarkers.ts, real typeGrouping.ts, real typeInstances.ts — only
// PdfEvidenceViewer itself is mocked (a thin probe, not a re-implementation),
// since jsdom can't render a real PDF.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import type { DrawingMarker } from "@/lib/review/drawingMarkers";

// jsdom has no ResizeObserver; the coordinate-plot fallback (EvidenceViewer)
// can mount briefly before the drawings query resolves and uses one to size
// itself — same polyfill as BoqReviewWorkstation.test.tsx's own re-link tests.
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
const w2: StoredReviewItem = {
  id: "item-w2", reviewStatus: "PENDING_REVIEW",
  ai: {
    key: "W2", item: "Window W2", quantity: 3, unit: "nos", confidence: 0.3, aiStatus: "MEASURED",
    source: { documentId: "doc-1", document: "plan.pdf", page: 1, evidence: [{ bbox: [5, 5, 6, 6], page: 1, claim: "quantity" }] },
  },
};
const d1: StoredReviewItem = {
  id: "item-d1", reviewStatus: "PENDING_REVIEW",
  ai: { key: "D1", item: "Door D1", quantity: 1, unit: "nos", confidence: 0.9, aiStatus: "MEASURED", source: { documentId: "doc-1", document: "plan.pdf", page: 1, evidence: [{ bbox: [9, 9, 10, 10], page: 1 }] } },
};

vi.mock("@/lib/review/reviewStore", () => ({
  latestRunForBoq: vi.fn(async () => ({ id: "run-1", source: "json_import", item_count: 3, created_at: "2026-01-01T00:00:00Z", resolved_document_id: "doc-1" })),
  loadReviewItems: vi.fn(async () => [w1, w2, d1]),
  saveReviewDecision: vi.fn(async () => {}),
  createAnalysisRun: vi.fn(),
  updateResolvedDocument: vi.fn(),
}));

vi.mock("@/lib/review/drawingStorage", () => ({
  loadProjectDrawings: vi.fn(async () => [{ documentId: "doc-1", name: "Ground Floor Plan.pdf", filePath: "proj-1/doc-1/rev-1.pdf", pageCount: 1 }]),
  signedDrawingUrl: vi.fn(async () => "https://signed.example/plan.pdf"),
}));

// Real LOCATION instances for W1 only — the one honest per-occurrence
// source in this fixture. W2/D1 deliberately have none (the common,
// "spatial detail unavailable" case).
vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "SUCCEEDED", runId: "loc-run-1", claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => [
    {
      id: "obs-1", observationType: "opening", mark: "W1", scopeHint: "East wing", locationText: null,
      attributes: {}, evidence: { evidence: [{ bbox: [10, 10, 20, 20], page: 1 }] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "obs-2", observationType: "opening", mark: "W1", scopeHint: "West wing", locationText: null,
      attributes: {}, evidence: { evidence: [{ bbox: [30, 30, 40, 40], page: 1 }] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    },
  ]),
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

// A thin probe, not a re-implementation: exposes exactly what the REAL
// BoqReviewWorkstation computed and passed down, so these tests verify
// production wiring rather than re-deriving expected markers themselves.
vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: { markers?: DrawingMarker[]; markerContextLabel?: string | null; onSelectMarker?: (id: string) => void }) => (
    <div data-testid="pdf-probe" data-marker-context={props.markerContextLabel ?? ""}>
      {(props.markers ?? []).map((m) => (
        <button key={m.id} type="button" data-emphasis={m.emphasis} data-kind={m.kind} onClick={() => props.onSelectMarker?.(m.id)}>
          {m.label}
        </button>
      ))}
    </div>
  ),
}));

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

describe("Category selection scopes the drawing to every type in it", () => {
  it("clicking 'Windows' shows markers for BOTH W1 and W2, none for D1", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Windows/ }));
    const probe = await screen.findByTestId("pdf-probe");
    await waitFor(() => expect(probe.getAttribute("data-marker-context")).toMatch(/^Windows/));
    // W1 has real instances -> 2 instance markers; W2 has none -> 1 evidence marker.
    expect(await screen.findByText("W1 #1")).toBeInTheDocument();
    expect(screen.getByText("W1 #2")).toBeInTheDocument();
    expect(screen.getByText("W2")).toBeInTheDocument();
    expect(screen.queryByText("D1")).toBeNull();
  });

  it("clicking 'All categories' shows markers from every category", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("All categories"));
    await screen.findByText("W1 #1");
    expect(screen.getByText("W2")).toBeInTheDocument();
    expect(screen.getByText("D1")).toBeInTheDocument();
    const probe = screen.getByTestId("pdf-probe");
    expect(probe.getAttribute("data-marker-context")).toMatch(/^All categories/);
  });
});

describe("Type selection highlights ALL of that type's real instances together", () => {
  it("selecting W1 shows both of its real instances, both secondary (nothing focused yet)", async () => {
    renderPage();
    // W1 is VERIFIED — "needs review only" (default on) hides its row.
    fireEvent.click(await screen.findByLabelText(/Needs review only/i));
    fireEvent.click(await screen.findByRole("button", { name: /^Windows/ }));
    const w1Row = await screen.findByText(/W1 — Window W1/);
    fireEvent.click(w1Row);
    const i1 = await screen.findByText("W1 #1");
    const i2 = screen.getByText("W1 #2");
    expect(i1.getAttribute("data-emphasis")).toBe("secondary");
    expect(i2.getAttribute("data-emphasis")).toBe("secondary");
  });
});

describe("Instance selection focuses one instance while keeping siblings visible", () => {
  it("clicking an instance in the inspector's own list gives it primary emphasis, its sibling stays secondary", async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText(/Needs review only/i));
    fireEvent.click(await screen.findByRole("button", { name: /^Windows/ }));
    fireEvent.click(await screen.findByText(/W1 — Window W1/));
    // The inspector's own instance-list row (existing UI from the prior phase).
    const inspectorInstanceRow = await screen.findByText(/^Instance 1/);
    fireEvent.click(inspectorInstanceRow);
    await waitFor(() => {
      const primary = screen.getByText("W1 #1");
      expect(primary.getAttribute("data-emphasis")).toBe("primary");
    });
    expect(screen.getByText("W1 #2").getAttribute("data-emphasis")).toBe("secondary");
  });
});

describe("Clicking a marker on the canvas for a DIFFERENT type drills the inspector into it", () => {
  it("clicking W2's marker while Windows category is active switches the current type to W2", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Windows/ }));
    const w2Marker = await screen.findByText("W2");
    fireEvent.click(w2Marker);
    // The inspector now shows W2's own identity line.
    await waitFor(() => expect(screen.getByText(/W2 · Window W2/)).toBeInTheDocument());
  });
});

describe("No LOCATION data — the honest fallback, never a fabricated instance", () => {
  it("D1 (no LOCATION observations at all) gets a plain evidence marker, never an invented instance", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("All categories"));
    const d1Marker = await screen.findByText("D1");
    expect(d1Marker.getAttribute("data-kind")).toBe("evidence");
  });
});
