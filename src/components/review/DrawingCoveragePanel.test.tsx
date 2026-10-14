import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import DrawingCoveragePanel from "./DrawingCoveragePanel";
import type { LocationObservation } from "@/lib/review/locationObservations";
import { syntheticPlanText } from "@/lib/review/__fixtures__/syntheticPlanText";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// An invented plan (see __fixtures__/syntheticPlanText.ts).
const loader = vi.fn(async (documentId: string) => syntheticPlanText(documentId));
vi.mock("@/lib/review/drawingTextLoader", () => ({ loadDocumentDrawingText: (id: string) => loader(id) }));

const observation = (id: string, mark: string, page: number, scopeHint: string, dimension?: string): LocationObservation => ({
  id, observationType: "room_or_space", mark, scopeHint, locationText: null, attributes: dimension ? { dimension } : {},
  evidence: { page, evidence: [] }, evidenceCompleteness: "LIMITED", createdAt: "2026-09-28T00:00:00Z",
});
// Three rooms that exist in the plan text, plus a box-less W.R that can't be placed.
const OBSERVATIONS = [
  observation("o1", "W.R", 1, "Bedroom", `12'x10'`),
  observation("o2", "Dining", 1, "Dining Room", `14'x12'`),
  observation("o3", "Kitchen", 2, "Kitchen", `11'x9'`),
  observation("o4", "Lift", 2, "Building Lift", `8'x6'`),
];

const renderPanel = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <DrawingCoveragePanel documentId="doc-plan" observations={OBSERVATIONS} />
  </QueryClientProvider>,
);

describe("DrawingCoveragePanel", () => {
  it("loads nothing until asked", () => {
    renderPanel();
    expect(loader).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Check coverage against the drawing" })).toBeTruthy();
  });

  it("shows provisional coverage against the drawing's labelled spaces, with gaps, conflicts and draft areas", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Check coverage against the drawing" }));
    const panel = await screen.findByTestId("drawing-coverage");
    expect(loader).toHaveBeenCalledWith("doc-plan");
    const text = panel.textContent!;
    expect(text).toContain("Provisional");
    expect(text).toMatch(/The drawing text labels 12 spaces on p\.1 \(First Floor\), p\.2 \(Second Floor\)\.\s*This analysis observed 3 of them \(rooms 3 of 11\)/);
    expect(text).toContain("parser rejections unknown");
    expect(text).toContain("3 floor-label conflicts");
    expect(text).toContain(`LIFT (p.2): observed floor "Building Lift", sheet says Second Floor`);
    expect(text).toContain(`W.R (p.1) — "W.R" appears 3 times on page 1, and the observation has no evidence box to say which.`);
    expect(text).toContain(`Floor area — LIFT (Second Floor): 8' X 6' = 4.46 sqm`);
    expect(text).toContain("Floor areas ready for review (10) — drafts, not BOQ lines");
    expect(text).toContain("Spaces are recognised from a fixed vocabulary of room words; a space named outside it is not counted.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy drafts as analysis JSON" })).toBeTruthy());
  });
});
