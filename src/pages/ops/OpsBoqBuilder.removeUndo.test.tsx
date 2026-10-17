// Remove a line in the BOQ builder, then undo: the restored row must equal the
// original in every stored column — including the ones the builder never
// shows (identity key, source, basis, quantity status, location, drawing
// reference) — and the review/audit links the delete cleared must point back
// at it. Previously undo re-inserted only the 13 visible base columns.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import OpsBoqBuilder from "./OpsBoqBuilder";

vi.mock("sonner", () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() });
  return { toast: t };
});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  missing: new Set<string>(),
  deleteError: null as null | { message: string },
  failInsert: new Set<string>(),
}));

function chain(table: string) {
  let op = "select";
  let payload: Row = {};
  let returning = false;
  const filters: ((r: Row) => boolean)[] = [];
  const obj: Record<string, unknown> = {};
  ["order", "limit", "or", "neq", "ilike"].forEach((m) => { obj[m] = () => obj; });
  obj.select = () => { if (op !== "select") returning = true; return obj; };
  obj.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return obj; };
  obj.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return obj; };
  obj.is = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return obj; };
  obj.update = (p: Row) => { op = "update"; payload = p; return obj; };
  obj.insert = (p: Row) => { op = "insert"; payload = p; return obj; };
  obj.delete = () => { op = "delete"; return obj; };
  const run = () => {
    if (db.missing.has(table)) return { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
    const rows = (db.tables[table] ??= []);
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "select") return { data: hit.map((r) => ({ ...r })), error: null };
    if (op === "insert") {
      if (db.failInsert.has(table)) return { data: null, error: { message: `insert into ${table} failed` } };
      const list = (Array.isArray(payload) ? payload : [payload]).map((p: Row, i: number) => ({ id: p.id ?? `${table}-${rows.length + i + 1}`, ...p }));
      if (table === "boq_line" && list.some((r) => rows.some((x) => x.id === r.id))) return { data: null, error: { code: "23505", message: "duplicate key" } };
      rows.push(...list);
      return { data: returning ? list.map((r) => ({ ...r })) : null, error: null };
    }
    if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null }; }
    if (table === "boq_line" && db.deleteError) return { data: null, error: db.deleteError };
    const ids = new Set(hit.map((r) => r.id));
    db.tables[table] = rows.filter((r) => !ids.has(r.id));
    if (table === "boq_line") {
      for (const [t, c] of [["boq_audit_finding", "boq_line_id"], ["boq_line_change_log", "boq_line_id"]]) {
        (db.tables[t] ?? []).forEach((r) => { if (ids.has(r[c] as string)) r[c] = null; });
      }
    }
    return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
  };
  obj.single = () => Promise.resolve({
    data: table === "boq" ? { id: "boq-1", name: "Civil BOQ", status: "draft", project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null }
      : table === "projects" ? { id: "proj-1", name: "Tower B" } : null,
    error: null,
  });
  obj.maybeSingle = () => { const r = run(); return Promise.resolve(r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }); };
  obj.then = (resolve: (r: unknown) => void) => resolve(run());
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

const ORIGINAL: Row = {
  id: "l1", boq_id: "boq-1", section: "Finishes", dsr_code: "11.41.2", description: "Vitrified tiles", unit: "sqm", qty: 4.23,
  dsr_rate: 900, custom_rate: null, cost: 610, included: true, source: "auto", sort: 3,
  basis: "DRAWING_DERIVED", basis_note: "2.35 × 1.80, GF plan", external_key: "room:lift-lobby:gf", measurement_method: "AREA",
  quantity_status: "MEASURED", scope_id: "scope-gf", source_document_id: "doc-9", source_revision_id: "rev-2", source_page: "3",
};

beforeEach(() => {
  db.tables = {
    boq_line: [{ ...ORIGINAL }],
    boq_audit_finding: [{ id: "f1", boq_line_id: "l1" }],
    boq_line_change_log: [{ id: "c1", boq_line_id: "l1" }],
  };
  db.missing = new Set(["vendor_quotation", "boq_line_rate_review", "boq_line_dsr_mapping", "boq_line_rate_adoption"]);
  db.deleteError = null;
  db.failInsert = new Set();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
});

const removeButton = () => screen.getByRole("button", { name: "Remove Vitrified tiles (can be undone)" });
const ctrlZ = () => act(async () => { fireEvent.keyDown(document.body, { key: "z", ctrlKey: true }); });

