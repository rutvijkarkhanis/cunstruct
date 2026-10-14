// The combined client quote (shareQuote → openProjectQuote) applies the same
// quantity rule as every other export: measured lines are priced; included
// lines with no established quantity are listed under their BOQ as pending —
// never priced, never a Qty of 0, never silently dropped. Excluded lines stay
// out. Same harness shape as ProjectBoqs.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import ProjectBoqs from "./ProjectBoqs";
import { buildProjectQuoteHtml, computeCommercials, type ProjectQuoteBoq } from "@/lib/boqDsrDocument";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const spy = vi.hoisted(() => vi.fn((..._args: unknown[]) => true));
vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return { ...actual, openProjectQuote: (...args: Parameters<typeof actual.openProjectQuote>) => spy(...args) };
});

const fx = vi.hoisted(() => ({
  BOQS: [
    { id: "boq-1", name: "Floor 1", description: null, scope_id: null, sort: 0, status: "active", spec: {}, discipline: "civil" },
    { id: "boq-2", name: "Terrace", description: null, scope_id: null, sort: 1, status: "active", spec: {}, discipline: "civil" },
  ],
  lines: [] as Record<string, unknown>[],
}));
const ln = (o: Record<string, unknown>) => ({
  boq_id: "boq-1", section: "Finishes", dsr_code: "11.1", unit: "sqm", qty: 10, quantity_status: "MEASURED", dsr_rate: 100, custom_rate: null,
  included: true, sort: 1, source_document_id: null, source_page: null, ...o,
});

vi.mock("@/integrations/supabase/client", () => {
  const chain = (resolveWith: (usedIn: boolean) => { data: unknown; error: unknown; count?: number }) => {
    const obj: Record<string, unknown> = {};
    let usedIn = false;
    ["select", "eq", "order", "or"].forEach((m) => { obj[m] = () => obj; });
    obj.in = () => { usedIn = true; return obj; };
    obj.single = () => obj;
    (obj as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(resolveWith(usedIn));
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "projects") return chain(() => ({ data: { name: "Tower B", client_name: "ACME" }, error: null }));
        if (table === "boq") return chain((usedIn) => ({ data: usedIn ? fx.BOQS.map((b) => ({ id: b.id, spec: b.spec })) : fx.BOQS, error: null }));
        if (table === "boq_line") return chain((usedIn) => (usedIn ? { data: fx.lines, error: null } : { data: null, error: null, count: 0 }));
        return chain(() => ({ data: [], error: null }));
      },
    },
  };
});

function renderProjectBoqs() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/manage"]}>
        <Routes><Route path="/ops/projects/:id/boqs/manage" element={<ProjectBoqs />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function share(): Promise<ProjectQuoteBoq[]> {
  fireEvent.click(await screen.findByRole("button", { name: /share with client/i }));
  fireEvent.click(await screen.findByRole("button", { name: /for approval/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  return spy.mock.calls[0][1] as ProjectQuoteBoq[];
}

beforeEach(() => { spy.mockClear(); vi.mocked(toast.error).mockClear(); });

describe("combined quote — pending scope", () => {
  it("measured lines are priced; pending lines are listed as pending with their reason; excluded lines are absent", async () => {
    fx.lines = [
      ln({ description: "Tiles", qty: 40 }),                                                       // 4,000
      ln({ description: "Plaster", qty: 0, quantity_status: "PENDING", sort: 2 }),
      ln({ description: "Paint", qty: 12, quantity_status: "PENDING", sort: 3 }),                   // typed, not confirmed
      ln({ description: "Skirting (none required)", qty: 0, quantity_status: "MEASURED", sort: 4 }), // verified zero
      ln({ description: "Lift (by client)", qty: 1, included: false, sort: 5 }),
    ];
    renderProjectBoqs();
    const [b] = await share();
    expect(b.subheads.flatMap((s) => s.lines.map((l) => [l.spec, l.qty, l.amount]))).toEqual([["Tiles", 40, 4000], ["Skirting (none required)", 0, 0]]);
    expect(b.commercials.works).toBe(4000); // Paint's 12 × 100 is not priced
    expect(b.pendingItems!.map((p) => [p.no, p.spec, p.note])).toEqual([
      ["P.01", "Plaster", "Quantity pending: not yet measured"],
      ["P.02", "Paint", "Quantity pending: still marked pending; the entered 12 sqm has not been confirmed"],
    ]);
  });

  it("a BOQ whose included lines are all pending is shared with its pending list, not skipped", async () => {
    fx.lines = [ln({ description: "Tiles", qty: 40 }), ln({ boq_id: "boq-2", description: "Waterproofing", qty: 0, quantity_status: "PENDING" })];
    renderProjectBoqs();
    const boqs = await share();
    expect(boqs.map((b) => [b.name, b.subheads.length, b.pendingItems!.map((p) => p.spec)])).toEqual([["Floor 1", 1, []], ["Terrace", 0, ["Waterproofing"]]]);
    expect(boqs[1].commercials.works).toBe(0);
  });

  it("nothing included anywhere: still refused", async () => {
    fx.lines = [ln({ description: "Tiles", included: false })];
    renderProjectBoqs();
    fireEvent.click(await screen.findByRole("button", { name: /share with client/i }));
    fireEvent.click(await screen.findByRole("button", { name: /for approval/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("combined quote renderer", () => {
  const boq = (pendingItems?: ProjectQuoteBoq["pendingItems"]): ProjectQuoteBoq => ({
    name: "Floor 1", subheads: [], pendingItems,
    commercials: computeCommercials(0, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 0 }),
  });
  it("renders each pending item with 'pending' for Qty, its reason and source", () => {
    const html = buildProjectQuoteHtml({ projectName: "Tower B", generatedOn: "today", branding: "firm" },
      [boq([{ no: "P.01", spec: "Plaster", unit: "sqm", note: "Quantity pending: not yet measured", sourceDocument: "Plan", sourcePage: "2" }])], { autoPrint: false });
    expect(html).toContain('<td class="spec">Plaster<span class="pnote"> — Quantity pending: not yet measured</span><span class="srcref"> · Plan, p.2</span></td>');
    expect((html.match(/class="num pend">pending</g) ?? []).length).toBe(1);
  });
  it("a BOQ without pendingItems renders exactly as before (no pending table)", () => {
    const html = buildProjectQuoteHtml({ projectName: "Tower B", generatedOn: "today", branding: "firm" }, [boq()], { autoPrint: false });
    expect(html).not.toContain('<table class="pending">');
  });
});
