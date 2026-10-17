// Frozen revision exports (CSV and PDF) list pending lines in the pending
// section, from the revision's own saved rows only — never a Qty of 0, never
// dropped — and refuse only when the revision has nothing included at all.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { buildRevisionLines, type RevisionLine, type StoredRevision, type WorkingLine } from "@/lib/boqRevision";
import { computeCommercials, type DsrQuotePayload } from "@/lib/boqDsrDocument";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const io = vi.hoisted(() => ({ csv: [] as string[], quotes: [] as unknown[], savedLines: [] as unknown[], tablesRead: [] as string[] }));
vi.mock("@/lib/boqDsrDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/boqDsrDocument")>("@/lib/boqDsrDocument");
  return {
    ...actual,
    downloadCsv: (_name: string, csv: string) => { io.csv.push(csv); },
    openDsrQuote: (p: unknown) => { io.quotes.push(p); return true; },
  };
});
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order"].forEach((m) => { obj[m] = () => obj; });
    obj.then = (resolve: (r: { data: unknown; error: null }) => void) => {
      io.tablesRead.push(table);
      return resolve({ data: table === "boq_commercial_revision_line" ? io.savedLines.map((l) => ({ ...(l as object) })) : [], error: null });
    };
    return obj;
  };
  return { supabase: { from: (t: string) => chain(t) } };
});

import { useBoqRevisions } from "./useBoqRevisions";

const wl = (o: Partial<WorkingLine> & { id: string }): WorkingLine => ({
  section: "Finishes", dsr_code: null, description: o.id, unit: "sqm", qty: 10, dsr_rate: 100, custom_rate: null,
  included: true, quantity_status: "MEASURED", ...o,
});
const frozen = (lines: WorkingLine[]): RevisionLine[] => buildRevisionLines([{
  no: 1, name: "Finishes",
  rows: lines.map((line, i) => ({ line, no: `1.${String(i + 1).padStart(2, "0")}`, source: { sourceDocument: "Plan", sourcePage: "2", sourceDocumentId: "doc-1" } })),
}]);
const REV: StoredRevision = {
  id: "rev-1", boq_id: "boq-1", project_id: "proj-1", boq_name: "Civil BOQ", project_name: "Tower B", revision_no: 1,
  label: "Rev A", boq_status_at_issue: "draft", discipline: "civil", rate_year: null, context: { quote: {} },
  commercials: computeCommercials(1000, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 0 }),
  works_total: 1000, grand_total: 1000, line_count: 3, priced_line_count: 1, limitations: [], limitations_acknowledged: true,
  issue_note: null, issued_by: "u1", issued_at: "2026-10-12T09:00:00Z",
};
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

async function exportRevision(kind: "pdf" | "pdf_blank" | "csv") {
  const { result } = renderHook(() => useBoqRevisions("boq-1"), { wrapper });
  await act(async () => { await result.current.exportRevision(REV, kind); });
}

beforeEach(() => { io.csv = []; io.quotes = []; io.tablesRead = []; vi.mocked(toast.error).mockClear(); });

describe("frozen revision exports", () => {
  it("CSV: measured rows as saved; the pending line in the pending section; the excluded line absent", async () => {
    io.savedLines = frozen([
      wl({ id: "Tiles", qty: 10 }),
      wl({ id: "Door", qty: 0, quantity_status: "PENDING" }),
      wl({ id: "Lift (by client)", qty: 1, included: false }),
    ]);
    await exportRevision("csv");
    const body = io.csv[0].split("\r\n").slice(4);
    expect(body).toEqual([
      "1.00 Finishes,1.01,,Tiles,sqm,10,100,100,=F5*H5,Plan,2,",
      "",
      "IDENTIFIED — PENDING QUANTIFICATION (not priced; confirm a quantity to price)",
      "Pending,P.01,,Door — Quantity pending: not yet measured,sqm,,,,,Plan,2,",
    ]);
    expect(io.tablesRead).toContain("boq_commercial_revision_line");
    expect(io.tablesRead).not.toContain("boq_line"); // never the working BOQ
  });

  it("PDF: pending lines are in pendingItems, not among measured rows", async () => {
    io.savedLines = frozen([wl({ id: "Tiles", qty: 10 }), wl({ id: "Door", qty: 0, quantity_status: "PENDING" })]);
    await exportRevision("pdf");
    const p = io.quotes[0] as DsrQuotePayload;
    expect(p.subheads.flatMap((s) => s.lines.map((l) => l.spec))).toEqual(["Tiles"]);
    expect(p.pendingItems!.map((x) => [x.spec, x.note, x.sourceDocument, x.sourcePage])).toEqual([["Door", "Quantity pending: not yet measured", "Plan", "2"]]);
  });

  it("a pending-only revision exports both CSV and PDF", async () => {
    io.savedLines = frozen([wl({ id: "Door", qty: 0, quantity_status: "PENDING" })]);
    await exportRevision("csv");
    await exportRevision("pdf_blank");
    expect(toast.error).not.toHaveBeenCalled();
    expect(io.csv[0]).toContain("Pending,P.01,,Door — Quantity pending");
    expect((io.quotes[0] as DsrQuotePayload).pendingItems).toHaveLength(1);
  });

  it("a revision with every line excluded is refused for both CSV and PDF", async () => {
    io.savedLines = frozen([wl({ id: "Lift", included: false }), wl({ id: "Door", qty: 0, quantity_status: "PENDING", included: false })]);
    await exportRevision("csv");
    await exportRevision("pdf");
    expect(io.csv).toEqual([]);
    expect(io.quotes).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith("Nothing to export in this revision");
  });
});
