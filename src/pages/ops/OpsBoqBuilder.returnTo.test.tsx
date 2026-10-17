// The BOQ builder opened from the project journey (?returnTo=/app/projects/…)
// leads back there; without one (or with anything else) back is unchanged.
// Harness as OpsBoqBuilder.removeUndo.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import OpsBoqBuilder from "./OpsBoqBuilder";

type Row = Record<string, unknown>;
vi.mock("sonner", () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() });
  return { toast: t };
});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  missing: new Set<string>(),
  deleteError: null as null | { message: string },
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
    if (op === "insert") { rows.push({ ...payload }); return { data: null, error: null }; }
    if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null }; }
    if (table === "boq_line" && db.deleteError) return { data: null, error: db.deleteError };
    const ids = new Set(hit.map((r) => r.id));
    db.tables[table] = rows.filter((r) => !ids.has(r.id));
    if (table === "boq_line") {
      for (const [t, c] of [["boq_audit_finding", "boq_line_id"], ["boq_line_change_log", "boq_line_id"]]) {
        (db.tables[t] ?? []).forEach((r) => { if (ids.has(r[c] as string)) r[c] = null; });
      }
    }
    return { data: null, error: null };
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

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };
function renderAt(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const LINE = { id: "l1", boq_id: "boq-1", section: "Finishes", dsr_code: null, description: "Vitrified tiles", unit: "sqm", qty: 4,
  dsr_rate: 900, custom_rate: null, cost: null, included: true, source: "manual", sort: 1, basis: null, basis_note: null,
  external_key: null, measurement_method: null, quantity_status: "MEASURED", source_document_id: null, source_page: null, scope_id: null };
const RETURN = "/app/projects/proj-1/check?boq=boq-1";

beforeEach(() => {
  db.tables = { boq_line: [{ ...LINE }] };
  db.missing = new Set();
  db.deleteError = null;
});

describe("OpsBoqBuilder — return to the project journey", () => {
  it("back returns to the journey step it was opened from", async () => {
    renderAt(`/ops/projects/proj-1/boqs/boq-1?returnTo=${encodeURIComponent(RETURN)}`);
    await screen.findByText("Vitrified tiles");
    fireEvent.click(screen.getByRole("button", { name: "Back to project" }));
    expect(screen.getByTestId("where")).toHaveTextContent(RETURN);
  });
  it("without a journey returnTo, back still goes to the Workspace", async () => {
    renderAt(`/ops/projects/proj-1/boqs/boq-1?returnTo=${encodeURIComponent("https://evil.example/app/projects/x")}`);
    await screen.findByText("Vitrified tiles");
    fireEvent.click(screen.getByRole("button", { name: "Back to Workspace" }));
    expect(screen.getByTestId("where").textContent).toMatch(/^\/ops\/projects\/proj-1\/workspace/);
  });
});
