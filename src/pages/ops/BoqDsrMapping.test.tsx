// DSR mapping + indicative costing page, against an in-memory supabase mock
// that records every write. The key guarantee under test: decisions and
// estimate inclusion write ONLY to boq_line_dsr_mapping — never to boq_line.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import BoqDsrMapping from "./BoqDsrMapping";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "reviewer-1" } }) }));

const db = vi.hoisted(() => {
  const LINES = [
    { id: "line-pcc", section: "Foundation", dsr_code: "4.1.3", description: "PCC below footings", unit: "cum", qty: 10, included: true, quantity_status: "MEASURED", sort: 1 },
    { id: "line-tile", section: "Finishes", dsr_code: null, description: "Vitrified tiles", unit: "sqm", qty: 40, included: true, quantity_status: "MEASURED", sort: 2 },
    { id: "line-rail", section: "Finishes", dsr_code: null, description: "SS railing", unit: "rmt", qty: 12, included: true, quantity_status: "MEASURED", sort: 3 },
  ];
  const DSR = [
    { id: "dsr-2023", code: "4.1.3", description: "Providing and laying in position cement concrete of specified grade 1:2:4", unit: "cum", rate: 100, source: "DSR", rate_year: "2023", subhead: "4.0 CONCRETE WORK" },
    { id: "dsr-2021", code: "4.1.3", description: "Cement concrete 1:2:4 (older schedule)", unit: "cum", rate: 90, source: "DSR", rate_year: "2021", subhead: null },
    { id: "dsr-tile", code: "11.41.2", description: "Vitrified floor tiles", unit: "sqm", rate: 1500, source: "DSR", rate_year: "2023", subhead: null },
  ];
  const state = {
    mappingTableMissing: false,
    mappings: [] as Record<string, unknown>[],
    writes: [] as { table: string; op: string; payload?: unknown }[],
  };
  return { LINES, DSR, state };
});

function chain(table: string) {
  let op = "select";
  let payload: Record<string, unknown> | undefined;
  const filters: Record<string, unknown> = {};
  const obj: Record<string, unknown> = {};
  obj.select = () => obj;
  ["order", "limit", "or"].forEach((m) => { obj[m] = () => obj; });
  obj.eq = (c: string, v: unknown) => { filters[c] = v; return obj; };
  obj.upsert = (p: Record<string, unknown>) => { op = "upsert"; payload = p; return obj; };
  obj.update = (p: Record<string, unknown>) => { op = "update"; payload = p; return obj; };
  obj.delete = () => { op = "delete"; return obj; };
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    const s = db.state;
    if (op !== "select") s.writes.push({ table, op, payload: { ...payload, ...filters } });
    if (table === "boq_line_dsr_mapping") {
      if (s.mappingTableMissing) return resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.boq_line_dsr_mapping' in the schema cache" } });
      if (op === "upsert") {
        s.mappings = s.mappings.filter((m) => m.boq_line_id !== payload!.boq_line_id);
        s.mappings.push({ id: `map-${payload!.boq_line_id}`, ...payload });
      } else if (op === "update") {
        s.mappings = s.mappings.map((m) => (m.id === filters.id ? { ...m, ...payload } : m));
      } else if (op === "delete") {
        s.mappings = s.mappings.filter((m) => m.boq_line_id !== filters.boq_line_id);
      }
      return resolve({ data: op === "select" ? s.mappings : null, error: null });
    }
    if (table === "boq_line") return resolve({ data: db.LINES, error: null });
    if (table === "boq") return resolve({ data: [{ name: "Civil BOQ" }], error: null });
    if (table === "dsr_item") {
      const rows = filters.code ? db.DSR.filter((d) => d.code === filters.code) : db.DSR;
      return resolve({ data: rows, error: null });
    }
    return resolve({ data: [], error: null });
  };
  return obj;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => chain(t) } }));

