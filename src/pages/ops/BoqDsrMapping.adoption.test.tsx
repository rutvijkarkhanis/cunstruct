// Explicit rate adoption from the Rate comparison tab, against an in-memory
// supabase mock that simulates the guarded boq_line update and records every
// write. Key guarantees: opening/cancelling a preview writes nothing; confirm
// is the only write; it sets ONLY custom_rate and is audited.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import BoqDsrMapping from "./BoqDsrMapping";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "reviewer-1" } }) }));

const db = vi.hoisted(() => {
  const line = () => ({
    id: "line-tile", section: "Finishes", dsr_code: "11.41.2", description: "Vitrified floor tiles", unit: "sqm", qty: 40,
    included: true, quantity_status: "MEASURED", sort: 1, dsr_rate: 900, custom_rate: null as number | null,
  });
  const MAPPING = {
    id: "map-1", boq_id: "boq-1", boq_line_id: "line-tile", status: "mapped", include_in_estimate: false,
    dsr_item_id: "dsr-1", dsr_code: "11.41.2", dsr_description: "Vitrified floor tiles 600x600", dsr_unit: "sqm",
    dsr_rate: 1000, dsr_source: "DSR", dsr_rate_year: "2023", reviewer_note: null, reviewed_by: null, reviewed_at: null,
  };
  const quote = (o: Record<string, unknown>) => ({
    boq_id: "boq-1", boq_line_id: "line-tile", status: "received", vendor_name: "Vendor A", vendor_contact: null,
    quoted_description: "600x600 vitrified, laid", quoted_unit: "sqm", quoted_rate: 1150, spec_match: "matches",
    tax_treatment: "not_stated", tax_pct: null, freight: "included", freight_amount: null, installation: "included",
    installation_amount: null, other_charges: null, quotation_date: "2026-10-01", valid_until: "2026-12-01",
    quotation_ref: "Q-1", source_document_id: null, exclusions: null, conditions: null, notes: null, recorded_by: null, ...o,
  });
  const state = {
    line: line(),
    adoptionMissing: false,
    /** Makes the adopt_boq_line_rate call fail as a whole (e.g. an RLS or constraint error inside it). */
    adoptFails: null as null | string,
    quotations: [] as Record<string, unknown>[],
    adoptions: [] as Record<string, unknown>[],
    writes: [] as { table: string; op: string; payload?: Record<string, unknown> }[],
  };
  return { line, MAPPING, quote, state };
});

