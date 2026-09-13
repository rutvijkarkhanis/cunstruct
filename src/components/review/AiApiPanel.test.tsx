// AiApiPanel — the normal-user "Generate analysis" flow. Mocks
// src/lib/ai/analysisClient.ts (the ONLY network boundary this component
// uses) so this exercises the real component/UI logic with zero network
// calls — no real Supabase, no real OpenAI, ever.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AiApiPanel from "./AiApiPanel";
import * as analysisClient from "@/lib/ai/analysisClient";

vi.mock("@/lib/ai/analysisClient", async () => {
  const actual = await vi.importActual<typeof analysisClient>("@/lib/ai/analysisClient");
  return { ...actual, fetchPreflight: vi.fn(), generateAnalysis: vi.fn(), showInternalAiControls: vi.fn(() => false) };
});

function renderPanel(onGenerated = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <AiApiPanel projectId="proj-1" boqId="boq-1" onGenerated={onGenerated} />
    </QueryClientProvider>,
  );
  return { ...utils, onGenerated };
}

const basePreflight: analysisClient.PreflightSummary = {
  totalProjectFiles: 5, totalEligibleDrawingFiles: 4, filesPendingHash: 0,
  alreadyAnalysedCount: 1, newFilesCount: 3, duplicateFilesSkipped: 0, inFlightCount: 0,
  allFilesAlreadyAnalysed: false, existingRunCount: 1, latestRunId: "run-old",
  documentCompleteness: "UNKNOWN",
  willSendFiles: [{ documentId: "d1", filename: "Plan A.pdf" }, { documentId: "d2", filename: "Plan B.pdf" }, { documentId: "d3", filename: "Plan C.pdf" }],
  alreadyAnalysedFiles: [{ documentId: "d0", filename: "Old Plan.pdf" }],
  duplicateGroups: [],
};

describe("AiApiPanel — normal user view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows file counts from preflight and never shows model/pricing/provider text", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: basePreflight });
    renderPanel();
    await screen.findByText(/5 files in this project/);
    expect(screen.getByText(/1 already analysed/)).toBeInTheDocument();
    expect(screen.getByText(/3 new/)).toBeInTheDocument();
    expect(screen.queryByText(/gpt-4o|pricing|Estimated cost|Contract version/i)).not.toBeInTheDocument();
  });

  it("'Review files' expands to list which files are new vs already analysed, by name", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: basePreflight });
    renderPanel();
    await screen.findByText(/5 files in this project/);
    fireEvent.click(screen.getByText("Review files"));
    expect(screen.getByText("Plan A.pdf")).toBeInTheDocument();
    expect(screen.getByText("Old Plan.pdf")).toBeInTheDocument();
  });

  it("Generate analysis calls generateAnalysis and forwards the run to onGenerated", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: basePreflight });
    vi.mocked(analysisClient.generateAnalysis).mockResolvedValue({ ok: true, generated: 3, runId: "run-new", itemCount: 12 });
    const { onGenerated } = renderPanel();
    await screen.findByText(/5 files in this project/);
    fireEvent.click(screen.getByText("Generate analysis"));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith("run-new"));
  });

  it("when everything is already analysed, the button reads 'Open existing analysis' and skips the network call", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({
      ok: true,
      preflight: { ...basePreflight, newFilesCount: 0, allFilesAlreadyAnalysed: true, willSendFiles: [] },
    });
    const { onGenerated } = renderPanel();
    await screen.findByText(/0 new/);
    const btn = screen.getByText("Open existing analysis");
    expect(btn.closest("button")).not.toBeDisabled();
    fireEvent.click(btn);
    expect(analysisClient.generateAnalysis).not.toHaveBeenCalled();
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith("run-old"));
  });

  it("Generate is disabled with no PDFs uploaded at all", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({
      ok: true,
      preflight: { ...basePreflight, totalEligibleDrawingFiles: 0, newFilesCount: 0, alreadyAnalysedCount: 0, allFilesAlreadyAnalysed: false, latestRunId: null, willSendFiles: [], alreadyAnalysedFiles: [] },
    });
    renderPanel();
    await screen.findByText(/0 new/);
    expect(screen.getByText("Generate analysis").closest("button")).toBeDisabled();
  });

  it("shows a duplicate-files note when the server reports duplicates", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: { ...basePreflight, duplicateFilesSkipped: 2 } });
    renderPanel();
    await screen.findByText(/2 duplicate files/);
  });

  it("shows an in-flight note when another request is already processing a file", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: { ...basePreflight, inFlightCount: 1 } });
    renderPanel();
    await screen.findByText(/1 file currently being analysed elsewhere/);
  });

  it("surfaces a preflight error instead of crashing", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: false, error: "AI processing is not enabled for this project." });
    renderPanel();
    await screen.findByText("AI processing is not enabled for this project.");
  });

  it("does not render the internal admin panel when showInternalAiControls is false, even if the server returned internal data", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({
      ok: true, preflight: basePreflight,
      internal: { provider: "openai", model: "gpt-4o-mini", contractVersion: "v1", forceReanalyse: false, estimatedCostUsd: 0.01 },
    });
    renderPanel();
    await screen.findByText(/5 files in this project/);
    expect(screen.queryByText(/Internal \(admin\)/)).not.toBeInTheDocument();
  });
});

describe("AiApiPanel — internal admin controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analysisClient.showInternalAiControls).mockReturnValue(true);
  });

  it("shows model/provider/cost details ONLY when the server also returned an internal block (real admin)", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({
      ok: true, preflight: basePreflight,
      internal: { provider: "openai", model: "gpt-4o-mini", contractVersion: "cunstruct-openai-v1.0.0", forceReanalyse: false, estimatedCostUsd: 0.0123 },
    });
    renderPanel();
    await screen.findByText(/Internal \(admin\)/);
    expect(screen.getByText(/gpt-4o-mini/)).toBeInTheDocument();
    expect(screen.getByText(/0.0123/)).toBeInTheDocument();
  });

  it("shows nothing internal when the flag is on but the server withheld the internal block (non-admin)", async () => {
    vi.mocked(analysisClient.fetchPreflight).mockResolvedValue({ ok: true, preflight: basePreflight });
    renderPanel();
    await screen.findByText(/5 files in this project/);
    expect(screen.queryByText(/Internal \(admin\)/)).not.toBeInTheDocument();
  });
});
