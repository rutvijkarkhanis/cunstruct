// Integration: freezing a commercial revision from the BOQ editor sends a
// snapshot of the editor's own lines, and that snapshot exports exactly what
// the live PDF export produces at the same moment. Same harness shape as
// OpsBoqBuilder.exportGuard.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OpsBoqBuilder from "./OpsBoqBuilder";
import { revisionQuotePayload, type RevisionLine, type StoredRevision } from "@/lib/boqRevision";
import type { DsrQuotePayload, QuoteCommercials } from "@/lib/boqDsrDocument";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "issuer-1" } }) }));

const io = vi.hoisted(() => ({ quotes: [] as unknown[], rpc: [] as { fn: string; args: Record<string, unknown> }[], writes: [] as string[] }));
vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return { ...actual, openDsrQuote: (p: unknown) => { io.quotes.push(p); return true; }, downloadCsv: vi.fn() };
});

const fx = vi.hoisted(() => {
  const base = {
    section: "Finishes", dsr_code: "11.41.2", unit: "sqm", dsr_rate: 900, custom_rate: null, cost: null, basis: null,
    basis_note: null, external_key: null, measurement_method: null, quantity_status: "MEASURED", included: true,
    source: "manual", sort: 1, source_document_id: null, source_page: null,
  };
  return {
    BOQ: { id: "boq-1", name: "Civil BOQ", status: "draft", project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null },
    PROJECT: { id: "proj-1", name: "Tower B", area_sqft: null, floors: null, client_name: "ACME", location: "Vizag", project_type: null, scope: null },
    LINES: [
      { ...base, id: "l1", description: "Vitrified tiles", qty: 40 },
      { ...base, id: "l2", description: "Skirting", unit: "rmt", qty: 30, dsr_rate: 250, custom_rate: 280, sort: 2 },
      { ...base, id: "l3", description: "Lift (by client)", qty: 1, included: false, sort: 3 },
    ],
  };
});

function chain(table: string) {
  const obj: Record<string, unknown> = {};
  ["select", "eq", "order", "limit", "in", "or", "neq"].forEach((m) => { obj[m] = () => obj; });
  ["insert", "update", "upsert", "delete"].forEach((m) => { obj[m] = () => { io.writes.push(`${m}:${table}`); return obj; }; });
  obj.single = () => Promise.resolve({ data: table === "boq" ? fx.BOQ : table === "projects" ? fx.PROJECT : null, error: null });
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) =>
    // Copies, like a real database: later edits to fx.LINES are "saved data" the
    // screen hasn't seen until it re-reads.
    resolve({ data: table === "boq_line" ? fx.LINES.map((l) => ({ ...l })) : [], error: null });
  return obj;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => chain(t),
    rpc: (fn: string, args: Record<string, unknown>) => { io.rpc.push({ fn, args }); return Promise.resolve({ data: "rev-1", error: null }); },
  },
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
// Radix menus open by keyboard under jsdom (see OpsBoqBuilder.sourceIndicator.test.tsx).
async function openMenu(name: RegExp) {
  const trigger = (await screen.findAllByRole("button", { name }))[0];
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
}

beforeEach(() => { io.quotes = []; io.rpc = []; io.writes = []; });

