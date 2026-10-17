// THE SCHEDULE CHECK IN THE JOURNEY, IN A CONTROLLED SETUP.
//
// Real journey shell, the real Check & finalise and Export steps, the real
// matcher and store — against an in-memory database seeded with the REAL
// DSR 2023 schedule from the seed migration. Nothing reaches a real project.
// Mocked only: drawing storage and the CSV download (captured, not saved).
//
// Traces one suggestion: surfaced from a matched line's exclusion → reject /
// undo / defer → accept with two schedule items → pending lines in the BOQ →
// schedule rate (separate, audited) → export states them as pending →
// the revision snapshot carries them as pending.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectShell from "@/components/app/ProjectShell";
import ProjectExport from "./ProjectExport";
import { seedCatalogue } from "@/lib/dsr/seedFixture";
import { buildRevisionLines, pendingItemsFrom } from "@/lib/boqRevision";
import { groupSubheads, workingSubheadsFrom } from "@/lib/boqLiveExport";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, writes: [] as string[], nextId: 1, csv: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => {
  function query(table: string, op: "select" | "insert" | "update" | "delete", payload?: Row | Row[]) {
    const filters: ((r: Row) => boolean)[] = [];
    let from = 0, limit = Infinity, returning = op === "select";
    let order: string | null = null;
    const run = () => {
      const rows = (mem.tables[table] ??= []);
      if (op !== "select") mem.writes.push(`${op} ${table}`);
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ id: `${table}-${mem.nextId++}`, ...p }));
        rows.push(...list.map((r) => ({ ...r })));
        return { data: list, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null }; }
      if (op === "delete") throw new Error("nothing in this journey may delete");
      const sorted = order ? [...hit].sort((a, b) => String(a[order!]).localeCompare(String(b[order!]))) : hit;
      return { data: sorted.slice(from, from + limit).map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {};
    q.select = () => { returning = true; return q; };
    q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
    q.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; };
    q.is = (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; };
    q.order = (c: string) => { order = c; return q; };
    q.limit = (n: number) => { limit = n; return q; };
    q.range = (a: number, b: number) => { from = a; limit = b - a + 1; return q; };
    q.maybeSingle = async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: null }; };
    q.single = async () => { const r = run(); const l = r.data as Row[]; return l?.length === 1 ? { data: l[0], error: null } : { data: null, error: { code: "PGRST116", message: "not one row" } }; };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej);
    return q;
  }
  return {
    supabase: {
      from: (t: string) => ({ select: () => query(t, "select"), insert: (p: Row | Row[]) => query(t, "insert", p), update: (p: Row) => query(t, "update", p), delete: () => query(t, "delete") }),
      rpc: async (fn: string) => ({ data: null, error: { message: `function ${fn} not in harness` } }),
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }), getSession: async () => ({ data: { session: null } }) },
    },
  };
});
vi.mock("@/lib/review/drawingStorage", async (orig) => ({ ...(await orig<typeof import("@/lib/review/drawingStorage")>()), loadProjectDrawings: vi.fn(async () => []) }));
vi.mock("@/lib/boqDsrDocument", async (orig) => ({ ...(await orig<typeof import("@/lib/boqDsrDocument")>()), downloadCsv: vi.fn((_n: string, csv: string) => { mem.csv.push(csv); }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, roles: ["ops"], isStaff: true }) }));

