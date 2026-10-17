// Export & History: the live exports really produce the builder's documents
// (same payload builders, sources, pending items, unfinished-review count),
// and frozen revisions are listed and exported from their own rows.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ProjectExport from "./ProjectExport";
import { commercialsFor } from "@/lib/boqLiveExport";

vi.mock("@/components/app/projectShellContext", () => ({
  useProjectShell: () => ({ projectId: "p1", project: { id: "p1", name: "Sample Apartment", client_name: "Acme", location: "Pune", project_type: "Residential", status: "active", area_sqft: 1200, floors: 2 } }),
}));
let boqListFails = false;
vi.mock("@/hooks/useProjectBoqs", () => ({
  useProjectBoqs: () => (boqListFails
    ? { data: undefined, isLoading: false, isError: true, isSuccess: false }
    : { data: [{ id: "b1", name: "Civil BOQ", created_at: "", discipline: "civil" }], isLoading: false, isError: false, isSuccess: true }),
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
// The PDF tab (openQuoteWindow) opens from the click; `openDsrQuote` records
// what is finally shown in it, `quoteFailed` what it says instead.
const openDsrQuote = vi.fn();
const quoteFailed = vi.fn();
const openQuoteWindow = vi.fn((): unknown => ({ show: (...a: unknown[]) => openDsrQuote(...(a as [])), fail: (m: string) => quoteFailed(m) }));
const downloadCsv = vi.fn();
vi.mock("@/lib/boqDsrDocument", async (orig) => ({
  ...(await orig<typeof import("@/lib/boqDsrDocument")>()),
  openQuoteWindow: () => openQuoteWindow(),
  downloadCsv: (...a: unknown[]) => downloadCsv(...(a as [])),
}));
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), warning: (m: string) => toastWarning(m) } }));
const exportRevision = vi.fn();
let revState: { revisions: unknown[]; available: boolean; loading: boolean } = { revisions: [], available: true, loading: false };
vi.mock("@/hooks/useBoqRevisions", () => ({
  REVISIONS_UNAVAILABLE_MESSAGE: "Commercial revisions are not set up on this database yet.",
  useBoqRevisions: () => ({ ...revState, busy: false, exportRevision, createRevision: vi.fn() }),
}));

const base = { section: "Brickwork", dsr_code: "6.1", unit: "cum", custom_rate: null, basis: null, quantity_status: null, measurement_method: null, included: true, source_page: null, source_document_id: null };
let lines: Record<string, unknown>[] = [];
let failLineReadsAfter = Infinity; // fail every boq_line read after the first N
let lineReads = 0;
let boqReadFailures = 0; // the next N reads of the boq row fail
vi.mock("@/lib/untypedDb", () => ({
  db: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.order = () => (++lineReads > failLineReadsAfter
        ? Promise.resolve({ data: null, error: { message: "network down" } })
        : Promise.resolve({ data: lines.map((l) => ({ ...l })), error: null }));
      q.maybeSingle = () => Promise.resolve(table === "boq" && boqReadFailures > 0 && boqReadFailures--
        ? { data: null, error: { message: "network down" } }
        : table === "boq"
        ? { data: { id: "b1", name: "Civil BOQ", status: "draft", spec: { _gst_pct: 12 } }, error: null }
        : { data: null, error: null });
      return q;
    },
  },
}));

const renderPage = (mode: "check" | "export" = "export", boq = "b1") => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[`/app/projects/p1/${mode}?boq=${boq}`]}><ProjectExport mode={mode} /></MemoryRouter>
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
  openDsrQuote.mockReset();
  quoteFailed.mockReset();
  openQuoteWindow.mockClear();
  failLineReadsAfter = Infinity;
  lineReads = 0;
  boqReadFailures = 0;
  boqListFails = false;
  downloadCsv.mockReset();
  toastError.mockReset();
  exportRevision.mockReset();
});

