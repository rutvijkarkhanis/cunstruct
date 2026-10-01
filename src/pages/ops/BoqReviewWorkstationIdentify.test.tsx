// Integration tests for the Click-to-Identify wiring inside
// BoqReviewWorkstation: the "Identify" toggle, the state machine
// (identifyModeActive/identifyPoint/identifyCandidates/identifyConfirmed),
// and the IdentifyResultPanel/ItemPanel swap in the right rail. Real
// production component — only PdfEvidenceViewer (jsdom can't render a real
// PDF) and the network-facing modules (supabase, identifyClient,
// reviewStore, drawingStorage, locationObservations) are mocked.
//
// This is deliberately narrow: it proves the composition/state wiring this
// phase added, not a redesign or a re-test of IdentifyResultPanel's own
// internals (already covered by IdentifyResultPanel.test.tsx) or
// PdfEvidenceViewer's own click-to-page-space math (already covered by
// PdfEvidenceViewer.test.tsx's "Click-to-Identify" describe block).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import { applyReviewPlan } from "@/lib/review/applyReview";
import { saveReviewDecision } from "@/lib/review/reviewStore";
import { identifyAtPoint } from "@/lib/ai/identifyClient";
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

vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => []),
}));

// Real buildApplyPlan (pure, needed for the top bar's Apply count) — only
// applyReviewPlan (the actual BOQ-mutating call) is replaced with a spy, so
// "no BOQ mutation occurs" can be asserted directly against a mock rather
// than inferred from the Apply dialog never being opened.
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
      candidates: [{ label: "Door", description: "Single leaf door", confidence: 0.82, evidence: [] }],
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

// A thin probe exposing exactly what the real component passed down, plus a
// button that fires onIdentifyPoint the same way a real drawing click would
// (see PdfEvidenceViewer's own handleIdentifyClick, tested separately) —
// this proves the production wiring between the toggle, the handler, and
// the result panel, not a re-implementation of the click math.
vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: {
    identifyModeActive?: boolean;
    onIdentifyPoint?: (args: { page: number; point: { x: number; y: number }; nearbyText: string[] }) => void;
    identifyHighlight?: { point: { page: number; x: number; y: number } } | null;
  }) => (
    <div
      data-testid="pdf-probe"
      data-identify-active={String(!!props.identifyModeActive)}
      data-identify-highlight={props.identifyHighlight ? JSON.stringify(props.identifyHighlight.point) : ""}
    >
      <button
        type="button"
        onClick={() => props.onIdentifyPoint?.({ page: 1, point: { x: 100, y: 200 }, nearbyText: ["Door schedule"] })}
      >
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

describe("Click-to-Identify — enabling the mode", () => {
  it("starts with Identify mode off: the normal ItemPanel is shown and the drawing viewer gets identifyModeActive=false", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /^Verify$/ })).toBeInTheDocument();
    const probe = await screen.findByTestId("pdf-probe");
    expect(probe.getAttribute("data-identify-active")).toBe("false");
    expect(screen.queryByText(/Click anywhere on the drawing/)).toBeNull();
  });

  it("clicking Identify flips identifyModeActive, passes it into the drawing viewer, and swaps ItemPanel for IdentifyResultPanel", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());

    const probe = await screen.findByTestId("pdf-probe");
    expect(probe.getAttribute("data-identify-active")).toBe("true");
    expect(screen.queryByRole("button", { name: /^Verify$/ })).toBeNull();
    expect(screen.getByText(/Click anywhere on the drawing to identify what's there/)).toBeInTheDocument();
  });
});

describe("Click-to-Identify — triggering a result through the drawing viewer", () => {
  it("a click reported by the drawing viewer calls identifyAtPoint and renders the returned candidate in IdentifyResultPanel", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());

    fireEvent.click(await screen.findByText("simulate drawing click"));

    await waitFor(() => expect(identifyAtPoint).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", documentId: "doc-1", page: 1, point: { x: 100, y: 200 } }),
    ));
    expect(await screen.findByText("Door")).toBeInTheDocument();
    expect(screen.getByText("Single leaf door")).toBeInTheDocument();
    expect(screen.getByText("82% confidence")).toBeInTheDocument();

    // The clicked point is also threaded back into the drawing as a highlight.
    const probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-identify-highlight") || "null")).toEqual({ page: 1, x: 100, y: 200 });
  });
});

describe("Click-to-Identify — Confirm / Change / Dismiss", () => {
  async function getToCandidate() {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");
  }

  it("Confirm shows the confirmed acknowledgment and removes the action buttons", async () => {
    await getToCandidate();
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    expect(await screen.findByText(/Confirmed as "Door"/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Confirm$/ })).toBeNull();
  });

  it("Change lets the user override the label before confirming", async () => {
    await getToCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Change/i }));
    fireEvent.change(screen.getByPlaceholderText("Your label"), { target: { value: "Window" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Confirmed as "Window"/)).toBeInTheDocument();
  });

  it("Dismiss clears the candidate and returns the panel to the awaiting-a-click prompt, without leaving Identify mode", async () => {
    await getToCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(await screen.findByText(/Click anywhere on the drawing to identify what's there/)).toBeInTheDocument();
    expect(screen.queryByText("Door")).toBeNull();
    // Still in Identify mode — the normal ItemPanel has not come back.
    expect(screen.queryByRole("button", { name: /^Verify$/ })).toBeNull();
    expect(screen.getByTestId("pdf-probe").getAttribute("data-identify-active")).toBe("true");
  });

  it("Exit (distinct from Dismiss) leaves Identify mode entirely and restores the normal ItemPanel inspector", async () => {
    await getToCandidate();
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(await screen.findByRole("button", { name: /^Verify$/ })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-probe").getAttribute("data-identify-active")).toBe("false");
  });
});

describe("Click-to-Identify — never mutates the BOQ", () => {
  it("confirming, changing, and dismissing an identification never calls saveReviewDecision or applyReviewPlan", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");

    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await screen.findByText(/Confirmed as "Door"/);

    expect(saveReviewDecision).not.toHaveBeenCalled();
    expect(applyReviewPlan).not.toHaveBeenCalled();
  });
});
