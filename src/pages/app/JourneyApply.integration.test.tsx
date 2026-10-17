// THE WHOLE QUANTITY BOQ JOURNEY, END TO END, IN A CONTROLLED SETUP.
//
// Real journey shell and steps, the real review screen, the real review-store
// writes and the real applyReviewPlan — against an in-memory database (the
// Supabase client is replaced below), so nothing reaches any real project.
// Mocked only: the PDF viewer, drawing storage/signing, location
// observations and the read-only analysis preflight (network-only concerns).
//
// Walks: Overview → Review quantities (Apply blocked) → review screen →
// Verify the last item → Apply → "View updated BOQ" → Build BOQ (what was
// applied, line now has its quantity) → Check & finalise → Export, and checks
// the database holds exactly what the screens claim, and that only the
// expected tables were written.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ProjectShell from "@/components/app/ProjectShell";
import ProjectOverview from "./ProjectOverview";
import ProjectReview from "./ProjectReview";
import ProjectBoq from "./ProjectBoq";
import ProjectExport from "./ProjectExport";
import BoqReviewWorkstation from "@/pages/ops/BoqReviewWorkstation";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

// ── In-memory database ───────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, writes: [] as string[], invokes: [] as string[], nextId: 1 }));

vi.mock("@/integrations/supabase/client", () => {
  function query(table: string, op: "select" | "insert" | "update" | "upsert" | "delete", payload?: Row | Row[]) {
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    let order: { col: string; asc: boolean } | null = null;
    const run = () => {
      const rows = (mem.tables[table] ??= []);
      if (op !== "select") mem.writes.push(`${op} ${table}`);
      if (op === "insert" || op === "upsert") {
        const list = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ id: `${table}-${mem.nextId++}`, ...p }));
        rows.push(...list.map((r) => ({ ...r })));
        return { data: list, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: hit.map((r) => ({ ...r })), error: null }; }
      if (op === "delete") { mem.tables[table] = rows.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      const sorted = order ? [...hit].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1)) : hit;
      return { data: sorted.slice(0, limit).map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
    q.neq = (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; };
    q.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; };
    q.is = (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; };
    q.not = (c: string, o: string, v: unknown) => { if (o === "is" && v === null) filters.push((r) => r[c] != null); return q; };
    q.or = self; q.ilike = self; q.range = self; q.match = self;
    q.order = (c: string, o?: { ascending?: boolean }) => { order = { col: c, asc: o?.ascending !== false }; return q; };
    q.limit = (n: number) => { limit = n; return q; };
    q.single = async () => { const r = run(); const list = r.data as Row[]; return list?.length === 1 ? { data: list[0], error: null } : { data: null, error: { code: "PGRST116", message: "not one row" } }; };
    q.maybeSingle = async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: null }; };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej);
    return q;
  }
  return {
    supabase: {
      from: (t: string) => ({
        select: () => query(t, "select"),
        insert: (p: Row | Row[]) => query(t, "insert", p),
        update: (p: Row) => query(t, "update", p),
        upsert: (p: Row | Row[]) => query(t, "upsert", p),
        delete: () => query(t, "delete"),
      }),
      rpc: async (fn: string) => { mem.writes.push(`rpc ${fn}`); return { data: null, error: { message: `function ${fn} not in harness` } }; },
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }), getSession: async () => ({ data: { session: null } }) },
      functions: { invoke: async (name: string, o?: { body?: { action?: string } }) => { mem.invokes.push(`${name}:${o?.body?.action ?? ""}`); return { data: null, error: { message: "not in harness" } }; } },
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/x.pdf" }, error: null }) }) },
    },
  };
});
vi.mock("@/lib/review/drawingStorage", async (orig) => ({
  ...(await orig<typeof import("@/lib/review/drawingStorage")>()),
  loadProjectDrawings: vi.fn(async () => [{ documentId: "doc-1", name: "Ground Floor Plan", originalFilename: null, filePath: "proj-1/doc-1/rev-1.pdf", pageCount: 1, pageTitles: null }]),
  signedDrawingUrl: vi.fn(async () => "https://signed.example/plan.pdf"),
}));
vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => []),
}));
const preflight = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/ai/analysisClient", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/analysisClient")>()), fetchPreflight: preflight, generateAnalysis: vi.fn(() => { throw new Error("analysis must not run"); }) }));
vi.mock("@/components/review/PdfEvidenceViewer", () => ({ default: () => <div data-testid="pdf-probe" /> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, roles: ["ops"], isStaff: true }) }));

