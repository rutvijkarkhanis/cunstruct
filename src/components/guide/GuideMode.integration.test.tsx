// GUIDE MODE — from the home page to the end of the walkthrough, IN A
// CONTROLLED SETUP (mock data, not a live backend).
//
// The real Projects home, AppLayout (with the guide panel), project shell and
// journey steps run against an in-memory database (the Supabase client is
// replaced below — the same harness as JourneyRecovery.integration.test), so
// nothing reaches any real project. The guide must read only: every test
// ends by checking that no insert, update, upsert, delete, rpc or edge
// function call was made.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AppLayout from "@/components/app/AppLayout";
import ProjectShell from "@/components/app/ProjectShell";
import AppProjects from "@/pages/app/AppProjects";
import ProjectOverview from "@/pages/app/ProjectOverview";
import ProjectDrawings from "@/pages/app/ProjectDrawings";
import ProjectReview from "@/pages/app/ProjectReview";
import ProjectBoq from "@/pages/app/ProjectBoq";
import ProjectExport from "@/pages/app/ProjectExport";
import StartGuideButton from "./StartGuideButton";
import { GUIDE_STORAGE_KEY, exitGuide } from "@/lib/guide/guideSession";

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

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.value }));
const staff = { user: { id: "user-1" }, loading: false, rolesReady: true, isStaff: true, roles: ["ops"], signOut: vi.fn() };

const aiItem = (key: string, name: string, qty: number | null, evidence: unknown[] = []) => ({
  key, item: name, quantity: qty, unit: "nos", confidence: 0.95, aiStatus: "MEASURED",
  source: { documentId: "doc-1", document: "Ground Floor Plan", page: 1, evidence, pageSize: { width: 100, height: 100 } },
});
const line = (p: Row): Row => ({
  boq_id: "boq-1", section: "Doors", dsr_code: null, unit: "nos", dsr_rate: null, custom_rate: null, cost: null,
  basis_note: null, measurement_method: "COUNT", included: true, sort: 1, scope_id: null, source: "auto", ...p,
});

/** Tower B: one drawing, one analysed BOQ (D1 verified and applied, W1
 *  flagged), one line with no rate. Empty Site: a project with nothing yet. */
