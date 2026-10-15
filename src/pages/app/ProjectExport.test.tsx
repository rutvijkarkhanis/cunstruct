// Export & History: the live exports really produce the builder's documents
// (same payload builders, sources, pending items, unfinished-review count),
// and frozen revisions are listed and exported from their own rows.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ProjectExport from "./ProjectExport";
import { commercialsFor } from "@/lib/boqLiveExport";

vi.mock("@/components/app/projectShellContext", () => ({
  useProjectShell: () => ({ projectId: "p1", project: { id: "p1", name: "Sample Apartment", client_name: "Acme", location: "Pune", project_type: "Residential", status: "active", area_sqft: 1200, floors: 2 } }),
}));
vi.mock("@/hooks/useProjectBoqs", () => ({
  useProjectBoqs: () => ({ data: [{ id: "b1", name: "Civil BOQ", created_at: "", discipline: "civil" }], isLoading: false, isError: false, isSuccess: true }),
  useMostRecentlyAnalyzedBoqId: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/lib/review/drawingStorage", async (orig) => ({
  ...(await orig<typeof import("@/lib/review/drawingStorage")>()),
  loadProjectDrawings: async () => [{ documentId: "d1", name: "GF Plan", originalFilename: null, filePath: "x.pdf", pageCount: 3, pageTitles: null }],
}));
let reviewStatuses: string[] = [];
vi.mock("@/lib/review/reviewStore", () => ({
  latestRunForBoq: async () => (reviewStatuses.length ? { id: "run1" } : null),
  loadReviewItems: async () => reviewStatuses.map((reviewStatus) => ({ reviewStatus })),
}));
const openDsrQuote = vi.fn(() => true);
const downloadCsv = vi.fn();
vi.mock("@/lib/boqDsrDocument", async (orig) => ({
  ...(await orig<typeof import("@/lib/boqDsrDocument")>()),
  openDsrQuote: (...a: unknown[]) => openDsrQuote(...(a as [])),
  downloadCsv: (...a: unknown[]) => downloadCsv(...(a as [])),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));
const exportRevision = vi.fn();
let revState: { revisions: unknown[]; available: boolean; loading: boolean } = { revisions: [], available: true, loading: false };
vi.mock("@/hooks/useBoqRevisions", () => ({
  REVISIONS_UNAVAILABLE_MESSAGE: "Commercial revisions are not set up on this database yet.",
  useBoqRevisions: () => ({ ...revState, busy: false, exportRevision, createRevision: vi.fn() }),
}));

const base = { section: "Brickwork", dsr_code: "6.1", unit: "cum", custom_rate: null, basis: null, quantity_status: null, measurement_method: null, included: true, source_page: null, source_document_id: null };
let lines: Record<string, unknown>[] = [];
vi.mock("@/lib/untypedDb", () => ({
  db: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.order = () => Promise.resolve({ data: lines, error: null });
      q.maybeSingle = () => Promise.resolve(table === "boq"
        ? { data: { id: "b1", name: "Civil BOQ", status: "draft", spec: { _gst_pct: 12 } }, error: null }
        : { data: null, error: null });
      return q;
    },
  },
}));

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ProjectExport /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  lines = [
    { ...base, id: "l1", sort: 1, description: "Brick wall", qty: 10, dsr_rate: 100, source_document_id: "d1", source_page: "2" },
    { ...base, id: "l2", sort: 2, description: "Plaster", qty: 0, dsr_rate: 50, quantity_status: "PENDING" },
    { ...base, id: "l3", sort: 3, description: "Old item", qty: 5, dsr_rate: 10, included: false },
  ];
  reviewStatuses = [];
  revState = { revisions: [], available: true, loading: false };
  openDsrQuote.mockReset().mockReturnValue(true);
  downloadCsv.mockReset();
  toastError.mockReset();
  exportRevision.mockReset();
});

