// Scope D — surfaces Scope C's persisted boq_line.source_document_id/
// source_page back to the ops user in the BOQ editor. These tests are
// deliberately separate from OpsBoqBuilder.test.tsx (which covers the
// mobile-nav breadcrumb) so this feature's own supabase fixtures — real
// boq_line rows with source_* columns, plus project_document/document_revision
// for loadProjectDrawings — don't have to be threaded through an unrelated
// suite's shared mock.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OpsBoqBuilder from "./OpsBoqBuilder";
import { computeCommercials, type QuoteItem, type CsvRow } from "@/lib/boqDsrDocument";

// Scope H — the export-wiring tests below need to see the ACTUAL arguments
// OpsBoqBuilder hands to the PDF/CSV builders (not just the real builders'
// own output, already covered by boqDsrDocument.test.ts). openDsrQuote and
// downloadCsv are replaced outright (they touch window.open/Blob/URL, which
// jsdom doesn't need to exercise here); buildBoqCsv is spied on but still
// DELEGATES to the real implementation, so the CSV assertions below are
// checking genuine end-to-end output, not a stand-in.
const exportSpies = vi.hoisted(() => ({
  openDsrQuote: vi.fn(() => true),
  buildBoqCsv: vi.fn(),
  downloadCsv: vi.fn(),
}));
vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return {
    ...actual,
    openDsrQuote: (...args: Parameters<typeof actual.openDsrQuote>) => {
      exportSpies.openDsrQuote(...args);
      return true;
    },
    buildBoqCsv: (...args: Parameters<typeof actual.buildBoqCsv>) => {
      exportSpies.buildBoqCsv(...args);
      return actual.buildBoqCsv(...args);
    },
    downloadCsv: (...args: Parameters<typeof actual.downloadCsv>) => {
      exportSpies.downloadCsv(...args);
    },
  };
});

const fixtures = vi.hoisted(() => {
  const BOQ_ROW = {
    id: "boq-1", name: "Elevation & Facade", status: "draft",
    project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null,
  };
  const PROJECT_ROW = {
    id: "proj-1", name: "Srikakulam Apartment", area_sqft: null, floors: null,
    client_name: null, location: null, project_type: null, scope: null,
  };
  const DOCS = [{ id: "doc-1", name: "Ground Floor Plan", current_revision_id: "rev-1" }];
  const REVISIONS = [{
    id: "rev-1", document_id: "doc-1", file_path: "proj-1/doc-1/rev-1.pdf",
    original_filename: "ground-floor.pdf", page_count: 5, page_titles: null,
  }];
  const baseLine = {
    section: "Foundation", dsr_code: "2.1", unit: "cum", dsr_rate: 100, custom_rate: null,
    cost: null, basis: null, basis_note: null, external_key: null, measurement_method: null,
    quantity_status: null, included: true, source: "manual", sort: 1,
  };
  const LINES_WITH_SOURCE = [
    { ...baseLine, id: "line-resolved", description: "RCC footing — resolved source", qty: 10, source_document_id: "doc-1", source_page: "3" },
    { ...baseLine, id: "line-unresolved", description: "Brickwork — unresolved source", qty: 5, source_document_id: "doc-missing", source_page: null },
    { ...baseLine, id: "line-none", description: "Plaster — no source", qty: 8, source_document_id: null, source_page: null },
  ];
  // The column-fallback scenario: a stale deployment's boq_line genuinely has
  // no source_document_id/source_page columns at all — not merely null values.
  const LINES_NO_SOURCE_COLS = LINES_WITH_SOURCE.map(({ source_document_id, source_page, ...rest }) => rest);

  // Scope H, case 4 — holds project_document (and so loadProjectDrawings as a
  // whole, which awaits it first) permanently pending, so drawingsLoading stays
  // true for the life of a test. Real boq_line/boq/projects rows still resolve
  // normally — only the drawings lookup is stalled.
  const state = { missingSourceCols: false, holdDrawings: false, calls: [] as { table: string; op: string; payload?: unknown }[] };
  return { BOQ_ROW, PROJECT_ROW, DOCS, REVISIONS, LINES_WITH_SOURCE, LINES_NO_SOURCE_COLS, state };
});

