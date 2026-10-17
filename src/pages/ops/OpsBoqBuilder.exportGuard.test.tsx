// Blank-PDF guard: exportQuote must never open a print document with no line
// items. A BOQ can hold real rows that are all excluded; both exports then
// refuse with "Nothing to export yet". A BOQ whose included lines are all
// quantity-pending (reachable right after Apply) is NOT blank: both exports
// list those lines in their pending section — never as a Qty of 0. Same
// harness shape as OpsBoqBuilder.sourceIndicator.test.tsx, with per-test
// boq_line fixtures.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import OpsBoqBuilder from "./OpsBoqBuilder";
import { downloadCsv, type QuoteItem, type QuotePendingItem } from "@/lib/boqDsrDocument";
import { PDF_REREAD_FAILED_MESSAGE } from "@/lib/exportFreshness";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const exportSpies = vi.hoisted(() => ({
  openDsrQuote: vi.fn(),
  popupAllowed: true,
}));
vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return {
    ...actual,
    // openDsrQuote's contract: false when the pop-up was blocked.
    openDsrQuote: (...args: Parameters<typeof actual.openDsrQuote>) => {
      exportSpies.openDsrQuote(...args);
      return exportSpies.popupAllowed;
    },
    // The builder opens the tab from the click (openQuoteWindow) and shows the
    // freshly read document in it; `show` records it like openDsrQuote did.
    openQuoteWindow: () => (exportSpies.popupAllowed
      ? { show: (...args: Parameters<typeof actual.openDsrQuote>) => { exportSpies.openDsrQuote(...args); return true; }, fail: () => {} }
      : null),
    downloadCsv: vi.fn(),
  };
});

const fixtures = vi.hoisted(() => {
  const BOQ_ROW = {
    id: "boq-1", name: "Guard BOQ", status: "draft",
    project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null,
  };
  const PROJECT_ROW = {
    id: "proj-1", name: "Sample Project", area_sqft: null, floors: null,
    client_name: null, location: null, project_type: null, scope: null,
  };
  const baseLine = {
    section: "Foundation", dsr_code: "2.1", unit: "cum", dsr_rate: 100, custom_rate: null,
    cost: null, basis: null, basis_note: null, external_key: null, measurement_method: null,
    quantity_status: null, included: true, source: "manual", sort: 1,
    source_document_id: null, source_page: null,
  };
  const state = { lines: [] as Record<string, unknown>[], holdLines: false, failSpecRead: false };
  return { BOQ_ROW, PROJECT_ROW, baseLine, state };
});

