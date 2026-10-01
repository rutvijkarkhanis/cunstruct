// M6 — BOQ-boundary integration verification for the complete Find Similar
// flow (Click-to-Identify -> Confirm -> Find Similar -> matches -> optional
// LOCATION enrichment -> Confirm/Reject -> Exit).
//
// This file does not introduce any new production behavior — it exists to
// prove, with a single cohesive end-to-end test plus the explicit LOCATION-
// boundary cases, that nothing in M1-M5 has (or gained) a route to BOQ or
// analysis persistence. Where the existing M4/M5 integration suites already
// assert "the mock was never called," this file goes one step further and
// also captures real, rendered review-item state (quantity, review status,
// the reviewed/total counter) before the flow and re-asserts it is
// unchanged afterward — a stronger signal than an absent mock call alone,
// using only existing render output, no new instrumentation.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import { applyReviewPlan } from "@/lib/review/applyReview";
import { saveReviewDecision, createAnalysisRun, updateResolvedDocument } from "@/lib/review/reviewStore";
import { findSimilar } from "@/lib/ai/findSimilarClient";
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

// A real LOCATION run WITH observations — deliberately present throughout
// this whole file (including the "AI returns [] + LOCATION exists" case) so
// every test proves the boundary holds even when there is real, non-empty
// LOCATION data sitting right next to the flow.
vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "SUCCEEDED", runId: "loc-run-1", claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => [
    { id: "obs-1", observationType: "opening", mark: "D1", scopeHint: "East wing", locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
    { id: "obs-2", observationType: "opening", mark: "D1", scopeHint: "West wing", locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
    { id: "obs-3", observationType: "opening", mark: "SKYLIGHT-9", scopeHint: null, locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
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

// Mutable per-test so the "AI empty result" case can override it without a
// second mock-setup file.
const findSimilarMock = vi.fn(async () => ({
  ok: true,
  result: {
    schemaVersion: "cunstruct.similar.v1",
    reference: { label: "Door", description: "Single leaf door", evidence: [{ bbox: [90, 190, 110, 210], page: 1 }] },
    matches: [
      { label: "D1", description: "A door matching recorded mark D1", confidence: 0.75, evidence: [{ bbox: [10, 10, 20, 20], page: 1 }] },
      { label: "Window", description: "A plain window, no known mark", confidence: 0.5, evidence: [{ bbox: [50, 50, 60, 60], page: 3 }] },
    ],
  },
}));
vi.mock("@/lib/ai/findSimilarClient", () => ({ findSimilar: (...args: unknown[]) => findSimilarMock(...args) }));

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
  default: (props: { onIdentifyPoint?: (args: { page: number; point: { x: number; y: number }; nearbyText: string[] }) => void }) => (
    <div data-testid="pdf-probe">
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
const reviewedCounter = () => screen.getByText(/\d+ \/ \d+ reviewed/).textContent;

describe("M6 — complete Find Similar flow is BOQ-untouchable end to end", () => {
  it("click -> identify -> confirm -> find similar -> multiple matches -> enrichment -> confirm/reject -> exit, with BOQ/review state unchanged throughout", async () => {
    renderPage();

    // Baseline: capture the real, rendered review-item state before Identify
    // mode is ever touched.
    await screen.findByRole("button", { name: /^Verify$/ });
    const quantityBefore = screen.getByTitle("2 nos");
    expect(quantityBefore).toBeInTheDocument();
    const reviewedBefore = reviewedCounter();
    expect(reviewedBefore).toBe("0 / 1 reviewed");

    // 1. User clicks a drawing location (simulated via the mocked viewer).
    // 2. Click-to-Identify produces candidates.
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    expect(await screen.findByText("Door")).toBeInTheDocument();

    // 3. User confirms a candidate.
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await screen.findByText(/Confirmed as "Door"/);

    // 4. Find Similar becomes available. 5. Find Similar executes.
    const findSimilarBtn = screen.getByRole("button", { name: /Find Similar/i });
    expect(findSimilarBtn).toBeInTheDocument();
    fireEvent.click(findSimilarBtn);
    expect(screen.getByText(/Searching the document/)).toBeInTheDocument();

    // 6. Multiple matches are returned. 7. Optional LOCATION enrichment runs.
    // 8. Matches are displayed.
    expect(await screen.findByText("A door matching recorded mark D1")).toBeInTheDocument();
    expect(screen.getByText("A plain window, no known mark")).toBeInTheDocument();
    expect(screen.getByText(/Matches recorded mark "D1"/)).toBeInTheDocument(); // enrichment rendered inline
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(2);

    // 9. Individual matches are confirmed/rejected, independently.
    const confirmButtons = screen.getAllByRole("button", { name: /^Confirm$/ });
    fireEvent.click(confirmButtons[0]);
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeInTheDocument());
    const rejectButtons = screen.getAllByRole("button", { name: /^Reject$/ });
    fireEvent.click(rejectButtons[0]); // the remaining pending match
    await waitFor(() => expect(screen.getByText("Rejected")).toBeInTheDocument());

    // 10. The user exits the Find Similar flow.
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(await screen.findByRole("button", { name: /^Verify$/ })).toBeInTheDocument();

    // BOQ invariant: the exact same review-item state is rendered after the
    // entire flow as before it — not merely "a mock wasn't called," but the
    // actual displayed quantity and reviewed/total counter are unchanged.
    expect(screen.getByTitle("2 nos")).toBeInTheDocument();
    expect(reviewedCounter()).toBe(reviewedBefore);

    // Explicit persistence/write-path assertions.
    expect(saveReviewDecision).not.toHaveBeenCalled();
    expect(applyReviewPlan).not.toHaveBeenCalled();
    expect(createAnalysisRun).not.toHaveBeenCalled();
    expect(updateResolvedDocument).not.toHaveBeenCalled();
    // loadLocationObservations (a read) was used for enrichment; nothing
    // ever wrote back to analysis_observation — there is no write function
    // exported from this module for a mock to even represent (see the
    // module's own "every query here is a .select()" guarantee).
    expect(vi.mocked(loadLocationObservations)).toHaveBeenCalled();
  });
});

describe("M6 — LOCATION boundary: AI matches stay authoritative, LOCATION only enriches", () => {
  it("AI match + matching LOCATION observation -> enrichment only, the match itself is unchanged", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await screen.findByText(/Confirmed as "Door"/);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));

    expect(await screen.findByText("A door matching recorded mark D1")).toBeInTheDocument();
    expect(screen.getByText(/Matches recorded mark "D1"/)).toBeInTheDocument();
    expect(screen.getByText(/2 known instances/)).toBeInTheDocument(); // ambiguous, reported honestly
    // Still exactly the AI's own 2 matches — enrichment added an annotation, not a new entry.
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(2);
  });

  it("a LOCATION observation with no corresponding AI match (SKYLIGHT-9) never appears as its own entry", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await screen.findByText(/Confirmed as "Door"/);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await screen.findByText("A door matching recorded mark D1");

    expect(screen.queryByText(/SKYLIGHT-9/)).toBeNull();
    expect(screen.queryByText("A plain window, no known mark")?.closest("div")).not.toBeNull();
    // Exactly 2 match cards exist — SKYLIGHT-9's observation never became a third.
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(2);
  });

  it("an AI empty result stays empty even with real LOCATION observations present — LOCATION never manufactures a match", async () => {
    findSimilarMock.mockResolvedValueOnce({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [] },
    });
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await screen.findByText(/Confirmed as "Door"/);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));

    expect(await screen.findByText(/No similar elements found/)).toBeInTheDocument();
    expect(screen.queryByText(/Matches recorded mark/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Confirm$/ })).toBeNull();
    expect(screen.queryByText(/D1|SKYLIGHT-9/)).toBeNull();
  });

  it("multiple distinct AI matches remain independent after enrichment — confirming one never confirms or alters the other", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await screen.findByText(/Confirmed as "Door"/);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await screen.findByText("A door matching recorded mark D1");

    fireEvent.click(screen.getAllByRole("button", { name: /^Confirm$/ })[0]); // the enriched D1 match
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeInTheDocument());
    // The Window match (no enrichment) is still pending, with its own Reject available.
    expect(screen.getAllByRole("button", { name: /^Reject$/ })).toHaveLength(1);
    expect(screen.getByText("A plain window, no known mark")).toBeInTheDocument();
  });

  it("an ambiguous LOCATION association (two observations share mark D1) is reported as a count, never resolved into two separate matches or merged away", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await screen.findByText(/Confirmed as "Door"/);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await screen.findByText("A door matching recorded mark D1");

    // Exactly one "D1" annotation (not duplicated per observation), and the
    // match count stays at the AI's own 2 — ambiguity never manufactures an
    // extra match or collapses the D1 match away.
    expect(screen.getAllByText(/Matches recorded mark "D1"/)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(2);
  });
});

