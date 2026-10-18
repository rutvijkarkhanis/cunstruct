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

  it("never shows an amount for a line it shows as pending or unavailable, even if an older share function priced it", async () => {
    // A share function deployed before quantityState existed sends no state and
    // prices every line: a bare 0 arrives as amount 0 (0 x rate). The panel shows
    // that line as "Quantity pending", so it must not also show "₹0".
    invoke.mockResolvedValue({ error: null, data: { ok: true, boq: { id: "b1", name: "Civil BOQ" },
      commercials: { works: 1000, subTotal: 1000, grandTotal: 1000 },
      lines: [
        { id: "a", description: "Footing", unit: "cum", qty: 10, included: true, rate: 100, amount: 1000 },
        { id: "b", description: "Door", unit: "nos", qty: 0, included: true, rate: 100, amount: 0 },
        { id: "z", description: "Skirting", unit: "m", qty: 0, included: true, rate: 100, amount: 0, quantityState: "confirmed_zero" },
      ] } });
    renderPanel();
    const door = (await screen.findByText("Door")).closest("div.flex")!;
    expect(door).toHaveTextContent("Quantity pending");
    expect(door).not.toHaveTextContent("₹0");
    // A confirmed zero is a real quantity: its ₹0 amount is shown, and it reads differently from pending.
    const skirting = screen.getByText("Skirting").closest("div.flex")!;
    expect(skirting).toHaveTextContent("0 m (confirmed)");
    expect(skirting).toHaveTextContent("₹0");
  });

  it("an excluded line is marked as excluded, shows no quantity, rate or amount, and cannot contradict the subtotal", async () => {
    invoke.mockResolvedValue({ error: null, data: { ok: true, boq: { id: "b1", name: "Civil BOQ" },
      commercials: { works: 1000, subTotal: 1180, grandTotal: 1400 },
      lines: [
        { id: "a", description: "Footing", unit: "cum", qty: 10, included: true, rate: 100, amount: 1000, quantityState: "established", basis: "Changed manually" },
        // The share function still returns an amount for an excluded line; the subtotal leaves it out.
        { id: "x", description: "Boundary wall", unit: "cum", qty: 5, included: false, rate: 200, amount: 1000, quantityState: "established", basis: "Changed manually" },
      ] } });
    renderPanel();
    expect(await screen.findByText("Excluded — not in the total")).toBeInTheDocument();
    expect(screen.getByText("Boundary wall")).toBeInTheDocument();
    // Only the included line's amount is shown, and it equals the subtotal.
    expect(screen.getAllByText("₹1,000")).toHaveLength(2); // the Footing row and the Subtotal
    expect(screen.queryByText(/^5 cum/)).toBeNull();
    expect(screen.queryByText(/₹200/)).toBeNull();
    expect(screen.getAllByText(/^Basis:/)).toHaveLength(1);
  });

  it("a failed load says so instead of loading forever", async () => {
    invoke.mockResolvedValue({ error: new Error("boom"), data: null });
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
  });
});