describe("ProjectExport — current BOQ", () => {
  it("opens the priced PDF with sources, pending items, the review count and the builder's commercials", async () => {
    reviewStatuses = ["VERIFIED", "PENDING"];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "PDF (priced)" }));
    expect(openDsrQuote).toHaveBeenCalledTimes(1);
    const [payload, opts] = openDsrQuote.mock.calls[0] as unknown as [Record<string, unknown> & { subheads: { items: Record<string, unknown>[] }[] }, unknown];
    expect(opts).toEqual({ autoPrint: true });
    expect(payload).toMatchObject({ boqName: "Civil BOQ", projectName: "Sample Apartment", blankRates: false, unresolvedReviewCount: 1 });
    expect(payload.commercials).toEqual(commercialsFor(1000, { _gst_pct: 12 }));
    expect(JSON.stringify(payload.subheads)).toContain("GF Plan");
    expect(payload.pendingItems).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("Old item"); // excluded line absent
  });

  it("opens the specs & quantities PDF with blank rates and no auto-print", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /PDF — specs & quantities/ }));
    expect(openDsrQuote.mock.calls[0]).toEqual([expect.objectContaining({ blankRates: true }), { autoPrint: false }]);
  });

  it("downloads the CSV with the source reference and the pending line", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Excel (CSV)" }));
    const [name, csv] = downloadCsv.mock.calls[0] as [string, string];
    expect(name).toBe("Civil_BOQ_BOQ.csv");
    expect(csv).toContain("GF Plan");
    expect(csv).toContain("Plaster");
  });

  it("states what is incomplete before exporting", async () => {
    reviewStatuses = ["FLAGGED"];
    renderPage();
    expect(await screen.findByText(/This BOQ is incomplete: 1 line has a pending quantity/)).toBeInTheDocument();
    expect(screen.getByText("1 drawing review item is not finished and not in this BOQ.")).toBeInTheDocument();
  });

  it("reports a blocked pop-up and an all-excluded BOQ", async () => {
    openDsrQuote.mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "PDF (priced)" }));
    expect(toastError).toHaveBeenCalledWith("Allow pop-ups to export");
  });

  it("says there is nothing to export when every line is excluded", async () => {
    lines = lines.map((l) => ({ ...l, included: false }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Excel (CSV)" }));
    expect(toastError).toHaveBeenCalledWith("Nothing to export yet");
    expect(downloadCsv).not.toHaveBeenCalled();
  });
});

describe("ProjectExport — history", () => {
  const rev = {
    id: "r1", boq_id: "b1", project_id: "p1", boq_name: "Civil BOQ", project_name: "Sample", revision_no: 2, label: "Rev B",
    boq_status_at_issue: "finalized", discipline: "civil", rate_year: null, context: {}, commercials: {}, works_total: 900,
    grand_total: 123456, line_count: 4, priced_line_count: 3, limitations: [{ code: "x", message: "m", count: 1 }],
    limitations_acknowledged: true, issue_note: "Issued for tender", issued_by: "u", issued_at: "2026-10-01T10:00:00Z",
  };

  it("lists frozen revisions with one Rev prefix and exports each from its own rows", async () => {
    revState = { revisions: [rev], available: true, loading: false };
    renderPage();
    const list = await screen.findByRole("list", { name: "Frozen revisions" });
    expect(within(list).getByText("Rev B")).toBeInTheDocument();
    expect(within(list).queryByText(/Rev Rev/)).toBeNull();
    expect(within(list).getByText(/₹1,23,456 · 3 of 4 lines priced · 1 limitation acknowledged/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "CSV of Rev B" }));
    fireEvent.click(within(list).getByRole("button", { name: "PDF with blank rates of Rev B" }));
    expect(exportRevision.mock.calls).toEqual([[rev, "csv"], [rev, "pdf_blank"]]);
  });

  it("explains when revisions are not set up, or none exist yet", async () => {
    revState = { revisions: [], available: false, loading: false };
    const { unmount } = renderPage();
    expect(await screen.findByText(/not set up on this database/)).toBeInTheDocument();
    unmount();
    revState = { revisions: [], available: true, loading: false };
    renderPage();
    expect(await screen.findByText(/No revisions frozen yet/)).toBeInTheDocument();
  });
});
