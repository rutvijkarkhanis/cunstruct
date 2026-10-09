// Scope H follow-up — the combined multi-BOQ client export (shareQuote →
// openProjectQuote) previously built QuoteItems with no sourceDocument/
// sourcePage at all, even though buildProjectQuoteHtml() already renders
// them (it shares boqDsrDocument.ts's srcRef() helper with the single-BOQ
// export). These tests exercise the ACTUAL combined-export data flow —
// rendering the real page, clicking through to Share, and inspecting what
// openProjectQuote was actually called with — not just the renderer (that's
// boqDsrDocument.test.ts's job).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProjectBoqs from "./ProjectBoqs";
import type { ProjectQuoteBoq, QuoteItem } from "@/lib/boqDsrDocument";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

// Scope H follow-up — same technique OpsBoqBuilder.sourceIndicator.test.tsx
// uses: openProjectQuote is replaced (it calls window.open, which jsdom
// doesn't need to exercise here) but buildProjectQuoteHtml/computeCommercials/
// roundRupee stay real, via importActual, so nothing about the renderer or
// the commercial math is stubbed out from under this test.
const openProjectQuoteSpy = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return { ...actual, openProjectQuote: (...args: Parameters<typeof actual.openProjectQuote>) => openProjectQuoteSpy(...args) };
});

const fixtures = vi.hoisted(() => {
  const PROJECT_ROW = { name: "Srikakulam Apartment", client_name: "Dr. Sandeep", location: null, project_type: null, floors: null, area_sqft: null };
  const BOQS = [
    { id: "boq-1", name: "Floor 1", description: null, scope_id: null, sort: 0, status: "active", spec: {}, discipline: "civil" },
    { id: "boq-2", name: "Terrace", description: null, scope_id: null, sort: 1, status: "active", spec: {}, discipline: "civil" },
  ];
  const LINES = [
    // boq-1 — resolved source: doc-1 exists in THIS project's project_document result.
    { boq_id: "boq-1", section: "RCC", dsr_code: "4.1", description: "RCC footing", unit: "cum", qty: 10, dsr_rate: 100, custom_rate: null, included: true, sort: 1, source_document_id: "doc-1", source_page: "3" },
    // boq-2 — unresolved source: doc-missing is a REAL document, but it belongs to a
    // DIFFERENT project (see project_document mock below) — never resolvable here.
    { boq_id: "boq-2", section: "Brick", dsr_code: "5.1", description: "Brickwork", unit: "cum", qty: 5, dsr_rate: 200, custom_rate: null, included: true, sort: 1, source_document_id: "doc-missing", source_page: null },
    // boq-2 — no provenance at all.
    { boq_id: "boq-2", section: "Brick", dsr_code: "5.2", description: "Plaster", unit: "sqm", qty: 8, dsr_rate: 50, custom_rate: null, included: true, sort: 2, source_document_id: null, source_page: null },
  ];
  // doc-1 belongs to proj-1 (the project under test); doc-missing belongs to a
  // different project ("proj-b") entirely — present in the overall fixture data
  // so a resolution bug that ignores project scoping would have something real
  // to wrongly match against.
  const PROJECT_A_DOCS = [{ id: "doc-1", name: "Floor 1 Plan", current_revision_id: "rev-1" }];
  const PROJECT_B_DOCS = [{ id: "doc-missing", name: "Should never resolve for proj-1", current_revision_id: null }];
  const REVISIONS = [{ id: "rev-1", document_id: "doc-1", file_path: "proj-1/doc-1/rev-1.pdf", original_filename: "floor1.pdf", page_count: 5, page_titles: null }];

  const state = { holdDrawings: false, projectDocumentEqCalls: [] as { col: string; val: unknown }[] };
  return { PROJECT_ROW, BOQS, LINES, PROJECT_A_DOCS, PROJECT_B_DOCS, REVISIONS, state };
});

