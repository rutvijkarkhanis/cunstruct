// Work packages and the incomplete-scope notice on the real BOQ builder. The
// work-package export and the on-screen notice are presentations of the same
// lines: they never write, and never change a quantity. Same harness shape as
// OpsBoqBuilder.exportGuard.test.tsx, plus a review store with unresolved items
// and the project's scopes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OpsBoqBuilder from "./OpsBoqBuilder";
import { downloadCsv } from "@/lib/boqDsrDocument";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return { ...actual, openDsrQuote: vi.fn(() => true), openQuoteWindow: vi.fn(() => ({ show: vi.fn(() => true), fail: vi.fn() })), downloadCsv: vi.fn() };
});

const fixtures = vi.hoisted(() => {
  const BOQ_ROW = { id: "boq-1", name: "Tower A", status: "draft", project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null };
  const PROJECT_ROW = { id: "proj-1", name: "Sample Project", area_sqft: null, floors: null, client_name: null, location: null, project_type: null, scope: null };
  const baseLine = {
    section: "Masonry", dsr_code: null, unit: "cum", dsr_rate: 100, custom_rate: null, cost: null, basis: null, basis_note: null,
    external_key: null, measurement_method: null, quantity_status: null, included: true, source: "manual", sort: 1,
    source_document_id: null, source_page: null, scope_id: null,
  };
  const state = {
    lines: [] as Record<string, unknown>[],
    scopes: [{ id: "s-ground", name: "Ground Floor" }, { id: "s-first", name: "First Floor" }],
    reviewStatuses: [] as string[],
    writes: [] as string[],
  };
  return { BOQ_ROW, PROJECT_ROW, baseLine, state };
});

vi.mock("@/lib/review/reviewStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/review/reviewStore")>("@/lib/review/reviewStore");
  return {
    ...actual,
    latestRunForBoq: vi.fn(async () => (fixtures.state.reviewStatuses.length ? { id: "run-1" } : null)),
    loadReviewItems: vi.fn(async () => fixtures.state.reviewStatuses.map((reviewStatus, i) => ({ id: `ri-${i}`, reviewStatus }))),
  };
});

function chain(table: string) {
  const obj: Record<string, unknown> = {};
  let patch: Record<string, unknown> | null = null;
  ["select", "order", "limit", "in", "or", "neq"].forEach((m) => { obj[m] = () => obj; });
  // An update is applied to the matching fixture row, so a refetch reads it back.
  obj.eq = (col: string, value: unknown) => {
    if (patch && table === "boq_line" && col === "id") {
      fixtures.state.lines = fixtures.state.lines.map((l) => (l.id === value ? { ...l, ...patch } : l));
    }
    return obj;
  };
  obj.update = (values: Record<string, unknown>) => { fixtures.state.writes.push(`update ${table} ${JSON.stringify(values)}`); patch = values; return obj; };
  ["insert", "upsert", "delete"].forEach((m) => { obj[m] = () => { fixtures.state.writes.push(`${m} ${table}`); return obj; }; });
  obj.single = () => Promise.resolve({ data: table === "boq" ? fixtures.BOQ_ROW : table === "projects" ? fixtures.PROJECT_ROW : null, error: null });
  obj.maybeSingle = obj.single;
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    if (table === "boq_line") return resolve({ data: fixtures.state.lines, error: null });
    if (table === "project_scope") return resolve({ data: fixtures.state.scopes, error: null });
    return resolve({ data: [], error: null });
  };
  return obj;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => chain(table) } }));

