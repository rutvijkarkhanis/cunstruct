// Review quantities step: states the saved review decisions, why Apply is or
// is not blocked (the review screen's own rule), and links into the review
// screen with a way back to this step.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectReview from "./ProjectReview";
import { saveReceipt } from "@/lib/review/applyReceipt";

vi.mock("@/components/app/projectShellContext", () => ({
  useProjectShell: () => ({ projectId: "p1", project: { id: "p1", name: "Sample" } }),
}));
let boqs: { id: string; name: string; created_at: string; discipline: string }[] = [];
vi.mock("@/hooks/useProjectBoqs", () => ({
  useProjectBoqs: () => ({ data: boqs, isLoading: false, isError: false, isSuccess: true }),
  useMostRecentlyAnalyzedBoqId: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/lib/review/drawingStorage", () => ({ loadProjectDrawings: async () => [{ documentId: "d1", name: "GF", filePath: "x.pdf" }] }));
let statuses: string[] | null = null;
let runError = false;
vi.mock("@/lib/review/reviewStore", () => ({ loadReviewItems: async () => (statuses ?? []).map((s) => ({ reviewStatus: s })) }));
vi.mock("@/lib/untypedDb", () => ({
  db: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      ["select", "eq", "in", "order", "limit"].forEach((m) => { q[m] = () => q; });
      q.then = (resolve: (r: unknown) => void) => resolve(
        table === "analysis_run"
          ? (runError ? { data: null, error: { message: "permission denied" } } : { data: statuses ? [{ id: "run-1" }] : [], error: null })
          : { data: [], error: null },
      );
      return q;
    },
  },
}));

const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/app/projects/p1/review?boq=b1"]}>
      <Routes><Route path="/app/projects/:id/review" element={<ProjectReview />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
const RETURN = encodeURIComponent("/app/projects/p1/review?boq=b1");

beforeEach(() => {
  boqs = [{ id: "b1", name: "Civil BOQ", created_at: "", discipline: "civil" }];
  statuses = null;
  runError = false;
  window.sessionStorage.clear();
});

describe("ProjectReview", () => {
  it("with items still needing a decision, says Apply is blocked and continues the review with a way back", async () => {
    statuses = ["PENDING_REVIEW", "PENDING_REVIEW", "VERIFIED", "FLAGGED"];
    renderIt();
    expect(await screen.findByText("Need a decision")).toBeInTheDocument();
    expect(screen.getByText("Need a decision").nextSibling).toHaveTextContent("2");
    expect(screen.getByRole("note")).toHaveTextContent("Apply is blocked: 2 items still need a decision.");
    expect(screen.getByRole("link", { name: /Continue review/ }))
      .toHaveAttribute("href", `/ops/projects/p1/boqs/b1/review?returnTo=${RETURN}`);
  });

  it("with every item decided, says what can be applied and what stays out", async () => {
    statuses = ["VERIFIED", "EDITED", "MARKED_PENDING"];
    renderIt();
    const note = await screen.findByRole("note");
    expect(note).not.toHaveTextContent("blocked");
    expect(note).toHaveTextContent("1 flagged or pending item will stay out of the BOQ until resolved.");
    expect(screen.getByRole("link", { name: /Open review to apply/ })).toBeInTheDocument();
  });

  it("with no analysis yet, offers to start one — never shows it as finished", async () => {
    renderIt();
    expect(await screen.findByText(/No drawing analysis has been loaded/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start review/ })).toHaveAttribute("href", `/ops/projects/p1/boqs/b1/review?returnTo=${RETURN}`);
  });

  it("a failed read is reported, not shown as 'no analysis'", async () => {
    runError = true;
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the review state");
    expect(screen.queryByText(/No drawing analysis/)).toBeNull();
  });

  it("shows the last Apply result recorded in this tab", async () => {
    statuses = ["VERIFIED"];
    saveReceipt({ boqId: "b1", runId: "run-1", appliedAt: "2026-10-16T10:00:00Z", appliedCount: 3, unresolvedCount: 1, correctedCount: 1,
      reviewedCount: 4, verifiedCount: 3, unauditedCount: 0, conflictedCount: 0, revisionChanged: [], justAppliedLineIds: [] });
    renderIt();
    const status = await screen.findByText(/Last applied from review in this browser tab/);
    expect(status).toHaveTextContent("3 items applied · 1 from corrected items · 1 not applied (unresolved)");
  });

  it("with no BOQ, explains that one is needed first", async () => {
    boqs = [];
    renderIt();
    const box = await screen.findByRole("heading", { name: "No BOQ to review into yet" });
    expect(within(box.parentElement!).getByRole("link", { name: "Create a BOQ" }))
      .toHaveAttribute("href", `/ops/projects/p1/boqs/manage?returnTo=${encodeURIComponent("/app/projects/p1/review?boq=b1")}`);
  });
});
