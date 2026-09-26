// DocumentLocationExtraction — the document-level LOCATION entry point that
// replaces the old BOQ-Review-internal "Run LOCATION test" control. Mocks
// src/lib/ai/analysisClient.ts (the ONLY network boundary this component
// uses) so this exercises the real component logic with zero network calls.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DocumentLocationExtraction from "./DocumentLocationExtraction";
import * as analysisClient from "@/lib/ai/analysisClient";

vi.mock("@/lib/ai/analysisClient", async () => {
  const actual = await vi.importActual<typeof analysisClient>("@/lib/ai/analysisClient");
  return { ...actual, fetchPreflight: vi.fn(), generateAnalysis: vi.fn(), showInternalAiControls: vi.fn(() => false) };
});

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
    await screen.findByText("AI generation is not configured on the server.");
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