describe("OpsBoqBuilder — remove then undo restores the whole line", () => {
  it("the restored row equals the original in every column, and its links are re-attached", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await act(async () => { fireEvent.click(removeButton()); });
    await waitFor(() => expect(db.tables.boq_line).toEqual([]));
    expect(db.tables.boq_audit_finding[0].boq_line_id).toBeNull();

    await ctrlZ();
    await waitFor(() => expect(db.tables.boq_line).toHaveLength(1));
    expect(db.tables.boq_line[0]).toEqual(ORIGINAL);
    expect(db.tables.boq_audit_finding).toEqual([{ id: "f1", boq_line_id: "l1" }]);
    // The earlier history row is re-attached; the removal and the restore are
    // recorded (who, and the whole removed row), both linked to the line.
    expect(db.tables.boq_line_change_log).toEqual([
      { id: "c1", boq_line_id: "l1" },
      expect.objectContaining({ field: "line_removed", boq_id: "boq-1", boq_line_id: "l1", changed_by: "user-1", old_value: JSON.stringify(ORIGINAL) }),
      expect.objectContaining({ field: "line_restored", boq_id: "boq-1", boq_line_id: "l1", changed_by: "user-1" }),
    ]);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a failed delete is reported and leaves nothing to undo", async () => {
    db.deleteError = { message: "permission denied for table boq_line" };
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await act(async () => { fireEvent.click(removeButton()); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Line not removed — permission denied/)));
    expect(db.tables.boq_line).toEqual([ORIGINAL]);
    const inserts = db.tables.boq_line.length;
    await ctrlZ();
    expect(db.tables.boq_line).toHaveLength(inserts);   // undo had no step to replay
  });

  it("a line whose removal would cascade-delete records is not removed", async () => {
    db.missing.delete("vendor_quotation");
    db.tables.vendor_quotation = [{ id: "vq1", boq_line_id: "l1" }];
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await act(async () => { fireEvent.click(removeButton()); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/linked vendor quotation/)));
    expect(db.tables.boq_line).toEqual([ORIGINAL]);
    expect(db.tables.vendor_quotation).toHaveLength(1);
  });

  it("without the change-history table, a line is not removed and the person is told to exclude it instead", async () => {
    db.missing.add("boq_line_change_log");
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await act(async () => { fireEvent.click(removeButton()); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/change history is not set up.*Exclude the line/)));
    expect(db.tables.boq_line).toEqual([ORIGINAL]);
  });

  it("a line changed elsewhere since it was loaded is not removed, and the other change survives", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    db.tables.boq_line[0].qty = 9;   // saved by someone else after this screen loaded
    await act(async () => { fireEvent.click(removeButton()); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed elsewhere since it was loaded \(qty\)/)));
    expect(db.tables.boq_line).toEqual([{ ...ORIGINAL, qty: 9 }]);
  });

  it("a removal whose history row fails is put back, reported, and leaves nothing to undo", async () => {
    db.failInsert.add("boq_line_change_log");
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await act(async () => { fireEvent.click(removeButton()); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/its history record couldn't be saved.*The line was put back/)));
    expect(db.tables.boq_line).toEqual([ORIGINAL]);
    expect(db.tables.boq_audit_finding).toEqual([{ id: "f1", boq_line_id: "l1" }]);
    await ctrlZ();
    expect(db.tables.boq_line).toEqual([ORIGINAL]);
  });

  it("a double Ctrl+Z replays the restore once — no false 'not restored' error", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    await act(async () => { fireEvent.click(removeButton()); });
    await waitFor(() => expect(db.tables.boq_line).toEqual([]));
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
      fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    });
    await waitFor(() => expect(db.tables.boq_line).toHaveLength(1));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("OpsBoqBuilder — adding a line is recorded, and its undo/redo is guarded", () => {
  async function addBlankLine() {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    const trigger = (await screen.findAllByRole("button", { name: /^More$/ }))[0];
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    // Menu items remount on every editor render: find and click in one step.
    await act(async () => {
      await waitFor(() => fireEvent.click(screen.getByRole("menuitem", { name: /Add blank line/ })));
    });
  }
  const added = () => db.tables.boq_line.filter((r) => r.id !== "l1");
  const ctrlShiftZ = () => act(async () => { fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true }); });

  it("records the new line; undo takes it out (recorded); redo puts the same line back", async () => {
    await addBlankLine();
    await waitFor(() => expect(added()).toHaveLength(1));
    const newId = added()[0].id;
    expect(db.tables.boq_line_change_log.filter((r) => r.boq_line_id === newId).map((r) => [r.field, r.new_value])).toEqual([
      ["line_created", "New item"], ["qty", "1"], ["unit", "nos"],
    ]);

    await ctrlZ();
    await waitFor(() => expect(added()).toEqual([]));
    expect(db.tables.boq_line_change_log.some((r) => r.field === "line_removed")).toBe(true);

    await ctrlShiftZ();
    await waitFor(() => expect(added()).toHaveLength(1));
    expect(added()[0].id).toBe(newId);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("undo never removes an added line someone has changed since", async () => {
    await addBlankLine();
    await waitFor(() => expect(added()).toHaveLength(1));
    added()[0].description = "Edited elsewhere";
    await ctrlZ();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed elsewhere since it was loaded \(description\)/)));
    expect(added()).toEqual([expect.objectContaining({ description: "Edited elsewhere" })]);
  });

  it("a line whose creation can't be recorded is taken out again, reported, and leaves nothing to undo", async () => {
    db.failInsert.add("boq_line_change_log");
    await addBlankLine();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Line not added: its history record couldn't be saved/)));
    expect(added()).toEqual([]);
    await ctrlZ();
    expect(db.tables.boq_line).toEqual([ORIGINAL]);
  });
});