function chain(table: string) {
  let selectedCols = "";
  const obj: Record<string, unknown> = {};
  obj.select = (cols?: string) => { selectedCols = cols ?? ""; return obj; };
  obj.update = (patch: unknown) => { fixtures.state.calls.push({ table, op: "update", payload: patch }); return obj; };
  ["eq", "order", "limit", "in", "or", "neq"].forEach((m) => { obj[m] = () => obj; });
  obj.single = () => {
    if (table === "boq") return Promise.resolve({ data: fixtures.BOQ_ROW, error: null });
    if (table === "projects") return Promise.resolve({ data: fixtures.PROJECT_ROW, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    if (table === "boq_line") {
      if (fixtures.state.missingSourceCols && selectedCols.includes("source_document_id")) {
        return resolve({ data: null, error: { message: "column boq_line.source_document_id does not exist" } });
      }
      const rows = fixtures.state.missingSourceCols ? fixtures.LINES_NO_SOURCE_COLS : fixtures.LINES_WITH_SOURCE;
      return resolve({ data: rows, error: null });
    }
    if (table === "project_document") {
      // Scope H, case 4 — never calling `resolve` leaves this specific await
      // (loadProjectDrawings' first query) pending forever, so drawingsLoading
      // stays true for the test's whole lifetime; document_revision is then
      // never even reached, same as a real in-flight request.
      if (fixtures.state.holdDrawings) return;
      return resolve({ data: fixtures.DOCS, error: null });
    }
    if (table === "document_revision") return resolve({ data: fixtures.REVISIONS, error: null });
    return resolve({ data: [], error: null });
  };
  return obj;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain(table) },
}));

function renderBoqBuilder() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <Routes>
          <Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fixtures.state.missingSourceCols = false;
  fixtures.state.holdDrawings = false;
  fixtures.state.calls = [];
  exportSpies.openDsrQuote.mockClear();
  exportSpies.buildBoqCsv.mockClear();
  exportSpies.downloadCsv.mockClear();
});

// Scope H — opens the desktop toolbar's "Export BOQ" menu and clicks the named
// item. Two such menus exist in the DOM at once (desktop toolbar + mobile row
// — only CSS, not jsdom, hides the mobile one), so `findAllByRole` and the
// first match disambiguates, same convention OpsBoqBuilder.test.tsx already
// uses for "Review Analysis →" vs. the breadcrumb's own link.
//
// A plain fireEvent.click on the trigger does NOT open a Radix dropdown under
// jsdom (it relies on pointer-capture behavior jsdom doesn't implement) —
// confirmed empirically before writing these tests. Keyboard activation
// (focus + Enter) opens it reliably; the item itself responds to a normal
// click once the menu is open.
async function clickExportItem(item: "PDF" | "Excel") {
  const triggers = await screen.findAllByRole("button", { name: /Export BOQ/i });
  const trigger = triggers[0];
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
  const menuItem = await screen.findByRole("menuitem", { name: item });
  fireEvent.click(menuItem);
}

