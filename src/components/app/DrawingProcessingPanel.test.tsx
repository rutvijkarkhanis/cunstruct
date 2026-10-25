// Drawing processing: server processing is turned on only by the person,
// fingerprints are computed only through preflight, and the paid AI analysis
// is reachable only through the explicit "Analyze drawings" step (the
// existing Analyze Project panel), whose results open the existing review.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({ enabled: false, readFails: false, updates: [] as Record<string, unknown>[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (db.readFails ? { data: null, error: { message: "down" } } : { data: { id: "p1", ai_processing_enabled: db.enabled }, error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({ eq: () => ({ select: async () => { db.updates.push(patch); db.enabled = true; return { data: [{ id: "p1" }], error: null }; } }) }),
    }),
  },
}));
const fp = vi.hoisted(() => ({ compute: vi.fn() }));
vi.mock("@/lib/app/drawingFingerprints", () => ({ computeDrawingFingerprints: fp.compute }));
const ai = vi.hoisted(() => ({ generateAnalysis: vi.fn(), fetchPreflight: vi.fn() }));
vi.mock("@/lib/ai/analysisClient", () => ai);
const panel = vi.hoisted(() => ({ mounted: 0 }));
vi.mock("@/components/ops/workspace/WorkspaceAnalyzePanel", () => ({
  default: ({ onEnterMode }: { onEnterMode: (m: string, boq?: string) => void }) => {
    panel.mounted++;
    return <button onClick={() => onEnterMode("review", "boq-9")}>Open review exceptions</button>;
  },
}));

import DrawingProcessingPanel from "./DrawingProcessingPanel";

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };
const renderPanel = (drawingCount = 2) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/app/projects/p1/drawings"]}>
      <Routes>
        <Route path="/app/projects/p1/drawings" element={<DrawingProcessingPanel projectId="p1" drawingCount={drawingCount} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  db.enabled = false; db.readFails = false; db.updates = [];
  fp.compute.mockReset(); ai.generateAnalysis.mockReset(); ai.fetchPreflight.mockReset(); panel.mounted = 0;
});

describe("Drawing processing", () => {
  it("with processing off: nothing is computed, and Analyze waits for the person to allow it", async () => {
    renderPanel();
    expect(await screen.findByText(/Server processing is off for this project/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyze drawings/ })).toBeDisabled();
    expect(fp.compute).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("allowing processing changes only that flag, then fingerprints are computed — no AI", async () => {
    fp.compute.mockResolvedValue({ eligible: 2, fingerprinted: 2 });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Allow server processing for this project" }));
    expect(await screen.findByText("Fingerprinted 2 of 2 drawings.")).toBeInTheDocument();
    expect(db.updates).toEqual([{ ai_processing_enabled: true }]);
    expect(fp.compute).toHaveBeenCalledWith("p1");
    expect(ai.generateAnalysis).not.toHaveBeenCalled();
  });

  it("drawings not yet fingerprinted are counted, with Retry", async () => {
    db.enabled = true;
    fp.compute.mockResolvedValueOnce({ eligible: 1, fingerprinted: 1 }).mockResolvedValueOnce({ eligible: 2, fingerprinted: 2 });
    renderPanel();
    expect(await screen.findByText(/Fingerprinted 1 of 2 drawings\./)).toBeInTheDocument();
    expect(screen.getByText(/1 could not be read from storage yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Fingerprinted 2 of 2 drawings.")).toBeInTheDocument();
  });

  it("a fingerprinting failure is an error with Retry", async () => {
    db.enabled = true;
    fp.compute.mockRejectedValueOnce(new Error("Fingerprinting failed: network down")).mockResolvedValueOnce({ eligible: 2, fingerprinted: 2 });
    renderPanel();
    expect(await screen.findByText("Fingerprinting failed: network down")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry fingerprints" }));
    expect(await screen.findByText("Fingerprinted 2 of 2 drawings.")).toBeInTheDocument();
  });

  it("a failed read of the setting is an error, not 'processing off'", async () => {
    db.readFails = true;
    renderPanel();
    expect(await screen.findByText("Could not read this project's processing setting.")).toBeInTheDocument();
    expect(screen.queryByText(/Server processing is off/)).toBeNull();
  });

  it("the analysis step opens only on Analyze drawings, and its results open the existing review screen", async () => {
    db.enabled = true;
    fp.compute.mockResolvedValue({ eligible: 2, fingerprinted: 2 });
    renderPanel();
    await screen.findByText("Fingerprinted 2 of 2 drawings.");
    expect(panel.mounted).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /Analyze drawings/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open review exceptions" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(
      `/ops/projects/p1/boqs/boq-9/review?returnTo=${encodeURIComponent("/app/projects/p1/drawings")}`));
    expect(ai.generateAnalysis).not.toHaveBeenCalled(); // the panel itself starts any paid run
  });

  it("shows nothing until there is a drawing", () => {
    const { container } = renderPanel(0);
    expect(container).toBeEmptyDOMElement();
  });
});
