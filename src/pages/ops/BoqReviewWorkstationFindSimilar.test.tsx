// Integration tests for the Find Similar wiring inside BoqReviewWorkstation:
// the "Find Similar" action appearing after a confirmed identification, the
// state machine (findSimilarActive/findSimilarStatus/findSimilarMatches),
// and the FindSimilarResultPanel/IdentifyResultPanel/ItemPanel three-way
// swap in the right rail. Real production component — only PdfEvidenceViewer
// (jsdom can't render a real PDF) and the network-facing modules are
// mocked, same discipline as BoqReviewWorkstationIdentify.test.tsx.
//
// Deliberately narrow: proves the M4 composition/state wiring, not a
// re-test of FindSimilarResultPanel's own internals (FindSimilarResultPanel.test.tsx)
// or PdfEvidenceViewer's own similarMatches rendering math (PdfEvidenceViewer.test.tsx's
// "Find Similar matches" describe block).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import { applyReviewPlan } from "@/lib/review/applyReview";
import { saveReviewDecision } from "@/lib/review/reviewStore";
import { findSimilar } from "@/lib/ai/findSimilarClient";
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

vi.mock("@/lib/ai/findSimilarClient", () => ({
  findSimilar: vi.fn(async () => ({
    ok: true,
    result: {
      schemaVersion: "cunstruct.similar.v1",
      reference: { label: "Door", description: "Single leaf door", evidence: [{ bbox: [90, 190, 110, 210], page: 1 }] },
      matches: [
        { label: "Door", description: "On the east wall", confidence: 0.75, evidence: [{ bbox: [10, 10, 20, 20], page: 1 }] },
        { label: "Door", description: "On the west wall", confidence: 0.5, evidence: [{ bbox: [30, 30, 40, 40], page: 4 }] },
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

// Same thin probe convention as BoqReviewWorkstationIdentify.test.tsx,
// extended to also surface the new similarMatches prop.
vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: {
    identifyModeActive?: boolean;
    onIdentifyPoint?: (args: { page: number; point: { x: number; y: number }; nearbyText: string[] }) => void;
    identifyHighlight?: { point: { page: number; x: number; y: number } } | null;
    similarMatches?: { id: string; evidence: { page?: number }[]; status: string }[] | null;
  }) => (
    <div
      data-testid="pdf-probe"
      data-identify-active={String(!!props.identifyModeActive)}
      data-similar-matches={JSON.stringify(props.similarMatches ?? null)}
    >
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

async function getToConfirmedCandidate() {
  renderPage();
  await screen.findByRole("button", { name: /^Verify$/ });
  fireEvent.click(identifyToggle());
  fireEvent.click(await screen.findByText("simulate drawing click"));
  await screen.findByText("Door");
  fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
  await screen.findByText(/Confirmed as "Door"/);
}

describe("Find Similar — availability is gated on a confirmed identification", () => {
  it("is unavailable before a candidate is confirmed", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");
    // Not yet confirmed — no Find Similar action, no request, no Find Similar state shown.
    expect(screen.queryByRole("button", { name: /Find Similar/i })).toBeNull();
    expect(findSimilar).not.toHaveBeenCalled();
  });

  it("becomes available once the candidate is confirmed", async () => {
    await getToConfirmedCandidate();
    expect(screen.getByRole("button", { name: /Find Similar/i })).toBeInTheDocument();
  });
});

describe("Find Similar — triggering a search", () => {
  it("passes the confirmed candidate as the reference, unchanged", async () => {
    await getToConfirmedCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await waitFor(() => expect(findSimilar).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        documentId: "doc-1",
        reference: { label: "Door", description: "Single leaf door", evidence: [{ bbox: [90, 190, 110, 210], page: 1 }] },
      }),
    ));
  });

  it("shows a loading state while the request is pending, then swaps ItemPanel/IdentifyResultPanel for FindSimilarResultPanel", async () => {
    await getToConfirmedCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    // The panel swap and loading text appear synchronously with the click,
    // before the mocked async findSimilar() call resolves.
    expect(screen.getByText(/Searching the document/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed as "Door"/)).toBeNull();
    await screen.findByText("On the east wall");
  });
});

describe("Find Similar — rendering results", () => {
  it("renders a single match with its label/description/confidence/page", async () => {
    await getToConfirmedCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    expect(await screen.findByText("On the east wall")).toBeInTheDocument();
    expect(screen.getByText("75% confidence")).toBeInTheDocument();
    expect(screen.getByText(/page 1/)).toBeInTheDocument();
  });

  it("renders multiple matches independently, including ones spanning multiple pages", async () => {
    await getToConfirmedCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await screen.findByText("On the east wall");
    expect(screen.getByText("On the west wall")).toBeInTheDocument();
    expect(screen.getByText(/page 1/)).toBeInTheDocument();
    expect(screen.getByText(/page 4/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(2);

    // The drawing viewer receives both matches, as pending, each anchored
    // to its own page — never collapsed into one.
    const probe = await screen.findByTestId("pdf-probe");
    const similar = JSON.parse(probe.getAttribute("data-similar-matches") || "null");
    expect(similar).toHaveLength(2);
    expect(similar.map((m: { evidence: { page?: number }[] }) => m.evidence[0]?.page)).toEqual([1, 4]);
    expect(similar.every((m: { status: string }) => m.status === "pending")).toBe(true);
  });

  it("renders an honest empty state when no matches are found", async () => {
    vi.mocked(findSimilar).mockResolvedValueOnce({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [] },
    });
    await getToConfirmedCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    expect(await screen.findByText(/No similar elements found/)).toBeInTheDocument();
  });

  it("renders an error state on client/request failure, never a silently fabricated empty result", async () => {
    vi.mocked(findSimilar).mockResolvedValueOnce({ ok: false, error: "Couldn't search the document. Please try again." });
    await getToConfirmedCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    expect(await screen.findByText("Couldn't search the document. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/No similar elements found/)).toBeNull();
  });
});

describe("Find Similar — independent per-match Confirm/Reject", () => {
  async function getToResults() {
    await getToConfirmedCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await screen.findByText("On the east wall");
  }

  it("confirming one match does not confirm the other", async () => {
    await getToResults();
    const confirmButtons = screen.getAllByRole("button", { name: /^Confirm$/ });
    fireEvent.click(confirmButtons[0]);
    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    // The second match is still pending — its own Confirm/Reject remain.
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Reject$/ })).toHaveLength(1);
  });

  it("rejecting one match does not reject the other", async () => {
    await getToResults();
    const rejectButtons = screen.getAllByRole("button", { name: /^Reject$/ });
    fireEvent.click(rejectButtons[1]);
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(1);
  });

  it("confirm/reject only ever change local component state — the drawing highlight reflects the SAME local status, nothing re-fetched", async () => {
    await getToResults();
    fireEvent.click(screen.getAllByRole("button", { name: /^Confirm$/ })[0]);
    await screen.findByText("Confirmed");
    const callsBefore = vi.mocked(findSimilar).mock.calls.length;

    const probe = screen.getByTestId("pdf-probe");
    const similar = JSON.parse(probe.getAttribute("data-similar-matches") || "null");
    expect(similar[0].status).toBe("confirmed");
    expect(similar[1].status).toBe("pending");
    expect(vi.mocked(findSimilar).mock.calls.length).toBe(callsBefore); // no re-request
  });

  it("Exit from Find Similar restores the normal ItemPanel inspector", async () => {
    await getToResults();
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(await screen.findByRole("button", { name: /^Verify$/ })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-probe").getAttribute("data-identify-active")).toBe("false");
  });
});

describe("Find Similar — never mutates the BOQ", () => {
  it("displaying, confirming, and rejecting matches never calls saveReviewDecision or applyReviewPlan", async () => {
    await getToConfirmedCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await screen.findByText("On the east wall");

    fireEvent.click(screen.getAllByRole("button", { name: /^Confirm$/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Reject$/ })[0]);
    await screen.findByText("Confirmed");
    await screen.findByText("Rejected");

    expect(saveReviewDecision).not.toHaveBeenCalled();
    expect(applyReviewPlan).not.toHaveBeenCalled();
  });
});

describe("Find Similar — existing Click-to-Identify Confirm/Change/Dismiss remains intact", () => {
  it("Change still works, and the resulting confirmed label is what Find Similar would use as its reference", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");

    fireEvent.click(screen.getByRole("button", { name: /Change/i }));
    fireEvent.change(screen.getByPlaceholderText("Your label"), { target: { value: "Window" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Confirmed as "Window"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await waitFor(() => expect(findSimilar).toHaveBeenCalledWith(
      expect.objectContaining({ reference: expect.objectContaining({ label: "Window" }) }),
    ));
  });

  it("Dismiss still clears the candidate and returns to the awaiting-a-click prompt", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(await screen.findByText(/Click anywhere on the drawing to identify what's there/)).toBeInTheDocument();
  });
});
