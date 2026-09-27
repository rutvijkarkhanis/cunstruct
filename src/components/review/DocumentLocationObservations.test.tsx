// DocumentLocationObservations — the four-state LOCATION inspector. Mocks
// src/lib/review/locationObservations.ts (the ONLY data boundary this
// component uses) so this exercises the real rendering logic with zero
// network calls.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DocumentLocationObservations from "./DocumentLocationObservations";
import * as locationObservations from "@/lib/review/locationObservations";
import type { LocationObservation, LocationRunState } from "@/lib/review/locationObservations";

vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(),
  loadLocationObservations: vi.fn(),
}));

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocumentLocationObservations projectId="proj-1" documentId="doc-1" />
    </QueryClientProvider>,
  );
}

const NOT_RUN: LocationRunState = { status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null };

describe("DocumentLocationObservations — the four states", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. never run — shown clearly as not run, never as a zero result", async () => {
    vi.mocked(locationObservations.latestLocationRunForDocument).mockResolvedValue(NOT_RUN);
    renderPanel();
    await screen.findByText("LOCATION extraction has not been run for this document.");
    expect(screen.queryByText(/no observations were found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/persisted/i)).not.toBeInTheDocument();
  });

  it("B. ran and found nothing — a real run existed, distinct wording from 'never run'", async () => {
    vi.mocked(locationObservations.latestLocationRunForDocument).mockResolvedValue({
      status: "SUCCEEDED", runId: "run-1", claimedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z", error: null,
    });
    vi.mocked(locationObservations.loadLocationObservations).mockResolvedValue([]);
    renderPanel();
    await screen.findByText("No LOCATION observations were found in this document.");
    expect(screen.getByText(/0 observations persisted/i)).toBeInTheDocument(); // the diagnostic timestamp line
    expect(screen.queryByText("LOCATION extraction has not been run for this document.")).not.toBeInTheDocument();
  });

  it("C. ran and found observations — displayed with type, mark, location text and evidence completeness", async () => {
    vi.mocked(locationObservations.latestLocationRunForDocument).mockResolvedValue({
      status: "SUCCEEDED", runId: "run-1", claimedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z", error: null,
    });
    const obs: LocationObservation = {
      id: "obs-1", observationType: "schedule_entry", mark: "W1", scopeHint: "Ground Floor",
      locationText: "Door/Window schedule, Ground floor sheet",
      attributes: { dimension: "6'x6'9\"", specification: "UPVC" },
      evidence: { documentId: "doc-1", page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8 }] },
      evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    };
    vi.mocked(locationObservations.loadLocationObservations).mockResolvedValue([obs]);
    renderPanel();
    await screen.findByText("1 LOCATION observation extracted from this document, independent of any BOQ.");
    expect(screen.getByText("W1")).toBeInTheDocument();
    expect(screen.getByText(/Ground Floor/)).toBeInTheDocument();
    expect(screen.getByText("Door/Window schedule, Ground floor sheet")).toBeInTheDocument();
    expect(screen.getByText(/p\.8/)).toBeInTheDocument();
    expect(screen.getByText("FULL")).toBeInTheDocument();
    expect(screen.getByText(/6'x6'9".*UPVC/)).toBeInTheDocument();
  });

  it("D. extraction failed — shown as a failure, never a successful zero", async () => {
    vi.mocked(locationObservations.latestLocationRunForDocument).mockResolvedValue({
      status: "FAILED", runId: null, claimedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:00Z",
      error: "OpenAI request failed",
    });
    renderPanel();
    await screen.findByText(/LOCATION extraction failed — OpenAI request failed/);
    expect(screen.queryByText(/no observations were found/i)).not.toBeInTheDocument();
    expect(locationObservations.loadLocationObservations).not.toHaveBeenCalled(); // no run id to load from
  });

  it("never invokes anything BOQ-shaped — the component takes no boqId/BOQ prop at all", () => {
    // Structural: DocumentLocationObservations's props are exactly
    // {projectId, documentId} — no boqId, no onApplyToBoq, nothing
    // BOQ-shaped could even be wired in without changing this file.
    vi.mocked(locationObservations.latestLocationRunForDocument).mockResolvedValue(NOT_RUN);
    const { container } = renderPanel();
    expect(container.innerHTML).not.toMatch(/boq/i);
  });
});
