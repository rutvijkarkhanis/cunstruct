// Commercial revisions panel: freezing goes only through the RPC, after the
// limitations are acknowledged; exporting a saved revision uses its own saved
// rows — never the working BOQ.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import BoqRevisionsPanel, { type RevisionDraftSource } from "./BoqRevisionsPanel";
import { buildRevisionLines, type WorkingLine } from "@/lib/boqRevision";
import { computeCommercials } from "@/lib/boqDsrDocument";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "issuer-1" } }) }));

const io = vi.hoisted(() => ({
  revisionsMissing: false,
  revisions: [] as Record<string, unknown>[],
  revisionLines: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcError: null as null | { message: string },
  writes: [] as string[],
  quotes: [] as unknown[],
  csv: [] as string[],
}));
vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return { ...actual, openDsrQuote: (p: unknown) => { io.quotes.push(p); return true; }, downloadCsv: (_n: string, body: string) => { io.csv.push(body); } };
});
function chain(table: string) {
  const obj: Record<string, unknown> = {};
  ["select", "eq", "order", "limit"].forEach((m) => { obj[m] = () => obj; });
  ["insert", "update", "upsert", "delete"].forEach((m) => { obj[m] = () => { io.writes.push(`${m}:${table}`); return obj; }; });
  obj.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
    if (table === "boq_commercial_revision") {
      return io.revisionsMissing
        ? resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.boq_commercial_revision' in the schema cache" } })
        : resolve({ data: io.revisions, error: null });
    }
    if (table === "boq_commercial_revision_line") return resolve({ data: io.revisionLines, error: null });
    if (table === "boq_line_rate_adoption") return resolve({ data: [], error: null });
    return resolve({ data: [], error: null });
  };
  return obj;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => chain(t),
    rpc: (fn: string, args: Record<string, unknown>) => {
      io.rpcCalls.push({ fn, args });
      if (io.rpcError) return Promise.resolve({ data: null, error: io.rpcError });
      io.revisions = [{ ...SAVED, id: "rev-2", revision_no: 2, label: "Rev B" }, ...io.revisions];
      return Promise.resolve({ data: "rev-2", error: null });
    },
  },
}));

const line = (o: Partial<WorkingLine> & { id: string }): WorkingLine => ({
  section: "Finishes", dsr_code: "11.41.2", description: "Vitrified tiles", unit: "sqm", qty: 40, dsr_rate: 900, custom_rate: null, included: true, ...o,
});
const COMMERCIALS = computeCommercials(36000, { costIndexPct: 0, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18 });
const SAVED = {
  id: "rev-1", boq_id: "boq-1", project_id: "proj-1", boq_name: "Civil BOQ", project_name: "Tower B", revision_no: 1, label: "Rev A",
  boq_status_at_issue: "draft", discipline: "civil", rate_year: "2023", context: { quote: { projectName: "Tower B" } },
  commercials: COMMERCIALS, works_total: 36000, grand_total: COMMERCIALS.grandTotal, line_count: 1, priced_line_count: 1,
  limitations: [{ code: "boq_status", count: 1, message: "draft" }], limitations_acknowledged: true, issue_note: "For client review",
  issued_by: "issuer-1", issued_at: "2026-10-12T09:00:00Z",
};

function source(o: Partial<WorkingLine> = {}): RevisionDraftSource & { build: ReturnType<typeof vi.fn> } {
  return {
    boqStatus: "draft",
    workingGrandTotal: COMMERCIALS.grandTotal,
    build: vi.fn(() => {
      const lines = buildRevisionLines([{ no: 1, name: "Finishes", rows: [{ line: line({ id: "l1", ...o }), no: "1.01", source: { sourceDocument: null, sourcePage: null } }] }]);
      return { lines, header: { boq_name: "Civil BOQ", project_name: "Tower B", context: {}, commercials: COMMERCIALS, works_total: 36000, grand_total: COMMERCIALS.grandTotal, priced_line_count: 1 } };
    }),
  };
}
const renderPanel = (src = source()) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BoqRevisionsPanel boqId="boq-1" source={src} /></QueryClientProvider>);

beforeEach(() => {
  io.revisionsMissing = false; io.rpcError = null; io.revisions = []; io.revisionLines = []; io.rpcCalls = []; io.writes = []; io.quotes = []; io.csv = [];
});

