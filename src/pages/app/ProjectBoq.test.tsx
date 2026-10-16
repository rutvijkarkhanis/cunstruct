// BOQ step: real write path (boq_line update with the parsed patch), session
// undo (button and Ctrl+Z) writing the exact inverse, failure handling, the
// incomplete warning, and BOQ selection.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ProjectBoq from "./ProjectBoq";

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
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

let rows: Record<string, unknown>[] = [];
let failNextUpdate: string | null = null;
const updates: { patch: Record<string, unknown>; id: unknown }[] = [];
vi.mock("@/lib/untypedDb", () => ({
  db: {
    from: () => {
      const q: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      q.select = () => q;
      q.order = () => Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
      q.update = (p: Record<string, unknown>) => { patch = p; return q; };
      q.eq = (col: string, val: unknown) => {
        if (!patch) return q;
        if (failNextUpdate) { const message = failNextUpdate; failNextUpdate = null; return Promise.resolve({ error: { message } }); }
        updates.push({ patch, id: val });
        rows = rows.map((r) => (r.id === val ? { ...r, ...patch } : r));
        return Promise.resolve({ error: null });
      };
      return q;
    },
  },
}));

const base = { section: "Brickwork", dsr_code: "6.1", unit: "cum", dsr_rate: 100, custom_rate: null, basis: null, quantity_status: null, measurement_method: null, included: true, source_page: null };

function renderPage(path = "/x") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}><ProjectBoq /></MemoryRouter>
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
  boqs = [{ id: "b1", name: "Civil BOQ", created_at: "", discipline: "civil" }];
  rows = [
    { ...base, id: "l1", sort: 1, description: "Brick wall", qty: 10, source_document_id: "d1", source_page: "2" },
    { ...base, id: "l2", sort: 2, description: "Plaster", qty: 0, basis: "PENDING", quantity_status: "PENDING" },
  ];
  updates.length = 0;
  failNextUpdate = null;
  toastError.mockClear();
});

describe("ProjectBoq", () => {
  it("states that the BOQ is incomplete and links sources to the Drawings step", async () => {
    renderPage();
    expect(await screen.findByText(/This BOQ is incomplete: 1 line has a pending quantity/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source drawing GF Plan, page 2" }))
      .toHaveAttribute("href", "/drawings?boq=b1&document=d1&page=2");
  });

  it("writes the edit, then undoes it with the exact inverse patch", async () => {
    renderPage();
    await editQty("Plaster", "40");
    expect(updates).toEqual([{ id: "l2", patch: { qty: 40, basis: null, quantity_status: "MEASURED" } }]);
    await waitFor(() => expect(screen.queryByText(/This BOQ is incomplete/)).toBeNull());

    const undo = screen.getByRole("button", { name: /Undo: Quantity of “Plaster”: 0 → 40/ });
    await act(async () => { fireEvent.click(undo); });
    expect(updates[1]).toEqual({ id: "l2", patch: { qty: 0, basis: "PENDING", quantity_status: "PENDING" } });
    expect(await screen.findByText(/This BOQ is incomplete/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
  });

  it("undoes with Ctrl+Z outside an input, but not while typing in one", async () => {
    renderPage();
    await editQty("Brick wall", "12");
    const search = screen.getByRole("searchbox", { name: "Search BOQ lines" });
    await act(async () => { fireEvent.keyDown(search, { key: "z", ctrlKey: true }); });
    expect(updates).toHaveLength(1);
    await act(async () => { fireEvent.keyDown(document.body, { key: "z", ctrlKey: true }); });
    expect(updates[1]).toEqual({ id: "l1", patch: { qty: 10 } });
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
    expect(screen.getByRole("link", { name: "Create a BOQ" })).toHaveAttribute("href", "/ops/projects/p1/boqs/manage");
  });

  it("says when ?boq= is not part of this project", async () => {
    renderPage("/x?boq=elsewhere");
    expect(await screen.findByRole("note")).toHaveTextContent("not part of this project");
    expect(within(screen.getByRole("combobox", { name: "BOQ" })).getByRole("option", { name: "Civil BOQ" })).toBeInTheDocument();
  });
});