function renderBoqBuilder() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <Routes>
          <Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} />
          <Route path="/ops/projects/:id/boqs/:boqId/review" element={<div>Review Workstation</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function clickExportItem(name: string | RegExp) {
  const triggers = await screen.findAllByRole("button", { name: /Export BOQ/i });
  await waitFor(() => expect(triggers[0]).toBeEnabled());
  triggers[0].focus();
  fireEvent.keyDown(triggers[0], { key: "Enter", code: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

const line = (o: Record<string, unknown>) => ({ ...fixtures.baseLine, ...o });

beforeEach(() => {
  fixtures.state.lines = [];
  fixtures.state.reviewStatuses = [];
  fixtures.state.writes = [];
  vi.mocked(downloadCsv).mockClear();
});

describe("OpsBoqBuilder — incomplete-scope notice on screen", () => {
  it("states unresolved drawing-review items with the export wording and links to the review", async () => {
    fixtures.state.lines = [line({ id: "l1", description: "Brickwork", qty: 10 })];
    fixtures.state.reviewStatuses = ["VERIFIED", "PENDING", "FLAGGED", "EDITED"];
    renderBoqBuilder();
    const notice = await screen.findByTestId("incomplete-scope-notice");
    expect(notice).toHaveTextContent("Incomplete scope. 2 drawing-review items are still pending or flagged and are not included in this BOQ.");
    fireEvent.click(screen.getByRole("button", { name: /Review unresolved items/ }));
    expect(await screen.findByText("Review Workstation")).toBeInTheDocument();
  });

  it("shows no notice when every review item was applied or corrected", async () => {
    fixtures.state.lines = [line({ id: "l1", description: "Brickwork", qty: 10 })];
    fixtures.state.reviewStatuses = ["VERIFIED", "EDITED"];
    renderBoqBuilder();
    await screen.findAllByText("Brickwork");
    expect(screen.queryByTestId("incomplete-scope-notice")).toBeNull();
  });
});

describe("OpsBoqBuilder — work packages by trade and location", () => {
  it("exports the same lines grouped by trade then location, quantities only, without writing", async () => {
    fixtures.state.lines = [
      line({ id: "l1", section: "Masonry", description: "Brickwork", qty: 12, scope_id: "s-ground", sort: 1 }),
      line({ id: "l2", section: "Concrete", description: "RCC slab", qty: 8, scope_id: "s-first", sort: 2 }),
      line({ id: "l3", section: "Masonry", description: "Parapet", qty: 0, quantity_status: "PENDING", scope_id: "s-ground", sort: 3 }),
      line({ id: "l4", section: "Masonry", description: "Old wall", qty: 3, included: false, sort: 4 }),
    ];
    fixtures.state.reviewStatuses = ["PENDING"];
    renderBoqBuilder();
    await screen.findByTestId("incomplete-scope-notice");
    await clickExportItem(/Work packages/);

    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls[0] as [string, string];
    expect(filename).toBe("Tower_A_work_packages.csv");
    const rows = csv.split("\r\n");
    expect(rows[1]).toContain("DRAFT BOQ — All quantities and rates are unvalidated drafts.");
    expect(rows[2]).toBe("Incomplete scope. 1 drawing-review item is still pending or flagged and is not included in this BOQ.");
    expect(rows).toContain("1 excluded line not shown.");
    const data = rows.slice(rows.findIndex((r) => r.startsWith("Package,")) + 1);
    expect(data).toEqual([
      "1,Concrete,First Floor,1.01,,RCC slab,cum,8,Measured,,",
      "2,Masonry,Ground Floor,2.01,,Brickwork,cum,12,Measured,,",
      "2,Masonry,Ground Floor,2.02,,Parapet,cum,,Pending — quantity not confirmed,,",
    ]);
    // No commercial figure anywhere in the table: header and rows carry no rate, amount or currency.
    const table = rows.slice(rows.findIndex((r) => r.startsWith("Package,")));
    expect(table.join("\n")).not.toMatch(/₹|rate|amount/i);
    expect(fixtures.state.writes).toEqual([]);
  });

  it("the BOQ Excel export carries the draft disclaimer and incomplete-scope notice before the header", async () => {
    fixtures.state.lines = [line({ id: "l1", description: "Brickwork", qty: 10 })];
    fixtures.state.reviewStatuses = ["FLAGGED", "PENDING", "PENDING"];
    renderBoqBuilder();
    await screen.findByTestId("incomplete-scope-notice");
    await clickExportItem("Excel");
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    const rows = (vi.mocked(downloadCsv).mock.calls[0][1] as string).split("\r\n");
    expect(rows[1]).toContain("DRAFT BOQ — All quantities and rates are unvalidated drafts.");
    expect(rows[2]).toBe("Incomplete scope. 3 drawing-review items are still pending or flagged and are not included in this BOQ.");
    expect(rows[3].startsWith("Sub-head,")).toBe(true);
  });
});

describe("OpsBoqBuilder — assigning a trade", () => {
  it("saves the line's section, reloads it, and the work-package export groups by it", async () => {
    fixtures.state.lines = [
      line({ id: "l1", section: "Drawing review — added", description: "Brickwork", qty: 12, scope_id: "s-ground", sort: 1 }),
      line({ id: "l2", section: "Drawing review — added", description: "RCC slab", qty: 8, scope_id: "s-first", sort: 2 }),
    ];
    renderBoqBuilder();
    const trade = await screen.findByRole("combobox", { name: "Trade for Brickwork" });
    expect(trade).toHaveValue("Drawing review — added");
    fireEvent.change(trade, { target: { value: "  Masonry " } });
    fireEvent.blur(trade);

    await waitFor(() => expect(fixtures.state.writes).toContain('update boq_line {"section":"Masonry"}'));
    // Only the section was written; quantities untouched.
    expect(fixtures.state.lines.find((l) => l.id === "l1")).toMatchObject({ section: "Masonry", qty: 12 });
    // Reloaded from the store, the line now sits under its trade.
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Trade for Brickwork" })).toHaveValue("Masonry"));

    await clickExportItem(/Work packages/);
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    const rows = (vi.mocked(downloadCsv).mock.calls[0][1] as string).split("\r\n");
    const data = rows.slice(rows.findIndex((r) => r.startsWith("Package,")) + 1);
    expect(data).toEqual([
      "1,Masonry,Ground Floor,1.01,,Brickwork,cum,12,Measured,,",
      "2,Unassigned trade,First Floor,2.01,,RCC slab,cum,8,Measured,,",
    ]);
  });

  it("an unchanged trade writes nothing", async () => {
    fixtures.state.lines = [line({ id: "l1", section: "Masonry", description: "Brickwork", qty: 12 })];
    renderBoqBuilder();
    const trade = await screen.findByRole("combobox", { name: "Trade for Brickwork" });
    fireEvent.blur(trade);
    await new Promise((r) => setTimeout(r, 50));
    expect(fixtures.state.writes).toEqual([]);
  });
});
