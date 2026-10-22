// BOQ step: real write path (boq_line update with the parsed patch), session
// undo (button and Ctrl+Z) writing the exact inverse, failure handling, the
// incomplete warning, and BOQ selection.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ProjectBoq from "./ProjectBoq";
import { clearSessionUndoHistories } from "@/components/app/undoHistory";
import { BOQ_DRAFT_UI_DISCLAIMER } from "@/lib/boqDraftDisclaimer";
import { saveReceipt } from "@/lib/review/applyReceipt";
import type { EvidenceItem } from "@/lib/lineEvidence";

const evidence = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/lib/lineEvidence", async (orig) => ({
  ...(await orig<typeof import("@/lib/lineEvidence")>()),
  loadBoqEvidenceItems: async () => evidence.items,
}));

vi.mock("@/components/app/projectShellContext", () => ({ useProjectShell: () => ({ projectId: "p1" }) }));
let boqs = [{ id: "b1", name: "Civil BOQ", created_at: "", discipline: "civil" }];
vi.mock("@/hooks/useProjectBoqs", () => ({
  useProjectBoqs: () => ({ data: boqs, isLoading: false, isError: false, isSuccess: true }),
  useMostRecentlyAnalyzedBoqId: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/lib/review/drawingStorage", async (orig) => ({
  ...(await orig<typeof import("@/lib/review/drawingStorage")>()),
  loadProjectDrawings: async () => [{ documentId: "d1", name: "GF Plan", originalFilename: null, filePath: "x.pdf", pageCount: 3, pageTitles: null }],
}));
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), warning: (m: string) => toastWarning(m) } }));

let rows: Record<string, unknown>[] = [];
let failNextUpdate: string | null = null;
let historyTableMissing = true;
let historyInsertError: string | null = null;
/** Fail the Nth boq_line update from now (1-based); 0 = never. */
let failUpdateAt = 0;
const updates: { patch: Record<string, unknown>; id: unknown }[] = [];
const historyRows: Record<string, unknown>[] = [];
// One in-memory stand-in for both the untyped `db` helper and the Supabase
// client (guarded quantity edits go through applyFinding, which uses the
// client): reads, guarded/unguarded updates and the history table.
const mockDb = vi.hoisted(() => ({ from: (_t: string): unknown => null }));
mockDb.from = (table: string) => {
  const q: Record<string, unknown> = {};
  let patch: Record<string, unknown> | null = null;
  let insert: Record<string, unknown>[] | null = null;
  const filters: [string, string, unknown][] = [];
  const run = () => {
    if (table === "boq_line_change_log") {
      if (historyTableMissing) return { data: null, error: { code: "42P01", message: 'relation "public.boq_line_change_log" does not exist' } };
      if (insert && historyInsertError) return { data: null, error: { message: historyInsertError } };
      if (insert) historyRows.push(...insert);
      return { data: [], error: null };
    }
    if (!patch) return { data: rows.map((r) => ({ ...r })), error: null };
    if (failNextUpdate) { const message = failNextUpdate; failNextUpdate = null; return { data: null, error: { message } }; }
    if (failUpdateAt && --failUpdateAt === 0) return { data: null, error: { message: "network down" } };
    const hit = rows.filter((r) => filters.every(([op, c, v]) => (op === "is" ? (r[c] ?? null) === v : r[c] === v)));
    for (const h of hit) { updates.push({ patch: patch!, id: h.id }); Object.assign(h, patch); }
    return { data: hit.map((h) => ({ id: h.id })), error: null };
  };
  q.select = () => q;
  q.limit = () => q;
  q.order = () => Promise.resolve(run());
  q.update = (p: Record<string, unknown>) => { patch = p; return q; };
  q.insert = (r: Record<string, unknown> | Record<string, unknown>[]) => { insert = Array.isArray(r) ? r : [r]; return q; };
  q.eq = (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; };
  q.is = (c: string, v: unknown) => { filters.push(["is", c, v]); return q; };
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej);
  return q;
};
vi.mock("@/lib/untypedDb", async (orig) => ({ ...(await orig<typeof import("@/lib/untypedDb")>()), db: mockDb }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mockDb }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const base = { section: "Brickwork", dsr_code: "6.1", unit: "cum", dsr_rate: 100, custom_rate: null, basis: null, quantity_status: null, measurement_method: null, included: true, source_page: null };

function renderPage(path = "/x", historyScope?: "session") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}><ProjectBoq historyScope={historyScope} /></MemoryRouter>
    </QueryClientProvider>,
  );
}
async function editQty(name: string, value: string) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`Edit Quantity for ${name}`) }));
  const input = screen.getByRole("textbox", { name: `Quantity for ${name}` });
  fireEvent.change(input, { target: { value } });
  await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
}

