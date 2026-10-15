// Rate comparison tab: vendor quotations, historical firm BOQ rates and the
// preferred candidate, against an in-memory supabase mock that records every
// write. Key guarantees: evidence writes go only to vendor_quotation /
// boq_line_rate_review (never boq_line or the DSR mapping), nothing is
// preferred automatically, and historical rates are read-only.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import BoqDsrMapping from "./BoqDsrMapping";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "estimator-1" } }) }));

const db = vi.hoisted(() => {
  const LINES = [
    { id: "line-tile", section: "Finishes", dsr_code: "11.41.2", description: "Vitrified floor tiles", unit: "sqm", qty: 40, included: true, quantity_status: "MEASURED", sort: 1 },
  ];
  const MAPPING = {
    id: "map-1", boq_id: "boq-1", boq_line_id: "line-tile", status: "mapped", include_in_estimate: true,
    dsr_item_id: "dsr-1", dsr_code: "11.41.2", dsr_description: "Vitrified floor tiles 600x600", dsr_unit: "sqm",
    dsr_rate: 1000, dsr_source: "DSR", dsr_rate_year: "2023", reviewer_note: null, reviewed_by: null, reviewed_at: null,
  };
  const HISTORICAL = [{
    id: "old-line", boq_id: "boq-old", description: "Vitrified floor tiles 600x600", unit: "sqm", qty: 120,
    dsr_code: "11.41.2", dsr_rate: 950, custom_rate: 1200,
    boq: { name: "Tower A BOQ", status: "sent", rate_year: "2023", created_at: "2025-11-02T00:00:00Z", updated_at: "2026-01-15T00:00:00Z", project: { name: "Tower A", location: "Vizag" } },
  }];
  const state = {
    evidenceMissing: false,
    quotations: [] as Record<string, unknown>[],
    reviews: [] as Record<string, unknown>[],
    writes: [] as { table: string; op: string; payload?: Record<string, unknown> }[],
  };
  return { LINES, MAPPING, HISTORICAL, state };
});

