// Edit safety in the BOQ builder, found in the live audit: a negative
// quantity was sent to the database, a failed or refused save left the
// unsaved value on screen (and in the undo ledger), and a failed load was
// shown as an empty "0 lines" BOQ. Same harness as the rate-edit tests.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import OpsBoqBuilder from "./OpsBoqBuilder";

vi.mock("sonner", () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() });
  return { toast: t };
});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const db = vi.hoisted(() => {
  const line = (o: Record<string, unknown>) => ({
    section: "Finishes", dsr_code: "11.41.2", unit: "sqm", qty: 40, dsr_rate: 900, custom_rate: null, cost: null, basis: null,
    basis_note: null, external_key: null, measurement_method: null, quantity_status: "MEASURED", included: true,
    source: "manual", source_document_id: null, source_page: null, ...o,
  });
  return {
    line,
    lines: [] as Record<string, unknown>[],
    adoptions: [] as Record<string, unknown>[],
    writes: [] as { table: string; op: string; payload: Record<string, unknown> }[],
    logError: null as null | { message: string },
    updateError: null as null | { message: string },
    selectError: null as null | { message: string },
  };
});

function chain(table: string) {
  let op = "select";
  let payload: Record<string, unknown> = {};
  const filters: [string, string, unknown][] = [];
  const obj: Record<string, unknown> = {};
  ["select", "order", "limit", "in", "or", "neq"].forEach((m) => { obj[m] = () => obj; });
  obj.eq = (c: string, v: unknown) => { filters.push(["eq", c, v]); return obj; };
  obj.is = (c: string, v: unknown) => { filters.push(["is", c, v]); return obj; };
  obj.update = (p: Record<string, unknown>) => { op = "update"; payload = p; return obj; };
  obj.insert = (p: Record<string, unknown>) => { op = "insert"; payload = p; return obj; };
  obj.single = () => Promise.resolve({
    data: table === "boq" ? { id: "boq-1", name: "Civil BOQ", status: "draft", project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null }
      : table === "projects" ? { id: "proj-1", name: "Tower B" } : null,
    error: null,
  });
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    if (op !== "select") db.writes.push({ table, op, payload });
    if (table === "boq_line") {
      if (op === "update" && db.updateError) return resolve({ data: null, error: db.updateError });
      if (op === "select" && db.selectError) return resolve({ data: null, error: db.selectError });
      if (op === "update") {
        const hit = db.lines.filter((l) => filters.every(([o, c, v]) => (o === "is" ? l[c] == null : l[c] === v)));
        hit.forEach((l) => Object.assign(l, payload));
        return resolve({ data: hit.map((l) => ({ id: l.id })), error: null });
      }
      return resolve({ data: db.lines.map((l) => ({ ...l })), error: null });
    }
    if (table === "boq_line_change_log") return resolve({ data: null, error: op === "insert" ? db.logError : null });
    if (table === "boq_line_rate_adoption") return resolve({ data: db.adoptions, error: null });
    return resolve({ data: [], error: null });
  };
  return obj;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => chain(t) } }));

function renderBoqBuilder() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <Routes><Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const qty = () => screen.getByRole("spinbutton", { name: "Quantity for Vitrified tiles" }) as HTMLInputElement;
const rate = () => screen.getByRole("spinbutton", { name: "Rate for Vitrified tiles" }) as HTMLInputElement;
const unit = () => screen.getByRole("textbox", { name: "Unit for Vitrified tiles" }) as HTMLInputElement;
const type = (el: HTMLInputElement, v: string) => { fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); };

beforeEach(() => {
  db.lines = [db.line({ id: "l1", description: "Vitrified tiles", sort: 1 })];
  db.adoptions = [];
  db.writes = [];
  db.logError = null;
  db.updateError = null;
  db.selectError = null;
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("OpsBoqBuilder — edit safety", () => {
  it("never saves a negative quantity: restores the saved one and says why", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    type(qty(), "-5");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Quantity must be zero or more — not saved. It is still 40 sqm."));
    expect(qty().value).toBe("40");
    expect(db.writes).toEqual([]);
  });

  it("never saves a blank unit", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    type(unit(), "  ");
    expect(unit().value).toBe("sqm");
    expect(toast.error).toHaveBeenCalledWith("Unit cannot be empty — not saved.");
    expect(db.writes).toEqual([]);
  });

  it("a failed save puts the saved value back, explains plainly, and records no undo step", async () => {
    db.updateError = { message: "TypeError: Failed to fetch" };
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    type(qty(), "55");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not saved — the connection to the server failed. Check your connection and try again."));
    await waitFor(() => expect(qty().value).toBe("40"));
    expect(toast).not.toHaveBeenCalled(); // the ledger's "change recorded" toast
    expect(db.lines[0].qty).toBe(40);
  });

  it("a refused rate edit does not stay in the field", async () => {
    db.logError = { message: "relation \"boq_line_change_log\" does not exist" };
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    type(rate(), "1500");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(rate().value).toBe("900"));
  });

  it("rejects a negative rate without writing", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    type(rate(), "-10");
    expect(toast.error).toHaveBeenCalledWith("Rate cannot be negative — not saved.");
    expect(rate().value).toBe("900");
    expect(db.writes).toEqual([]);
  });

  it("shows a failed load as an error with retry, not as an empty BOQ", async () => {
    db.selectError = { message: "TypeError: Failed to fetch" };
    renderBoqBuilder();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this BOQ's lines");
    expect(screen.queryByText(/No items yet/)).toBeNull();
    expect(screen.getByText(/lines unavailable/)).toBeInTheDocument();
    db.selectError = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Vitrified tiles")).toBeInTheDocument();
  });

  it("labels the headline total without repeating 'works'", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    expect(screen.queryByText(/works works/i)).toBeNull();
    expect(screen.getAllByText("Civil works").length).toBeGreaterThan(0);
  });

  it("names every line control for assistive technology", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    expect(screen.getByRole("checkbox", { name: "Include Vitrified tiles in the BOQ total" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Remove Vitrified tiles (can be undone)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show how Vitrified tiles is priced" })).toHaveAttribute("aria-expanded", "false");
    expect(qty()).toBeInTheDocument();
    expect(rate()).toBeInTheDocument();
  });
});

describe("OpsBoqBuilder — quantity edits never overwrite a change made elsewhere", () => {
  it("refuses a quantity edit when the line changed since it was loaded, and records no undo step", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    db.lines[0].qty = 41; // saved meanwhile by someone else
    type(qty(), "55");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Change not saved: this line was changed elsewhere since it was loaded. The current values are now shown."));
    expect(db.lines[0].qty).toBe(41);
    expect(db.writes.filter((w) => w.table === "boq_line" && w.op === "update")).toHaveLength(1); // the guarded attempt, which matched nothing
    expect(toast).not.toHaveBeenCalled(); // no ledger ("change recorded") step
  });

  it("records a saved quantity edit in the line's history", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    type(qty(), "55");
    await waitFor(() => expect(db.lines[0].qty).toBe(55));
    await waitFor(() => expect(db.writes).toContainEqual({ table: "boq_line_change_log", op: "insert",
      payload: [expect.objectContaining({ boq_line_id: "l1", field: "qty", old_value: "40", new_value: "55", changed_by: "user-1" })] }));
  });
});
