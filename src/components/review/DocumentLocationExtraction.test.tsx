// DocumentLocationExtraction — the document-level LOCATION entry point that
// replaces the old BOQ-Review-internal "Run LOCATION test" control. Mocks
// src/lib/ai/analysisClient.ts (the ONLY network boundary this component
// uses) so this exercises the real component logic with zero network calls.
// Also mocks locationObservations.ts: this component now renders the real
// DocumentLocationObservations inspector as a child, which would otherwise
// make its own real (unmocked) Supabase calls during these tests.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DocumentLocationExtraction from "./DocumentLocationExtraction";
import * as analysisClient from "@/lib/ai/analysisClient";
import * as locationObservations from "@/lib/review/locationObservations";

vi.mock("@/lib/ai/analysisClient", async () => {
  const actual = await vi.importActual<typeof analysisClient>("@/lib/ai/analysisClient");
  return { ...actual, fetchPreflight: vi.fn(), generateAnalysis: vi.fn(), showInternalAiControls: vi.fn(() => false) };
});

vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => []),
}));

function renderControl() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocumentLocationExtraction projectId="proj-1" documentId="doc-42" />
    </QueryClientProvider>,
  );
}

const basePreflight: analysisClient.PreflightSummary = {
  mode: "LOCATION",
  totalProjectFiles: 5, totalEligibleDrawingFiles: 4, filesPendingHash: 0,
  alreadyAnalysedCount: 1, newFilesCount: 3, duplicateFilesSkipped: 0, inFlightCount: 0,
  allFilesAlreadyAnalysed: false, existingRunCount: 1, latestRunId: "run-old",
  documentCompleteness: "UNKNOWN",
  willSendFiles: [], alreadyAnalysedFiles: [], duplicateGroups: [],
};

const internalBlock: analysisClient.PreflightInternal = {
  provider: "openai", model: "gpt-4o-mini", contractVersion: "cunstruct-openai-v1.0.0",
  forceReanalyse: false, estimatedCost: { lowUsd: 0.01, highUsd: 0.05, basis: "page_count" },
};

describe("DocumentLocationExtraction — admin gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when showInternalAiControls is false (never even calls fetchPreflight)", () => {
    vi.mocked(analysisClient.showInternalAiControls).mockReturnValue(false);
    const { container } = renderControl();
    expect(container).toBeEmptyDOMElement();
    expect(analysisClient.fetchPreflight).not.toHaveBeenCalled();
  });

  it("renders nothing when the flag is on but the server withholds the internal block (non-admin)", async () => {
    vi.mocked(analysisClient.showInternalAiControls).mockReturnValue(true);
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: basePreflight });
    const { container } = renderControl();
    await waitFor(() => expect(analysisClient.fetchPreflight).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Run LOCATION extraction")).not.toBeInTheDocument();
  });

  it("renders for a server-confirmed admin (flag on AND internal block present)", async () => {
    vi.mocked(analysisClient.showInternalAiControls).mockReturnValue(true);
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: basePreflight, internal: internalBlock });
    renderControl();
    await screen.findByText("Run LOCATION extraction");
    expect(screen.getByText("Document Analysis")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
  });
});