const mapped = (lineId: string, item: (typeof db.DSR)[number], o: Record<string, unknown> = {}) => ({
  id: `map-${lineId}`, boq_id: "boq-1", boq_line_id: lineId, status: "mapped", include_in_estimate: false,
  dsr_item_id: item.id, dsr_code: item.code, dsr_description: item.description, dsr_unit: item.unit,
  dsr_rate: item.rate, dsr_source: item.source, dsr_rate_year: item.rate_year,
  reviewer_note: null, reviewed_by: "reviewer-1", reviewed_at: "2026-10-01T00:00:00Z", ...o,
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1/dsr-mapping"]}>
        <Routes>
          <Route path="/ops/projects/:id/boqs/:boqId/dsr-mapping" element={<BoqDsrMapping />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const openEstimate = async () => {
  const tab = await screen.findByRole("tab", { name: "Indicative estimate" });
  fireEvent.mouseDown(tab);
  await screen.findByText("Indicative Cost Estimate — Not Final Pricing");
};
const boqLineWrites = () => db.state.writes.filter((w) => w.table === "boq_line");

beforeEach(() => {
  db.state.mappingTableMissing = false;
  db.state.mappings = [];
  db.state.writes = [];
});

describe("BoqDsrMapping — mapping", () => {
  it("selecting a candidate saves a snapshot of THAT dsr_item (by id) to the mapping table only", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /PCC below footings/ }));
    // Same code exists in two schedules — both are offered, distinguished by year.
    const cards = await screen.findAllByTestId("dsr-candidate");
    const card2021 = cards.find((c) => within(c).queryByText("DSR 2021"))!;
    fireEvent.click(within(card2021).getByRole("button", { name: "Select match" }));

    await waitFor(() => expect(db.state.writes).toHaveLength(1));
    expect(db.state.writes[0]).toMatchObject({
      table: "boq_line_dsr_mapping", op: "upsert",
      payload: {
        boq_line_id: "line-pcc", status: "mapped", include_in_estimate: false, reviewed_by: "reviewer-1",
        dsr_item_id: "dsr-2021", dsr_code: "4.1.3", dsr_rate: 90, dsr_unit: "cum", dsr_rate_year: "2021",
        dsr_description: "Cement concrete 1:2:4 (older schedule)",
      },
    });
    expect(boqLineWrites()).toHaveLength(0);
  });

  it("marks a custom item unmatched with no reference, and clears a decision by deleting only the mapping", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /SS railing/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark unmatched (custom item)" }));
    await waitFor(() => expect(db.state.writes).toHaveLength(1));
    expect(db.state.writes[0].payload).toMatchObject({ status: "unmatched", dsr_item_id: null, dsr_code: null, dsr_rate: null });

    fireEvent.click(await screen.findByRole("button", { name: "Clear decision" }));
    await waitFor(() => expect(db.state.writes).toHaveLength(2));
    expect(db.state.writes[1]).toMatchObject({ table: "boq_line_dsr_mapping", op: "delete", payload: { boq_line_id: "line-rail" } });
    expect(boqLineWrites()).toHaveLength(0);
  });

  it("shows measured and DSR units side by side when they differ, without converting", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /SS railing/ }));
    fireEvent.change(screen.getByLabelText("Search DSR items"), { target: { value: "tiles" } });
    const notes = await screen.findAllByRole("note");
    expect(notes.some((n) => /Unit mismatch — measured: rmt · DSR: sqm \(not converted\)/.test(n.textContent ?? ""))).toBe(true);
  });

  it("when the mapping table isn't migrated, explains it and disables every decision", async () => {
    db.state.mappingTableMissing = true;
    renderPage();
    expect(await screen.findByText(/has not been applied/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /SS railing/ }));
    expect(screen.getByRole("button", { name: "Mark unmatched (custom item)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Flag as ambiguous" })).toBeDisabled();
    expect(db.state.writes).toHaveLength(0);
  });
});

describe("BoqDsrMapping — indicative estimate", () => {
  it("labels the estimate, prices only included matches, and reports the total as partial", async () => {
    db.state.mappings = [
      mapped("line-pcc", db.DSR[0], { include_in_estimate: true }),
      mapped("line-rail", db.DSR[2]), // sqm reference on an rmt line
    ];
    renderPage();
    await openEstimate();

    expect(screen.getByTestId("indicative-total")).toHaveTextContent("₹1,000");
    expect(screen.getByTestId("indicative-coverage")).toHaveTextContent("Partial — 1 of 3 in-scope lines priced; 2 not costed");
    expect(within(screen.getByTestId("estimate-row-line-rail")).getByText("Unit mismatch")).toBeInTheDocument();
    expect(within(screen.getByTestId("estimate-row-line-tile")).getByText("Unmapped")).toBeInTheDocument();
  });

  it("a unit-mismatched or unmapped line can't be included; an eligible one is included via the mapping row only", async () => {
    db.state.mappings = [mapped("line-pcc", db.DSR[0]), mapped("line-rail", db.DSR[2])];
    renderPage();
    await openEstimate();

    expect(screen.getByRole("checkbox", { name: /Include SS railing/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Include Vitrified tiles/ })).toBeDisabled();
    expect(screen.getByTestId("indicative-total")).toHaveTextContent("₹0");

    fireEvent.click(screen.getByRole("checkbox", { name: /Include PCC below footings/ }));
    await waitFor(() => expect(screen.getByTestId("indicative-total")).toHaveTextContent("₹1,000"));
    expect(db.state.writes).toEqual([
      expect.objectContaining({ table: "boq_line_dsr_mapping", op: "update", payload: expect.objectContaining({ include_in_estimate: true, id: "map-line-pcc" }) }),
    ]);
    expect(boqLineWrites()).toHaveLength(0);
  });

  it("prices from the saved snapshot, not the current reference table", async () => {
    // Snapshot says ₹120; the live dsr_item row for the same id says ₹100.
    db.state.mappings = [mapped("line-pcc", db.DSR[0], { dsr_rate: 120, include_in_estimate: true })];
    renderPage();
    await openEstimate();
    expect(screen.getByTestId("indicative-total")).toHaveTextContent("₹1,200");
  });
});
