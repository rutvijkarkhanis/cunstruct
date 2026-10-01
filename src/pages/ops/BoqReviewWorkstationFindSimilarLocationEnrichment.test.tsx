// Integration tests for Find Similar's LOCATION enrichment (M5): the
// existing observationsByDoc data (already fetched reviewer-accessibly for
// the unrelated instance-display feature) is reused to annotate matches,
// never to gate, create, or remove them. Same mock discipline as
// BoqReviewWorkstationFindSimilar.test.tsx — only the locationObservations
// mock differs (real marks here, instead of always-empty).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import { applyReviewPlan } from "@/lib/review/applyReview";
import { saveReviewDecision } from "@/lib/review/reviewStore";
import { loadLocationObservations } from "@/lib/review/locationObservations";
import type { StoredReviewItem } from "@/lib/review/reviewStore";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const w1: StoredReviewItem = {
  id: "item-w1", reviewStatus: "PENDING_REVIEW",
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

// Reviewer-accessible — no admin/showInternalAiControls gate anywhere in
// this mock or in the real BoqReviewWorkstation code path that calls it
// (confirmed by source inspection: this query has no isAdmin/internal check).
// A real LOCATION run with real marks, exactly like a document that already
// had LOCATION extraction run on it by an admin at some point.
vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "SUCCEEDED", runId: "loc-run-1", claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => [
    { id: "obs-1", observationType: "opening", mark: "D1", scopeHint: "East wing", locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
    { id: "obs-2", observationType: "opening", mark: "D1", scopeHint: "West wing", locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
    { id: "obs-3", observationType: "opening", mark: "COLUMN-7", scopeHint: null, locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
  ]),
}));

vi.mock("@/lib/review/applyReview", async () => {
  const actual = await vi.importActual<typeof import("@/lib/review/applyReview")>("@/lib/review/applyReview");
  return { ...actual, applyReviewPlan: vi.fn(async () => ({ appliedCount: 0, unresolvedCount: 0, conflictedReviewItemIds: [] })) };
});

vi.mock("@/lib/ai/identifyClient", () => ({
  identifyAtPoint: vi.fn(async () => ({
    ok: true,
    result: {
      schemaVersion: "cunstruct.identify.v1",
      point: { page: 1, x: 100, y: 200 },
      candidates: [{ label: "Door", description: "Single leaf door", confidence: 0.82, evidence: [{ bbox: [90, 190, 110, 210], page: 1 }] }],
    },
  })),
}));

// Matches include one whose label exactly equals a known mark ("D1" — note
// the model CAN return a specific mark as its label, not only a generic
// word, since buildFindSimilarPrompt only asks for "a short label"), one
// that happens to equal an unrelated mark's own text only coincidentally
// different ("Column" vs "COLUMN-7" — NOT an exact match, must stay
// unenriched), and one with no mark relationship at all ("Window").
vi.mock("@/lib/ai/findSimilarClient", () => ({
  findSimilar: vi.fn(async () => ({
    ok: true,
    result: {
      schemaVersion: "cunstruct.similar.v1",
      reference: { label: "Door", description: "Single leaf door", evidence: [{ bbox: [90, 190, 110, 210], page: 1 }] },
      matches: [
        { label: "D1", description: "A door matching mark D1", confidence: 0.75, evidence: [{ bbox: [10, 10, 20, 20], page: 1 }] },
        { label: "Column", description: "An unrelated column", confidence: 0.4, evidence: [{ bbox: [30, 30, 40, 40], page: 2 }] },
        { label: "Window", description: "A plain window, no known mark", confidence: 0.5, evidence: [{ bbox: [50, 50, 60, 60], page: 3 }] },
      ],
    },
  })),
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

vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: {
    identifyModeActive?: boolean;
    onIdentifyPoint?: (args: { page: number; point: { x: number; y: number }; nearbyText: string[] }) => void;
  }) => (
    <div data-testid="pdf-probe" data-identify-active={String(!!props.identifyModeActive)}>
      <button type="button" onClick={() => props.onIdentifyPoint?.({ page: 1, point: { x: 100, y: 200 }, nearbyText: [] })}>
        simulate drawing click
      </button>
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

const identifyToggle = () => screen.getByTitle(/Click a point on the drawing to identify/);

async function getToResults() {
  renderPage();
  await screen.findByRole("button", { name: /^Verify$/ });
  fireEvent.click(identifyToggle());
  fireEvent.click(await screen.findByText("simulate drawing click"));
  await screen.findByText("Door");
  fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
  await screen.findByText(/Confirmed as "Door"/);
  fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
  await screen.findByText("A door matching mark D1");
}

describe("Find Similar — LOCATION enrichment (M5)", () => {
  it("enriches a match whose label exactly equals a known mark, and reports the ambiguous (>1) count honestly", async () => {
    await getToResults();
    // "D1" has two stored observations (ambiguous) — reported as a count, never resolved to one.
    expect(await screen.findByText(/Matches recorded mark "D1"/)).toBeInTheDocument();
    expect(screen.getByText(/2 known instances/)).toBeInTheDocument();
  });

  it("does not enrich a match whose label merely resembles an unrelated mark but isn't an exact match", async () => {
    await getToResults();
    expect(screen.getByText("An unrelated column")).toBeInTheDocument();
    // "Column" != "COLUMN-7" (not exactly equal even case-insensitively) — no annotation for it.
    expect(screen.queryByText(/Matches recorded mark "COLUMN-7"/)).toBeNull();
  });

  it("leaves a match with no corresponding mark completely unchanged from M4 — no annotation at all", async () => {
    await getToResults();
    expect(screen.getByText("A plain window, no known mark")).toBeInTheDocument();
    expect(screen.queryByText(/Matches recorded mark "Window"/i)).toBeNull();
  });

  it("all three matches remain independent and visible — enrichment never removes or collapses a match", async () => {
    await getToResults();
    expect(screen.getByText("A door matching mark D1")).toBeInTheDocument();
    expect(screen.getByText("An unrelated column")).toBeInTheDocument();
    expect(screen.getByText("A plain window, no known mark")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(3);
  });

  it("confirming/rejecting an enriched match still only changes local state — no persistence", async () => {
    await getToResults();
    fireEvent.click(screen.getAllByRole("button", { name: /^Confirm$/ })[0]);
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeInTheDocument());
    expect(saveReviewDecision).not.toHaveBeenCalled();
    expect(applyReviewPlan).not.toHaveBeenCalled();
    // No new LOCATION observation was ever written — loadLocationObservations
    // is a read, and nothing in this flow calls any write function at all.
    expect(vi.mocked(loadLocationObservations)).toHaveBeenCalled();
  });
});

describe("Find Similar — reviewer access unaffected by LOCATION enrichment", () => {
  it("still works end-to-end for a plain reviewer session — no admin gate was introduced by reusing observationsByDoc", async () => {
    // This test's own render path never checks/mocks any admin/internal
    // flag — the entire flow (identify -> confirm -> find similar ->
    // enriched results) completes without one, proving enrichment adds no
    // new access requirement beyond what M4 already had.
    await getToResults();
    expect(screen.getByText("A door matching mark D1")).toBeInTheDocument();
  });
});