describe("DocumentLocationExtraction — request shape and result display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analysisClient.showInternalAiControls).mockReturnValue(true);
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: basePreflight, internal: internalBlock });
  });

  it("sends mode: LOCATION and exactly this document's id — no boqId, no other documents", async () => {
    vi.mocked(analysisClient.generateAnalysis).mockResolvedValue({ ok: true, generated: 1, runId: "run-loc-1", observationCount: 12, itemCount: 0 });
    renderControl();
    fireEvent.click(await screen.findByText("Run LOCATION extraction"));

    await waitFor(() => expect(analysisClient.generateAnalysis).toHaveBeenCalledWith({
      projectId: "proj-1", boqId: null, documentIds: ["doc-42"], mode: "LOCATION",
    }));
  });

  it("shows the persisted observation count on success", async () => {
    vi.mocked(analysisClient.generateAnalysis).mockResolvedValue({ ok: true, generated: 1, runId: "run-loc-1", observationCount: 7, itemCount: 0 });
    renderControl();
    fireEvent.click(await screen.findByText("Run LOCATION extraction"));
    await screen.findByText("LOCATION extraction complete — 7 observation(s) persisted");
  });

  it("shows a clear failure state instead of a false success", async () => {
    vi.mocked(analysisClient.generateAnalysis).mockResolvedValue({ ok: false, error: "AI generation is not configured on the server.", generated: 0 });
    renderControl();
    fireEvent.click(await screen.findByText("Run LOCATION extraction"));
    await screen.findByText("LOCATION extraction failed — AI generation is not configured on the server.");
  });

  // REGRESSION — this is the exact case that produced the misleading green
  // "0 observation(s) persisted" in production: nothing new was sent to the
  // extractor at all (already analysed under this contract, or in-flight
  // elsewhere), so the server's `ok:true` response has NO observationCount
  // field. The old `observationCount ?? 0` fallback rendered this identically
  // to a real zero-result extraction. It must never claim extraction ran.
  it("shows the server's own message, never a fabricated observation count, when nothing new was sent (generated: 0, no observationCount)", async () => {
    vi.mocked(analysisClient.generateAnalysis).mockResolvedValue({
      ok: true, generated: 0, message: "All uploaded files have already been analysed.",
    });
    renderControl();
    fireEvent.click(await screen.findByText("Run LOCATION extraction"));
    await screen.findByText("All uploaded files have already been analysed.");
    expect(screen.queryByText(/observation\(s\) persisted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no observations found/)).not.toBeInTheDocument();
  });

  // The extraction genuinely ran (generated: 1, a real run + claim were
  // created) and genuinely found zero location-worthy facts. This must read
  // as a distinct, honest "no observations found" — never "0 persisted"
  // (which reads as if extraction ran and populated something) and never an
  // error (a real, valid extraction that found nothing is not a failure).
  it("shows 'no observations found' when extraction genuinely ran and found zero — not '0 observation(s) persisted', not an error", async () => {
    vi.mocked(analysisClient.generateAnalysis).mockResolvedValue({
      ok: true, generated: 1, runId: "run-loc-zero", observationCount: 0, itemCount: 0,
    });
    renderControl();
    fireEvent.click(await screen.findByText("Run LOCATION extraction"));
    await screen.findByText("LOCATION extraction complete — no observations found");
    expect(screen.queryByText(/0 observation\(s\) persisted/)).not.toBeInTheDocument();
  });

  // REGRESSION — proves the cache-invalidation wiring actually does something
  // observable, not just that the code calling invalidateQueries exists. The
  // inspector (DocumentLocationExtraction's child) must reflect the NEW run
  // state after a successful extraction, not keep showing the stale state it
  // loaded on mount.
  it("a successful extraction invalidates the inspector's run-state query, which refetches and shows the updated state", async () => {
    vi.mocked(locationObservations.latestLocationRunForDocument)
      .mockResolvedValueOnce({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null })
      .mockResolvedValueOnce({ status: "SUCCEEDED", runId: "run-loc-1", claimedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z", error: null });
    vi.mocked(locationObservations.loadLocationObservations).mockResolvedValue([]);
    vi.mocked(analysisClient.generateAnalysis).mockResolvedValue({ ok: true, generated: 1, runId: "run-loc-1", observationCount: 0, itemCount: 0 });

    renderControl();

    // 1 & 2: the inspector is mounted and has already loaded the initial
    // (never-run) state — one call, before anything is clicked.
    await screen.findByText("LOCATION extraction has not been run for this document.");
    expect(locationObservations.latestLocationRunForDocument).toHaveBeenCalledTimes(1);

    // 3: the extraction mutation succeeds.
    fireEvent.click(screen.getByText("Run LOCATION extraction"));
    await screen.findByText("LOCATION extraction complete — no observations found");

    // 4: the success handler's invalidateQueries caused a second call —
    // the inspector actually re-requested the run state, it didn't just sit
    // on its first result.
    await waitFor(() => expect(locationObservations.latestLocationRunForDocument).toHaveBeenCalledTimes(2));

    // 5: and it rendered that updated state — the stale "never run" text is
    // gone, replaced by what the second call resolved to.
    await screen.findByText("No LOCATION observations were found in this document.");
    expect(screen.queryByText("LOCATION extraction has not been run for this document.")).not.toBeInTheDocument();
  });

  it("uses the preflight/generate admin-check query only once per project across multiple mounted rows", async () => {
    vi.mocked(analysisClient.generateAnalysis).mockResolvedValue({ ok: true, generated: 1, runId: "run-loc-1", observationCount: 1, itemCount: 0 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DocumentLocationExtraction projectId="proj-1" documentId="doc-a" />
        <DocumentLocationExtraction projectId="proj-1" documentId="doc-b" />
      </QueryClientProvider>,
    );
    await screen.findAllByText("Run LOCATION extraction");
    expect(analysisClient.fetchPreflight).toHaveBeenCalledTimes(1);
  });
});
