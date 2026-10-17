// The public share view never shows a pending quantity as a number, never
// prices it, and says what the totals leave out. It also copes with a
// response from a share function deployed before quantityState existed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import ShareBoqPanel from "./ShareBoqPanel";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

const renderPanel = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ShareBoqPanel token="t" boqs={[{ id: "b1", name: "Civil BOQ", scopeId: null, lineCount: 4 }]} />
  </QueryClientProvider>,
);

beforeEach(() => invoke.mockReset());

describe("ShareBoqPanel — quantity states", () => {
  it("shows pending, confirmed zero and unavailable as such, with the recorded basis", async () => {
    invoke.mockResolvedValue({ error: null, data: { ok: true, boq: { id: "b1", name: "Civil BOQ" },
      commercials: { works: 1000, subTotal: 1180, grandTotal: 1400 },
      lines: [
        { id: "a", description: "Footing", unit: "cum", qty: 10, included: true, rate: 100, amount: 1000, quantityState: "established", basis: "From drawing summary (estimator's reading)" },
        { id: "b", description: "Door", unit: "nos", qty: 12, included: true, rate: 100, amount: null, quantityState: "pending", basis: "Awaiting quantity" },
        { id: "c", description: "Skirting", unit: "m", qty: 0, included: true, rate: 100, amount: 0, quantityState: "confirmed_zero", basis: "Changed manually" },
        { id: "d", description: "Railing", unit: "m", qty: null, included: true, rate: 100, amount: null, quantityState: "unavailable", basis: "Basis not recorded" },
      ] } });
    renderPanel();
    expect(await screen.findByText(/^Quantity pending/)).toBeInTheDocument();
    expect(screen.queryByText(/^12 nos/)).toBeNull();
    expect(screen.getByText(/^0 m \(confirmed\)/)).toBeInTheDocument();
    expect(screen.getByText(/^Quantity not available/)).toBeInTheDocument();
    expect(screen.getByText("Basis: From drawing summary (estimator's reading)")).toBeInTheDocument();
    expect(screen.getByText("2 lines have no established quantity and are not in these totals.")).toBeInTheDocument();
    expect(screen.getByText("Subtotal (priced lines)")).toBeInTheDocument();
  });

  it("an older response without quantityState: a bare 0 is pending, never '0 measured'", async () => {
    invoke.mockResolvedValue({ error: null, data: { ok: true, lines: [
      { id: "a", description: "Footing", unit: "cum", qty: 0, included: true },
    ] } });
    renderPanel();
    expect(await screen.findByText("Quantity pending")).toBeInTheDocument();
  });

  it("a failed load says so instead of loading forever", async () => {
    invoke.mockResolvedValue({ error: new Error("boom"), data: null });
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
  });
});
