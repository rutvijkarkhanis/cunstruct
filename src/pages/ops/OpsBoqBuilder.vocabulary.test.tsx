// Rate-source wording in the BOQ editor (charter §3.5, vocabulary): a line
// with no DSR code is labelled "No DSR code". It is never labelled "Priced
// separately", which would imply a commercial decision the data does not record.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OpsBoqBuilder from "./OpsBoqBuilder";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const LINE = {
  section: "Finishes", unit: "sqm", qty: 40, cost: null, basis: null, basis_note: null, external_key: null,
  measurement_method: null, quantity_status: "MEASURED", included: true, source: "manual", source_document_id: null, source_page: null,
};
const LINES = [
  { ...LINE, id: "l1", sort: 1, dsr_code: "11.41.2", description: "Vitrified tiles", dsr_rate: 900, custom_rate: null },
  { ...LINE, id: "l2", sort: 2, dsr_code: null, description: "Custom skirting", dsr_rate: null, custom_rate: 250 },
  { ...LINE, id: "l3", sort: 3, dsr_code: null, description: "Unpriced item", dsr_rate: null, custom_rate: null },
];

function chain(table: string) {
  const obj: Record<string, unknown> = {};
  ["select", "order", "limit", "in", "or", "neq", "eq", "is"].forEach((m) => { obj[m] = () => obj; });
  obj.single = () => Promise.resolve({
    data: table === "boq" ? { id: "boq-1", name: "Civil BOQ", status: "draft", project_id: "proj-1", spec: {}, discipline: "civil", contractor_id: null }
      : table === "projects" ? { id: "proj-1", name: "Tower B" } : null,
    error: null,
  });
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => resolve({ data: table === "boq_line" ? LINES : [], error: null });
  return obj;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: null, error: null }) },
}));

describe("BOQ editor rate-source wording", () => {
  it("labels lines without a DSR code 'No DSR code', never 'Priced separately'", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/ops/projects/proj-1/boqs/boq-1"]}>
          <Routes><Route path="/ops/projects/:id/boqs/:boqId" element={<OpsBoqBuilder />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Both uncoded lines (one with an own rate, one with no rate at all) carry the explicit label.
    expect(await screen.findAllByText("No DSR code")).toHaveLength(2);
    expect(screen.getAllByText("11.41.2").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Priced separately/)).toBeNull();
  });
});
