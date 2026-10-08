// WorkspaceAnalyzePanel — Phase A. Exercises the three-step Analyze Project
// flow end-to-end against mocked dependencies: explicit multi-discipline
// document assignment -> orchestrated AI calls -> readiness rollup +
// exception review, all without touching Supabase or OpenAI.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import WorkspaceAnalyzePanel from "./WorkspaceAnalyzePanel";
import { latestLocationRunForDocument, loadLocationObservations as loadLocationObservationsMock } from "@/lib/review/locationObservations";

window.HTMLElement.prototype.scrollIntoView = () => {};

vi.mock("@/lib/review/drawingStorage", () => ({
  loadProjectDrawings: vi.fn(async () => [
    { documentId: "doc-floor-plan", name: "Ground Floor Plan.pdf", filePath: "p/doc-floor-plan/r1.pdf", pageCount: 3 },
    { documentId: "doc-electrical-layout", name: "Electrical Layout.pdf", filePath: "p/doc-electrical-layout/r1.pdf", pageCount: 2 },
  ]),
}));

vi.mock("@/hooks/useProjectBoqs", () => ({
  useProjectBoqs: () => ({ data: [] }),
}));

const createBoq = vi.fn(async ({ discipline }: { discipline?: string }) => `new-${discipline}-boq`);
vi.mock("@/hooks/useBoqManagement", () => ({
  useBoqManagement: () => ({ createBoq }),
  NEW_SCOPE: "__new__",
}));

const fetchPreflight = vi.fn(async () => ({ ok: true, preflight: { mode: "LOCATION" as const } }));
const generateAnalysis = vi.fn(async (args: { mode?: string; boqId?: string | null; documentIds?: string[] }) => ({
  ok: true, generated: 1, itemCount: 1, runId: `run-${args.boqId ?? args.documentIds?.[0]}`,
}));
vi.mock("@/lib/ai/analysisClient", () => ({
  fetchPreflight: (...args: unknown[]) => fetchPreflight(...args),
  generateAnalysis: (...args: unknown[]) => generateAnalysis(...args),
}));

const latestRunForBoq = vi.fn(async (boqId: string) => ({ id: `run-${boqId}` }));
const loadReviewItems = vi.fn(async (runId: string) => {
  if (runId === "run-new-civil-boq") {
    return [{
      id: "item-w1", reviewStatus: "PENDING_REVIEW",
      ai: { key: "W1", item: "Window W1", quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
        source: { documentId: "doc-floor-plan", document: "Ground Floor Plan.pdf", page: 1, evidence: [{ bbox: [0, 0, 1, 1], page: 1 }] } },
    }];
  }
  return [{
    id: "item-e1", reviewStatus: "PENDING_REVIEW",
    ai: { key: "E1", item: "Switchboard E1", quantity: null, confidence: null, aiStatus: "PENDING",
      source: { documentId: "doc-electrical-layout", document: "Electrical Layout.pdf", page: 1, evidence: [] } },
  }];
});
vi.mock("@/lib/review/reviewStore", () => ({
  latestRunForBoq: (...args: unknown[]) => latestRunForBoq(...(args as [string])),
  loadReviewItems: (...args: unknown[]) => loadReviewItems(...(args as [string])),
}));

vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => []),
}));

// PR #154 — the panel now wires linkAnalyzedDocuments into runProjectAnalysis;
// mocked here the same way every other I/O dependency this component imports
// already is, so this file keeps testing orchestration/UI behavior without
// touching Supabase.
const linkAnalyzedDocumentsToBoq = vi.fn(async () => {});
// Coverage orchestration wiring — this component now also assembles and
// persists Coverage signals via these real functions; mocked like every
// other I/O dependency this file imports. Empty by default (no boq_document
// links -> generateAndPersistCoverageFindings is a no-op), so every
// pre-existing test here keeps seeing today's exact BOQ/readiness behavior.
const loadBoqDocumentLinks = vi.fn(async () => [] as { boqId: string; documentId: string }[]);
vi.mock("@/lib/review/boqDocumentLinks", () => ({
  linkAnalyzedDocumentsToBoq: (...args: unknown[]) => linkAnalyzedDocumentsToBoq(...(args as [string, string[]])),
  loadBoqDocumentLinks: (...args: unknown[]) => loadBoqDocumentLinks(...(args as [string[]])),
}));