beforeEach(() => {
  clearSessionUndoHistories();
  boqs = [{ id: "b1", name: "Civil BOQ", created_at: "", discipline: "civil" }];
  rows = [
    { ...base, id: "l1", sort: 1, description: "Brick wall", qty: 10, source_document_id: "d1", source_page: "2" },
    { ...base, id: "l2", sort: 2, description: "Plaster", qty: 0, basis: "PENDING", quantity_status: "PENDING" },
  ];
  updates.length = 0;
  failNextUpdate = null;
  historyTableMissing = true;
  historyInsertError = null;
  failUpdateAt = 0;
  historyRows.length = 0;
  toastWarning.mockClear();
  toastError.mockClear();
});

describe("ProjectBoq — arriving from another step", () => {
  it("a ?status=pending link opens the table filtered to the pending lines", async () => {
    renderPage("/x?boq=b1&status=pending");
    expect(await screen.findByText("Plaster")).toBeInTheDocument();
    expect(screen.queryByText("Brick wall")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("pending");
  });
  it("an unknown ?status= is ignored", async () => {
    renderPage("/x?boq=b1&status=bogus");
    expect(await screen.findByText("Brick wall")).toBeInTheDocument();
    expect(screen.getByText("Plaster")).toBeInTheDocument();
  });
  it("shows what the last Apply from review did, after returning from the review screen", async () => {
    window.sessionStorage.clear();
    saveReceipt({ boqId: "b1", runId: "run-1", appliedAt: "2026-10-16T10:00:00Z", appliedCount: 2, unresolvedCount: 0, correctedCount: 0,
      reviewedCount: 2, verifiedCount: 2, unauditedCount: 0, conflictedCount: 0, revisionChanged: [], justAppliedLineIds: [] });
    renderPage();
    expect(await screen.findByText(/Last applied from review in this browser tab, .*: 2 items applied\./)).toBeInTheDocument();
    window.sessionStorage.clear();
  });
});

describe("ProjectBoq", () => {
  it("states that the BOQ is incomplete and links sources to the Drawings step", async () => {
    renderPage();
    expect(await screen.findByText(/Quantities are incomplete: 1 line has a pending quantity/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source drawing GF Plan, page 2" }))
      .toHaveAttribute("href", "/drawings?boq=b1&document=d1&page=2");
  });

  it("writes the edit, then undoes it with the exact inverse patch", async () => {
    renderPage();
    await editQty("Plaster", "40");
    expect(updates).toEqual([{ id: "l2", patch: { qty: 40, basis: "MANUAL", quantity_status: "MEASURED" } }]);
    await waitFor(() => expect(screen.queryByText(/Quantities are incomplete/)).toBeNull());

    const undo = screen.getByRole("button", { name: /Undo: Quantity of “Plaster”: 0 → 40/ });
    await act(async () => { fireEvent.click(undo); });
    expect(updates[1]).toEqual({ id: "l2", patch: { qty: 0, basis: "PENDING", quantity_status: "PENDING" } });
    expect(await screen.findByText(/Quantities are incomplete/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
  });

  it("undoes with Ctrl+Z outside an input, but not while typing in one", async () => {
    renderPage();
    await editQty("Brick wall", "12");
    const search = screen.getByRole("searchbox", { name: "Search BOQ lines" });
    await act(async () => { fireEvent.keyDown(search, { key: "z", ctrlKey: true }); });
    expect(updates).toHaveLength(1);
    await act(async () => { fireEvent.keyDown(document.body, { key: "z", ctrlKey: true }); });
    expect(updates[1]).toEqual({ id: "l1", patch: { qty: 10, basis: null } });
  });

  it("reports a failed save and records nothing to undo", async () => {
    renderPage();
    failNextUpdate = "permission denied";
    await editQty("Brick wall", "12");
    expect(toastError).toHaveBeenCalledWith("Not saved — you don't have permission to change this. Ask an admin if you should.");
    expect(updates).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
  });

  it("keeps the undo entry when the undo write fails", async () => {
    renderPage();
    await editQty("Brick wall", "12");
    failNextUpdate = "TypeError: Failed to fetch";
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Undo:/ })); });
    expect(toastError).toHaveBeenCalledWith("Undo failed — the connection to the server failed. Check your connection and try again.");
    expect(screen.getByRole("button", { name: /^Undo:/ })).toBeEnabled();
  });

  it("shows an empty state with a way to create a BOQ", async () => {
    boqs = [];
    renderPage();
    expect(screen.getByRole("heading", { name: "No BOQ yet" })).toBeInTheDocument();
    // Leaves the journey with a way back to this step.
    expect(screen.getByRole("link", { name: "Create a BOQ" })).toHaveAttribute("href", `/ops/projects/p1/boqs/manage?returnTo=${encodeURIComponent("/x")}`);
  });

  it("says when ?boq= is not part of this project", async () => {
    renderPage("/x?boq=elsewhere");
    expect(await screen.findByRole("note")).toHaveTextContent("not part of this project");
    expect(within(screen.getByRole("combobox", { name: "BOQ" })).getByRole("option", { name: "Civil BOQ" })).toBeInTheDocument();
  });
});