function chain(table: string) {
  let op = "select";
  let payload: Record<string, unknown> | undefined;
  const filters: Record<string, unknown> = {};
  const obj: Record<string, unknown> = {};
  ["select", "order", "limit", "or", "ilike"].forEach((m) => { obj[m] = () => obj; });
  obj.eq = (c: string, v: unknown) => { filters[c] = v; return obj; };
  obj.neq = (c: string, v: unknown) => { filters[`not:${c}`] = v; return obj; };
  obj.insert = (p: Record<string, unknown>) => { op = "insert"; payload = p; return obj; };
  obj.upsert = (p: Record<string, unknown>) => { op = "upsert"; payload = p; return obj; };
  obj.update = (p: Record<string, unknown>) => { op = "update"; payload = p; return obj; };
  obj.delete = () => { op = "delete"; return obj; };
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    const s = db.state;
    if (op !== "select") s.writes.push({ table, op, payload: { ...payload, ...filters } });
    const evidence = table === "vendor_quotation" || table === "boq_line_rate_review";
    if (evidence && s.evidenceMissing) {
      return resolve({ data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` } });
    }
    if (table === "vendor_quotation") {
      if (op === "insert") s.quotations.push({ id: `q-${s.quotations.length + 1}`, ...payload });
      return resolve({ data: op === "select" ? s.quotations : null, error: null });
    }
    if (table === "boq_line_rate_review") {
      if (op === "upsert") {
        const prev = s.reviews.find((r) => r.boq_line_id === payload!.boq_line_id);
        s.reviews = s.reviews.filter((r) => r !== prev).concat({ id: "rev-1", ...prev, ...payload });
      }
      return resolve({ data: op === "select" ? s.reviews : null, error: null });
    }
    if (table === "boq_line_dsr_mapping") return resolve({ data: [db.MAPPING], error: null });
    if (table === "boq_line") {
      // Historical searches exclude this BOQ; the BOQ's own lines come by boq_id.
      return resolve({ data: filters["not:boq_id"] ? db.HISTORICAL : db.LINES, error: null });
    }
    if (table === "boq") return resolve({ data: [{ name: "Civil BOQ", project_id: "proj-1" }], error: null });
    if (table === "project_document") return resolve({ data: [{ id: "doc-q", name: "Vendor A quotation.pdf", doc_type: "quotation" }], error: null });
    return resolve({ data: [], error: null });
  };
  return obj;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => chain(t) } }));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1/dsr-mapping"]}>
        <Routes>
          <Route path="/ops/projects/:id/boqs/:boqId/dsr-mapping" element={<BoqDsrMapping />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openLine() {
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Rate comparison" }));
  fireEvent.click(await screen.findByRole("button", { name: /Vitrified floor tiles/ }));
  await screen.findByTestId("evidence-dsr");
}
const forbiddenWrites = () => db.state.writes.filter((w) => w.table === "boq_line" || w.table === "boq_line_dsr_mapping");

beforeEach(() => {
  db.state.evidenceMissing = false;
  db.state.quotations = [];
  db.state.reviews = [];
  db.state.writes = [];
});

describe("BoqDsrMapping — rate comparison", () => {
  it("shows DSR reference, indicative amount and historical rate side by side, with nothing preferred automatically", async () => {
    renderPage();
    await openLine();
    expect(within(screen.getByTestId("evidence-dsr")).getByText("Schedule year 2023")).toBeInTheDocument();
    expect(screen.getByTestId("evidence-indicative")).toHaveTextContent("₹40,000");
    const h = await screen.findByTestId("evidence-h:old-line");
    expect(h).toHaveTextContent("Firm BOQ — Tower A BOQ · Tower A, Vizag");
    expect(h).toHaveTextContent("BOQ last updated 2026-01-15");
    expect(h).toHaveTextContent("Historical — specification not verified against this line");
    expect(screen.getByTestId("preferred-candidate")).toHaveTextContent("None chosen. Nothing is selected automatically.");
    expect(db.state.writes).toHaveLength(0);
  });

  it("records a quotation (linked to a project document) only in vendor_quotation, then compares it like-for-like", async () => {
    renderPage();
    await openLine();
    fireEvent.click(screen.getByRole("button", { name: "Record quotation" }));
    const form = screen.getByRole("form", { name: "Quotation" });
    const set = (label: string, value: string) => fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    set("Vendor name", "Vendor A");
    set("Quoted rate (₹)", "1100");
    set("Quoted unit (BOQ: sqm)", "sqm");
    set("Same scope/spec as the BOQ line?", "matches");
    set("Tax", "excluded");
    set("Quotation date", "2026-09-20");
    set("Source document", "doc-q");
    fireEvent.click(within(form).getByRole("button", { name: "Save quotation" }));

    await waitFor(() => expect(db.state.writes).toHaveLength(1));
    expect(db.state.writes[0]).toMatchObject({
      table: "vendor_quotation", op: "insert",
      payload: {
        boq_line_id: "line-tile", recorded_by: "estimator-1", vendor_name: "Vendor A", quoted_rate: 1100, quoted_unit: "sqm",
        spec_match: "matches", tax_treatment: "excluded", freight: "not_stated", tax_pct: null, valid_until: null,
        quotation_date: "2026-09-20", source_document_id: "doc-q",
      },
    });
    const row = await screen.findByTestId("evidence-q:q-1");
    expect(row).toHaveTextContent("+10%");
    expect(row).toHaveTextContent("Tax excluded");
    expect(forbiddenWrites()).toHaveLength(0);
  });

  it("refuses a received quotation with no rate, instead of saving a made-up value", async () => {
    renderPage();
    await openLine();
    fireEvent.click(screen.getByRole("button", { name: "Record quotation" }));
    const form = screen.getByRole("form", { name: "Quotation" });
    fireEvent.change(within(form).getByLabelText("Vendor name"), { target: { value: "Vendor B" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save quotation" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/needs a rate — record it as incomplete/);
    expect(db.state.writes).toHaveLength(0);
  });

  it("preferring a historical rate snapshots it into the rate review only — not adopted, BOQ untouched", async () => {
    renderPage();
    await openLine();
    const h = await screen.findByTestId("evidence-h:old-line");
    fireEvent.click(within(h).getByRole("button", { name: "Prefer for review" }));

    await waitFor(() => expect(db.state.writes).toHaveLength(1));
    expect(db.state.writes[0]).toMatchObject({
      table: "boq_line_rate_review", op: "upsert",
      payload: {
        boq_line_id: "line-tile", reviewed_by: "estimator-1", preferred_kind: "historical_boq", preferred_boq_line_id: "old-line",
        preferred_rate: 1200, preferred_unit: "sqm", preferred_rate_date: "2026-01-15",
        preferred_source_label: "Firm BOQ — Tower A BOQ · Tower A, Vizag",
      },
    });
    await waitFor(() => expect(screen.getByTestId("preferred-candidate")).toHaveTextContent("Firm BOQ — Tower A BOQ"));
    expect(screen.getByTestId("preferred-candidate")).toHaveTextContent("Not adopted — BOQ rates unchanged");
    expect(forbiddenWrites()).toHaveLength(0);
  });

  it("when the evidence tables aren't migrated, explains it and disables saving, but still shows historical rates", async () => {
    db.state.evidenceMissing = true;
    renderPage();
    await openLine();
    expect(screen.getByText(/20261004000000_boq_line_rate_evidence\.sql has not been applied/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record quotation" })).toBeDisabled();
    const h = await screen.findByTestId("evidence-h:old-line");
    expect(within(h).getByRole("button", { name: "Prefer for review" })).toBeDisabled();
    expect(db.state.writes).toHaveLength(0);
  });
});
