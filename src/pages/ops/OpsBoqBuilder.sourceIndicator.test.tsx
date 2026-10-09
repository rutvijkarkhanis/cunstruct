// Scope D — surfaces Scope C's persisted boq_line.source_document_id/
// source_page back to the ops user in the BOQ editor. These tests are
// deliberately separate from OpsBoqBuilder.test.tsx (which covers the
// mobile-nav breadcrumb) so this feature's own supabase fixtures — real
// boq_line rows with source_* columns, plus project_document/document_revision
// for loadProjectDrawings — don't have to be threaded through an unrelated
// suite's shared mock.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OpsBoqBuilder from "./OpsBoqBuilder";

const fixtures = vi.hoisted(() => {
  const BOQ_ROW = {
    id: "boq-1", name: "Elevation & Facade", status: "draft",
    project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null,
  };
  const PROJECT_ROW = {
    id: "proj-1", name: "Srikakulam Apartment", area_sqft: null, floors: null,
    client_name: null, location: null, project_type: null, scope: null,
  };
  const DOCS = [{ id: "doc-1", name: "Ground Floor Plan", current_revision_id: "rev-1" }];
  const REVISIONS = [{
    id: "rev-1", document_id: "doc-1", file_path: "proj-1/doc-1/rev-1.pdf",
    original_filename: "ground-floor.pdf", page_count: 5, page_titles: null,
  }];
  const baseLine = {
    section: "Foundation", dsr_code: "2.1", unit: "cum", dsr_rate: 100, custom_rate: null,
    cost: null, basis: null, basis_note: null, external_key: null, measurement_method: null,
    quantity_status: null, included: true, source: "manual", sort: 1,
  };
  const LINES_WITH_SOURCE = [
    { ...baseLine, id: "line-resolved", description: "RCC footing — resolved source", qty: 10, source_document_id: "doc-1", source_page: "3" },
    { ...baseLine, id: "line-unresolved", description: "Brickwork — unresolved source", qty: 5, source_document_id: "doc-missing", source_page: null },
    { ...baseLine, id: "line-none", description: "Plaster — no source", qty: 8, source_document_id: null, source_page: null },
  ];
  // The column-fallback scenario: a stale deployment's boq_line genuinely has
  // no source_document_id/source_page columns at all — not merely null values.
  const LINES_NO_SOURCE_COLS = LINES_WITH_SOURCE.map(({ source_document_id, source_page, ...rest }) => rest);

  const state = { missingSourceCols: false, calls: [] as { table: string; op: string; payload?: unknown }[] };
  return { BOQ_ROW, PROJECT_ROW, DOCS, REVISIONS, LINES_WITH_SOURCE, LINES_NO_SOURCE_COLS, state };
});

function chain(table: string) {
  let selectedCols = "";
  const obj: Record<string, unknown> = {};
  obj.select = (cols?: string) => { selectedCols = cols ?? ""; return obj; };
  obj.update = (patch: unknown) => { fixtures.state.calls.push({ table, op: "update", payload: patch }); return obj; };
  ["eq", "order", "limit", "in", "or", "neq"].forEach((m) => { obj[m] = () => obj; });
  obj.single = () => {
    if (table === "boq") return Promise.resolve({ data: fixtures.BOQ_ROW, error: null });
    if (table === "projects") return Promise.resolve({ data: fixtures.PROJECT_ROW, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    if (table === "boq_line") {
      if (fixtures.state.missingSourceCols && selectedCols.includes("source_document_id")) {
        return resolve({ data: null, error: { message: "column boq_line.source_document_id does not exist" } });
      }
      const rows = fixtures.state.missingSourceCols ? fixtures.LINES_NO_SOURCE_COLS : fixtures.LINES_WITH_SOURCE;
      return resolve({ data: rows, error: null });
    }
    if (table === "project_document") return resolve({ data: fixtures.DOCS, error: null });
    if (table === "document_revision") return resolve({ data: fixtures.REVISIONS, error: null });
    return resolve({ data: [], error: null });
  };
  return obj;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain(table) },
}));

function renderBoqBuilder() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
        <Routes>
          <Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fixtures.state.missingSourceCols = false;
  fixtures.state.calls = [];
});

describe("OpsBoqBuilder — drawing-source indicator (Scope D)", () => {
  it("shows the actual resolved document name and page for a line with a valid source", async () => {
    renderBoqBuilder();
    const badge = await screen.findByTitle("Sourced from Ground Floor Plan, page 3");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain("Ground Floor Plan");
    expect(badge.textContent).toContain("p.3");
  });

  it("shows no source indicator at all for a line with no source_document_id", async () => {
    renderBoqBuilder();
    await screen.findByText("Plaster — no source");
    // Exactly the two source-bearing lines produce a badge; the third never does.
    expect(screen.getAllByTitle(/^Sourced from|source drawing could not be resolved$/)).toHaveLength(2);
  });

  it("never fabricates a document name for an unresolved source_document_id", async () => {
    renderBoqBuilder();
    const unresolved = await screen.findByText("Source document unavailable");
    expect(unresolved).toBeInTheDocument();
    // The raw, unresolved id must never leak into the UI as a stand-in label.
    expect(screen.queryByText("doc-missing")).not.toBeInTheDocument();
  });

  it("falls back gracefully when source_document_id/source_page columns are missing, without breaking the editor", async () => {
    fixtures.state.missingSourceCols = true;
    renderBoqBuilder();
    // The builder still renders real lines via the fallback select.
    await screen.findByText("RCC footing — resolved source");
    await screen.findByText("Brickwork — unresolved source");
    // But with no source columns at all, no source badge of either kind appears.
    expect(screen.queryByTitle(/^Sourced from/)).not.toBeInTheDocument();
    expect(screen.queryByText("Source document unavailable")).not.toBeInTheDocument();
  });

  it("leaves existing line-editing/persistence behavior unchanged", async () => {
    renderBoqBuilder();
    await screen.findByText("Plaster — no source");
    const checkboxes = screen.getAllByRole("checkbox");
    const plasterCheckbox = checkboxes.find((cb) => (cb as HTMLInputElement).checked) as HTMLInputElement;
    fireEvent.click(plasterCheckbox);
    await waitFor(() => {
      const updateCall = fixtures.state.calls.find((c) => c.table === "boq_line" && c.op === "update");
      expect(updateCall).toBeTruthy();
      expect((updateCall!.payload as Record<string, unknown>).included).toBe(false);
    });
  });
});
