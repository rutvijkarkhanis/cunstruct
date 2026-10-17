// THE QUANTITY BOQ JOURNEY — RESUME, RELOAD AND RECOVERY, IN A CONTROLLED SETUP.
//
// Real journey shell and steps (Overview, Drawings, Review, BOQ, Check,
// Export), the real drawing viewer wrapper (WorkspaceCanvas) and real loaders,
// against an in-memory database (the Supabase client is replaced below), so
// nothing reaches any real project. Mocked only: the PDF renderer (a probe
// that prints what it was asked to draw), the drawing list (a plain list),
// drawing signing, and the analysis client (must never be called).
//
// A "reload" here is a fresh QueryClient + MemoryRouter at the same URL:
// whatever the screen shows afterwards can only have come from the database
// (or, for the Last Apply note only, this tab's sessionStorage).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ProjectShell from "@/components/app/ProjectShell";
import ProjectOverview from "./ProjectOverview";
import ProjectDrawings from "./ProjectDrawings";
import ProjectReview from "./ProjectReview";
import ProjectBoq from "./ProjectBoq";
import ProjectExport from "./ProjectExport";
import { saveReceipt } from "@/lib/review/applyReceipt";
import { seedCatalogue } from "@/lib/dsr/seedFixture";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

// ── In-memory database, with per-table read failures ─────────────────────────
type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, writes: [] as string[], invokes: [] as string[], nextId: 1,
  /** Tables whose reads fail (a network/RLS error), until removed. */
  failing: new Set<string>(),
}));

vi.mock("@/integrations/supabase/client", () => {
  function query(table: string, op: "select" | "insert" | "update" | "upsert" | "delete", payload?: Row | Row[]) {
    const filters: ((r: Row) => boolean)[] = [];
    let from = 0, limit = Infinity;
    let order: { col: string; asc: boolean } | null = null;
    const run = () => {
      if (op === "select" && mem.failing.has(table)) return { data: null, error: { message: `read of ${table} failed (test)` } };
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
      return { data: sorted.slice(from, from + limit).map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
    q.neq = (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; };
    q.gt = (c: string, v: number) => { filters.push((r) => Number(r[c]) > v); return q; };
    q.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; };
    q.is = (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; };
    q.not = (c: string, o: string, v: unknown) => { if (o === "is" && v === null) filters.push((r) => r[c] != null); return q; };
    q.or = self; q.ilike = self; q.match = self;
    q.range = (a: number, b: number) => { from = a; limit = b - a + 1; return q; };
    q.order = (c: string, o?: { ascending?: boolean }) => { order = { col: c, asc: o?.ascending !== false }; return q; };
    q.limit = (n: number) => { limit = n; return q; };
    q.single = async () => { const r = run(); if (r.error) return r; const list = r.data as Row[]; return list?.length === 1 ? { data: list[0], error: null } : { data: null, error: { code: "PGRST116", message: "not one row" } }; };
    q.maybeSingle = async () => { const r = run(); if (r.error) return r; return { data: (r.data as Row[] | null)?.[0] ?? null, error: null }; };
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
  signedDrawingUrl: vi.fn(async () => "https://signed.example/plan.pdf"),
}));
const analysis = vi.hoisted(() => ({ preflight: vi.fn(async () => ({ ok: true })), generate: vi.fn(() => { throw new Error("analysis must not run"); }) }));
vi.mock("@/lib/ai/analysisClient", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/analysisClient")>()), fetchPreflight: analysis.preflight, generateAnalysis: analysis.generate }));
// The renderer is a probe: it prints the page and how many recorded boxes it was asked to draw.
vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: ({ fileUrl, source }: { fileUrl: string | null; source?: { page: number; evidence: unknown[] } }) =>
    <div data-testid="pdf-probe">{fileUrl ? "file" : "no-file"}{source ? ` page:${source.page} boxes:${source.evidence.length}` : ""}</div>,
}));
vi.mock("@/components/ops/workspace/WorkspaceSources", () => ({
  default: ({ onSelectDocument }: { onSelectDocument: (id: string) => void }) => <button onClick={() => onSelectDocument("doc-1")}>Ground Floor Plan</button>,
}));
vi.mock("@/components/ops/workspace/WorkspaceSourceManager", () => ({ default: () => null }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, roles: ["ops"], isStaff: true }) }));