describe("ProjectBoq — guarded, recorded quantity edits", () => {
  it("records the edit in the line's history when the history table exists", async () => {
    historyTableMissing = false;
    renderPage();
    await editQty("Brick wall", "12");
    expect(updates).toEqual([{ id: "l1", patch: { qty: 12, basis: "MANUAL" } }]);
    expect(historyRows).toEqual([expect.objectContaining({ boq_id: "b1", boq_line_id: "l1", field: "qty", old_value: "10", new_value: "12", changed_by: "user-1" })]);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("says when the edit could not be recorded because history is not set up", async () => {
    renderPage();
    await editQty("Brick wall", "12");
    expect(updates).toHaveLength(1);
    expect(toastWarning).toHaveBeenCalledWith("Change saved. Change history is not set up on this database, so it is not in the line's history.");
  });

  it("never overwrites a quantity changed elsewhere since the BOQ was loaded", async () => {
    renderPage();
    await screen.findByText("Brick wall");
    rows = rows.map((r) => (r.id === "l1" ? { ...r, qty: 11 } : r)); // another user's save
    await editQty("Brick wall", "12");
    expect(updates).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith("Change not saved: this line was changed elsewhere since it was loaded. The current values are now shown.");
    expect(screen.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
  });

  it("undo never reverts a later change made by someone else", async () => {
    renderPage();
    await editQty("Brick wall", "12");
    rows = rows.map((r) => (r.id === "l1" ? { ...r, qty: 15 } : r)); // someone else, after our edit
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Undo:/ })); });
    expect(updates).toHaveLength(1);
    expect(rows.find((r) => r.id === "l1")!.qty).toBe(15);
    expect(toastError).toHaveBeenCalledWith("Undo not saved: this line was changed elsewhere since it was loaded. The current values are now shown.");
    expect(screen.getByRole("button", { name: /^Undo:/ })).toBeEnabled(); // kept, not assumed reverted
  });

  // The workbench ("session" history, its accepted stale-undo contract): the
  // journey above keeps its released behaviour.
  it("workbench: a refused step leaves the stack and is listed as not undone", async () => {
    renderPage("/x", "session");
    await editQty("Brick wall", "12");
    rows = rows.map((r) => (r.id === "l1" ? { ...r, qty: 15 } : r)); // someone else, after our edit
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Undo:/ })); });
    expect(rows.find((r) => r.id === "l1")!.qty).toBe(15);
    expect(screen.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
    const notUndone = screen.getByRole("region", { name: "Changes that could not be undone" });
    expect(notUndone).toHaveTextContent("Quantity of “Brick wall”: 10 → 12");
  });

  it("workbench: a stale newest step does not block an earlier step on another line", async () => {
    renderPage("/x", "session");
    await editQty("Brick wall", "12");
    await editQty("Plaster", "45");
    rows = rows.map((r) => (r.id === "l2" ? { ...r, qty: 50 } : r)); // someone else changes Plaster
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Undo: Quantity of “Plaster”/ })); });
    expect(rows.find((r) => r.id === "l2")!.qty).toBe(50);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Undo: Quantity of “Brick wall”/ })); });
    expect(rows.find((r) => r.id === "l1")!.qty).toBe(10);
    expect(screen.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Changes that could not be undone" })).toHaveTextContent("Plaster");
  });

  it("an undo that fails for any other reason keeps its step (not refused, not assumed reverted)", async () => {
    renderPage();
    await editQty("Brick wall", "12");
    failNextUpdate = "network down";
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Undo:/ })); });
    expect(rows.find((r) => r.id === "l1")!.qty).toBe(12);
    expect(screen.getByRole("button", { name: /^Undo: Quantity of “Brick wall”/ })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Changes that could not be undone" })).toBeNull();
  });
});

