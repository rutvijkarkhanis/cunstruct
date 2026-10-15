// Overview renders only real, loaded figures and points at the right next step.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ProjectOverview from "./ProjectOverview";

vi.mock("@/components/app/projectShellContext", () => ({
  useProjectShell: () => ({ projectId: "p1", project: { id: "p1", name: "Sample", client_name: "Acme", location: "Pune", project_type: null, status: "active", area_sqft: 1200, floors: 2 } }),
}));
let boqs: { id: string; name: string; created_at: string; discipline: string }[] = [];
vi.mock("@/hooks/useProjectBoqs", () => ({ useProjectBoqs: () => ({ data: boqs, isLoading: false, isError: false, isSuccess: true }) }));
let drawings: { documentId: string; name: string; filePath: string | null }[] = [];
vi.mock("@/lib/review/drawingStorage", () => ({ loadProjectDrawings: async () => drawings }));
let reviewStatuses: Record<string, string[]> = {};
vi.mock("@/lib/review/reviewStore", () => ({
  latestRunForBoq: async (id: string) => (reviewStatuses[id] ? { id: `run-${id}` } : null),
  loadReviewItems: async (runId: string) => reviewStatuses[runId.replace("run-", "")].map((s) => ({ reviewStatus: s })),
}));
let lines: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ in: async () => ({ data: lines, error: null }) }) }) },
}));

const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ProjectOverview /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  boqs = [{ id: "b1", name: "Civil BOQ", created_at: "", discipline: "civil" }];
  drawings = [{ documentId: "d1", name: "GF Plan", filePath: "x.pdf" }, { documentId: "d2", name: "Section", filePath: null }];
  reviewStatuses = {};
  lines = [
    { boq_id: "b1", qty: 10, quantity_status: null, dsr_rate: 100, custom_rate: null, included: true, source_document_id: "d1" },
    { boq_id: "b1", qty: 0, quantity_status: null, dsr_rate: 100, custom_rate: null, included: true },
    { boq_id: "b1", qty: 5, quantity_status: null, dsr_rate: null, custom_rate: null, included: true },
  ];
});

describe("ProjectOverview", () => {
  it("shows drawing and BOQ figures from loaded rows", async () => {
    renderIt();
    const drawingsSection = (await screen.findByRole("heading", { name: "Drawings" })).closest("section")!;
    expect(within(drawingsSection).getByText("Documents").nextSibling).toHaveTextContent("2");
    expect(within(drawingsSection).getByText("Without a file").nextSibling).toHaveTextContent("1");
    const boqSection = screen.getByRole("heading", { name: "BOQs" }).closest("section")!;
    expect(within(boqSection).getByText("Civil BOQ")).toBeInTheDocument();
    expect(within(boqSection).getByText("Pending quantity").nextSibling).toHaveTextContent("1");
    expect(within(boqSection).getByText("No rate").nextSibling).toHaveTextContent("1");
    expect(within(boqSection).getByText("Complete").nextSibling).toHaveTextContent("1");
    expect(within(boqSection).getByRole("link", { name: "Open BOQ" })).toHaveAttribute("href", "/boq?boq=b1");
  });

  it("points at unfinished review before pending quantities", async () => {
    reviewStatuses = { b1: ["VERIFIED", "PENDING", "FLAGGED"] };
    renderIt();
    const next = (await screen.findByRole("heading", { name: "Next step" })).closest("section")!;
    expect(next).toHaveTextContent("2 drawing review items are not finished");
    expect(within(next).getByRole("link", { name: /Continue review/ })).toHaveAttribute("href", "/ops/projects/p1/boqs/b1/review");
  });

  it("asks for drawings when there are none", async () => {
    drawings = [];
    renderIt();
    const next = (await screen.findByRole("heading", { name: "Next step" })).closest("section")!;
    expect(next).toHaveTextContent("No drawings yet");
  });
});
