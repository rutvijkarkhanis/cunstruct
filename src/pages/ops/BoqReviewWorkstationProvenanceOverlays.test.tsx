// Evidence-viewer overlays × revision provenance. LOCATION markers come from
// the document's latest LOCATION run and Identify / Find Similar analyse the
// document's CURRENT revision server-side, so neither may be used on a
// drawing whose provenance is not confirmed current (revisionFreshness.ts).
// Real BoqReviewWorkstation, real assessRunFreshness / drawingMarkers /
// typeInstances; only the network boundary and PdfEvidenceViewer (a probe)
// are mocked. The Supabase stand-in is SIMULATED — it proves the component's
// wiring, not PostgREST, RLS, or real concurrency.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import { identifyAtPoint } from "@/lib/ai/identifyClient";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import type { DrawingMarker } from "@/lib/review/drawingMarkers";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

type Provenance = "current" | "stale" | "unknown" | "checking";
const state = vi.hoisted(() => ({
  provenance: "current" as "current" | "stale" | "unknown" | "checking",
  // The revision each LOCATION observation was pinned to (null = since deleted, unknown).
  observationRevisions: ["rev-a", "rev-a"] as (string | null)[],
}));

const w1: StoredReviewItem = {
  id: "item-w1", reviewStatus: "PENDING_REVIEW",
  ai: {
    key: "W1", item: "Window W1", quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    source: { documentId: "doc-1", document: "plan.pdf", page: 1, evidence: [{ bbox: [1, 1, 2, 2], page: 1, claim: "quantity" }] },
  },
};

vi.mock("@/lib/review/reviewStore", () => ({
  latestRunForBoq: vi.fn(async () => ({ id: "run-1", source: "ai_api", item_count: 1, created_at: "2026-01-01T00:00:00Z", resolved_document_id: null })),
  loadReviewItems: vi.fn(async () => [w1]),
  saveReviewDecision: vi.fn(async () => {}),
  createAnalysisRun: vi.fn(),
  updateResolvedDocument: vi.fn(),
}));

vi.mock("@/lib/review/drawingStorage", () => ({
  loadProjectDrawings: vi.fn(async () => [{ documentId: "doc-1", name: "Ground Floor Plan", filePath: "proj-1/doc-1/rev-b.pdf", pageCount: 1 }]),
  signedDrawingUrl: vi.fn(async () => "https://signed.example/plan.pdf"),
}));

// Two real LOCATION instances of W1 — from the document's latest LOCATION run.
vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "SUCCEEDED", runId: "loc-run-1", claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => state.observationRevisions.map((revisionId, i) => ({
    id: `obs-${i + 1}`, observationType: "opening", mark: "W1", scopeHint: null, locationText: null, attributes: {},
    evidence: { evidence: [{ bbox: [10 + 20 * i, 10 + 20 * i, 20 + 20 * i, 20 + 20 * i], page: 1 }] },
    evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z", documentId: "doc-1", revisionId,
  }))),
}));

vi.mock("@/lib/ai/identifyClient", () => ({
  identifyAtPoint: vi.fn(async () => ({
    ok: true,
    result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 100, y: 200 }, candidates: [{ label: "Door", description: "Single leaf door", confidence: 0.8, evidence: [] }] },
  })),
}));
vi.mock("@/lib/ai/findSimilarClient", () => ({ findSimilar: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: () => { data: unknown; error: null } | null) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "single", "order", "limit", "in"].forEach((m) => { obj[m] = () => obj; });
    // null = the query never settles (the freshness check is still running).
    (obj as { then: unknown }).then = (resolve: (r: unknown) => void) => { const r = result(); if (r) resolve(r); };
    return obj;
  };
  // rev-a was analysed. "current": rev-a is still current. "stale": rev-b is
  // now current. "unknown": no run-source claim (e.g. a JSON import).
  const revisions = [
    { id: "rev-a", document_id: "doc-1", label: "Rev A", file_path: "proj-1/doc-1/rev-a.pdf" },
    { id: "rev-b", document_id: "doc-1", label: "Rev B", file_path: "proj-1/doc-1/rev-b.pdf" },
  ];
  return {
    supabase: {
      from: (table: string) => {
        if (table === "boq") return chain(() => ({ data: { id: "boq-1", name: "Test BOQ", project_id: "proj-1" }, error: null }));
        if (table === "projects") return chain(() => ({ data: { id: "proj-1", name: "Test Project", project_type: null }, error: null }));
        if (table === "project_document") {
          return chain(() => ({ data: [{ id: "doc-1", name: "Ground Floor Plan", current_revision_id: state.provenance === "current" ? "rev-a" : "rev-b" }], error: null }));
        }
        if (table === "document_revision") return chain(() => ({ data: revisions, error: null }));
        if (table === "analysis_run_source") {
          return chain(() => (state.provenance === "checking" ? null
            : { data: state.provenance === "unknown" ? [] : [{ document_id: "doc-1", document_revision_id: "rev-a", status: "SUCCEEDED" }], error: null }));
        }
        return chain(() => ({ data: [], error: null }));
      },
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    },
  };
});