describe("OpsBoqBuilder — commercial revisions", () => {
  it("freezes the editor's own lines, and the revision exports exactly what the live PDF export produces", async () => {
    renderBoqBuilder();
    await screen.findByText("Vitrified tiles");

    // Live export first, as the baseline.
    await openMenu(/Export BOQ/i);
    fireEvent.click(await screen.findByRole("menuitem", { name: "PDF" }));
    await waitFor(() => expect(io.quotes).toHaveLength(1));
    const live = io.quotes[0] as DsrQuotePayload;

    await openMenu(/^More$/);
    // The editor's menu items are remounted on every editor re-render
    // (AdminMenuItems is defined inside render), so a found element can be
    // detached by the time it's clicked. Look it up and click it in one
    // synchronous step, retrying until the panel is open.
    await waitFor(() => {
      if (!screen.queryByText(/A revision freezes this BOQ/)) {
        fireEvent.click(screen.getByRole("menuitem", { name: /Commercial revisions/ }));
      }
      expect(screen.getByText(/A revision freezes this BOQ/)).toBeInTheDocument();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Prepare a new revision…" }));
    const region = await screen.findByRole("region", { name: "New revision" });
    fireEvent.click(within(region).getByRole("checkbox"));
    fireEvent.click(within(region).getByRole("button", { name: "Freeze revision" }));
    await waitFor(() => expect(io.rpc).toHaveLength(1));

    const { fn, args } = io.rpc[0];
    expect(fn).toBe("create_boq_commercial_revision");
    const lines = args.p_lines as RevisionLine[];
    expect(lines.map((l) => [l.source_line_id, l.item_no, l.qty, l.unit, l.rate, l.rate_basis, l.amount, l.included])).toEqual([
      ["l1", "1.01", 40, "sqm", 900, "dsr", 36000, true],
      ["l2", "1.02", 30, "rmt", 280, "custom", 8400, true],
      ["l3", "1.03", 1, "sqm", 900, "dsr", null, false],
    ]);
    const header = args.p_header as { commercials: QuoteCommercials; works_total: number; context: { quote: Record<string, unknown> } };
    expect(header.works_total).toBe(36000 + 8400);
    expect(header.context.quote).toMatchObject({ projectName: "Tower B", clientName: "ACME", location: "Vizag" });

    // The saved snapshot reproduces the live document's content.
    const rev = { ...header, id: "rev-1", boq_name: "Civil BOQ", label: "Rev A", issued_at: "2026-10-12T09:00:00Z" } as unknown as StoredRevision;
    const fromRevision = revisionQuotePayload(rev, lines, false);
    expect(fromRevision.subheads).toEqual(live.subheads);
    expect(fromRevision.abstract).toEqual(live.abstract);
    expect(fromRevision.commercials).toEqual(live.commercials);

    // Freezing never wrote the working BOQ.
    expect(io.writes.filter((w) => w.endsWith(":boq_line") || w.endsWith(":boq"))).toEqual([]);
  });

  it("re-reads the saved BOQ at Freeze: a rate saved after Prepare is frozen, not the stale preview", async () => {
    const original = fx.LINES.map((l) => ({ ...l }));
    try {
      renderBoqBuilder();
      await screen.findByText("Vitrified tiles");
      await openMenu(/^More$/);
      await screen.findAllByRole("menuitem");
      await waitFor(() => {
        if (!screen.queryByText(/A revision freezes this BOQ/)) fireEvent.click(screen.getByRole("menuitem", { name: /Commercial revisions/ }));
        expect(screen.getByText(/A revision freezes this BOQ/)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "Prepare a new revision…", hidden: true }));
      let region = await screen.findByRole("region", { name: "New revision", hidden: true });
      fireEvent.click(within(region).getByRole("checkbox", { hidden: true }));

      // The tiles rate is changed and saved after the preview was prepared.
      (fx.LINES[0] as { custom_rate: number | null }).custom_rate = 1150;
      fireEvent.click(within(region).getByRole("button", { name: "Freeze revision", hidden: true }));
      region = await screen.findByRole("region", { name: "New revision", hidden: true });
      await within(region).findByText(/The BOQ changed after you prepared this revision/);
      expect(io.rpc).toHaveLength(0);

      fireEvent.click(within(region).getByRole("checkbox", { hidden: true }));
      fireEvent.click(within(region).getByRole("button", { name: "Freeze revision", hidden: true }));
      await waitFor(() => expect(io.rpc).toHaveLength(1));
      const lines = io.rpc[0].args.p_lines as RevisionLine[];
      expect(lines[0]).toMatchObject({ source_line_id: "l1", rate: 1150, rate_basis: "custom", amount: 46000 });
      expect((io.rpc[0].args.p_header as { works_total: number }).works_total).toBe(46000 + 8400);
    } finally {
      fx.LINES.splice(0, fx.LINES.length, ...original);
    }
  });
});