// PR #157 — the readiness panel now reads already-persisted Coverage
// finding counts; mocked here like every other I/O dependency this
// component imports, so this file keeps testing orchestration/UI behavior
// without touching Supabase. Empty by default — most existing tests here
// have no Coverage findings and must see the readiness output unchanged.
const loadActiveCoverageFindingCounts = vi.fn(async () => ({}) as Record<string, number>);
const persistCoverageFindings = vi.fn(async () => ({ runId: "run-coverage", createdCount: 0, skippedCount: 0 }));
vi.mock("@/lib/auditImport", () => ({
  loadActiveCoverageFindingCounts: (...args: unknown[]) => loadActiveCoverageFindingCounts(...(args as [string[]])),
  persistCoverageFindings: (...args: unknown[]) => persistCoverageFindings(...(args as [{ boqId: string; projectId?: string | null; signals: unknown[] }])),
}));

function renderPanel() {
  const qc = new QueryClient();
  const onEnterMode = vi.fn();
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkspaceAnalyzePanel projectId="proj-1" onEnterMode={onEnterMode} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, onEnterMode };
}

describe("WorkspaceAnalyzePanel — assignment step", () => {
  beforeEach(() => { createBoq.mockClear(); generateAnalysis.mockClear(); linkAnalyzedDocumentsToBoq.mockClear(); loadActiveCoverageFindingCounts.mockClear(); loadActiveCoverageFindingCounts.mockResolvedValue({}); loadBoqDocumentLinks.mockClear(); loadBoqDocumentLinks.mockResolvedValue([]); persistCoverageFindings.mockClear(); persistCoverageFindings.mockResolvedValue({ runId: "run-coverage", createdCount: 0, skippedCount: 0 }); });

  it("lists every project drawing with a checkbox per discipline, and the Analyze button starts disabled", async () => {
    renderPanel();
    await screen.findByText("Ground Floor Plan.pdf");
    expect(screen.getByText("Electrical Layout.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyze Project/i })).toBeDisabled();
  });

  it("checking a document for multiple disciplines previews it under EACH discipline, never forcing one choice", async () => {
    renderPanel();
    await screen.findByText("Ground Floor Plan.pdf");
    const row = screen.getByText("Ground Floor Plan.pdf").closest("tr")!;
    fireEvent.click(within(row).getByLabelText(/Assign Ground Floor Plan.pdf to Civil Works/i));
    fireEvent.click(within(row).getByLabelText(/Assign Ground Floor Plan.pdf to Electrical Works/i));

    expect(await screen.findByText("Civil Works")).toBeInTheDocument();
    expect(screen.getByText("Electrical Works")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyze Project/i })).not.toBeDisabled();
  });
});