// Probe: exposes what the real workstation passed down, and fires
// onIdentifyPoint the way a real drawing click would — even when Identify is
// off, to prove the handler itself refuses an unconfirmed document.
vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: {
    markers?: DrawingMarker[]; identifyModeActive?: boolean;
    onIdentifyPoint?: (args: { page: number; point: { x: number; y: number }; nearbyText: string[] }) => void;
  }) => (
    <div data-testid="pdf-probe" data-identify-active={String(!!props.identifyModeActive)}>
      {(props.markers ?? []).map((m) => <span key={m.id} data-testid={`marker-${m.kind}`}>{m.label}</span>)}
      <button type="button" onClick={() => props.onIdentifyPoint?.({ page: 1, point: { x: 100, y: 200 }, nearbyText: [] })}>simulate drawing click</button>
    </div>
  ),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/review/boq-1"]}>
        <Routes><Route path="/review/:boqId" element={<BoqReviewWorkstation />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

const identifyToggle = () => screen.getByTitle(/Click a point on the drawing to identify/);
const provenanceNotice = () => screen.queryByTestId("evidence-provenance")?.textContent ?? null;

async function expectOverlaysSuppressed(notice: RegExp) {
  await waitFor(() => expect(provenanceNotice()).toMatch(notice));
  // LOCATION instances are gone; the analysis's own evidence still shows.
  await waitFor(() => expect(screen.getAllByTestId("marker-evidence").length).toBeGreaterThan(0));
  expect(screen.queryAllByTestId("marker-instance")).toHaveLength(0);
  expect(identifyToggle()).toBeDisabled();
  expect(screen.getByTestId("pdf-probe").getAttribute("data-identify-active")).toBe("false");
  // A click reaching the handler anyway never calls the server-side identify.
  const callsBefore = vi.mocked(identifyAtPoint).mock.calls.length;
  fireEvent.click(screen.getByText("simulate drawing click"));
  await new Promise((r) => setTimeout(r, 0));
  expect(vi.mocked(identifyAtPoint).mock.calls.length).toBe(callsBefore);
}

beforeEach(() => {
  state.provenance = "current";
  state.observationRevisions = ["rev-a", "rev-a"];
  vi.mocked(identifyAtPoint).mockClear();
});

describe("evidence-viewer overlays follow revision provenance", () => {
  it("current: LOCATION markers shown and Identify works exactly as before", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("marker-instance")).toHaveLength(2));
    expect(provenanceNotice()).toBeNull();
    await waitFor(() => expect(identifyToggle()).toBeEnabled());
    fireEvent.click(identifyToggle());
    expect(screen.getByTestId("pdf-probe").getAttribute("data-identify-active")).toBe("true");
    fireEvent.click(screen.getByText("simulate drawing click"));
    await waitFor(() => expect(identifyAtPoint).toHaveBeenCalledWith(expect.objectContaining({ documentId: "doc-1" })));
    expect(await screen.findByText("Door")).toBeInTheDocument();
  });

  it.each<[Provenance, RegExp]>([
    ["stale", /^Showing Rev A, the revision this analysis read\. The current revision is now Rev B\./],
    ["unknown", /^Source revision unknown\./],
    ["checking", /^Checking which revision this analysis read/],
  ])("%s: LOCATION markers suppressed, Identify disabled and refused", async (provenance, notice) => {
    state.provenance = provenance;
    renderPage();
    await expectOverlaysSuppressed(notice);
  });

  it("current → stale while Identify is active: Identify mode is exited and LOCATION markers disappear", async () => {
    const qc = renderPage();
    await waitFor(() => expect(identifyToggle()).toBeEnabled());
    fireEvent.click(identifyToggle());
    fireEvent.click(screen.getByText("simulate drawing click"));
    expect(await screen.findByText("Door")).toBeInTheDocument();

    state.provenance = "stale";
    await qc.invalidateQueries({ queryKey: ["rw-freshness"] });

    await waitFor(() => expect(screen.getByTestId("pdf-probe").getAttribute("data-identify-active")).toBe("false"));
    expect(screen.queryByText("Door")).toBeNull(); // identify result cleared with the mode
    await expectOverlaysSuppressed(/^Showing Rev A/);
    expect(identifyAtPoint).toHaveBeenCalledTimes(1); // only the earlier, confirmed-current click
  });
});

describe("LOCATION observations are pinned to the displayed revision (provenance current)", () => {
  it("observations from an OLDER revision (the latest LOCATION run read rev-0) are not drawn; Identify still works", async () => {
    state.observationRevisions = ["rev-0", "rev-0"];
    renderPage();
    await waitFor(() => expect(identifyToggle()).toBeEnabled()); // provenance itself is current
    await waitFor(() => expect(screen.getAllByTestId("marker-evidence").length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId("marker-instance")).toHaveLength(0);
    expect(provenanceNotice()).toBeNull();
  });

  it("observations whose revision is unknown (deleted since: revision_id null) are not drawn", async () => {
    state.observationRevisions = [null, null];
    renderPage();
    await waitFor(() => expect(identifyToggle()).toBeEnabled());
    await waitFor(() => expect(screen.getAllByTestId("marker-evidence").length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId("marker-instance")).toHaveLength(0);
  });

  it("mixed: only the observation pinned to the displayed revision is drawn", async () => {
    state.observationRevisions = ["rev-a", "rev-0", null];
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("marker-instance")).toHaveLength(1));
    expect(screen.queryAllByTestId("marker-evidence")).toHaveLength(0); // the type has a real instance, so instance markers replace evidence
  });
});