describe("OpsBoqBuilder — export wiring (Scope H)", () => {
  it("resolved provenance: the PDF export receives the correct document name and page for the right line", async () => {
    renderBoqBuilder();
    await screen.findByText("RCC footing — resolved source");
    await clickExportItem("PDF");
    expect(exportSpies.openDsrQuote).toHaveBeenCalledTimes(1);
    const payload = exportSpies.openDsrQuote.mock.calls[0][0] as { subheads: { lines: QuoteItem[] }[] };
    const items = payload.subheads.flatMap((sh) => sh.lines);
    const item = items.find((l) => l.spec === "RCC footing — resolved source");
    expect(item).toMatchObject({ sourceDocument: "Ground Floor Plan", sourcePage: "3" });
  });

  it("resolved provenance: the Excel export's CSV row carries the same document name and page", async () => {
    renderBoqBuilder();
    await screen.findByText("RCC footing — resolved source");
    await clickExportItem("Excel");
    expect(exportSpies.buildBoqCsv).toHaveBeenCalledTimes(1);
    const rows = exportSpies.buildBoqCsv.mock.calls[0][0] as CsvRow[];
    const row = rows.find((r) => r.spec === "RCC footing — resolved source");
    expect(row).toMatchObject({ sourceDocument: "Ground Floor Plan", sourcePage: "3" });
    // End-to-end: the real buildBoqCsv ran (it isn't stubbed), so the actual
    // downloaded CSV text is what downloadCsv received — prove the resolved
    // name/page genuinely reached the rendered file, not just the call args.
    const csv = exportSpies.downloadCsv.mock.calls[0][1] as string;
    expect(csv).toContain("Ground Floor Plan");
  });

  it("unresolved document: the PDF export shows the established unavailable text and never pairs a page with it", async () => {
    renderBoqBuilder();
    await screen.findByText("Brickwork — unresolved source");
    await clickExportItem("PDF");
    const payload = exportSpies.openDsrQuote.mock.calls[0][0] as { subheads: { lines: QuoteItem[] }[] };
    const items = payload.subheads.flatMap((sh) => sh.lines);
    const item = items.find((l) => l.spec === "Brickwork — unresolved source");
    expect(item?.sourceDocument).toBe("Source document unavailable");
    // The unresolved line's own source_page ("rev" fixture has none — null —
    // but even if it had one, it must never surface once the name itself
    // didn't resolve).
    expect(item?.sourcePage).toBeFalsy();
    // The raw, unresolved id is never shown as a stand-in label.
    expect(items.some((l) => l.sourceDocument === "doc-missing")).toBe(false);
  });

  it("unresolved document: the Excel export's row matches the same unavailable convention, never a bare page", async () => {
    renderBoqBuilder();
    await screen.findByText("Brickwork — unresolved source");
    await clickExportItem("Excel");
    const rows = exportSpies.buildBoqCsv.mock.calls[0][0] as CsvRow[];
    const row = rows.find((r) => r.spec === "Brickwork — unresolved source");
    expect(row?.sourceDocument).toBe("Source document unavailable");
    expect(row?.sourcePage).toBeFalsy();
  });

  it("no provenance: a line with no source_document_id exports with blank/absent source fields, nothing fabricated", async () => {
    renderBoqBuilder();
    await screen.findByText("Plaster — no source");
    await clickExportItem("PDF");
    const payload = exportSpies.openDsrQuote.mock.calls[0][0] as { subheads: { lines: QuoteItem[] }[] };
    const items = payload.subheads.flatMap((sh) => sh.lines);
    const item = items.find((l) => l.spec === "Plaster — no source");
    expect(item?.sourceDocument).toBeFalsy();
    expect(item?.sourcePage).toBeFalsy();
  });

  it("loading state: while drawing metadata is still loading, export never prematurely marks a document unavailable", async () => {
    fixtures.state.holdDrawings = true;
    renderBoqBuilder();
    await screen.findByText("Brickwork — unresolved source");
    await clickExportItem("PDF");
    const payload = exportSpies.openDsrQuote.mock.calls[0][0] as { subheads: { lines: QuoteItem[] }[] };
    const items = payload.subheads.flatMap((sh) => sh.lines);
    const item = items.find((l) => l.spec === "Brickwork — unresolved source");
    // Still unresolved either way, but while drawings are in flight this must
    // read as "nothing known yet" (null), never the same text a GENUINELY
    // missing document gets once loading has actually finished.
    expect(item?.sourceDocument).not.toBe("Source document unavailable");
    expect(item?.sourceDocument).toBeFalsy();
    expect(item?.sourcePage).toBeFalsy();
  });

  it("commercial invariants: qty/unit/rate/amount and the grand total are exactly what the pre-Scope-H formulas produce", async () => {
    renderBoqBuilder();
    await screen.findByText("RCC footing — resolved source");
    await clickExportItem("PDF");
    const payload = exportSpies.openDsrQuote.mock.calls[0][0] as {
      subheads: { lines: QuoteItem[] }[];
      commercials: ReturnType<typeof computeCommercials>;
    };
    const items = payload.subheads.flatMap((sh) => sh.lines);
    const item = items.find((l) => l.spec === "RCC footing — resolved source");
    // qty 10 × dsr_rate 100 (no custom_rate override) — untouched by source fields.
    expect(item).toMatchObject({ qty: 10, unit: "cum", rate: 100, amount: 1000 });

    // All three fixture lines are included with qty > 0: 10, 5, 8 × rate 100.
    const works = 1000 + 500 + 800;
    const expected = computeCommercials(works, {
      costIndexPct: 0, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18,
    });
    expect(payload.commercials.works).toBe(expected.works);
    expect(payload.commercials.grandTotal).toBe(expected.grandTotal);
  });

  it("commercial invariants: the Excel export's live Amount formula still references the original Qty/Your-rate columns", async () => {
    renderBoqBuilder();
    await screen.findByText("RCC footing — resolved source");
    await clickExportItem("Excel");
    const csv = exportSpies.downloadCsv.mock.calls[0][1] as string;
    // Header line 4 (index 3), first data row is spreadsheet line 5 — the new
    // Source Document/Source Page columns are appended after Amount, so this
    // formula's column letters are exactly as before Scope H.
    expect(csv).toContain("=F5*H5");
  });
});