const line = (p: Row): Row => ({
  boq_id: "boq-1", section: "RCC", dsr_rate: null, custom_rate: null, basis: "MANUAL", basis_note: null, quantity_status: "MEASURED",
  measurement_method: null, included: true, sort: 1, external_key: null, scope_id: null, source_document_id: null, source_page: null, ...p,
});
function seed() {
  mem.writes = []; mem.nextId = 1; mem.csv = [];
  mem.tables = {
    projects: [{ id: "proj-1", name: "Tower B", client_name: "Acme", location: "Pune", project_type: "Residential", status: "active" }],
    boq: [{ id: "boq-1", name: "Civil BOQ", project_id: "proj-1", created_at: "2026-10-01", status: "draft", spec: { overheads: 10 }, rate_year: "2023", updated_at: "2026-10-01T00:00:00Z", scope_id: null }],
    boq_line: [
      line({ id: "rcc", dsr_code: "5.1.3", description: "RCC 1:2:4 in footings", unit: "cum", qty: 12, dsr_rate: 8583.4 }),
      line({ id: "solar", dsr_code: null, description: "Solar panel installation", unit: "each", qty: 4, custom_rate: 25000, sort: 2, section: "Services" }),
    ],
    boq_line_change_log: [],
    analysis_run: [],
    dsr_item: seedCatalogue().map((i) => ({ ...i, billable: true })),
  };
}
function renderAt(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/projects/:id" element={<ProjectShell />}>
            <Route path="check" element={<ProjectExport mode="check" />} />
            <Route path="export" element={<ProjectExport />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const lines = () => mem.tables.boq_line;
const decisions = () => (mem.tables.boq[0].spec as Record<string, Record<string, { decision: string; note?: string; codes?: string[] }>>)._dsr_scope_decisions ?? {};
const card = (title: string) => screen.getByRole("article", { name: `Suggestion: ${title}` });

beforeEach(seed);

// Indexing the real 2,758-item schedule takes about half a second; these
// journeys run several steps on top, so they get more than the 5 s default
// when the suite runs in parallel.
describe("Schedule check — from suggestion to export", () => {
  it("matches, surfaces the excluded work, records every decision, and keeps accepted work pending through export", { timeout: 20000 }, async () => {
    renderAt("/app/projects/proj-1/check?boq=boq-1");
    const section = (await screen.findByRole("heading", { name: "Schedule check — DSR 2023" })).closest("section")!;
    await within(section).findByText(/2,758 items/);
    expect(section).toHaveTextContent("Reliable match: 1");
    expect(section).toHaveTextContent("No reliable match: 1");

    // The unmatched line is listed with the reason, never forced onto an item.
    expect(within(section).getByRole("listitem", { name: "Schedule match for Solar panel installation" }))
      .toHaveTextContent('No reliable match');
    expect(within(section).getByRole("listitem", { name: "Schedule match for Solar panel installation" })).toHaveTextContent('does not mention "solar"');

    // Two suggestions, each tracing to the matched item's own exclusion clause.
    const fw = card("Formwork (centering and shuttering)");
    expect(fw).toHaveTextContent("DSR 2023 item 5.1.3, matched to “RCC 1:2:4 in footings”, is stated as “excluding the cost of centering, shuttering, finishing and reinforcement");
    expect(fw).toHaveTextContent("No quantity: the formwork area has to be measured from the drawings");
    const rf = card("Steel reinforcement");

    // Reject with a note — nothing deleted — then undo.
    fireEvent.change(within(rf).getByRole("textbox", { name: "Note on Steel reinforcement (optional)" }), { target: { value: "In the structural package" } });
    await act(async () => { fireEvent.click(within(rf).getByRole("button", { name: "Reject" })); });
    await waitFor(() => expect(decisions()["excluded_reinforcement:5"]).toMatchObject({ decision: "rejected", note: "In the structural package" }));
    expect(lines()).toHaveLength(2);
    expect(await within(card("Steel reinforcement")).findByText(/Rejected — In the structural package/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(card("Steel reinforcement")).getByRole("button", { name: "Undo the decision on Steel reinforcement" })); });
    await waitFor(() => expect(decisions()["excluded_reinforcement:5"]).toBeUndefined());

    // Defer formwork; it does not block anything else.
    await act(async () => { fireEvent.click(within(card("Formwork (centering and shuttering)")).getByRole("button", { name: "Defer" })); });
    await waitFor(() => expect(decisions()["excluded_formwork:5"]?.decision).toBe("deferred"));

    // Accept formwork: choose two schedule items → two PENDING lines, no rate.
    await waitFor(() => expect(within(card("Formwork (centering and shuttering)")).getByText("Deferred")).toBeInTheDocument());
    fireEvent.click(within(card("Formwork (centering and shuttering)")).getByRole("button", { name: "Accept…" }));
    const fwc = card("Formwork (centering and shuttering)");
    fireEvent.click(within(fwc).getByRole("checkbox", { name: /^5\.9\.3 — Suspended floors/ }));
    fireEvent.click(within(fwc).getByRole("checkbox", { name: /^5\.9\.6 — Columns/ }));
    await act(async () => { fireEvent.click(within(fwc).getByRole("button", { name: "Add 2 pending lines" })); });
    await waitFor(() => expect(lines()).toHaveLength(4));
    const added = lines().filter((l) => String(l.external_key).startsWith("dsr-scope:"));
    expect(added.map((l) => [l.dsr_code, l.unit, l.qty, l.quantity_status, l.basis, l.dsr_rate ?? null, l.section])).toEqual([
      ["5.9.3", "sqm", 0, "PENDING", "PENDING", null, "RCC"], ["5.9.6", "sqm", 0, "PENDING", "PENDING", null, "RCC"],
    ]);
    expect(decisions()["excluded_formwork:5"]).toMatchObject({ decision: "accepted", codes: ["5.9.3", "5.9.6"] });
    expect(await within(card("Formwork (centering and shuttering)")).findByText(/2 pending lines added/)).toBeInTheDocument();
    // The check's own summary now counts them as pending quantities.
    await waitFor(() => expect(screen.getByRole("heading", { name: "What the export will state" }).closest("section")).toHaveTextContent("Quantity pending: 2"));

    // The schedule rate is a separate step, validated and audited; the quantity stays pending.
    const useRate = await screen.findByRole("button", { name: /^Use the DSR 2023 rate for Centering and shuttering .*Columns/ });
    await act(async () => { fireEvent.click(useRate); });
    await waitFor(() => expect(lines().find((l) => l.dsr_code === "5.9.6")).toMatchObject({ dsr_rate: 961.3, qty: 0, quantity_status: "PENDING" }));

    // Every decision and the rate are in the change history.
    expect(mem.tables.boq_line_change_log.map((r) => `${r.field}: ${r.new_value}`)).toEqual([
      "dsr_scope_decision: rejected: excluded_reinforcement:5 — In the structural package",
      "dsr_scope_decision: undecided: excluded_reinforcement:5",
      "dsr_scope_decision: deferred: excluded_formwork:5",
      "dsr_scope_decision: accepted: excluded_formwork:5 (5.9.3, 5.9.6)",
      "dsr_rate: 961.3 (DSR 2023 5.9.6)",
    ]);
    expect(mem.tables.boq[0].spec).toMatchObject({ overheads: 10 });
    expect(new Set(mem.writes)).toEqual(new Set(["update boq", "insert boq_line_change_log", "insert boq_line", "update boq_line"]));
  });

  it("export and revision state accepted work as pending — never as a zero quantity or amount", async () => {
    // Accepted state, as the previous journey leaves it.
    lines().push(
      line({ id: "fw", dsr_code: "5.9.6", description: "Centering and shuttering … — Columns, Pillars, Piers, Abutments, Posts and Struts", unit: "sqm", qty: 0, dsr_rate: 961.3, quantity_status: "PENDING", basis: "PENDING", external_key: "dsr-scope:excluded_formwork:5:5.9.6", sort: 3 }),
    );
    renderAt("/app/projects/proj-1/export?boq=boq-1");
    const csvBtn = await screen.findByRole("button", { name: /CSV/ });
    await waitFor(() => expect(csvBtn).toBeEnabled());
    await act(async () => { fireEvent.click(csvBtn); });
    await waitFor(() => expect(mem.csv).toHaveLength(1));
    const csv = mem.csv[0];
    // Listed as pending, with its schedule code, no quantity and no amount — not priced as 0.
    const row = csv.split("\r\n").find((r) => r.startsWith("Pending,"))!;
    expect(row).toMatch(/^Pending,P\.01,5\.9\.6,"Centering and shuttering … — Columns, Pillars, Piers, Abutments, Posts and Struts — Quantity pending: not yet measured",sqm,,,,,,,Awaiting quantity$/);

    // The revision snapshot is built by the same function the freeze uses.
    const rev = buildRevisionLines(workingSubheadsFrom(groupSubheads(lines() as never), () => null as never));
    const fw = rev.find((l) => l.description?.includes("Columns, Pillars"))!;
    expect(fw).toMatchObject({ quantity_status: "PENDING", basis: "PENDING", dsr_code: "5.9.6", amount: null });
    expect(pendingItemsFrom(rev).find((p) => p.spec.includes("Columns, Pillars"))).toMatchObject({ code: "5.9.6", note: "Quantity pending: not yet measured" });
  });

  it("a double click saves one decision; Undo after Accept says the lines remain; an uncertain line never triggers a suggestion", { timeout: 20000 }, async () => {
    // A line that only POSSIBLY matches RCC (wrong unit) must not surface anything on its own.
    lines().push(line({ id: "rcc-sqm", dsr_code: null, description: "RCC 1:2:4 in footings", unit: "sqm", qty: 3, sort: 3 }));
    renderAt("/app/projects/proj-1/check?boq=boq-1");
    const section = (await screen.findByRole("heading", { name: "Schedule check — DSR 2023" })).closest("section")!;
    await within(section).findByText(/2,758 items/);
    // Suggestions come only from the reliable, coded line.
    expect(card("Formwork (centering and shuttering)")).toHaveTextContent("matched to “RCC 1:2:4 in footings”,");
    expect(card("Formwork (centering and shuttering)")).not.toHaveTextContent("and 1 more line");

    // Double click on Defer, before the button can re-render as disabled.
    const defer = within(card("Formwork (centering and shuttering)")).getByRole("button", { name: "Defer" });
    await act(async () => { fireEvent.click(defer); fireEvent.click(defer); });
    await waitFor(() => expect(decisions()["excluded_formwork:5"]?.decision).toBe("deferred"));
    expect(mem.tables.boq_line_change_log.filter((r) => r.field === "dsr_scope_decision")).toHaveLength(1);

    // Accept one item, then undo the decision: the line stays and the card says so.
    await waitFor(() => expect(within(card("Formwork (centering and shuttering)")).getByText("Deferred")).toBeInTheDocument());
    fireEvent.click(within(card("Formwork (centering and shuttering)")).getByRole("button", { name: "Accept…" }));
    fireEvent.click(within(card("Formwork (centering and shuttering)")).getByRole("checkbox", { name: /^5\.9\.6 — Columns/ }));
    const add = within(card("Formwork (centering and shuttering)")).getByRole("button", { name: "Add 1 pending line" });
    await act(async () => { fireEvent.click(add); fireEvent.click(add); });
    await waitFor(() => expect(decisions()["excluded_formwork:5"]?.decision).toBe("accepted"));
    expect(lines().filter((l) => String(l.external_key).startsWith("dsr-scope:"))).toHaveLength(1);
    await within(card("Formwork (centering and shuttering)")).findByText(/1 pending line added/);
    await act(async () => { fireEvent.click(within(card("Formwork (centering and shuttering)")).getByRole("button", { name: "Undo the decision on Formwork (centering and shuttering)" })); });
    await waitFor(() => expect(decisions()["excluded_formwork:5"]).toBeUndefined());
    const note = await within(card("Formwork (centering and shuttering)")).findByRole("note");
    expect(note).toHaveTextContent("Decision undone: the line already added is still in the BOQ. Nothing is deleted here — remove it in the BOQ if not needed.");
    expect(card("Formwork (centering and shuttering)")).toHaveTextContent("Next: No decision recorded; lines added earlier remain in the BOQ with their quantity pending.");
    expect(card("Formwork (centering and shuttering)")).not.toHaveTextContent("Accepted: measure the quantity");
    // Still pending and unpriced — undo did not delete or price anything.
    const kept = lines().find((l) => l.dsr_code === "5.9.6")!;
    expect(kept).toMatchObject({ qty: 0, quantity_status: "PENDING" });
    expect(kept.dsr_rate ?? null).toBeNull();
    expect(mem.writes).not.toContain("delete boq_line");
  });
});
