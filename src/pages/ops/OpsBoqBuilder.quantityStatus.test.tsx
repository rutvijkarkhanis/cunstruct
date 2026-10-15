// Quantity status in the BOQ editor: a quantity-pending line becomes a measured
// line only when a positive quantity is entered for it (the editor's own
// "enter a quantity to price this line"); until then it is never priced —
// not in line amounts, sub-head subtotals, the grand total, or the exports.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OpsBoqBuilder from "./OpsBoqBuilder";
import type { DsrQuotePayload } from "@/lib/boqDsrDocument";

vi.mock("sonner", () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() });
  return { toast: t };
});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const io = vi.hoisted(() => ({ quotes: [] as unknown[] }));
vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return { ...actual, openDsrQuote: (p: unknown) => { io.quotes.push(p); return true; }, downloadCsv: vi.fn() };
});

const db = vi.hoisted(() => {
  const line = (o: Record<string, unknown>) => ({
    section: "Finishes", dsr_code: "11.41.2", unit: "sqm", qty: 40, dsr_rate: 100, custom_rate: null, cost: null, basis: null,
    basis_note: null, external_key: null, measurement_method: null, quantity_status: "MEASURED", included: true,
    source: "manual", sort: 1, source_document_id: null, source_page: null, ...o,
  });
  return { line, lines: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] };
});

function chain(table: string) {
  let op = "select";
  let payload: Record<string, unknown> = {};
  const filters: [string, unknown][] = [];
  const obj: Record<string, unknown> = {};
  ["select", "order", "limit", "in", "or", "neq", "is"].forEach((m) => { obj[m] = () => obj; });
  obj.eq = (c: string, v: unknown) => { filters.push([c, v]); return obj; };
  obj.update = (p: Record<string, unknown>) => { op = "update"; payload = p; return obj; };
  obj.insert = () => { op = "insert"; return obj; };
  obj.single = () => Promise.resolve({
    data: table === "boq" ? { id: "boq-1", name: "Civil BOQ", status: "draft", project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null }
      : table === "projects" ? { id: "proj-1", name: "Tower B" } : null,
    error: null,
  });
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    if (table === "boq_line" && op === "update") {
      db.updates.push(payload);
      db.lines.filter((l) => filters.every(([c, v]) => l[c] === v)).forEach((l) => Object.assign(l, payload));
      return resolve({ data: null, error: null });
    }
    if (table === "boq_line") return resolve({ data: db.lines.map((l) => ({ ...l })), error: null });
    return resolve({ data: [], error: null });
  };
  return obj;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => chain(t) } }));

function renderBoqBuilder() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <Routes><Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
/** The editor's quantity inputs, in line order (number inputs that aren't rate/cost). */
const qtyInputs = () => (Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[])
  .filter((i) => !i.placeholder);
const typeQty = (i: number, v: string) => { const el = qtyInputs()[i]; fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); };
async function exportPdf() {
  const trigger = (await screen.findAllByRole("button", { name: /Export BOQ/i }))[0];
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "PDF" }));
  await waitFor(() => expect(io.quotes.length).toBeGreaterThan(0));
  return io.quotes[io.quotes.length - 1] as DsrQuotePayload;
}

beforeEach(() => { db.updates = []; io.quotes = []; });

describe("entering a quantity", () => {
  it("a positive quantity on a pending line confirms it: the pending marker is cleared in the same write", async () => {
    db.lines = [db.line({ id: "l1", description: "Plaster", qty: 0, basis: "PENDING", quantity_status: "PENDING" })];
    renderBoqBuilder();
    await screen.findByText("quantity pending");
    typeQty(0, "25");
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0]).toEqual({ qty: 25, basis: null, quantity_status: "MEASURED" });
  });

  it("a counted item is confirmed as COUNTED", async () => {
    db.lines = [db.line({ id: "l1", description: "Doors", unit: "nos", qty: 0, basis: "PENDING", quantity_status: "PENDING", measurement_method: "COUNT" })];
    renderBoqBuilder();
    await screen.findByText("quantity pending");
    typeQty(0, "6");
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0]).toEqual({ qty: 6, basis: null, quantity_status: "COUNTED" });
  });

  it("zero or a negative number is not a confirmation: the line stays pending", async () => {
    db.lines = [db.line({ id: "l1", description: "Plaster", qty: 5, basis: "PENDING", quantity_status: "PENDING" })];
    renderBoqBuilder();
    await screen.findByText("quantity pending");
    typeQty(0, "0");
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0]).toEqual({ qty: 0 });
  });

  it("editing a measured line changes only its quantity", async () => {
    db.lines = [db.line({ id: "l1", description: "Tiles", qty: 40 })];
    renderBoqBuilder();
    await screen.findByDisplayValue("Tiles");
    typeQty(0, "42");
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0]).toEqual({ qty: 42 });
  });
});

describe("a line still marked pending is never priced", () => {
  // A legacy row: a number was typed into it before entering a quantity cleared the marker.
  const LINES = () => [
    db.line({ id: "l1", description: "Tiles", qty: 40 }),                                                   // 40 × 100 = 4,000
    db.line({ id: "l2", description: "Plaster", qty: 12, basis: "PENDING", quantity_status: "PENDING", sort: 2 }),
    db.line({ id: "l3", description: "Skirting (none required)", qty: 0, quantity_status: "MEASURED", sort: 3 }), // a verified zero
  ];

  it("subtotal and works total count only the measured lines; the pending line is listed as pending, the verified zero as a measured row", async () => {
    db.lines = LINES();
    renderBoqBuilder();
    await screen.findByDisplayValue("Tiles");
    const p = await exportPdf();
    expect(p.subheads.flatMap((s) => s.lines.map((l) => [l.spec, l.qty, l.amount]))).toEqual([["Tiles", 40, 4000], ["Skirting (none required)", 0, 0]]);
    expect(p.subheads[0].subtotal).toBe(4000);
    expect(p.commercials.works).toBe(4000);
    expect(p.pendingItems!.map((x) => [x.spec, x.note])).toEqual([["Plaster", "Quantity pending: still marked pending; the entered 12 sqm has not been confirmed"]]);
  });

  it("its amount is shown as '—', not 12 × rate", async () => {
    db.lines = [db.line({ id: "l2", description: "Plaster", qty: 12, basis: "PENDING", quantity_status: "PENDING" })];
    renderBoqBuilder();
    await screen.findByText("quantity pending");
    expect(screen.queryByText("₹1,200")).toBeNull();
  });
});
