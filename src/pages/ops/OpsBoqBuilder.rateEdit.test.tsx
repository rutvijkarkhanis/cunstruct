// Inline rate edits in the BOQ editor are audited, confirm before replacing an
// adopted rate, never touch adoption history, and never report an unaudited
// change as a success. The mock simulates the guarded boq_line update, the
// change log and the adoption table, and records every write.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

function renderBoqBuilder(client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <Routes><Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
/** The desktop rate input of the only line. */
const rateInput = () => screen.getAllByPlaceholderText("rate")[0] as HTMLInputElement;
const typeRate = (v: string) => { fireEvent.change(rateInput(), { target: { value: v } }); fireEvent.blur(rateInput()); };
const ADOPTION = {
  id: "ad-1", boq_line_id: "l1", adopted_rate: 1150, source_label: "Quotation — Vendor A (Q-1)", confirmed_at: "2026-10-10T09:00:00Z",
  previous_rate: 900, previous_basis: "dsr", source_kind: "vendor_quotation", source_unit: "sqm", source_date: "2026-10-01",
  acknowledged_caveats: [], confirmation_text: "…", confirmed_by: "reviewer-1",
};

beforeEach(() => {
  db.lines = [db.line({ id: "l1", description: "Vitrified tiles", sort: 1 })];
  db.adoptions = [];
  db.writes = [];
  db.logError = null;
  vi.mocked(toast.error).mockClear();
});

describe("OpsBoqBuilder — manual rate edits", () => {
  it("audits a manual rate change: guarded custom_rate update plus a change-log row with actor", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    typeRate("1100");
    await waitFor(() => expect(db.writes.some((w) => w.table === "boq_line_change_log")).toBe(true));
    expect(db.writes).toEqual([
      { table: "boq_line", op: "update", payload: { custom_rate: 1100 } },
      { table: "boq_line_change_log", op: "insert", payload: {
        boq_id: "boq-1", boq_line_id: "l1", review_item_id: null, field: "custom_rate", old_value: null, new_value: "1100", changed_by: "user-1",
      } },
    ]);
    expect(db.lines[0]).toMatchObject({ custom_rate: 1100, qty: 40, unit: "sqm", description: "Vitrified tiles", dsr_rate: 900 });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before replacing an adopted rate; 'Keep adopted rate' writes nothing and restores the field", async () => {
    db.lines = [db.line({ id: "l1", description: "Vitrified tiles", sort: 1, custom_rate: 1150 })];
    db.adoptions = [ADOPTION];
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    expect(await screen.findByTestId("rate-provenance-l1")).toHaveTextContent("adopted rate");

    typeRate("1300");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("This line's rate of ₹1,150 was adopted from Quotation — Vendor A (Q-1) on 2026-10-10. Changing it to ₹1,300 makes it a manual rate.");
    expect(db.writes).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep adopted rate" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(rateInput().value).toBe("1150");
    expect(db.writes).toHaveLength(0);
  });

  it("after confirmation, records the manual change, keeps the adoption record, and labels the line as changed after adoption", async () => {
    db.lines = [db.line({ id: "l1", description: "Vitrified tiles", sort: 1, custom_rate: 1150 })];
    db.adoptions = [ADOPTION];
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await screen.findByTestId("rate-provenance-l1");

    typeRate("1300");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Replace with manual rate" }));
    await waitFor(() => expect(db.writes.some((w) => w.table === "boq_line_change_log")).toBe(true));
    expect(db.writes.map((w) => `${w.op}:${w.table}`)).toEqual(["update:boq_line", "insert:boq_line_change_log"]);
    expect(db.writes[1].payload).toMatchObject({ old_value: "1150", new_value: "1300" });
    // Adoption history is untouched and still there.
    expect(db.writes.some((w) => w.table === "boq_line_rate_adoption")).toBe(false);
    expect(db.adoptions).toEqual([ADOPTION]);
    await waitFor(() => expect(screen.getByTestId("rate-provenance-l1")).toHaveTextContent("manual rate — changed after adoption"));
    expect(rateInput().value).toBe("1300");
  });

  it("if the audit row fails, rolls the rate back and says so — no silent success", async () => {
    db.logError = { message: "permission denied for table boq_line_change_log" };
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    typeRate("1100");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "Rate not changed: its audit record couldn't be saved (permission denied for table boq_line_change_log). The previous rate was kept.",
    ));
    expect(db.writes.map((w) => `${w.op}:${w.table}:${JSON.stringify(w.payload.custom_rate ?? null)}`)).toEqual([
      "update:boq_line:1100", "insert:boq_line_change_log:null", "update:boq_line:null",
    ]);
    expect(db.lines[0].custom_rate).toBeNull();
  });

  it("if the rate was changed elsewhere, writes nothing and reports it", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    db.lines[0].custom_rate = 950; // edited in another tab after this page loaded
    typeRate("1100");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "This line's rate was changed elsewhere since you opened it — nothing was saved. The current rate is shown.",
    ));
    expect(db.lines[0].custom_rate).toBe(950);
    expect(db.writes.filter((w) => w.table === "boq_line_change_log")).toHaveLength(0);
  });
});