function chain(table: string) {
  let op = "select";
  let payload: Record<string, unknown> | undefined;
  const filters: [string, string, unknown][] = [];
  const obj: Record<string, unknown> = {};
  ["select", "order", "limit", "or", "ilike"].forEach((m) => { obj[m] = () => obj; });
  obj.eq = (c: string, v: unknown) => { filters.push(["eq", c, v]); return obj; };
  obj.is = (c: string, v: unknown) => { filters.push(["is", c, v]); return obj; };
  obj.neq = (c: string, v: unknown) => { filters.push(["neq", c, v]); return obj; };
  obj.insert = (p: Record<string, unknown>) => { op = "insert"; payload = p; return obj; };
  obj.upsert = (p: Record<string, unknown>) => { op = "upsert"; payload = p; return obj; };
  obj.update = (p: Record<string, unknown>) => { op = "update"; payload = p; return obj; };
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    const s = db.state;
    if (op !== "select") s.writes.push({ table, op, payload });
    if (table === "boq_line") {
      if (op === "update") {
        const l = s.line as Record<string, unknown>;
        const match = filters.every(([o, c, v]) => (o === "is" ? l[c] == null : l[c] === v));
        if (match) Object.assign(l, payload);
        return resolve({ data: match ? [{ id: l.id }] : [], error: null });
      }
      return resolve({ data: filters.some(([o]) => o === "neq") ? [] : [{ ...s.line }], error: null });
    }
    if (table === "boq_line_rate_adoption") {
      if (s.adoptionMissing) return resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.boq_line_rate_adoption' in the schema cache" } });
      if (op === "insert") s.adoptions.unshift({ id: "a1", confirmed_at: "2026-10-12T09:00:00Z", ...payload });
      return resolve({ data: op === "select" ? s.adoptions : null, error: null });
    }
    if (table === "boq_line_change_log") return resolve({ data: null, error: null });
    if (table === "vendor_quotation") return resolve({ data: s.quotations, error: null });
    if (table === "boq_line_rate_review") return resolve({ data: [], error: null });
    if (table === "boq_line_dsr_mapping") return resolve({ data: [db.MAPPING], error: null });
    if (table === "boq") return resolve({ data: [{ name: "Civil BOQ", project_id: "proj-1" }], error: null });
    return resolve({ data: [], error: null });
  };
  return obj;
}
// Emulates adopt_boq_line_rate (migration 20261005): one transaction — the
// guarded custom_rate update, the change-log row and the adoption record are
// all written, or (on any failure / compare-and-swap miss) none of them.
function adoptRpc(args: { p_line_id: string; p_rate: number; p_expected: Record<string, unknown>; p_record: Record<string, unknown> }) {
  const s = db.state;
  if (s.adoptFails) return Promise.resolve({ data: null, error: { message: s.adoptFails } });
  const l = s.line as Record<string, unknown>;
  const e = args.p_expected;
  if (l.custom_rate !== e.custom_rate || l.dsr_rate !== e.dsr_rate || l.unit !== e.unit) return Promise.resolve({ data: "conflict", error: null });
  l.custom_rate = args.p_rate;
  s.writes.push({ table: "boq_line", op: "update", payload: { custom_rate: args.p_rate } });
  s.writes.push({ table: "boq_line_change_log", op: "insert", payload: {
    boq_id: "boq-1", boq_line_id: args.p_line_id, review_item_id: null, field: "custom_rate",
    old_value: e.custom_rate == null ? null : String(e.custom_rate), new_value: String(args.p_rate), changed_by: "reviewer-1",
  } });
  const record = { ...args.p_record, boq_line_id: args.p_line_id, adopted_rate: args.p_rate, confirmed_by: "reviewer-1" };
  s.writes.push({ table: "boq_line_rate_adoption", op: "insert", payload: record });
  s.adoptions.unshift({ id: "a1", confirmed_at: "2026-10-12T09:00:00Z", ...record });
  return Promise.resolve({ data: "applied", error: null });
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => chain(t),
    rpc: (fn: string, args: Parameters<typeof adoptRpc>[0]) =>
      fn === "adopt_boq_line_rate" ? adoptRpc(args) : Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } }),
  },
}));

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

async function openPreviewFor(evidenceKey: string) {
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Rate comparison" }));
  fireEvent.click(await screen.findByRole("button", { name: /Vitrified floor tiles/ }));
  await screen.findByTestId("commercial-rate");
  const row = await screen.findByTestId(`evidence-${evidenceKey}`);
  fireEvent.click(within(row).getByRole("button", { name: "Adopt…" }));
  return screen.findByRole("region", { name: "Rate adoption preview" });
}
const commercialWrites = () => db.state.writes.filter((w) => w.table !== "boq_line_rate_review" && w.table !== "vendor_quotation");

beforeEach(() => {
  db.state.line = db.line();
  db.state.adoptionMissing = false;
  db.state.adoptFails = null;
  db.state.quotations = [db.quote({ id: "q1" })];
  db.state.adoptions = [];
  db.state.writes = [];
  db.MAPPING.include_in_estimate = false;
});