vi.mock("@/integrations/supabase/client", () => {
  const simpleChain = (resolveWith: () => { data: unknown; error: unknown }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order", "in", "or"].forEach((m) => { obj[m] = () => obj; });
    obj.single = () => obj;
    (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: unknown }) => void) => resolve(resolveWith());
    return obj;
  };

  return {
    supabase: {
      from: (table: string) => {
        if (table === "projects") return simpleChain(() => ({ data: fixtures.PROJECT_ROW, error: null }));
        if (table === "project_scope") return simpleChain(() => ({ data: [], error: null }));

        // useBoqManagement's own list query (no `.in`) vs. shareQuote's `.select("id, spec").in(...)`.
        if (table === "boq") {
          const obj: Record<string, unknown> = {};
          let usedIn = false;
          obj.select = () => obj;
          obj.eq = () => obj;
          obj.order = () => obj;
          obj.in = () => { usedIn = true; return obj; };
          (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) =>
            resolve({ data: usedIn ? fixtures.BOQS.map((b) => ({ id: b.id, spec: b.spec })) : fixtures.BOQS, error: null });
          return obj;
        }

        // useBoqManagement's per-BOQ count query (`.eq("boq_id", id)`, no `.in`) vs.
        // shareQuote's own full line select (`.in("boq_id", ids)`).
        if (table === "boq_line") {
          const obj: Record<string, unknown> = {};
          let usedIn = false;
          obj.select = () => obj;
          obj.eq = () => obj;
          obj.order = () => obj;
          obj.in = () => { usedIn = true; return obj; };
          (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null; count?: number }) => void) =>
            usedIn ? resolve({ data: fixtures.LINES, error: null }) : resolve({ data: null, error: null, count: 0 });
          return obj;
        }

        if (table === "project_document") {
          const obj: Record<string, unknown> = {};
          let filterProjectId: unknown;
          obj.select = () => obj;
          obj.eq = (col: string, val: unknown) => {
            if (col === "project_id") { filterProjectId = val; fixtures.state.projectDocumentEqCalls.push({ col, val }); }
            return obj;
          };
          (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
            if (fixtures.state.holdDrawings) return; // never resolves — simulates still-loading
            // Real project_id scoping: only proj-1's own documents come back for proj-1.
            resolve({ data: filterProjectId === "proj-b" ? fixtures.PROJECT_B_DOCS : fixtures.PROJECT_A_DOCS, error: null });
          };
          return obj;
        }
        if (table === "document_revision") return simpleChain(() => ({ data: fixtures.REVISIONS, error: null }));

        return simpleChain(() => ({ data: [], error: null }));
      },
    },
  };
});