describe("M6 — existing Click-to-Identify behaviour is not regressed", () => {
  it("Confirm, Change, Dismiss, and candidate selection all still work exactly as before", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());
    fireEvent.click(await screen.findByText("simulate drawing click"));
    await screen.findByText("Door");

    // Change
    fireEvent.click(screen.getByRole("button", { name: /Change/i }));
    fireEvent.change(screen.getByPlaceholderText("Your label"), { target: { value: "Window" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Confirmed as "Window"/)).toBeInTheDocument();

    // A fresh click resets to a new candidate (candidate selection still works).
    fireEvent.click(screen.getByText("simulate drawing click"));
    await waitFor(() => expect(screen.getByText("Door")).toBeInTheDocument());

    // Dismiss
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(await screen.findByText(/Click anywhere on the drawing to identify what's there/)).toBeInTheDocument();
  });

  it("existing BOQ behaviour unrelated to Find Similar (Apply gating) is untouched — Apply stays unavailable with nothing verified/edited", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    expect(screen.queryByRole("button", { name: /Apply \d+ to BOQ/ })).toBeNull();
  });
});

// A consolidated, source-level audit across the WHOLE Find Similar feature
// surface (not just the M2 edge-function handler alone) — a single place
// proving the M2 structural zero-write guarantee still holds end to end.
describe("M6 — structural audit: no Find-Similar-related file has a route to BOQ/analysis persistence", () => {
  const WRITE_PATTERN = /\.insert\(|\.update\(|\.upsert\(|saveReviewDecision|applyReviewPlan/;

  const files = [
    "../../components/review/FindSimilarResultPanel.tsx",
    "../../lib/review/findSimilarLocationEnrichment.ts",
    "../../lib/review/findSimilarSchemaV1.ts",
    "../../lib/review/findSimilarPrompt.ts",
    "../../lib/ai/findSimilarClient.ts",
    "../../../supabase/functions/ai-analysis/findSimilarHandler.ts",
  ];

  for (const relativePath of files) {
    it(`${relativePath} contains no write/BOQ-mutation call`, () => {
      const source = readFileSync(join(__dirname, relativePath), "utf-8");
      expect(source).not.toMatch(WRITE_PATTERN);
    });
  }

  it("BoqReviewWorkstation.tsx's Find Similar wiring (handleFindSimilar) contains no write/BOQ-mutation call", () => {
    const source = readFileSync(join(__dirname, "BoqReviewWorkstation.tsx"), "utf-8");
    const start = source.indexOf("const handleFindSimilar = useCallback");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("}, [identifyConfirmed, identifyCandidates, identifyDocumentId, boq?.project_id, observationsByDoc]);", start);
    expect(end).toBeGreaterThan(start);
    const handlerSource = source.slice(start, end);
    expect(handlerSource).not.toMatch(WRITE_PATTERN);
  });
});
