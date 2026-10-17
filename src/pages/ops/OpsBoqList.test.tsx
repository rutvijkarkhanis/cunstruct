// The BOQ list's per-BOQ works total uses the shared quantity rule: a pending
// quantity is counted as pending, never priced; a failed line load is
// reported, never shown as "—"/₹0 totals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import OpsBoqList from "./OpsBoqList";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const db = vi.hoisted(() => ({ lines: [] as Record<string, unknown>[], linesError: null as null | { message: string } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const obj: Record<string, unknown> = {};
      ["select", "order", "in", "eq"].forEach((m) => { obj[m] = () => obj; });
      obj.then = (resolve: (r: unknown) => void) => resolve(
        table === "boq" ? { data: [{ id: "b1", name: "Civil BOQ", status: "draft", discipline: "civil", project_id: null, updated_at: "2026-10-01" }], error: null }
          : table === "boq_line" ? (db.linesError ? { data: null, error: db.linesError } : { data: db.lines, error: null })
            : { data: [], error: null },
      );
      return obj;
    },
  },
}));

const renderList = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><OpsBoqList /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { db.lines = []; db.linesError = null; });

describe("OpsBoqList — works totals", () => {
  it("leaves pending quantities out of the total and says how many", async () => {
    db.lines = [
      { boq_id: "b1", qty: 10, dsr_rate: 100, custom_rate: null, included: true, quantity_status: "MEASURED", basis: null },
      { boq_id: "b1", qty: 12, dsr_rate: 100, custom_rate: null, included: true, quantity_status: "PENDING", basis: "PENDING" },
      { boq_id: "b1", qty: 0, dsr_rate: 100, custom_rate: null, included: true, quantity_status: null, basis: null },
    ];
    renderList();
    expect(await screen.findByText("2 lines with quantity pending — not in total")).toBeInTheDocument();
    expect(screen.getAllByText("₹1,000").length).toBeGreaterThan(0);
    expect(screen.queryByText("₹2,200")).toBeNull();
  });

  it("a failed line load is reported instead of showing totals", async () => {
    db.linesError = { message: "permission denied" };
    renderList();
    expect(await screen.findByRole("alert")).toHaveTextContent("BOQs could not be loaded");
    expect(screen.queryByText(/No BOQs yet/)).toBeNull();
  });
});
