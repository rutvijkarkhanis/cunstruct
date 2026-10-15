// Working-BOQ status (Draft ⇄ Finalized) in the BOQ editor, against a mock
// that persists boq.status and honours the compare-and-swap filter. Key
// guarantees: only boq.status is written; the shown status is always re-read
// from persisted data (after success, conflict or failure); "sent" is never
// offered; and the revisions panel reflects the persisted status.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import OpsBoqBuilder from "./OpsBoqBuilder";
import { nextBoqStatus } from "@/lib/boqStatus";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const db = vi.hoisted(() => ({
  boq: { id: "boq-1", name: "Civil BOQ", status: "draft", project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null },
  updates: [] as { table: string; payload: Record<string, unknown>; filters: [string, unknown][] }[],
  failNext: null as null | string,
  /** Simulates another user changing the status between render and click. */
  changeBeforeNextUpdate: null as null | string,
}));
const LINES = [{
  id: "l1", section: "Finishes", dsr_code: "11.41.2", description: "Vitrified tiles", unit: "sqm", qty: 40, dsr_rate: 900,
  custom_rate: null, cost: null, basis: null, basis_note: null, external_key: null, measurement_method: null,
  quantity_status: "MEASURED", included: true, source: "manual", sort: 1, source_document_id: null, source_page: null,
}];

function chain(table: string) {
  let payload: Record<string, unknown> | null = null;
  const filters: [string, unknown][] = [];
  const obj: Record<string, unknown> = {};
  ["select", "order", "limit", "in", "or", "neq"].forEach((m) => { obj[m] = () => obj; });
  obj.eq = (c: string, v: unknown) => { filters.push([c, v]); return obj; };
  obj.update = (p: Record<string, unknown>) => { payload = p; return obj; };
  obj.single = () => Promise.resolve({ data: table === "boq" ? { ...db.boq } : table === "projects" ? { id: "proj-1", name: "Tower B" } : null, error: null });
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    if (payload) {
      db.updates.push({ table, payload, filters });
      if (db.failNext) { const message = db.failNext; db.failNext = null; return resolve({ data: null, error: { message } }); }
      if (db.changeBeforeNextUpdate) { db.boq.status = db.changeBeforeNextUpdate; db.changeBeforeNextUpdate = null; }
      const row = db.boq as Record<string, unknown>;
      const match = table === "boq" && filters.every(([c, v]) => row[c] === v);
      if (match) Object.assign(row, payload);
      return resolve({ data: match ? [{ id: row.id }] : [], error: null });
    }
    return resolve({ data: table === "boq_line" ? LINES : [], error: null });
  };
  return obj;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: null, error: null }) },
}));

function renderBoqBuilder() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <Routes><Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const status = () => screen.getAllByTestId("boq-status")[0];

beforeEach(() => {
  db.boq.status = "draft";
  db.updates = [];
  db.failNext = null;
  db.changeBeforeNextUpdate = null;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("nextBoqStatus", () => {
  it("offers only Draft ⇄ Finalized, never 'sent'", () => {
    expect(nextBoqStatus("draft")).toBe("finalized");
    expect(nextBoqStatus("finalized")).toBe("draft");
    expect(nextBoqStatus("sent")).toBeNull();
    expect(nextBoqStatus(null)).toBeNull();
  });
});

describe("OpsBoqBuilder — working BOQ status", () => {
  it("finalizes and returns to draft, writing only boq.status, guarded on the status shown", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    expect(status()).toHaveTextContent("Draft");

    fireEvent.click(within(status()).getByRole("button", { name: "Mark finalized" }));
    await waitFor(() => expect(status()).toHaveTextContent("Finalized (internal)"));
    expect(db.updates).toEqual([{ table: "boq", payload: { status: "finalized" }, filters: [["id", "boq-1"], ["status", "draft"]] }]);
    expect(toast.success).toHaveBeenCalledWith("BOQ finalized (internal only — not sent to a client)");

    fireEvent.click(within(status()).getByRole("button", { name: "Return to draft" }));
    await waitFor(() => expect(status()).toHaveTextContent("Draft"));
    expect(db.updates[1]).toEqual({ table: "boq", payload: { status: "draft" }, filters: [["id", "boq-1"], ["status", "finalized"]] });
    expect(db.updates.every((u) => u.table === "boq" && Object.keys(u.payload).join() === "status")).toBe(true);
  });

  it("on a save failure, says so and keeps showing the persisted status", async () => {
    db.failNext = "permission denied for table boq";
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    fireEvent.click(within(status()).getByRole("button", { name: "Mark finalized" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't change the BOQ status: permission denied for table boq"));
    expect(status()).toHaveTextContent("Draft");
    expect(db.boq.status).toBe("draft");
  });

  it("if the status changed elsewhere, doesn't overwrite it and shows the saved value", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    db.changeBeforeNextUpdate = "sent"; // recorded elsewhere after this page loaded
    fireEvent.click(within(status()).getByRole("button", { name: "Mark finalized" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The BOQ's status was changed elsewhere. Showing the saved status."));
    await waitFor(() => expect(status()).toHaveTextContent("Sent (recorded outside this editor)"));
    expect(db.boq.status).toBe("sent");
    // "sent" is shown but no transition is offered from it.
    expect(within(status()).queryByRole("button")).not.toBeInTheDocument();
  });

  it("the revisions panel shows the persisted working status and drops the 'working draft' limitation once finalized", async () => {
    db.boq.status = "finalized";
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");
    fireEvent.keyDown((await screen.findAllByRole("button", { name: /^More$/ }))[0], { key: "Enter", code: "Enter" });
    await screen.findAllByRole("menuitem");
    await waitFor(() => {
      if (!screen.queryByTestId("working-status")) fireEvent.click(screen.getByRole("menuitem", { name: /Commercial revisions/ }));
      expect(screen.getByTestId("working-status")).toHaveTextContent("Working BOQ status: Finalized (internal) — Finalized internally. Not sent to a client, awarded or executed.");
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare a new revision…", hidden: true }));
    const region = await screen.findByRole("region", { name: "New revision", hidden: true });
    expect(region).not.toHaveTextContent("freezes a working draft");
  });
});