describe("OpsBoqBuilder — drawing-source indicator (Scope D)", () => {
  it("shows the actual resolved document name and page for a line with a valid source", async () => {
    renderBoqBuilder();
    const badge = await screen.findByTitle("Sourced from Ground Floor Plan, page 3");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain("Ground Floor Plan");
    expect(badge.textContent).toContain("p.3");
  });

  it("shows no source indicator at all for a line with no source_document_id", async () => {
    renderBoqBuilder();
    await screen.findByText("Plaster — no source");
    // Exactly the two source-bearing lines produce a badge; the third never does.
    expect(screen.getAllByTitle(/^Sourced from|source drawing could not be resolved$/)).toHaveLength(2);
  });

  it("never fabricates a document name for an unresolved source_document_id", async () => {
    renderBoqBuilder();
    const unresolved = await screen.findByText("Source document unavailable");
    expect(unresolved).toBeInTheDocument();
    // The raw, unresolved id must never leak into the UI as a stand-in label.
    expect(screen.queryByText("doc-missing")).not.toBeInTheDocument();
  });

  it("falls back gracefully when source_document_id/source_page columns are missing, without breaking the editor", async () => {
    fixtures.state.missingSourceCols = true;
    renderBoqBuilder();
    // The builder still renders real lines via the fallback select.
    await screen.findByText("RCC footing — resolved source");
    await screen.findByText("Brickwork — unresolved source");
    // But with no source columns at all, no source badge of either kind appears.
    expect(screen.queryByTitle(/^Sourced from/)).not.toBeInTheDocument();
    expect(screen.queryByText("Source document unavailable")).not.toBeInTheDocument();
  });

  it("leaves existing line-editing/persistence behavior unchanged", async () => {
    renderBoqBuilder();
    await screen.findByText("Plaster — no source");
    const checkboxes = screen.getAllByRole("checkbox");
    const plasterCheckbox = checkboxes.find((cb) => (cb as HTMLInputElement).checked) as HTMLInputElement;
    fireEvent.click(plasterCheckbox);
    await waitFor(() => {
      const updateCall = fixtures.state.calls.find((c) => c.table === "boq_line" && c.op === "update");
      expect(updateCall).toBeTruthy();
      expect((updateCall!.payload as Record<string, unknown>).included).toBe(false);
    });
  });
});