function seed() {
  mem.writes = []; mem.invokes = []; mem.nextId = 1; mem.failing = new Set();
  mem.tables = {
    projects: [
      { id: "proj-1", name: "Tower B", client_name: "Acme", location: "Pune", project_type: "Residential", status: "active", area_sqft: 1000, floors: 1, created_at: "2026-10-01" },
      { id: "proj-2", name: "Empty Site", client_name: null, location: null, project_type: null, status: "pending_review", area_sqft: null, floors: null, created_at: "2026-10-02" },
    ],
    boq: [{ id: "boq-1", name: "Civil BOQ", project_id: "proj-1", created_at: "2026-10-01", discipline: "civil", status: "draft", spec: {}, updated_at: "2026-10-01T00:00:00Z", scope_id: null }],
    boq_line: [line({
      id: "line-1", description: "Door D1", qty: 4, basis: "REVIEW_VERIFIED", quantity_status: "COUNTED", external_key: "D1",
      source_document_id: "doc-1", source_page: "1",
    })],
    boq_line_change_log: [],
    analysis_run: [{ id: "run-1", boq_id: "boq-1", project_id: "proj-1", source: "json_import", item_count: 2, created_at: "2026-10-10T00:00:00Z", resolved_document_id: "doc-1" }],
    analysis_review_item: [
      { id: "ri-1", run_id: "run-1", item_key: "D1", item_name: "Door D1", ai_json: aiItem("D1", "Door D1", 4, [{ bbox: [10, 10, 20, 20], page: 1 }]), reviewer_json: null, review_status: "VERIFIED", flag_reason: null, review_note: null, reviewed_at: "2026-10-11T00:00:00Z", sort: 0 },
      { id: "ri-2", run_id: "run-1", item_key: "W1", item_name: "Window W1", ai_json: aiItem("W1", "Window W1", 6), reviewer_json: null, review_status: "FLAGGED", flag_reason: "INCORRECT_QUANTITY", review_note: "Count differs from schedule", reviewed_at: "2026-10-11T00:00:00Z", sort: 1 },
    ],
    project_document: [{ id: "doc-1", project_id: "proj-1", name: "Ground Floor Plan", current_revision_id: "rev-1", created_at: "2026-10-01" }],
    document_revision: [{ id: "rev-1", document_id: "doc-1", label: "Rev A", file_path: "proj-1/doc-1/rev-1.pdf", original_filename: "gf.pdf", page_count: 1, page_titles: null }],
    project_scope: [],
    dsr_item: [],
  };
}

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };
function load(url: string) {
  cleanup();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route path="projects" element={<AppProjects />} />
            <Route path="projects/:id" element={<ProjectShell />}>
              <Route path="overview" element={<ProjectOverview />} />
              <Route path="drawings" element={<ProjectDrawings />} />
              <Route path="review" element={<ProjectReview />} />
              <Route path="boq" element={<ProjectBoq />} />
              <Route path="check" element={<ProjectExport mode="check" />} />
              <Route path="export" element={<ProjectExport />} />
            </Route>
          </Route>
          <Route path="/home-non-staff" element={<StartGuideButton />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const at = () => screen.getByTestId("where").textContent;
const guide = () => screen.getByRole("complementary", { name: "Guided walkthrough" });
const P = "/app/projects/proj-1";
const noWrites = () => { expect(mem.writes).toEqual([]); expect(mem.invokes).toEqual([]); };
const next = () => fireEvent.click(within(guide()).getByRole("button", { name: "Next" }));
async function startOn(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Start Guided Walkthrough" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: new RegExp(name) }));
  return dialog;
}

beforeEach(() => { seed(); exitGuide(); window.localStorage.clear(); window.sessionStorage.clear(); auth.value = staff; });

describe("Guide Mode — home page to export, on the project's own data", () => {
  it("starts from the Projects home, walks all seven steps over the real screens, and writes nothing", async () => {
    load("/app/projects");
    const dialog = await startOn("Tower B");
    // The chosen project's actual state, before starting.
    const state = within(dialog).getByRole("region", { name: "Selected project" });
    expect(await within(state).findByText(/BOQ: Civil BOQ/)).toBeInTheDocument();
    expect(within(state).getByText(/1 drawing uploaded/)).toBeInTheDocument();
    expect(within(state).getByText(/held back \(flagged or marked pending\)/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start guide" }));

    // 1 — Overview: the project's recorded details.
    await waitFor(() => expect(at()).toBe(`${P}/overview`));
    expect(await within(guide()).findByText(/Step 1 of 7/)).toBeInTheDocument();
    expect(within(guide()).getByRole("heading", { name: "Project overview" })).toBeInTheDocument();
    expect(await within(guide()).findByText("Acme")).toBeInTheDocument();
    expect(within(guide()).getByText("1,000 sq ft")).toBeInTheDocument();

    // 2 — Drawings: opens the real Drawings screen; the drawing is listed and links into the viewer.
    next();
    await waitFor(() => expect(at()).toBe(`${P}/drawings?boq=boq-1`));
    expect(await within(guide()).findByText("Complete")).toBeInTheDocument();
    expect(within(guide()).getByRole("link", { name: "Ground Floor Plan" })).toHaveAttribute("href", `${P}/drawings?boq=boq-1&document=doc-1`);

    // 3 — Take-off: items, quantities, units, and the recorded region.
    next();
    await waitFor(() => expect(at()).toBe(`${P}/review?boq=boq-1`));
    expect(await within(guide()).findByText(/2 items in the latest take-off/)).toBeInTheDocument();
    expect(await within(guide()).findByText(/1 of 2 with a measured region/)).toBeInTheDocument();
    expect(within(guide()).getByRole("link", { name: "show region, p.1" })).toHaveAttribute("href", `${P}/drawings?boq=boq-1&document=doc-1&item=ri-1&run=run-1&page=1`);
    expect(within(guide()).getByRole("link", { name: "open drawing, p.1" })).toBeInTheDocument();

    // 4 — Review: real decisions; the flagged item is named with its reason and note.
    next();
    expect(await within(guide()).findByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(await within(guide()).findByText(/Window W1/)).toBeInTheDocument();
    expect(within(guide()).getByText(/flagged \(incorrect quantity\): “Count differs from schedule”/)).toBeInTheDocument();
    expect(within(guide()).getByText("Needs attention")).toBeInTheDocument();
    // The next action is linked, never performed.
    expect(within(guide()).getByText(/the guide does not change anything/)).toBeInTheDocument();
    expect(within(guide()).getByRole("link", { name: "Open the review screen to decide items" }).getAttribute("href")).toMatch(/^\/ops\/projects\/proj-1\/boqs\/boq-1\/review\?returnTo=/);

    // 5 — BOQ: the line with its quantity, unit and missing rate (never ₹0).
    next();
    await waitFor(() => expect(at()).toBe(`${P}/boq?boq=boq-1`));
    expect(await within(guide()).findByText(/4 nos/)).toBeInTheDocument();
    expect(within(guide()).getByText("no rate")).toBeInTheDocument();
    expect(within(guide()).getByRole("link", { name: "Enter missing rates (BOQ builder)" })).toBeInTheDocument();

    // 6 — Checks: the review item left out, linked to where it is resolved.
    next();
    await waitFor(() => expect(at()).toBe(`${P}/check?boq=boq-1`));
    expect(await within(guide()).findByText("Still open")).toBeInTheDocument();
    expect(within(guide()).getAllByText(/1 review item not in the BOQ/).length).toBeGreaterThan(0);

    // 7 — Export: the available outputs; the last step finishes instead of Next.
    next();
    await waitFor(() => expect(at()).toBe(`${P}/export?boq=boq-1`));
    expect(await within(guide()).findByText(/Downloading reads the BOQ and creates a file on your computer/)).toBeInTheDocument();
    expect(within(guide()).queryByRole("button", { name: "Next" })).toBeNull();

    // Back returns one step, on its screen.
    fireEvent.click(within(guide()).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(at()).toBe(`${P}/check?boq=boq-1`));

    // Finish: the guide closes and the normal application stays.
    next();
    await waitFor(() => expect(at()).toBe(`${P}/export?boq=boq-1`));
    fireEvent.click(within(guide()).getByRole("button", { name: "Finish guide" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Guided walkthrough" })).toBeNull());
    expect(at()).toBe(`${P}/export?boq=boq-1`);
    expect(screen.getByRole("navigation", { name: "Project steps" })).toBeInTheDocument();
    noWrites();
  });

  it("a project with no drawings and no BOQ: each step says it is unavailable and why, and nothing is shown as complete", async () => {
    load("/app/projects");
    const dialog = await startOn("Empty Site");
    expect(await within(dialog).findByText("This project has no BOQ yet.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start guide" }));
    await waitFor(() => expect(at()).toBe("/app/projects/proj-2/overview"));
    expect((await within(guide()).findAllByText("not recorded")).length).toBeGreaterThan(0);

    next();
    expect(await within(guide()).findByText("No drawings have been uploaded to this project.")).toBeInTheDocument();
    expect(within(guide()).getByText("Unavailable")).toBeInTheDocument();
    for (let i = 0; i < 5; i++) {
      next();
      expect(await within(guide()).findByText("Unavailable")).toBeInTheDocument();
    }
    expect(within(guide()).getByText(/Nothing to export yet/)).toBeInTheDocument();
    const progress = within(guide()).getByRole("list", { name: "Guide progress" });
    for (const b of within(progress).getAllByRole("button")) expect(b.getAttribute("aria-label")).not.toMatch(/Complete/);
    noWrites();
  });

  it("skip marks a step skipped; leaving the project pauses the guide, and Resume returns to the same step", async () => {
    load("/app/projects");
    const dialog = await startOn("Tower B");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start guide" }));
    await waitFor(() => expect(at()).toBe(`${P}/overview`));
    fireEvent.click(await within(guide()).findByRole("button", { name: "Skip step" }));
    await waitFor(() => expect(at()).toBe(`${P}/drawings?boq=boq-1`));
    const progress = within(guide()).getByRole("list", { name: "Guide progress" });
    expect(within(progress).getByRole("button", { name: /Step 1: Project overview — Skipped/ })).toBeInTheDocument();
    next(); next();
    await waitFor(() => expect(within(guide()).getByText(/Step 4 of 7/)).toBeInTheDocument());

    // Normal navigation still works: back to the Projects list pauses the guide.
    fireEvent.click(screen.getByRole("link", { name: "Projects", current: false }));
    await waitFor(() => expect(at()).toBe("/app/projects"));
    expect(guide()).toHaveTextContent(/Guide paused: Tower B, step 4 of 7/);

    // A reload keeps it (browser storage), and Resume reopens step 4's screen.
    load("/app/projects");
    fireEvent.click(await within(guide()).findByRole("link", { name: "Resume" }));
    await waitFor(() => expect(at()).toBe(`${P}/review`));
    expect(await within(guide()).findByRole("heading", { name: "Review" })).toBeInTheDocument();

    // Exit: the panel goes; the screen stays.
    fireEvent.click(within(guide()).getByRole("button", { name: "Exit guide" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Guided walkthrough" })).toBeNull());
    expect(at()).toBe(`${P}/review`);
    expect(window.localStorage.getItem(GUIDE_STORAGE_KEY)).toBeNull();
    noWrites();
  });

  it("is not offered to non-staff, and another user's guide is not shown", async () => {
    auth.value = { ...staff, isStaff: false, roles: [] };
    load("/home-non-staff");
    expect(screen.queryByRole("button", { name: "Start Guided Walkthrough" })).toBeNull();

    window.localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ userId: "someone-else", projectId: "proj-1", projectName: "Tower B", step: 2, skipped: [] }));
    auth.value = staff;
    load("/app/projects");
    expect(await screen.findByRole("button", { name: "Start Guided Walkthrough" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Guided walkthrough" })).toBeNull();
    expect(screen.queryByText(/Resume guide/)).toBeNull();
    noWrites();
  });
});