describe("ProjectExport — current BOQ", () => {
  it("opens the priced PDF with sources, pending items, the review count and the builder's commercials", async () => {
    reviewStatuses = ["VERIFIED", "PENDING"];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "PDF (priced)" }));
    await waitFor(() => expect(openDsrQuote).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(openDsrQuote).toHaveBeenCalledTimes(1));
    expect(openDsrQuote.mock.calls[0]).toEqual([expect.objectContaining({ blankRates: true }), { autoPrint: false }]);
  });

  it("downloads the CSV with the source reference and the pending line", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Excel (CSV)" }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled()); // built from a fresh read of the lines
    const [name, csv] = downloadCsv.mock.calls[0] as [string, string];
    expect(name).toBe("Civil_BOQ_BOQ.csv");
    expect(csv).toContain("GF Plan");
    expect(csv).toContain("Plaster");
  });

  it("Export points to Check & finalise when items are still open, and still exports", async () => {
    reviewStatuses = ["FLAGGED"];
    renderPage("export");
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("Some items are still open; the documents state them.");
    expect(within(note).getByRole("link", { name: "See Check & finalise" })).toHaveAttribute("href", "/app/projects/p1/check?boq=b1");
    expect(screen.getByRole("button", { name: /PDF \(priced\)/ })).toBeInTheDocument();
  });

  it("Check & finalise states what is incomplete, each item linked to where it is resolved", async () => {
    reviewStatuses = ["FLAGGED"];
    lines = [...lines, { ...base, id: "l4", sort: 4, description: "Skirting", qty: 3, dsr_rate: null, basis: "HEURISTIC" }];
    renderPage("check");
    expect(await screen.findByText(/Quantities are incomplete: 1 line has a pending quantity/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /PDF/ })).toBeNull();
    const back = encodeURIComponent("/app/projects/p1/check?boq=b1");
    expect(screen.getByRole("link", { name: "Add rates in the BOQ builder" })).toHaveAttribute("href", `/ops/projects/p1/boqs/b1?returnTo=${back}`);
    expect(screen.getByRole("link", { name: "Show assumptions" })).toHaveAttribute("href", "/app/projects/p1/boq?boq=b1&q=Assumption");
    expect(screen.getByRole("link", { name: "Show lines with no recorded basis" })).toHaveAttribute("href", "/app/projects/p1/boq?boq=b1&q=Basis+not+recorded");
    expect(screen.getByText("1 drawing review item is not verified or corrected, so it is not in this BOQ.")).toBeInTheDocument();
    // Each open item links to where it is resolved, keeping the BOQ.
    expect(screen.getByRole("link", { name: "Show pending lines" })).toHaveAttribute("href", expect.stringMatching(/\/app\/projects\/p1\/boq\?boq=b1&status=pending$/));
    expect(screen.getByRole("link", { name: "Review quantities" })).toHaveAttribute("href", expect.stringMatching(/\/app\/projects\/p1\/review\?boq=b1$/));
  });

  it("reports a blocked pop-up and an all-excluded BOQ", async () => {
    openQuoteWindow.mockReturnValueOnce(null);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "PDF (priced)" }));
    expect(toastError).toHaveBeenCalledWith("Allow pop-ups to export");
    expect(openDsrQuote).not.toHaveBeenCalled();
  });

  it("says there is nothing to export when every line is excluded", async () => {
    lines = lines.map((l) => ({ ...l, included: false }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Excel (CSV)" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Nothing to export yet"));
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

describe("ProjectExport — exports never silently miss a change saved elsewhere", () => {
  it("the CSV is built from a fresh read of the lines, not the copy on screen", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: "Excel (CSV)" });
    lines = lines.map((l) => (l.id === "l1" ? { ...l, qty: 99 } : l)); // saved by someone else after this page loaded
    fireEvent.click(button);
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());
    const csv = downloadCsv.mock.calls[0][1] as string;
    expect(csv).toMatch(/Brick wall,cum,99,/);
  });

  // P2-5: the tab opens from the click, but the document is built from a
  // fresh read — a change saved elsewhere is IN the PDF, not warned about after.
  it("the PDF is built from a fresh read of the lines, with the tab opened straight from the click", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: /PDF \(priced\)/ });
    lines = lines.map((l) => (l.id === "l1" ? { ...l, qty: 99 } : l)); // saved elsewhere after this page loaded
    fireEvent.click(button);
    expect(openQuoteWindow).toHaveBeenCalledTimes(1); // synchronously, inside the click
    await waitFor(() => expect(openDsrQuote).toHaveBeenCalledTimes(1));
    const [payload] = openDsrQuote.mock.calls[0] as unknown as [{ subheads: { lines: { qty: number; spec: string }[] }[]; commercials: unknown }];
    expect(payload.subheads.flatMap((sh) => sh.lines).find((l) => l.spec === "Brick wall")!.qty).toBe(99);
    expect(payload.commercials).toEqual(commercialsFor(9900, { _gst_pct: 12 })); // totals from the same fresh lines
    expect(quoteFailed).not.toHaveBeenCalled();
  });

  it("if the re-read fails, the PDF tab says no document was produced — never a stale one", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: /PDF \(priced\)/ });
    failLineReadsAfter = lineReads; // every read from now on fails
    fireEvent.click(button);
    await waitFor(() => expect(quoteFailed).toHaveBeenCalledWith(expect.stringMatching(/no PDF was produced/)));
    expect(openDsrQuote).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/no PDF was produced/));
  });

  it("if the CSV re-read fails, nothing is downloaded", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: "Excel (CSV)" });
    failLineReadsAfter = lineReads;
    fireEvent.click(button);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/nothing was exported/)));
    expect(downloadCsv).not.toHaveBeenCalled();
  });

  it("no warning when nothing changed", async () => {
    toastWarning.mockClear();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /PDF \(priced\)/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(toastWarning).not.toHaveBeenCalled();
  });
});

describe("ProjectExport — wrong links and failed reads are stated, with a way out", () => {
  it.each(["export", "check"] as const)("%s: a ?boq= that is not this project's is said, not swapped silently", async (mode) => {
    renderPage(mode, "other-project-boq");
    expect(await screen.findByText("The BOQ in this link is not part of this project; showing “Civil BOQ”.")).toBeInTheDocument();
  });

  it("no such note when the linked BOQ is this project's", async () => {
    renderPage();
    await screen.findByRole("button", { name: "PDF (priced)" });
    expect(screen.queryByText(/not part of this project/)).toBeNull();
  });

  it("a failed read offers Retry, which reloads what failed and enables the export", async () => {
    boqReadFailures = 1;
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load everything this export needs, so exporting is unavailable.");
    expect(screen.queryByRole("button", { name: "PDF (priced)" })).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "PDF (priced)" })).toBeInTheDocument();
  });

  it("when the project's BOQs cannot be loaded, offers Retry and a link to manage them", async () => {
    boqListFails = true;
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load this project's BOQs.");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: /Open this project's BOQs/ })).toHaveAttribute("href", expect.stringMatching(/^\/ops\/projects\/p1\/boqs\/manage/));
  });
});