const aiItem = (key: string, name: string, qty: number, evidence: unknown[] = []) => ({
  key, item: name, quantity: qty, unit: "nos", confidence: 0.95, aiStatus: "MEASURED",
  source: { documentId: "doc-1", document: "Ground Floor Plan", page: 1, evidence, pageSize: { width: 100, height: 100 } },
});
const line = (p: Row): Row => ({
  boq_id: "boq-1", section: "Doors", dsr_code: null, unit: "nos", dsr_rate: null, custom_rate: null, cost: null,
  basis_note: null, measurement_method: "COUNT", included: true, sort: 1, scope_id: null, source: "auto", ...p,
});

/** The state a completed Apply leaves: Door D1 verified and applied (qty 4),
 *  Window W1 flagged and held back. Two BOQs: boq-1 analysed, boq-2 newer and empty. */
function seed() {
  mem.writes = []; mem.invokes = []; mem.nextId = 1; mem.failing = new Set();
  mem.tables = {
    projects: [{ id: "proj-1", name: "Tower B", client_name: "Acme", location: "Pune", project_type: "Residential", status: "active", area_sqft: 1000, floors: 1 }],
    boq: [
      { id: "boq-1", name: "Civil BOQ", project_id: "proj-1", created_at: "2026-10-01", discipline: "civil", status: "draft", spec: {}, updated_at: "2026-10-01T00:00:00Z", scope_id: null },
      { id: "boq-2", name: "Site BOQ", project_id: "proj-1", created_at: "2026-10-05", discipline: "civil", status: "draft", spec: {}, updated_at: "2026-10-05T00:00:00Z", scope_id: null },
    ],
    boq_line: [line({
      id: "line-1", description: "Door D1", qty: 4, basis: "REVIEW_VERIFIED", quantity_status: "COUNTED", external_key: "D1",
      source_document_id: "doc-1", source_page: "1",
    })],
    boq_line_change_log: [],
    analysis_run: [{ id: "run-1", boq_id: "boq-1", project_id: "proj-1", source: "json_import", item_count: 2, created_at: "2026-10-10T00:00:00Z", resolved_document_id: "doc-1" }],
    analysis_review_item: [
      { id: "ri-1", run_id: "run-1", item_key: "D1", item_name: "Door D1", ai_json: aiItem("D1", "Door D1", 4, [{ bbox: [10, 10, 20, 20], page: 1 }, { bbox: [30, 30, 40, 40], page: 1 }]), reviewer_json: null, review_status: "VERIFIED", flag_reason: null, review_note: null, reviewed_at: "2026-10-11T00:00:00Z", sort: 0 },
      { id: "ri-2", run_id: "run-1", item_key: "W1", item_name: "Window W1", ai_json: aiItem("W1", "Window W1", 6), reviewer_json: null, review_status: "FLAGGED", flag_reason: "WRONG_QUANTITY", review_note: null, reviewed_at: "2026-10-11T00:00:00Z", sort: 1 },
    ],
    project_document: [{ id: "doc-1", project_id: "proj-1", name: "Ground Floor Plan", current_revision_id: "rev-1", created_at: "2026-10-01" }],
    document_revision: [{ id: "rev-1", document_id: "doc-1", label: "Rev A", file_path: "proj-1/doc-1/rev-1.pdf", original_filename: "gf.pdf", page_count: 1, page_titles: null }],
    project_scope: [],
    dsr_item: [],
  };
}

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };
/** One "browser load" of a URL: a fresh cache and router, nothing carried over in memory. */
function load(url: string) {
  cleanup();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/projects/:id" element={<ProjectShell />}>
            <Route path="overview" element={<ProjectOverview />} />
            <Route path="drawings" element={<ProjectDrawings />} />
            <Route path="review" element={<ProjectReview />} />
            <Route path="boq" element={<ProjectBoq />} />
            <Route path="check" element={<ProjectExport mode="check" />} />
            <Route path="export" element={<ProjectExport />} />
          </Route>
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const at = () => screen.getByTestId("where").textContent;
const steps = () => screen.getByRole("navigation", { name: "Project steps" });
const P = "/app/projects/proj-1";

beforeEach(() => { seed(); window.sessionStorage.clear(); analysis.preflight.mockClear(); analysis.generate.mockClear(); });

describe("Journey — the selected BOQ travels with every step", () => {
  it("keeps ?boq= through the step tabs and Back/Next, and the picker changes it in place", async () => {
    load(`${P}/overview?boq=boq-2`);
    expect(await screen.findByRole("heading", { name: /Quantity BOQ progress — Site BOQ/ })).toBeInTheDocument();

    for (const [name, step] of [["Step 1: Project & drawings", "drawings"], ["Step 2: Review quantities", "review"], ["Step 3: Build BOQ", "boq"], ["Step 4: Check & finalise", "check"], ["Step 5: Export", "export"], ["Overview", "overview"]] as const) {
      fireEvent.click(within(steps()).getByRole("link", { name }));
      await waitFor(() => expect(at()).toBe(`${P}/${step}?boq=boq-2`));
    }

    // Review step on boq-2 (never analysed): says so, and offers to start — it does not start anything.
    fireEvent.click(within(steps()).getByRole("link", { name: "Step 2: Review quantities" }));
    expect(await screen.findByText(/No drawing analysis has been loaded for “Site BOQ” yet/)).toBeInTheDocument();

    // Switch BOQ with the picker: the URL changes, and Back/Next carry the new one.
    fireEvent.change(screen.getByRole("combobox", { name: "BOQ" }), { target: { value: "boq-1" } });
    await waitFor(() => expect(at()).toBe(`${P}/review?boq=boq-1`));
    expect(await screen.findByText("Verified")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Previous and next step" });
    expect(within(nav).getByRole("link", { name: /Back: Project & drawings/ })).toHaveAttribute("href", `${P}/drawings?boq=boq-1`);
    expect(within(nav).getByRole("link", { name: /Next: Build BOQ/ })).toHaveAttribute("href", `${P}/boq?boq=boq-1`);
    expect(mem.writes).toEqual([]);
  });
});

describe("Journey — a BOQ line's evidence opens the drawing at the recorded region, and comes back", () => {
  it("BOQ line → Drawings (document, page, item, run, region drawn) → Back to the BOQ", async () => {
    load(`${P}/boq?boq=boq-1`);
    fireEvent.click(await screen.findByRole("button", { name: "Show evidence for Door D1" }));
    const panel = screen.getByRole("group", { name: "Evidence for Door D1" });
    fireEvent.click(within(panel).getByRole("link", { name: /Show the measured region on Ground Floor Plan, p\.1/ }));

    await waitFor(() => expect(at()).toBe(`${P}/drawings?boq=boq-1&document=doc-1&item=ri-1&run=run-1&page=1`));
    expect(await screen.findByText(/Showing the region recorded for “Door D1” \(verified in review\)/)).toBeInTheDocument();
    expect(await screen.findByTestId("pdf-probe")).toHaveTextContent("file page:1 boxes:2");
    expect(screen.getByRole("heading", { name: "Ground Floor Plan" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Back to the BOQ" }));
    await waitFor(() => expect(at()).toBe(`${P}/boq?boq=boq-1`));
    expect(await screen.findByText("Door D1")).toBeInTheDocument();
    expect(mem.writes).toEqual([]);
  });

  it("a stale evidence link (review item gone, drawing removed) says so and draws nothing", async () => {
    load(`${P}/drawings?boq=boq-1&document=doc-gone&item=ri-gone&run=run-1&page=1`);
    expect(await screen.findByText(/This drawing is not in this project's drawing list/)).toBeInTheDocument();
    expect(await screen.findByText(/The review item behind this link was not found/)).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-probe")).toBeNull();
    expect(screen.getByText("Select a drawing from Sources to begin.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the BOQ" })).toHaveAttribute("href", `${P}/boq?boq=boq-1`);
  });
});

describe("Journey — what survives a reload comes from the database", () => {
  it("review decisions and applied quantities are re-read from the database on reload, not remembered", async () => {
    load(`${P}/review?boq=boq-1`);
    const counts = async () => (await screen.findByRole("heading", { name: "Review decisions", hidden: true })).closest("section")!;
    expect(await counts()).toHaveTextContent(/Verified1/);
    expect(await counts()).toHaveTextContent(/Flagged1/);

    // Someone resolves the flagged item elsewhere; this tab "reloads".
    Object.assign(mem.tables.analysis_review_item[1], { review_status: "VERIFIED", flag_reason: null });
    load(`${P}/review?boq=boq-1`);
    expect(await counts()).toHaveTextContent(/Verified2/);
    expect(await counts()).toHaveTextContent(/Flagged0/);

    // The applied quantity and its basis are on the BOQ step after a reload.
    load(`${P}/boq?boq=boq-1`);
    expect(await screen.findByText("Door D1")).toBeInTheDocument();
    expect(screen.getByText("Counted on drawing, verified in review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Quantity for Door D1, currently 4" })).toBeInTheDocument();
  });

  it("the Last Apply note is only this tab's record: shown with that caveat, absent in a new tab — and the applied lines remain", async () => {
    saveReceipt({
      boqId: "boq-1", runId: "run-1", appliedAt: "2026-10-12T10:00:00Z", appliedCount: 1, unresolvedCount: 1, correctedCount: 0,
      reviewedCount: 2, verifiedCount: 1, unauditedCount: 0, conflictedCount: 0, revisionChanged: [], justAppliedLineIds: ["line-1"],
    });
    load(`${P}/boq?boq=boq-1`); // same tab, reloaded
    const note = await screen.findByRole("status", { name: "Last Apply result" });
    expect(note).toHaveTextContent(/Last applied from review in this browser tab, .*: 1 item applied · 1 not applied \(unresolved\)\./);
    expect(within(note).getByRole("link", { name: "Resolve the 1 not applied in Review quantities" })).toHaveAttribute("href", `${P}/review?boq=boq-1`);

    window.sessionStorage.clear(); // a new tab, another device or another user
    load(`${P}/boq?boq=boq-1`);
    expect(await screen.findByText("Door D1")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Last Apply result" })).toBeNull();
    // The work itself is intact: the quantity and the held-back item come from the rows.
    expect(screen.getByRole("button", { name: "Edit Quantity for Door D1, currently 4" })).toBeInTheDocument();
    load(`${P}/review?boq=boq-1`);
    expect(await screen.findByText(/1 flagged or pending item will stay out of the BOQ until resolved/)).toBeInTheDocument();
  });

  it("schedule (DSR) decisions are re-read from the BOQ row on reload", async () => {
    mem.tables.dsr_item = seedCatalogue().map((i) => ({ ...i, billable: true }));
    Object.assign(mem.tables.boq[0], {
      rate_year: "2023",
      spec: { _dsr_scope_decisions: { "excluded_reinforcement:5": { decision: "rejected", at: "2026-10-12T00:00:00Z", by: "user-2", note: "In the structural package", schedule: "DSR 2023" } } },
    });
    mem.tables.boq_line = [line({ id: "rcc", section: "RCC", dsr_code: "5.1.3", description: "RCC 1:2:4 in footings", unit: "cum", qty: 12, dsr_rate: 8583.4, basis: "MANUAL", quantity_status: "MEASURED", external_key: null, source_document_id: null, source_page: null })];
    load(`${P}/check?boq=boq-1`);
    const card = await screen.findByRole("article", { name: "Suggestion: Steel reinforcement" }, { timeout: 5000 });
    expect(card).toHaveTextContent(/Rejected — In the structural package/);
    expect(mem.writes).toEqual([]);
  });
});

describe("Journey — resuming from a link", () => {
  it("each step opens directly by URL with no prior navigation", async () => {
    for (const [step, text] of [
      ["overview", /Next step:/], ["drawings", /Drawings/], ["review", /Review quantities/], ["boq", /^BOQ$/], ["check", /.+/], ["export", /.+/],
    ] as const) {
      load(`${P}/${step}?boq=boq-1`);
      expect(await screen.findByRole("heading", { name: "Tower B" })).toBeInTheDocument();
      expect((await screen.findAllByRole("heading", { name: text })).length).toBeGreaterThan(0);
      expect(screen.queryByRole("alert")).toBeNull();
    }
  });

  it("an unknown ?boq= is named as not part of this project, never silently swapped", async () => {
    load(`${P}/review?boq=boq-gone`);
    expect(await screen.findByText("The BOQ in this link is not part of this project; showing “Civil BOQ”.")).toBeInTheDocument();
    // The review screen will return to the BOQ actually shown, not the stale one.
    const go = await screen.findByRole("link", { name: /Open review/ });
    expect(decodeURIComponent(go.getAttribute("href")!)).toContain(`returnTo=${P}/review?boq=boq-1`);

    load(`${P}/overview?boq=boq-gone`);
    expect(await screen.findByText("The BOQ in this link is not part of this project; showing “Civil BOQ”.")).toBeInTheDocument();

    load(`${P}/boq?boq=boq-gone`);
    expect(await screen.findByText("The BOQ in this link is not part of this project; showing “Civil BOQ”.")).toBeInTheDocument();
  });

  it("a project with no BOQ: every step says so, links to create one, and claims nothing is done", async () => {
    mem.tables.boq = []; mem.tables.boq_line = []; mem.tables.analysis_run = []; mem.tables.analysis_review_item = [];
    load(`${P}/overview`);
    const stages = await screen.findByRole("list", { name: "Quantity BOQ stages" });
    expect(stages).toHaveTextContent("No BOQ yet — create one to review quantities into.");
    expect(screen.getByRole("heading", { name: /^Next step: Review quantities/ })).toBeInTheDocument();

    load(`${P}/review`);
    expect(await screen.findByRole("heading", { name: "No BOQ to review into yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a BOQ" }).getAttribute("href")).toMatch(/^\/ops\/projects\/proj-1\/boqs\/manage\?returnTo=/);

    load(`${P}/boq`);
    expect(await screen.findByRole("heading", { name: "No BOQ yet" })).toBeInTheDocument();
    load(`${P}/export`);
    expect(await screen.findByRole("heading", { name: "Nothing to export yet" })).toBeInTheDocument();
    expect(screen.queryByText(/This step is done|Ready to export/)).toBeNull();
    expect(mem.writes).toEqual([]);
  });
});

describe("Journey — a failed read is an error with a way to recover, never a blank or a success", () => {
  it("project read fails → error, Retry recovers", async () => {
    mem.failing.add("projects");
    load(`${P}/overview?boq=boq-1`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load this project. Nothing has been changed.");
    expect(within(alert).getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/app/projects");
    mem.failing.delete("projects");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Tower B" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /^Next step:/ })).toBeInTheDocument();
  });

  it("the project's BOQ list read fails → an error on every step, never 'No BOQ yet'", async () => {
    mem.failing.add("boq");
    load(`${P}/overview`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this project's drawings or BOQs, so its progress is not shown.");
    expect(screen.queryByText(/No BOQ yet/)).toBeNull();
    for (const step of ["review", "boq", "check", "export"]) {
      load(`${P}/${step}`);
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this project's BOQs.");
      expect(screen.queryByRole("heading", { name: /No BOQ|Nothing to export yet/ })).toBeNull();
    }
    expect(mem.writes).toEqual([]);
  });

  it("Overview: drawings read fails → error with Retry, no progress shown", async () => {
    mem.failing.add("project_document");
    load(`${P}/overview?boq=boq-1`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load this project's drawings or BOQs, so its progress is not shown.");
    expect(screen.queryByRole("list", { name: "Quantity BOQ stages" })).toBeNull();
    mem.failing.delete("project_document");
    await act(async () => { fireEvent.click(within(alert).getByRole("button", { name: "Retry" })); });
    expect(await screen.findByRole("list", { name: "Quantity BOQ stages" })).toBeInTheDocument();
  });

  it("Review: analysis read fails → error with Retry, not 'no analysis'", async () => {
    mem.failing.add("analysis_run");
    load(`${P}/review?boq=boq-1`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the review state of this BOQ.");
    expect(screen.queryByText(/No drawing analysis/)).toBeNull();
    expect(screen.queryByRole("status", { name: "Step status" })).toBeNull();
    mem.failing.delete("analysis_run");
    await act(async () => { fireEvent.click(within(alert).getByRole("button", { name: "Retry" })); });
    expect(await screen.findByText("Verified")).toBeInTheDocument();
  });

  it("Build BOQ: lines read fails → error with Retry, not an empty BOQ", async () => {
    mem.failing.add("boq_line");
    load(`${P}/boq?boq=boq-1`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the lines of this BOQ.");
    expect(screen.queryByText(/No lines yet/)).toBeNull();
    expect(screen.queryByText(/This step is done/)).toBeNull();
    mem.failing.delete("boq_line");
    await act(async () => { fireEvent.click(within(alert).getByRole("button", { name: "Retry" })); });
    expect(await screen.findByText("Door D1")).toBeInTheDocument();
  });

  it("Check and Export: lines read fails → stated as unavailable, never 'ready'", async () => {
    mem.failing.add("boq_line");
    for (const step of ["check", "export"]) {
      load(`${P}/${step}?boq=boq-1`);
      expect(await screen.findByText(/Could not load everything this (check|export) needs/)).toBeInTheDocument();
      expect(screen.queryByText(/This step is done|Ready to export/)).toBeNull();
    }
  });
});

describe("Journey — opening a screen starts no analysis and writes nothing", () => {
  it("visiting every step (and an evidence link) writes nothing and calls no analysis", async () => {
    for (const url of [`${P}/overview`, `${P}/drawings?boq=boq-1&document=doc-1`, `${P}/review?boq=boq-1`, `${P}/review?boq=boq-2`, `${P}/boq?boq=boq-1`, `${P}/check?boq=boq-1`, `${P}/export?boq=boq-1`,
      `${P}/drawings?boq=boq-1&document=doc-1&item=ri-1&run=run-1&page=1`]) {
      load(url);
      expect(await screen.findByRole("heading", { name: "Tower B" })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryAllByRole("status", { name: /^Loading/ })).toHaveLength(0));
    }
    expect(mem.writes).toEqual([]);
    expect(mem.invokes).toEqual([]);
    expect(analysis.preflight).not.toHaveBeenCalled();
    expect(analysis.generate).not.toHaveBeenCalled();
  });
});