const aiItem = (key: string, name: string, qty: number) => ({
  key, item: name, quantity: qty, unit: "nos", confidence: 0.95, aiStatus: "MEASURED",
  source: { documentId: "doc-1", document: "Ground Floor Plan", page: 1, evidence: [] },
});

function seed() {
  mem.writes = []; mem.invokes = []; mem.nextId = 1;
  mem.tables = {
    projects: [{ id: "proj-1", name: "Tower B", client_name: "Acme", location: "Pune", project_type: "Residential", status: "active", area_sqft: 1000, floors: 1 }],
    boq: [{ id: "boq-1", name: "Civil BOQ", project_id: "proj-1", created_at: "2026-10-01", discipline: "civil", status: "draft", spec: {}, scope_id: null, contractor_id: null }],
    boq_line: [{
      id: "line-1", boq_id: "boq-1", section: "Doors", dsr_code: null, description: "Door D1", unit: "nos", qty: 0, dsr_rate: 1000, custom_rate: null,
      cost: null, basis: "PENDING", basis_note: null, quantity_status: "PENDING", measurement_method: "COUNT", included: true, sort: 1,
      external_key: "D1", scope_id: null, source_document_id: null, source_page: null, source: "auto",
    }],
    analysis_run: [{ id: "run-1", boq_id: "boq-1", project_id: "proj-1", source: "json_import", item_count: 2, created_at: "2026-10-10T00:00:00Z", resolved_document_id: "doc-1" }],
    analysis_review_item: [
      { id: "ri-1", run_id: "run-1", item_key: "D1", item_name: "Door D1", ai_json: aiItem("D1", "Door D1", 4), reviewer_json: null, review_status: "PENDING_REVIEW", flag_reason: null, review_note: null, reviewed_at: null, sort: 0 },
      { id: "ri-2", run_id: "run-1", item_key: "W1", item_name: "Window W1", ai_json: aiItem("W1", "Window W1", 6), reviewer_json: null, review_status: "VERIFIED", flag_reason: null, review_note: null, reviewed_at: "2026-10-11T00:00:00Z", sort: 1 },
    ],
    project_document: [{ id: "doc-1", project_id: "proj-1", name: "Ground Floor Plan", current_revision_id: "rev-1" }],
    document_revision: [{ id: "rev-1", document_id: "doc-1", label: "Rev A", file_path: "proj-1/doc-1/rev-1.pdf", page_count: 1 }],
    analysis_run_source: [{ analysis_run_id: "run-1", document_id: "doc-1", document_revision_id: "rev-1", status: "SUCCEEDED" }],
    project_scope: [],
  };
}

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };
function renderApp(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/projects/:id" element={<ProjectShell />}>
            <Route path="overview" element={<ProjectOverview />} />
            <Route path="review" element={<ProjectReview />} />
            <Route path="boq" element={<ProjectBoq />} />
            <Route path="check" element={<ProjectExport mode="check" />} />
            <Route path="export" element={<ProjectExport />} />
          </Route>
          <Route path="/ops/projects/:id/boqs/:boqId/review" element={<BoqReviewWorkstation />} />
          <Route path="*" element={<Where />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const at = () => screen.getAllByTestId("where").at(-1)!.textContent;

beforeEach(() => { seed(); window.sessionStorage.clear(); });

describe("Quantity BOQ journey — drawings to export, including Apply and its return", () => {
  it("guides each step from saved state, applies through the real Apply, and returns into the journey", async () => {
    renderApp("/app/projects/proj-1/overview");

    // Overview: one next action, from the saved review decisions.
    const next = (await screen.findByRole("heading", { name: /^Next step: Review quantities/ })).closest("section")!;
    expect(next).toHaveTextContent("1 item of 2 still needs a decision. Apply is blocked until every item has one.");
    fireEvent.click(within(next).getByRole("link", { name: /Continue review/ }));

    // Review quantities: why Apply is blocked, and the way into the review screen.
    expect(await screen.findByRole("note")).toHaveTextContent("Apply is blocked: 1 item still needs a decision");
    expect(at()).toBe("/app/projects/proj-1/review?boq=boq-1");
    expect(await screen.findByRole("status", { name: "Step status" })).toHaveTextContent("Still open here:1 item still needs a decision");
    fireEvent.click(screen.getByRole("link", { name: /Continue review/ }));

    // Review screen: opens on the item that needs a decision; verify it.
    await waitFor(() => expect(at()).toMatch(/^\/ops\/projects\/proj-1\/boqs\/boq-1\/review\?returnTo=/));
    const verify = await screen.findByRole("button", { name: /Verify/ });
    await waitFor(() => expect(verify).toBeEnabled());
    await act(async () => { fireEvent.click(verify); });
    await waitFor(() => expect(mem.tables.analysis_review_item.find((r) => r.id === "ri-1")!.review_status).toBe("VERIFIED"));

    // Apply — through the real applyReviewPlan, against the in-memory rows.
    fireEvent.click(await screen.findByRole("button", { name: /Review complete.*Apply to BOQ/ }));
    const dialog = screen.getByRole("dialog", { name: "Apply reviewed quantities" });
    const apply = within(dialog).getByRole("button", { name: /Apply \d+ to BOQ/ });
    await waitFor(() => expect(apply).toBeEnabled());
    await act(async () => { fireEvent.click(apply); });
    const receipt = await screen.findByRole("region", { name: /Applied \d+ changes? to the BOQ/ });

    // What the database now holds is what was applied: the pending line has
    // its reviewed quantity, and the second item became its own line.
    const line1 = mem.tables.boq_line.find((l) => l.id === "line-1")!;
    expect(line1).toMatchObject({ qty: 4, quantity_status: "COUNTED", basis: "REVIEW_VERIFIED" });
    expect(mem.tables.boq_line.find((l) => l.external_key === "W1")).toMatchObject({ qty: 6, boq_id: "boq-1", basis: "REVIEW_VERIFIED" });

    // Return into the journey's Build BOQ step for this BOQ.
    fireEvent.click(within(receipt).getByRole("button", { name: "View updated BOQ" }));
    await waitFor(() => expect(at()).toBe("/app/projects/proj-1/boq?boq=boq-1"));
    const note = await screen.findByRole("status", { name: "Last Apply result" });
    expect(note).toHaveTextContent(/Last applied from review in this browser tab, .*: 2 items applied\./);
    expect(within(note).getByRole("link", { name: "Continue to Check & finalise" })).toHaveAttribute("href", "/app/projects/proj-1/check?boq=boq-1");
    expect(await screen.findByText("Door D1")).toBeInTheDocument();
    expect(screen.getByText("Window W1")).toBeInTheDocument();
    // The basis shown is the reviewer's decision, not "Basis not recorded".
    expect(screen.getAllByText("Counted on drawing, verified in review").length).toBeGreaterThanOrEqual(2);

    // Build BOQ is done → its one next action is Check & finalise.
    const status = await screen.findByRole("status", { name: "Step status" });
    expect(status).toHaveTextContent("This step is done");
    fireEvent.click(within(status).getByRole("link", { name: /Next: Check & finalise/ }));

    // Check & finalise: nothing open on quantities or review; rates are Pricing.
    await waitFor(() => expect(at()).toBe("/app/projects/proj-1/check?boq=boq-1"));
    expect(await screen.findByText("No pending quantities and no review items left out of the BOQ.")).toBeInTheDocument();
    // The new line has no rate: stated as Pricing, linked to where rates are entered.
    expect(screen.getByRole("link", { name: "Add rates in the BOQ builder" })).toHaveAttribute("href", expect.stringMatching(/^\/ops\/projects\/proj-1\/boqs\/boq-1\?returnTo=/));
    const checkStatus = await screen.findByRole("status", { name: "Step status" });
    fireEvent.click(within(checkStatus).getByRole("link", { name: /Next: Export/ }));

    // Export: the documents are available.
    await waitFor(() => expect(at()).toBe("/app/projects/proj-1/export?boq=boq-1"));
    expect(await screen.findByRole("button", { name: /PDF \(priced\)/ })).toBeInTheDocument();

    // Only the intended writes happened, and no analysis was started.
    expect(new Set(mem.writes)).toEqual(new Set(["update analysis_review_item", "update boq_line", "insert boq_line", "insert boq_line_change_log"]));
    expect(mem.invokes).toEqual([]);
    expect(preflight).not.toHaveBeenCalled(); // a non-admin opening the review screen starts no eligibility work
  });

  it("leaving the review screen without applying returns to the same step, with nothing written", async () => {
    renderApp("/app/projects/proj-1/review?boq=boq-1");
    fireEvent.click(await screen.findByRole("link", { name: /Continue review/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to project" }));
    await waitFor(() => expect(at()).toBe("/app/projects/proj-1/review?boq=boq-1"));
    expect(mem.writes).toEqual([]);
  });
});