describe("BoqRevisionsPanel — freezing", () => {
  it("shows the draft's status and limitations, requires acknowledgement, and Cancel writes nothing", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Prepare a new revision…" }));
    const region = await screen.findByRole("region", { name: "New revision" });
    expect(within(region).getByRole("list", { name: "Revision limitations" })).toHaveTextContent('status is "draft", not finalized');
    expect(within(region).getByRole("list", { name: "Revision limitations" })).toHaveTextContent("1 included line(s) are priced at the DSR rate on the line");
    expect(within(region).getByRole("button", { name: "Freeze revision" })).toBeDisabled();
    fireEvent.click(within(region).getByRole("button", { name: "Cancel" }));
    expect(io.rpcCalls).toHaveLength(0);
    expect(io.writes).toHaveLength(0);
  });

  it("freezes only through the RPC, with the acknowledged limitations and note, and never writes the working BOQ", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Prepare a new revision…" }));
    const region = await screen.findByRole("region", { name: "New revision" });
    fireEvent.click(within(region).getByRole("checkbox"));
    fireEvent.change(within(region).getByPlaceholderText(/Purpose of this revision/), { target: { value: "Issued for client review" } });
    fireEvent.click(within(region).getByRole("button", { name: "Freeze revision" }));

    await waitFor(() => expect(io.rpcCalls).toHaveLength(1));
    const { fn, args } = io.rpcCalls[0];
    expect(fn).toBe("create_boq_commercial_revision");
    expect(args.p_boq_id).toBe("boq-1");
    expect(args.p_header).toMatchObject({ boq_name: "Civil BOQ", limitations_acknowledged: true, issue_note: "Issued for client review", grand_total: COMMERCIALS.grandTotal });
    expect((args.p_header as { limitations: { code: string }[] }).limitations.map((l) => l.code)).toEqual(["boq_status", "dsr_on_line"]);
    expect(args.p_lines).toEqual([expect.objectContaining({ source_line_id: "l1", item_no: "1.01", qty: 40, unit: "sqm", rate: 900, rate_basis: "dsr", amount: 36000 })]);
    expect(io.writes).toHaveLength(0);
    expect(await screen.findByTestId("revision-Rev B")).toBeInTheDocument();
  });

  it("never freezes a stale preview: if the BOQ changed after Prepare, it refreshes the preview and asks again", async () => {
    const src = source();
    renderPanel(src);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare a new revision…" }));
    let region = await screen.findByRole("region", { name: "New revision" });
    fireEvent.click(within(region).getByRole("checkbox"));

    // Meanwhile the working BOQ's rate is edited and saved.
    const changed = source({ custom_rate: 1150 }).build();
    src.build.mockImplementation(() => changed);
    fireEvent.click(within(region).getByRole("button", { name: "Freeze revision" }));

    region = await screen.findByRole("region", { name: "New revision" });
    expect(await within(region).findByRole("alert")).toHaveTextContent("The BOQ changed after you prepared this revision, so nothing was frozen.");
    expect(io.rpcCalls).toHaveLength(0);
    // The acknowledgement is reset for the new figures.
    expect(within(region).getByRole("button", { name: "Freeze revision" })).toBeDisabled();

    fireEvent.click(within(region).getByRole("checkbox"));
    fireEvent.click(within(region).getByRole("button", { name: "Freeze revision" }));
    await waitFor(() => expect(io.rpcCalls).toHaveLength(1));
    expect(io.rpcCalls[0].args.p_lines).toEqual([expect.objectContaining({ rate: 1150, rate_basis: "custom", amount: 46000 })]);
  });

  it("if the database rejects the snapshot as stale, says so, freezes nothing and keeps the preview open", async () => {
    io.rpcError = { message: "The BOQ changed after this revision was prepared, so nothing was frozen. Prepare the revision again." };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Prepare a new revision…" }));
    const region = await screen.findByRole("region", { name: "New revision" });
    fireEvent.click(within(region).getByRole("checkbox"));
    fireEvent.click(within(region).getByRole("button", { name: "Freeze revision" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(io.rpcError!.message));
    expect(screen.getByRole("region", { name: "New revision" })).toBeInTheDocument();
    expect(screen.queryByTestId("revision-Rev B")).not.toBeInTheDocument();
  });

  it("when the revision tables aren't migrated, says so and can't freeze", async () => {
    io.revisionsMissing = true;
    renderPanel();
    expect(await screen.findByText(/20261006000000_boq_commercial_revision\.sql has not been applied/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare a new revision…" })).toBeDisabled();
  });
});

describe("BoqRevisionsPanel — saved revisions", () => {
  const savedLine = {
    source_line_id: "l1", position: 1, subhead_no: 1, subhead_name: "Finishes", item_no: "1.01", section: "Finishes",
    dsr_code: "11.41.2", description: "Vitrified tiles (as issued)", unit: "sqm", qty: 40, quantity_status: "MEASURED", included: true,
    scope_id: null, external_key: null, rate: 900, rate_basis: "dsr", rate_provenance: "dsr_on_line", dsr_rate: 900, custom_rate: null,
    amount: 36000, source_document_id: null, source_document_name: "Ground Floor Plan", source_page: "3", adoption_id: null,
    adoption_source_kind: null, adoption_source_label: null, adoption_source_unit: null, adoption_source_date: null,
    adoption_confirmed_by: null, adoption_confirmed_at: null, limitations: [],
  };

  it("exports a revision from its saved rows even after the working BOQ changed", async () => {
    io.revisions = [SAVED];
    io.revisionLines = [savedLine];
    // The working BOQ now has a different rate and quantity.
    const src = source({ custom_rate: 1150, qty: 55 });
    src.workingGrandTotal = 99999;
    renderPanel(src);
    const item = await screen.findByTestId("revision-Rev A");
    expect(item).toHaveTextContent("the working BOQ has changed since");
    expect(item).toHaveTextContent("BOQ status then: Draft");

    fireEvent.click(within(item).getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(io.quotes).toHaveLength(1));
    const payload = io.quotes[0] as { boqName: string; subheads: { lines: { spec: string; qty: number; rate: number; sourceDocument: string }[] }[]; commercials: unknown };
    expect(payload.boqName).toBe("Civil BOQ — Rev A");
    expect(payload.subheads[0].lines[0]).toMatchObject({ spec: "Vitrified tiles (as issued)", qty: 40, rate: 900, sourceDocument: "Ground Floor Plan" });
    expect(payload.commercials).toEqual(COMMERCIALS);
    expect(src.build).not.toHaveBeenCalled();

    fireEvent.click(within(item).getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(io.csv).toHaveLength(1));
    expect(io.csv[0]).toContain("Vitrified tiles (as issued)");
    expect(io.csv[0]).toContain("Civil BOQ — Rev A");
  });

  it("opens a saved revision read-only, from its own rows, and shows how the working BOQ has moved since", async () => {
    io.revisions = [SAVED];
    io.revisionLines = [savedLine];
    renderPanel(source({ custom_rate: 1150, qty: 55 }));
    const item = await screen.findByTestId("revision-Rev A");
    fireEvent.click(within(item).getByRole("button", { name: "Open" }));

    const viewer = await screen.findByRole("region", { name: "Revision Rev A" });
    expect(viewer).toHaveTextContent("Frozen 2026-10-12 by you · BOQ status then: Draft");
    expect(viewer).toHaveTextContent("not that it was sent, awarded or executed");
    expect(within(viewer).getByRole("list", { name: "Recorded limitations" })).toHaveTextContent("draft");
    const row = await within(viewer).findByTestId("revision-line-1.01");
    // Saved values, not the working BOQ's.
    expect(row).toHaveTextContent("Vitrified tiles (as issued)");
    expect(row).toHaveTextContent("40 sqm");
    expect(row).toHaveTextContent("₹900");
    expect(row).toHaveTextContent("₹36,000");
    expect(row).toHaveTextContent("DSR rate on line");
    // The comparison is shown separately.
    expect(row).toHaveTextContent("qty: 40 → 55");
    expect(row).toHaveTextContent("rate: 900 → 1150");
    expect(within(viewer).getByTestId("revision-drift")).toHaveTextContent("1 changed, 0 removed and 0 added");

    fireEvent.click(within(viewer).getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(io.csv).toHaveLength(1));
    expect(io.csv[0]).toContain("Vitrified tiles (as issued)");
    expect(io.rpcCalls).toHaveLength(0);
    expect(io.writes).toHaveLength(0);

    fireEvent.click(within(viewer).getByRole("button", { name: "Close revision" }));
    expect(screen.queryByRole("region", { name: "Revision Rev A" })).not.toBeInTheDocument();
  });

  it("says when the working BOQ still matches the revision", async () => {
    io.revisions = [SAVED];
    io.revisionLines = [savedLine];
    renderPanel(source({ description: "Vitrified tiles (as issued)" }));
    fireEvent.click(within(await screen.findByTestId("revision-Rev A")).getByRole("button", { name: "Open" }));
    expect(await screen.findByText("The working BOQ still matches this revision line for line.")).toBeInTheDocument();
  });
});