// B1: the rate field is uncontrolled, and once typed into, a changed defaultValue
// no longer shows — so Undo/Redo/re-reads left the old text in the field.
describe("OpsBoqBuilder — rate field follows the saved rate", () => {
  const undoRedo = async (name: "Undo" | "Redo") => {
    if (!screen.queryByRole("button", { name })) fireEvent.click(screen.getByText("Advanced settings"));
    fireEvent.click(await screen.findByRole("button", { name }));
  };
  const saveRate = async (v: string) => {
    typeRate(v);
    await waitFor(() => expect(db.lines[0].custom_rate).toBe(Number(v)));
    await waitFor(() => expect(rateInput().value).toBe(v));
  };

  it("rate edit → Undo: the field shows the restored rate, not the undone one", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await saveRate("1100");
    await undoRedo("Undo");
    await waitFor(() => expect(db.lines[0].custom_rate).toBeNull());
    await waitFor(() => expect(rateInput().value).toBe("900")); // back to the DSR rate
  });

  it("rate edit → Undo → Redo: the field shows the redone rate", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await saveRate("1100");
    await undoRedo("Undo");
    await waitFor(() => expect(rateInput().value).toBe("900"));
    await undoRedo("Redo");
    await waitFor(() => expect(db.lines[0].custom_rate).toBe(1100));
    await waitFor(() => expect(rateInput().value).toBe("1100"));
  });

  it("after a re-read brings a new saved rate, the field shows it", async () => {
    const client = new QueryClient();
    renderBoqBuilder(client);
    await screen.findByText("Vitrified tiles");
    await saveRate("1100");
    db.lines[0].custom_rate = 1250; // saved elsewhere
    await client.invalidateQueries({ queryKey: ["boq-lines", "boq-1"] });
    await waitFor(() => expect(rateInput().value).toBe("1250"));
  });

  it("never overwrites a rate the user is still typing, and saves it on leaving the field", async () => {
    const client = new QueryClient();
    renderBoqBuilder(client);
    await screen.findByText("Vitrified tiles");
    const input = rateInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1200" } });
    db.lines[0].custom_rate = 1250; // a re-read lands mid-edit
    await client.invalidateQueries({ queryKey: ["boq-lines", "boq-1"] });
    await screen.findByText("Vitrified tiles");
    expect(rateInput().value).toBe("1200");
    // Leaving the field submits what was typed, guarded on the rate it was typed over:
    // the line changed meanwhile, so nothing is written and the saved rate is shown.
    fireEvent.blur(rateInput());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "This line's rate was changed elsewhere since you opened it — nothing was saved. The current rate is shown.",
    ));
    expect(db.lines[0].custom_rate).toBe(1250);
  });

  it("leaving the field without typing writes nothing, even if the saved rate changed while it had focus", async () => {
    const client = new QueryClient();
    renderBoqBuilder(client);
    await screen.findByText("Vitrified tiles");
    fireEvent.focus(rateInput());
    db.lines[0].custom_rate = 1250;
    await client.invalidateQueries({ queryKey: ["boq-lines", "boq-1"] });
    fireEvent.blur(rateInput());
    await waitFor(() => expect(rateInput().value).toBe("1250"));
    expect(db.writes).toHaveLength(0);
  });
});