describe("ProjectBoq — evidence behind a line", () => {
  it("shows the linked review item's decision, calculation and region link; unlinked lines offer none", async () => {
    rows = rows.map((r) => (r.id === "l1" ? { ...r, external_key: "BW1" } : r));
    evidence.items = [{
      id: "ri-7", runId: "run-3", reviewStatus: "EDITED", reviewer: { quantity: 10 }, reviewNote: "Checked against wall schedule",
      ai: { key: "BW1", item: "Brick wall GF", quantity: 9.5, unit: "cum", confidence: 0.8, aiStatus: "MEASURED",
        source: { documentId: "d1", document: "GF Plan", page: 2, evidence: [{ bbox: [1, 2, 3, 4], page: 2 }] },
        calculationData: { formula: "LENGTH_TIMES_WIDTH_TIMES_HEIGHT", inputs: [{ name: "Length", value: 10, unit: "m" }, { name: "Thickness", value: 0.23, unit: "m" }, { name: "Height", value: 4.13, unit: "m" }] } },
    }] satisfies EvidenceItem[] as unknown[];
    renderPage("/x?boq=b1");
    const toggle = await screen.findByRole("button", { name: "Show evidence for Brick wall" });
    expect(screen.queryByRole("button", { name: "Show evidence for Plaster" })).toBeNull();
    fireEvent.click(toggle);
    const panel = screen.getByRole("group", { name: "Evidence for Brick wall GF" });
    expect(panel).toHaveTextContent("Corrected in review — review item “Brick wall GF” (BW1). Extracted 9.5 cum, corrected to 10 cum.");
    expect(panel).toHaveTextContent("Calculation: Length 10 m × Thickness 0.23 m × Height 4.13 m = 9.499 cum");
    expect(panel).toHaveTextContent("Reviewer note: “Checked against wall schedule”");
    expect(within(panel).getByRole("link", { name: /Show the measured region on GF Plan, p.2/ }))
      .toHaveAttribute("href", "/drawings?boq=b1&document=d1&item=ri-7&run=run-3&page=2");
    evidence.items = [];
  });
});

describe("ProjectBoq — every field edit is guarded and recorded, not just quantities", () => {
  async function editDescription(name: string, value: string) {
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`Edit Description for ${name}`) }));
    const input = screen.getByRole("textbox", { name: `Description for ${name}` });
    fireEvent.change(input, { target: { value } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
  }
  it("records a description change in the line's history", async () => {
    historyTableMissing = false;
    renderPage();
    await editDescription("Brick wall", "Brick wall 230 mm");
    expect(updates).toEqual([{ id: "l1", patch: { description: "Brick wall 230 mm" } }]);
    expect(historyRows).toEqual([expect.objectContaining({ field: "description", old_value: "Brick wall", new_value: "Brick wall 230 mm" })]);
  });
  it("refuses a description edit when the description changed elsewhere", async () => {
    renderPage();
    await screen.findByText("Brick wall");
    rows = rows.map((r) => (r.id === "l1" ? { ...r, description: "Brick wall (revised by PM)" } : r));
    await editDescription("Brick wall", "Brick wall 230 mm");
    expect(updates).toHaveLength(0);
    expect(rows.find((r) => r.id === "l1")!.description).toBe("Brick wall (revised by PM)");
  });
});

describe("ProjectBoq — when the history row cannot be written (table exists)", () => {
  it("the edit is put back, reported as not saved, and leaves nothing to undo", async () => {
    historyTableMissing = false;
    historyInsertError = "permission denied for table boq_line_change_log";
    renderPage();
    await editQty("Brick wall", "12");
    expect(rows.find((r) => r.id === "l1")).toMatchObject({ qty: 10, basis: null });
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/^Change not saved: its history record couldn't be saved \(permission denied.*\)\. The previous value was kept\./));
    expect(screen.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
  });

  it("retry: once history can be written, the same edit saves and is recorded", async () => {
    historyTableMissing = false;
    historyInsertError = "temporary failure";
    renderPage();
    await editQty("Brick wall", "12");
    historyInsertError = null;
    // The cell stays open after a failed save; the person presses Enter again.
    const input = screen.getByRole("textbox", { name: "Quantity for Brick wall" });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(rows.find((r) => r.id === "l1")!.qty).toBe(12);
    expect(historyRows).toEqual([expect.objectContaining({ field: "qty", old_value: "10", new_value: "12" })]);
  });

  it("if putting it back fails too, the change is reported as saved-but-unrecorded and stays undoable", async () => {
    historyTableMissing = false;
    historyInsertError = "permission denied";
    failUpdateAt = 2;   // the compensating update
    renderPage();
    await editQty("Brick wall", "12");
    expect(rows.find((r) => r.id === "l1")!.qty).toBe(12);
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/^Change was saved, but its history record couldn't be saved.*Check this line\./));
    // The undo list matches the database: the change is there to undo.
    expect(screen.getByRole("button", { name: /^Undo: Quantity of “Brick wall”: 10 → 12/ })).toBeEnabled();
  });
});


describe("ProjectBoq — limited launch disclosure", () => {
  it("shows the unvalidated-draft disclaimer beside the priced works subtotal", async () => {
    renderPage();
    expect(await screen.findByText(BOQ_DRAFT_UI_DISCLAIMER)).toBeInTheDocument();
  });
});