describe("WorkspaceAnalyzePanel — running the analysis and reviewing readiness", () => {
  beforeEach(() => { createBoq.mockClear(); generateAnalysis.mockClear(); linkAnalyzedDocumentsToBoq.mockClear(); loadActiveCoverageFindingCounts.mockClear(); loadActiveCoverageFindingCounts.mockResolvedValue({}); loadBoqDocumentLinks.mockClear(); loadBoqDocumentLinks.mockResolvedValue([]); persistCoverageFindings.mockClear(); persistCoverageFindings.mockResolvedValue({ runId: "run-coverage", createdCount: 0, skippedCount: 0 }); });

  it("creates one new BOQ per assigned discipline, calls generateAnalysis once per discipline (BOQ) and once per distinct document (LOCATION), then shows the readiness rollup", async () => {
    const { onEnterMode } = renderPanel();
    await screen.findByText("Ground Floor Plan.pdf");

    const floorPlanRow = screen.getByText("Ground Floor Plan.pdf").closest("tr")!;
    fireEvent.click(within(floorPlanRow).getByLabelText(/Assign Ground Floor Plan.pdf to Civil Works/i));
    const electricalRow = screen.getByText("Electrical Layout.pdf").closest("tr")!;
    fireEvent.click(within(electricalRow).getByLabelText(/Assign Electrical Layout.pdf to Electrical Works/i));

    fireEvent.click(screen.getByRole("button", { name: /Analyze Project/i }));

    await waitFor(() => expect(createBoq).toHaveBeenCalledTimes(2));
    expect(createBoq).toHaveBeenCalledWith(expect.objectContaining({ discipline: "civil" }));
    expect(createBoq).toHaveBeenCalledWith(expect.objectContaining({ discipline: "electrical" }));

    await waitFor(() => expect(generateAnalysis).toHaveBeenCalledWith(expect.objectContaining({ mode: "BOQ", boqId: "new-civil-boq", documentIds: ["doc-floor-plan"] })));
    expect(generateAnalysis).toHaveBeenCalledWith(expect.objectContaining({ mode: "BOQ", boqId: "new-electrical-boq", documentIds: ["doc-electrical-layout"] }));
    expect(generateAnalysis).toHaveBeenCalledWith(expect.objectContaining({ mode: "LOCATION", boqId: null, documentIds: ["doc-floor-plan"] }));
    expect(generateAnalysis).toHaveBeenCalledWith(expect.objectContaining({ mode: "LOCATION", boqId: null, documentIds: ["doc-electrical-layout"] }));
    // Never one LOCATION call per discipline — exactly one per distinct document (2 documents here).
    const locationCalls = generateAnalysis.mock.calls.filter((c) => (c[0] as { mode?: string }).mode === "LOCATION");
    expect(locationCalls).toHaveLength(2);

    // PR #154: each discipline's own BOQ+documents are persisted to boq_document
    // once its own BOQ call succeeded — never one combined call for the whole run.
    await waitFor(() => expect(linkAnalyzedDocumentsToBoq).toHaveBeenCalledTimes(2));
    expect(linkAnalyzedDocumentsToBoq).toHaveBeenCalledWith("new-civil-boq", ["doc-floor-plan"]);
    expect(linkAnalyzedDocumentsToBoq).toHaveBeenCalledWith("new-electrical-boq", ["doc-electrical-layout"]);

    // Readiness: W1 (no LOCATION run) -> AMBER "Needs Review"; E1 (no quantity, no evidence) -> RED "Unresolved".
    await screen.findByText(/Ready/);
    expect(screen.getByText("1 Needs Review")).toBeInTheDocument();
    expect(screen.getByText("1 Unresolved")).toBeInTheDocument();
    expect(screen.getByText("0 Ready")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Review Exceptions/i }));
    expect(screen.getByText("Window W1")).toBeInTheDocument();
    expect(screen.getByText("Switchboard E1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Window W1").closest("tr")!);
    expect(onEnterMode).toHaveBeenCalledWith("review", "new-civil-boq");
  });

  it("PR #154: a later discipline's failed analysis call never un-persists, or blocks, an earlier discipline's already-successful mapping", async () => {
    // civil (processed first, per DISCIPLINES' fixed order) succeeds;
    // electrical (processed second) fails — queued in that exact call order.
    generateAnalysis.mockImplementationOnce(async (args: { boqId?: string | null; documentIds?: string[] }) => ({
      ok: true, generated: 1, itemCount: 1, runId: `run-${args.boqId}`,
    }));
    generateAnalysis.mockImplementationOnce(async () => ({ ok: false, generated: 0, error: "Simulated failure" }));

    renderPanel();
    await screen.findByText("Ground Floor Plan.pdf");
    fireEvent.click(within(screen.getByText("Ground Floor Plan.pdf").closest("tr")!).getByLabelText(/Assign Ground Floor Plan.pdf to Civil Works/i));
    fireEvent.click(within(screen.getByText("Electrical Layout.pdf").closest("tr")!).getByLabelText(/Assign Electrical Layout.pdf to Electrical Works/i));

    fireEvent.click(screen.getByRole("button", { name: /Analyze Project/i }));

    // Civil's mapping is persisted exactly once; Electrical's call threw
    // before ever reaching its own persistence call.
    await waitFor(() => expect(linkAnalyzedDocumentsToBoq).toHaveBeenCalledTimes(1));
    expect(linkAnalyzedDocumentsToBoq).toHaveBeenCalledWith("new-civil-boq", ["doc-floor-plan"]);
    expect(linkAnalyzedDocumentsToBoq).not.toHaveBeenCalledWith("new-electrical-boq", expect.anything());

    // The run as a whole still surfaces as a failure — Electrical's own
    // analysis genuinely did fail, and nothing here claims otherwise.
    await screen.findByText(/Simulated failure/i);
  });
});

