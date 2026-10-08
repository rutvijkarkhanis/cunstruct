// WorkspaceAnalyzePanel — Phase A. Exercises the three-step Analyze Project
// flow end-to-end against mocked dependencies: explicit multi-discipline
// document assignment -> orchestrated AI calls -> readiness rollup +
// exception review, all without touching Supabase or OpenAI.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import WorkspaceAnalyzePanel from "./WorkspaceAnalyzePanel";

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

function renderPanel() {
  const qc = new QueryClient();
  const onEnterMode = vi.fn();
  const result = render(
    <QueryClientProvider client={qc}>
      <WorkspaceAnalyzePanel projectId="proj-1" onEnterMode={onEnterMode} />
    </QueryClientProvider>,
  );
  return { ...result, onEnterMode };
}

describe("WorkspaceAnalyzePanel — assignment step", () => {
  beforeEach(() => { createBoq.mockClear(); generateAnalysis.mockClear(); });

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
  beforeEach(() => { createBoq.mockClear(); generateAnalysis.mockClear(); });

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
});
