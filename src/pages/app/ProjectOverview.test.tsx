// Overview renders only real, loaded figures, shows the Quantity BOQ stages for
// the selected BOQ and points at the right next step — using the review
// screen's own rule for what blocks Apply.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ProjectOverview from "./ProjectOverview";

vi.mock("@/components/app/projectShellContext", () => ({
  useProjectShell: () => ({ projectId: "p1", project: { id: "p1", name: "Sample", client_name: "Acme", location: "Pune", project_type: null, status: "active", area_sqft: 1200, floors: 2 } }),
}));
let boqs: { id: string; name: string; created_at: string; discipline: string }[] = [];
vi.mock("@/hooks/useProjectBoqs", () => ({
  useProjectBoqs: () => ({ data: boqs, isLoading: false, isError: false, isSuccess: true }),
  useMostRecentlyAnalyzedBoqId: () => ({ data: null, isLoading: false }),
}));
let drawings: { documentId: string; name: string; filePath: string | null }[] = [];
vi.mock("@/lib/review/drawingStorage", () => ({ loadProjectDrawings: async () => drawings }));
let reviewStatuses: Record<string, string[]> = {};
vi.mock("@/lib/review/reviewStore", () => ({
  loadReviewItems: async (runId: string) => reviewStatuses[runId.replace("run-", "")].map((s) => ({ reviewStatus: s })),
}));
let lines: Record<string, unknown>[] = [];
vi.mock("@/lib/untypedDb", () => ({
  db: {
    from: (table: string) => {
      let boqId: unknown = null;
      const q: Record<string, unknown> = {};
      ["select", "in", "order", "limit"].forEach((m) => { q[m] = () => q; });
      q.eq = (c: string, v: unknown) => { if (c === "boq_id") boqId = v; return q; };
      q.then = (resolve: (r: unknown) => void) => resolve(
        table === "analysis_run"
          ? { data: reviewStatuses[boqId as string] ? [{ id: `run-${boqId}` }] : [], error: null }
          : { data: boqId ? lines.filter((l) => l.boq_id === boqId) : lines, error: null },
      );
      return q;
    },
  },
}));

const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ProjectOverview /></MemoryRouter>
  </QueryClientProvider>,
);
const L = (p: Record<string, unknown>) => ({ id: Math.random().toString(36), boq_id: "b1", qty: 10, quantity_status: null, basis: null, dsr_rate: 100, custom_rate: null, included: true, ...p });

beforeEach(() => {
  boqs = [{ id: "b1", name: "Civil BOQ", created_at: "", discipline: "civil" }];
  drawings = [{ documentId: "d1", name: "GF Plan", filePath: "x.pdf" }, { documentId: "d2", name: "Section", filePath: null }];
  reviewStatuses = {};
  lines = [L({ source_document_id: "d1" }), L({ qty: 0 }), L({ qty: 5, dsr_rate: null })];
});

const nextCard = async () => (await screen.findByRole("heading", { name: /^Next step/ })).closest("section")!;
const stage = (name: RegExp) => screen.getByRole("heading", { name }).closest("li")!;

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
    expect(within(boqSection).getByText("Priced").nextSibling).toHaveTextContent("1");
    expect(within(boqSection).getByRole("link", { name: "Open BOQ" })).toHaveAttribute("href", "/boq?boq=b1");
  });

  it("only items still needing a decision block Apply — flagged or pending ones do not", async () => {
    reviewStatuses = { b1: ["VERIFIED", "PENDING_REVIEW", "FLAGGED"] };
    renderIt();
    const next = await nextCard();
    expect(next).toHaveTextContent("Next step: Review quantities");
    expect(next).toHaveTextContent("1 item of 3 still needs a decision. Apply is blocked until every item has one.");
    expect(within(next).getByRole("link", { name: /Continue review/ })).toHaveAttribute("href", "/app/projects/p1/review?boq=b1");
    const boqSection = screen.getByRole("heading", { name: "BOQs" }).closest("section")!;
    expect(within(boqSection).getByText("Need a review decision").nextSibling).toHaveTextContent("1");
  });

  it("a decided review with held-back items needs attention but does not claim Apply is blocked", async () => {
    reviewStatuses = { b1: ["VERIFIED", "FLAGGED", "MARKED_PENDING"] };
    renderIt();
    await nextCard();
    const review = stage(/B\. Review quantities/);
    expect(review).toHaveTextContent("Needs attention");
    expect(review).toHaveTextContent("Every item has a decision; 2 are held back");
    expect(review).not.toHaveTextContent("Apply is blocked");
  });

  it("after review, the next step is the pending lines, opened filtered to them", async () => {
    reviewStatuses = { b1: ["VERIFIED"] };
    drawings = [{ documentId: "d1", name: "GF Plan", filePath: "x.pdf" }];
    renderIt();
    const next = await nextCard();
    expect(next).toHaveTextContent("Next step: Build BOQ");
    expect(within(next).getByRole("link", { name: /Show pending lines/ })).toHaveAttribute("href", "/app/projects/p1/boq?boq=b1&status=pending");
  });

  it("a missing rate is not a quantity gap: with quantities done, the next step is checks then export", async () => {
    reviewStatuses = { b1: ["VERIFIED"] };
    drawings = [{ documentId: "d1", name: "GF Plan", filePath: "x.pdf" }];
    lines = [L({}), L({ dsr_rate: null })];
    renderIt();
    const next = await nextCard();
    expect(next).toHaveTextContent("Next step: Export");
    expect(stage(/C\. Build BOQ/)).toHaveTextContent("Done");
    const checks = stage(/D\. Check & finalise/);
    expect(checks).toHaveTextContent("Done");
    // The rate gap is stated as Pricing and links to where rates are entered.
    expect(within(checks).getByRole("link", { name: "1 line without a rate (rates belong to the Pricing phase)" }))
      .toHaveAttribute("href", `/ops/projects/p1/boqs/b1?returnTo=${encodeURIComponent("/app/projects/p1/check?boq=b1")}`);
  });

  it("asks for drawings when there are none", async () => {
    drawings = [];
    renderIt();
    expect(await nextCard()).toHaveTextContent("No drawings yet");
  });

  it("with no analysis yet, review has not started and is not reported as finished", async () => {
    drawings = [{ documentId: "d1", name: "GF Plan", filePath: "x.pdf" }];
    renderIt();
    const next = await nextCard();
    expect(next).toHaveTextContent("No drawing analysis for this BOQ yet.");
    expect(within(next).getByRole("link", { name: /Start review/ })).toHaveAttribute("href", "/app/projects/p1/review?boq=b1");
  });
});