// PR #157 — Coverage summary + navigation to the existing BOQ Audit Review.
describe("WorkspaceAnalyzePanel — Coverage readiness summary", () => {
  beforeEach(() => {
    createBoq.mockClear(); generateAnalysis.mockClear(); linkAnalyzedDocumentsToBoq.mockClear();
    loadActiveCoverageFindingCounts.mockClear();
    loadBoqDocumentLinks.mockClear(); loadBoqDocumentLinks.mockResolvedValue([]);
    persistCoverageFindings.mockClear(); persistCoverageFindings.mockResolvedValue({ runId: "run-coverage", createdCount: 0, skippedCount: 0 });
  });

  async function runAnalysis() {
    renderPanel();
    await screen.findByText("Ground Floor Plan.pdf");
    fireEvent.click(within(screen.getByText("Ground Floor Plan.pdf").closest("tr")!).getByLabelText(/Assign Ground Floor Plan.pdf to Civil Works/i));
    fireEvent.click(within(screen.getByText("Electrical Layout.pdf").closest("tr")!).getByLabelText(/Assign Electrical Layout.pdf to Electrical Works/i));
    fireEvent.click(screen.getByRole("button", { name: /Analyze Project/i }));
    await screen.findByText(/Ready/);
  }

  it("B/C: shows the total active Coverage count as an advisory badge, never a primary readiness state", async () => {
    loadActiveCoverageFindingCounts.mockResolvedValue({ "new-civil-boq": 2 });
    await runAnalysis();
    expect(screen.getAllByText("2 potential gaps").length).toBeGreaterThan(0);
    // The primary GREEN/AMBER/RED badges are unaffected — same values as the
    // no-Coverage test above.
    expect(screen.getByText("1 Needs Review")).toBeInTheDocument();
    expect(screen.getByText("1 Unresolved")).toBeInTheDocument();
  });

  it("A: zero active Coverage findings shows no gap badge at all", async () => {
    loadActiveCoverageFindingCounts.mockResolvedValue({});
    await runAnalysis();
    expect(screen.queryByText(/potential gap/)).not.toBeInTheDocument();
  });

  it("G: a Civil-only Coverage count never shows a gap badge for Electrical's own row", async () => {
    loadActiveCoverageFindingCounts.mockResolvedValue({ "new-civil-boq": 1 });
    await runAnalysis();
    const civilRow = screen.getByText("Civil Works BOQ").closest("div.rounded")!;
    const electricalRow = screen.getByText("Electrical Works BOQ").closest("div.rounded")!;
    expect(within(civilRow).getByText("1 potential gap")).toBeInTheDocument();
    expect(within(electricalRow).queryByText(/potential gap/)).not.toBeInTheDocument();
  });

  it("L: the per-BOQ Review link navigates to the existing BOQ Audit Review route for the correct BOQ, never the embedded workstation", async () => {
    loadActiveCoverageFindingCounts.mockResolvedValue({ "new-civil-boq": 1 });
    await runAnalysis();
    const civilRow = screen.getByText("Civil Works BOQ").closest("div.rounded")!;
    const reviewLink = within(civilRow).getByRole("link", { name: /review/i });
    expect(reviewLink).toHaveAttribute("href", "/ops/projects/proj-1/boqs/new-civil-boq");
  });

  it("no Review link is rendered for a BOQ with zero active Coverage findings", async () => {
    loadActiveCoverageFindingCounts.mockResolvedValue({ "new-civil-boq": 1 });
    await runAnalysis();
    const electricalRow = screen.getByText("Electrical Works BOQ").closest("div.rounded")!;
    expect(within(electricalRow).queryByRole("link", { name: /review/i })).not.toBeInTheDocument();
  });
});