function chain(table: string) {
  const obj: Record<string, unknown> = {};
  let cols = "";
  ["eq", "order", "limit", "in", "or", "neq", "update"].forEach((m) => { obj[m] = () => obj; });
  obj.select = (c?: string) => { cols = c ?? ""; return obj; };
  obj.single = () => {
    // The export's own read of the spec alone (fetchSpecStrict) can be made to fail.
    if (table === "boq" && cols === "spec" && fixtures.state.failSpecRead) return Promise.resolve({ data: null, error: { message: "spec read failed (test)" } });
    if (table === "boq") return Promise.resolve({ data: fixtures.BOQ_ROW, error: null });
    if (table === "projects") return Promise.resolve({ data: fixtures.PROJECT_ROW, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    if (table === "boq_line") {
      // Never resolving keeps the lines query in flight (linesLoading) for the
      // whole test, like a slow network.
      if (fixtures.state.holdLines) return;
      return resolve({ data: fixtures.state.lines, error: null });
    }
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

// Keyboard-open the first "Export BOQ" menu (Radix ignores a jsdom click on the
// trigger — see OpsBoqBuilder.sourceIndicator.test.tsx) and click the item.
async function clickExportItem(item: "PDF" | "PDF / Spec & Qty" | "Excel") {
  const triggers = await screen.findAllByRole("button", { name: /Export BOQ/i });
  await waitFor(() => expect(triggers[0]).toBeEnabled());
  triggers[0].focus();
  fireEvent.keyDown(triggers[0], { key: "Enter", code: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
  // The Excel export re-reads the lines first (lib/exportFreshness): let it finish.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const line = (overrides: Record<string, unknown>) => ({ ...fixtures.baseLine, ...overrides });

beforeEach(() => {
  fixtures.state.lines = [];
  fixtures.state.holdLines = false;
  fixtures.state.failSpecRead = false;
  exportSpies.openDsrQuote.mockClear();
  vi.mocked(downloadCsv).mockClear();
  exportSpies.popupAllowed = true;
  vi.mocked(toast.error).mockClear();
});

describe("OpsBoqBuilder — blank PDF export guard", () => {
  it("all lines excluded: both PDF entries and Excel show 'Nothing to export yet' and nothing opens or downloads", async () => {
    fixtures.state.lines = [
      line({ id: "l1", description: "RCC footing", qty: 10, included: false }),
      line({ id: "l2", description: "Brickwork", qty: 5, included: false }),
    ];
    renderBoqBuilder();
    // Excluded rows render only in the editor (dimmed, box unchecked), not in
    // the included-only summary, so wait on their checkboxes.
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(boxes).toHaveLength(2);
      boxes.forEach((b) => expect(b.checked).toBe(false));
    });

    await clickExportItem("PDF");
    await clickExportItem("PDF / Spec & Qty");
    await clickExportItem("Excel");

    expect(exportSpies.openDsrQuote).not.toHaveBeenCalled();
    expect(downloadCsv).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(3);
    for (const n of [1, 2, 3]) expect(toast.error).toHaveBeenNthCalledWith(n, "Nothing to export yet");
  });

  // boq_line.qty is NOT NULL: both writers (evalLinesToRows, applyReviewPlan)
  // persist a pending quantity as qty 0 + quantity_status "PENDING".
  it("all quantities pending: both exports list every line as pending, never as a measured 0", async () => {
    fixtures.state.lines = [
      line({ id: "l1", description: "Plaster — awaiting qty", qty: 0, quantity_status: "PENDING", source_document_id: null }),
      line({ id: "l2", description: "Flooring — awaiting qty", qty: 0, quantity_status: "PENDING", sort: 2 }),
    ];
    renderBoqBuilder();
    await screen.findByText("Plaster — awaiting qty");

    await clickExportItem("PDF");
    await clickExportItem("Excel");

    expect(toast.error).not.toHaveBeenCalled();
    expect(exportSpies.openDsrQuote).toHaveBeenCalledTimes(1);
    const [payload] = exportSpies.openDsrQuote.mock.calls[0] as [{ subheads: unknown[]; pendingItems: QuotePendingItem[] }];
    expect(payload.subheads).toEqual([]);
    expect(payload.pendingItems.map((p) => [p.spec, p.unit, p.note])).toEqual([
      ["Plaster — awaiting qty", "cum", "Quantity pending: not yet measured"],
      ["Flooring — awaiting qty", "cum", "Quantity pending: not yet measured"],
    ]);
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const csv = vi.mocked(downloadCsv).mock.calls[0][1];
    expect(csv).toContain("IDENTIFIED — PENDING QUANTIFICATION");
    // The pending row carries the line's schedule code, with no quantity.
    expect(csv).toContain("Pending,P.01,2.1,Plaster — awaiting qty — Quantity pending: not yet measured,cum,,");
    expect(csv.split("\r\n").filter((r) => r.split(",")[5] === "0")).toEqual([]);
  });

  it("valid BOQ: the PDF export opens with the measured lines priced, the pending line listed as pending, and the excluded line absent", async () => {
    fixtures.state.lines = [
      line({ id: "l1", description: "RCC footing", qty: 10 }),
      line({ id: "l2", description: "Brickwork — excluded", qty: 5, included: false }),
      line({ id: "l3", description: "Plaster — awaiting qty", qty: 0, quantity_status: "PENDING" }),
    ];
    renderBoqBuilder();
    await screen.findByText("RCC footing");

    await clickExportItem("PDF");

    expect(exportSpies.openDsrQuote).toHaveBeenCalledTimes(1);
    const [payload, opts] = exportSpies.openDsrQuote.mock.calls[0] as [{ boqName: string; blankRates: boolean; subheads: { lines: QuoteItem[] }[] }, { autoPrint: boolean }];
    expect(payload.boqName).toBe("Guard BOQ");
    expect(payload.blankRates).toBe(false);
    expect(opts).toEqual({ autoPrint: true });
    const items = payload.subheads.flatMap((sh) => sh.lines);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ spec: "RCC footing", qty: 10, unit: "cum", rate: 100, amount: 1000 });
    // The pending line is listed once as pending; the excluded line is absent.
    expect((payload as unknown as { pendingItems: QuotePendingItem[] }).pendingItems.map((p) => p.spec)).toEqual(["Plaster — awaiting qty"]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("valid BOQ: 'PDF / Spec & Qty' still opens, with blank rates and no auto-print", async () => {
    fixtures.state.lines = [line({ id: "l1", description: "RCC footing", qty: 10 })];
    renderBoqBuilder();
    await screen.findByText("RCC footing");

    await clickExportItem("PDF / Spec & Qty");

    expect(exportSpies.openDsrQuote).toHaveBeenCalledTimes(1);
    const [payload, opts] = exportSpies.openDsrQuote.mock.calls[0] as [{ blankRates: boolean }, { autoPrint: boolean }];
    expect(payload.blankRates).toBe(true);
    expect(opts).toEqual({ autoPrint: false });
  });

  it("the PDF is built from a fresh read: a quantity saved after the screen loaded is in the document", async () => {
    fixtures.state.lines = [line({ id: "l1", description: "RCC footing", qty: 10 })];
    renderBoqBuilder();
    await screen.findByText("RCC footing");
    fixtures.state.lines = [line({ id: "l1", description: "RCC footing", qty: 99 })]; // saved elsewhere meanwhile

    await clickExportItem("PDF");

    await waitFor(() => expect(exportSpies.openDsrQuote).toHaveBeenCalledTimes(1));
    const [payload] = exportSpies.openDsrQuote.mock.calls[0] as [{ subheads: { lines: QuoteItem[] }[] }];
    expect(payload.subheads[0].lines[0]).toMatchObject({ qty: 99, amount: 9900 });
  });

  it("a failed re-read of the BOQ's settings produces no PDF, and says so", async () => {
    fixtures.state.lines = [line({ id: "l1", description: "RCC footing", qty: 10 })];
    renderBoqBuilder();
    await screen.findByText("RCC footing");
    fixtures.state.failSpecRead = true;

    await clickExportItem("PDF");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(PDF_REREAD_FAILED_MESSAGE));
    expect(exportSpies.openDsrQuote).not.toHaveBeenCalled();
  });

  it("pop-up blocked: a valid export still reports 'Allow pop-ups to export'", async () => {
    exportSpies.popupAllowed = false;
    fixtures.state.lines = [line({ id: "l1", description: "RCC footing", qty: 10 })];
    renderBoqBuilder();
    await screen.findByText("RCC footing");

    await clickExportItem("PDF");

    // The tab is opened first (openQuoteWindow); when that is blocked, no
    // document is built or shown at all.
    expect(exportSpies.openDsrQuote).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Allow pop-ups to export");
    expect(toast.error).not.toHaveBeenCalledWith("Nothing to export yet");
  });

  // Empty and still-loading BOQs are stopped one layer earlier: `lines` is []
  // in both cases, so every Export trigger is disabled and exportQuote cannot
  // be reached from the UI at all. These pin that boundary.
  it("empty BOQ (no lines at all): every Export trigger is disabled and no document opens", async () => {
    renderBoqBuilder();
    const triggers = await screen.findAllByRole("button", { name: /Export BOQ/i });
    await waitFor(() => triggers.forEach((t) => expect(t).toBeDisabled()));
    expect(exportSpies.openDsrQuote).not.toHaveBeenCalled();
  });

  it("lines still loading: Export stays disabled rather than treating the BOQ as empty", async () => {
    fixtures.state.holdLines = true;
    renderBoqBuilder();
    const triggers = await screen.findAllByRole("button", { name: /Export BOQ/i });
    triggers.forEach((t) => expect(t).toBeDisabled());
    expect(exportSpies.openDsrQuote).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith("Nothing to export yet");
  });
});
