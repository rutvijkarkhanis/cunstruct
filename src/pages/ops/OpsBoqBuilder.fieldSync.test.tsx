// The builder's line fields (quantity, unit, description, cost) keep showing the
// saved value: after Undo/Redo, after a re-read, and never over a value the user
// is typing — and a typed value is never saved over a newer one. Same mock as
// OpsBoqBuilder.rateEdit.test.tsx: a guarded boq_line update plus the change log.
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
beforeEach(() => {
  db.lines = [db.line({ id: "l1", description: "Vitrified tiles", sort: 1 })];
  db.adoptions = [];
  db.writes = [];
  db.logError = null;
  vi.mocked(toast.error).mockClear();
});

const undoRedo = async (name: "Undo" | "Redo") => {
  if (!screen.queryByRole("button", { name })) fireEvent.click(screen.getByText("Advanced settings"));
  fireEvent.click(await screen.findByRole("button", { name }));
};
const CONFLICT = "Change not saved: this line was changed elsewhere since it was loaded. The current values are now shown.";

type Field = { name: string; key: "qty" | "unit" | "description" | "cost"; get: () => HTMLInputElement; view?: "Make";
  initial: string; typed: string; typedValue: unknown; reread: unknown; rereadText: string };
const FIELDS: Field[] = [
  { name: "quantity", key: "qty", get: () => screen.getByLabelText("Quantity for Vitrified tiles") as HTMLInputElement,
    initial: "40", typed: "45", typedValue: 45, reread: 50, rereadText: "50" },
  { name: "unit", key: "unit", get: () => screen.getByLabelText("Unit for Vitrified tiles") as HTMLInputElement,
    initial: "sqm", typed: "sqft", typedValue: "sqft", reread: "m2", rereadText: "m2" },
  { name: "description", key: "description", get: () => screen.getByLabelText(/^Description of line/) as HTMLInputElement,
    initial: "Vitrified tiles", typed: "Vitrified tiles 600x600", typedValue: "Vitrified tiles 600x600", reread: "Vitrified tiles (rev)", rereadText: "Vitrified tiles (rev)" },
  { name: "cost", key: "cost", view: "Make", get: () => screen.getAllByPlaceholderText("cost")[0] as HTMLInputElement,
    initial: "", typed: "700", typedValue: 700, reread: 650, rereadText: "650" },
];

async function open(f: Field, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <Routes><Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByText(/Vitrified tiles/);
  if (f.view) fireEvent.click(screen.getByRole("button", { name: new RegExp(f.view) }));
  await waitFor(() => expect(f.get().value).toBe(f.initial));
  return client;
}
const reread = (client: QueryClient) => client.invalidateQueries({ queryKey: ["boq-lines", "boq-1"] });

describe.each(FIELDS)("OpsBoqBuilder — $name field follows the saved value", (f) => {
  const save = async () => {
    fireEvent.change(f.get(), { target: { value: f.typed } });
    fireEvent.blur(f.get());
    await waitFor(() => expect(db.lines[0][f.key]).toBe(f.typedValue));
  };

  it("edit → Undo: shows the restored value", async () => {
    await open(f);
    await save();
    await undoRedo("Undo");
    await waitFor(() => expect(f.get().value).toBe(f.initial));
  });

  it("edit → Undo → Redo: shows the redone value", async () => {
    await open(f);
    await save();
    await undoRedo("Undo");
    await waitFor(() => expect(f.get().value).toBe(f.initial));
    await undoRedo("Redo");
    await waitFor(() => expect(db.lines[0][f.key]).toBe(f.typedValue));
    await waitFor(() => expect(f.get().value).toBe(f.typed));
  });

  it("a re-read bringing a newer saved value shows it", async () => {
    const client = await open(f);
    db.lines[0][f.key] = f.reread;
    await reread(client);
    await waitFor(() => expect(f.get().value).toBe(f.rereadText));
  });

  it("a re-read mid-edit neither replaces the typed text nor gets overwritten by it", async () => {
    const client = await open(f);
    fireEvent.focus(f.get());
    fireEvent.change(f.get(), { target: { value: f.typed } });
    db.lines[0][f.key] = f.reread;
    await reread(client);
    await new Promise((r) => setTimeout(r, 50));
    expect(f.get().value).toBe(f.typed);
    fireEvent.blur(f.get());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CONFLICT));
    expect(db.lines[0][f.key]).toBe(f.reread);
    await waitFor(() => expect(f.get().value).toBe(f.rereadText));
  });

  it("leaving the field without typing writes nothing", async () => {
    const client = await open(f);
    fireEvent.focus(f.get());
    db.lines[0][f.key] = f.reread;
    await reread(client);
    fireEvent.blur(f.get());
    await waitFor(() => expect(f.get().value).toBe(f.rereadText));
    expect(db.writes).toHaveLength(0);
  });
});