function renderProjectBoqs() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/manage"]}>
        <Routes>
          <Route path="/ops/projects/:id/boqs/manage" element={<ProjectBoqs />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Opens the "Share with client" panel and clicks the given branding button —
// the only way to reach shareQuote(), a local closure with no exported handle.
async function shareAs(branding: "firm" | "client") {
  fireEvent.click(await screen.findByRole("button", { name: /share with client/i }));
  const label = branding === "firm" ? /for approval/i : /final — client's name/i;
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

beforeEach(() => {
  openProjectQuoteSpy.mockClear();
  fixtures.state.holdDrawings = false;
  fixtures.state.projectDocumentEqCalls = [];
});

describe("ProjectBoqs — combined multi-BOQ export source references (Scope H follow-up)", () => {
  it("resolved source: the combined PDF payload carries the correct document name and page", async () => {
    renderProjectBoqs();
    await shareAs("firm");
    await waitFor(() => expect(openProjectQuoteSpy).toHaveBeenCalledTimes(1));
    const quoteBoqs = openProjectQuoteSpy.mock.calls[0][1] as ProjectQuoteBoq[];
    const items = quoteBoqs.flatMap((b) => b.subheads.flatMap((sh) => sh.lines));
    const item = items.find((l) => l.spec === "RCC footing");
    expect(item).toMatchObject({ sourceDocument: "Floor 1 Plan", sourcePage: "3" });
  });

  it("unresolved source: a cross-project document id never resolves — 'Source document unavailable', no page", async () => {
    renderProjectBoqs();
    await shareAs("firm");
    await waitFor(() => expect(openProjectQuoteSpy).toHaveBeenCalledTimes(1));
    const quoteBoqs = openProjectQuoteSpy.mock.calls[0][1] as ProjectQuoteBoq[];
    const items = quoteBoqs.flatMap((b) => b.subheads.flatMap((sh) => sh.lines));
    const item = items.find((l) => l.spec === "Brickwork");
    expect(item?.sourceDocument).toBe("Source document unavailable");
    expect(item?.sourcePage).toBeFalsy();
  });

  it("absent provenance: a line with no source_document_id has no source annotation", async () => {
    renderProjectBoqs();
    await shareAs("firm");
    await waitFor(() => expect(openProjectQuoteSpy).toHaveBeenCalledTimes(1));
    const quoteBoqs = openProjectQuoteSpy.mock.calls[0][1] as ProjectQuoteBoq[];
    const items = quoteBoqs.flatMap((b) => b.subheads.flatMap((sh) => sh.lines));
    const item = items.find((l) => l.spec === "Plaster");
    expect(item?.sourceDocument).toBeFalsy();
    expect(item?.sourcePage).toBeFalsy();
  });

  it("loading state: while drawings are still loading, the export never prematurely shows 'unavailable'", async () => {
    fixtures.state.holdDrawings = true;
    renderProjectBoqs();
    await shareAs("firm");
    await waitFor(() => expect(openProjectQuoteSpy).toHaveBeenCalledTimes(1));
    const quoteBoqs = openProjectQuoteSpy.mock.calls[0][1] as ProjectQuoteBoq[];
    const items = quoteBoqs.flatMap((b) => b.subheads.flatMap((sh) => sh.lines));
    const item = items.find((l) => l.spec === "Brickwork");
    expect(item?.sourceDocument).not.toBe("Source document unavailable");
    expect(item?.sourceDocument).toBeFalsy();
  });

  it("project scoping: project_document is queried filtered to THIS project only, never an unscoped read", async () => {
    renderProjectBoqs();
    await shareAs("firm");
    await waitFor(() => expect(openProjectQuoteSpy).toHaveBeenCalledTimes(1));
    expect(fixtures.state.projectDocumentEqCalls).toEqual([{ col: "project_id", val: "proj-1" }]);
  });

  it("both branding variants receive identical resolved source information", async () => {
    renderProjectBoqs();
    await shareAs("firm");
    await waitFor(() => expect(openProjectQuoteSpy).toHaveBeenCalledTimes(1));
    const firmItems = (openProjectQuoteSpy.mock.calls[0][1] as ProjectQuoteBoq[]).flatMap((b) => b.subheads.flatMap((sh) => sh.lines));

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    await shareAs("client");
    await waitFor(() => expect(openProjectQuoteSpy).toHaveBeenCalledTimes(2));
    const clientItems = (openProjectQuoteSpy.mock.calls[1][1] as ProjectQuoteBoq[]).flatMap((b) => b.subheads.flatMap((sh) => sh.lines));

    const pick = (items: QuoteItem[], spec: string) => ({ sourceDocument: items.find((l) => l.spec === spec)?.sourceDocument, sourcePage: items.find((l) => l.spec === spec)?.sourcePage });
    expect(pick(firmItems, "RCC footing")).toEqual(pick(clientItems, "RCC footing"));
    expect(pick(firmItems, "Brickwork")).toEqual(pick(clientItems, "Brickwork"));
  });

  it("commercial invariants: qty/unit/rate/amount and the grand total are unaffected by source resolution", async () => {
    renderProjectBoqs();
    await shareAs("firm");
    await waitFor(() => expect(openProjectQuoteSpy).toHaveBeenCalledTimes(1));
    const quoteBoqs = openProjectQuoteSpy.mock.calls[0][1] as ProjectQuoteBoq[];
    const floor1 = quoteBoqs.find((b) => b.name === "Floor 1")!;
    const rccItem = floor1.subheads.flatMap((sh) => sh.lines).find((l) => l.spec === "RCC footing");
    expect(rccItem).toMatchObject({ qty: 10, unit: "cum", rate: 100, amount: 1000 });
    expect(floor1.commercials.works).toBe(1000);

    const terrace = quoteBoqs.find((b) => b.name === "Terrace")!;
    // Brickwork (5 * 200 = 1000) + Plaster (8 * 50 = 400) = 1400 works.
    expect(terrace.commercials.works).toBe(1400);
  });
});