describe("BoqDsrMapping — explicit rate adoption", () => {
  it("previews current vs proposed, and Cancel discards it with no write", async () => {
    renderPage();
    const preview = await openPreviewFor("q:q1");
    expect(within(preview).getByTestId("adoption-current")).toHaveTextContent("₹900 / sqm");
    expect(within(preview).getByTestId("adoption-current")).toHaveTextContent("DSR rate on the line");
    expect(within(preview).getByTestId("adoption-current")).toHaveTextContent("₹36,000");
    expect(within(preview).getByTestId("adoption-proposed")).toHaveTextContent("₹1,150 / sqm");
    expect(within(preview).getByTestId("adoption-proposed")).toHaveTextContent("₹46,000 (+₹10,000)");
    expect(preview).toHaveTextContent("600x600 vitrified, laid");

    fireEvent.click(within(preview).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Rate adoption preview" })).not.toBeInTheDocument();
    expect(db.state.writes).toHaveLength(0);
    expect(db.state.line.custom_rate).toBeNull();
  });

  it("confirm stays disabled until every caveat is acknowledged; confirming sets only custom_rate and audits it", async () => {
    renderPage();
    const preview = await openPreviewFor("q:q1");
    const confirm = within(preview).getByRole("button", { name: "Confirm and apply rate" });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(preview).getByRole("checkbox", { name: /does not state whether tax is included/ }));
    expect(db.state.writes).toHaveLength(0); // ticking is not a write
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(commercialWrites()).toHaveLength(3));
    expect(commercialWrites()).toEqual([
      { table: "boq_line", op: "update", payload: { custom_rate: 1150 } },
      expect.objectContaining({ table: "boq_line_change_log", op: "insert", payload: expect.objectContaining({ field: "custom_rate", old_value: null, new_value: "1150", changed_by: "reviewer-1" }) }),
      expect.objectContaining({ table: "boq_line_rate_adoption", op: "insert", payload: expect.objectContaining({
        source_kind: "vendor_quotation", source_quotation_id: "q1", previous_rate: 900, previous_basis: "dsr", adopted_rate: 1150,
        acknowledged_caveats: ["The quotation does not state whether tax is included."], confirmed_by: "reviewer-1",
      }) }),
    ]);
    // Quantity, unit and description are untouched.
    expect(db.state.line).toMatchObject({ custom_rate: 1150, qty: 40, unit: "sqm", description: "Vitrified floor tiles", dsr_rate: 900 });
    await waitFor(() => expect(screen.getByTestId("last-adoption")).toHaveTextContent("Last adopted ₹1,150 from Quotation — Vendor A (Q-1)"));
  });

  it("blocks a quotation in an incompatible unit — no confirm, no write", async () => {
    db.state.quotations = [db.quote({ id: "q1", quoted_unit: "box", quoted_rate: 2400 })];
    renderPage();
    const preview = await openPreviewFor("q:q1");
    expect(within(preview).getByRole("list", { name: "Adoption blocked" })).toHaveTextContent(/incompatible with the BOQ line's unit "sqm"/);
    expect(within(preview).getByRole("button", { name: "Confirm and apply rate" })).toBeDisabled();
    expect(db.state.writes).toHaveLength(0);
  });

  it("does not let the indicative estimate be adopted (it has no Adopt action)", async () => {
    db.MAPPING.include_in_estimate = true; // so the estimate prices the line and shows an indicative row
    renderPage();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Rate comparison" }));
    fireEvent.click(await screen.findByRole("button", { name: /Vitrified floor tiles/ }));
    await screen.findByTestId("commercial-rate");
    expect(within(await screen.findByTestId("evidence-indicative")).queryByRole("button", { name: "Adopt…" })).not.toBeInTheDocument();
  });

  it("while the adoption table isn't migrated, preview works but adoption is refused before any write", async () => {
    db.state.adoptionMissing = true;
    renderPage();
    const preview = await openPreviewFor("q:q1");
    fireEvent.click(within(preview).getByRole("checkbox", { name: /does not state whether tax is included/ }));
    expect(within(preview).getByText(/20261005000000_boq_line_rate_adoption\.sql has not been applied/)).toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "Confirm and apply rate" })).toBeDisabled();
    expect(db.state.writes).toHaveLength(0);
  });

  it("if the adoption fails inside the database, nothing is changed — no rate, no audit row, no record", async () => {
    db.state.adoptFails = "new row violates row-level security policy for table \"boq_line_rate_adoption\"";
    renderPage();
    const preview = await openPreviewFor("q:q1");
    fireEvent.click(within(preview).getByRole("checkbox", { name: /does not state whether tax is included/ }));
    fireEvent.click(within(preview).getByRole("button", { name: "Confirm and apply rate" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Rate adoption failed — nothing was changed: new row violates row-level security policy/)));
    expect(db.state.line.custom_rate).toBeNull();
    expect(commercialWrites()).toEqual([]);
    // The preview stays open so the reviewer can see what was not applied.
    expect(screen.getByRole("region", { name: "Rate adoption preview" })).toBeInTheDocument();
  });

  it("a rate changed elsewhere since the preview is not overwritten", async () => {
    renderPage();
    const preview = await openPreviewFor("q:q1");
    fireEvent.click(within(preview).getByRole("checkbox", { name: /does not state whether tax is included/ }));
    db.state.line.custom_rate = 1000; // someone edited the rate after the preview loaded
    fireEvent.click(within(preview).getByRole("button", { name: "Confirm and apply rate" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The line's rate or unit changed since this preview — nothing was written. Review it again."));
    expect(db.state.line.custom_rate).toBe(1000);
    expect(db.state.writes.filter((w) => w.table === "boq_line_change_log" || w.table === "boq_line_rate_adoption")).toHaveLength(0);
  });
});