// The missing orchestration wiring itself: generateAndPersistCoverageFindings
// must actually be invoked, with real boqDocumentLinks/LOCATION evidence,
// BEFORE computeProjectReadiness — using the REAL coverageOrchestration.ts/
// coverageSignals.ts/coverageFindings.ts modules (never mocked), only their
// I/O boundaries mocked.
describe("WorkspaceAnalyzePanel — Coverage generation + persistence wiring", () => {
  beforeEach(() => {
    createBoq.mockClear(); generateAnalysis.mockClear(); linkAnalyzedDocumentsToBoq.mockClear();
    loadActiveCoverageFindingCounts.mockClear(); loadActiveCoverageFindingCounts.mockResolvedValue({});
    loadBoqDocumentLinks.mockClear(); loadBoqDocumentLinks.mockResolvedValue([]);
    persistCoverageFindings.mockClear(); persistCoverageFindings.mockResolvedValue({ runId: "run-coverage", createdCount: 1, skippedCount: 0 });
    vi.mocked(latestLocationRunForDocument).mockReset();
    vi.mocked(latestLocationRunForDocument).mockResolvedValue({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null });
    vi.mocked(loadLocationObservationsMock).mockReset();
    vi.mocked(loadLocationObservationsMock).mockResolvedValue([]);
  });

  async function runAnalysis() {
    renderPanel();
    await screen.findByText("Ground Floor Plan.pdf");
    fireEvent.click(within(screen.getByText("Ground Floor Plan.pdf").closest("tr")!).getByLabelText(/Assign Ground Floor Plan.pdf to Civil Works/i));
    fireEvent.click(within(screen.getByText("Electrical Layout.pdf").closest("tr")!).getByLabelText(/Assign Electrical Layout.pdf to Electrical Works/i));
    fireEvent.click(screen.getByRole("button", { name: /Analyze Project/i }));
    await screen.findByText(/Ready/);
  }

  it("detects a LOCATION mark with no matching review item and persists it for the correct BOQ, before the results screen renders", async () => {
    loadBoqDocumentLinks.mockResolvedValue([{ boqId: "new-civil-boq", documentId: "doc-floor-plan" }]);
    vi.mocked(latestLocationRunForDocument).mockResolvedValue({ status: "SUCCEEDED", runId: "loc-run-1", claimedAt: null, completedAt: null, error: null });
    vi.mocked(loadLocationObservationsMock).mockResolvedValue([
      { id: "obs-1", observationType: "schedule_entry", mark: "D-07", scopeHint: null, locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
    ]);

    await runAnalysis();

    expect(persistCoverageFindings).toHaveBeenCalledTimes(1);
    const call = persistCoverageFindings.mock.calls[0][0] as { boqId: string; projectId?: string | null; signals: { normalizedKey: string; boqId: string }[] };
    expect(call.boqId).toBe("new-civil-boq");
    expect(call.signals).toHaveLength(1);
    expect(call.signals[0]).toMatchObject({ normalizedKey: "d-07", boqId: "new-civil-boq" });
  });

  it("persists before computeProjectReadiness reads the count — same run's results screen shows the gap it just found", async () => {
    loadBoqDocumentLinks.mockResolvedValue([{ boqId: "new-civil-boq", documentId: "doc-floor-plan" }]);
    vi.mocked(latestLocationRunForDocument).mockResolvedValue({ status: "SUCCEEDED", runId: "loc-run-1", claimedAt: null, completedAt: null, error: null });
    vi.mocked(loadLocationObservationsMock).mockResolvedValue([
      { id: "obs-1", observationType: "schedule_entry", mark: "D-07", scopeHint: null, locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    loadActiveCoverageFindingCounts.mockImplementation(async () => (persistCoverageFindings.mock.calls.length > 0 ? { "new-civil-boq": 1 } : {}));

    await runAnalysis();
    expect(screen.getAllByText("1 potential gap").length).toBeGreaterThan(0);
  });

  it("no boq_document links -> no Coverage signals, never calls persistCoverageFindings", async () => {
    loadBoqDocumentLinks.mockResolvedValue([]);
    await runAnalysis();
    expect(persistCoverageFindings).not.toHaveBeenCalled();
  });

  it("a Coverage persistence failure never surfaces as an Analyze Project failure — BOQ/readiness results still render", async () => {
    loadBoqDocumentLinks.mockResolvedValue([{ boqId: "new-civil-boq", documentId: "doc-floor-plan" }]);
    vi.mocked(latestLocationRunForDocument).mockResolvedValue({ status: "SUCCEEDED", runId: "loc-run-1", claimedAt: null, completedAt: null, error: null });
    vi.mocked(loadLocationObservationsMock).mockResolvedValue([
      { id: "obs-1", observationType: "schedule_entry", mark: "D-07", scopeHint: null, locationText: null, attributes: {}, evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    persistCoverageFindings.mockRejectedValue(new Error("DB unavailable"));

    await runAnalysis(); // must still resolve to the results screen, not "Analysis failed"
    expect(screen.queryByText(/Analysis failed/i)).not.toBeInTheDocument();
  });
});
