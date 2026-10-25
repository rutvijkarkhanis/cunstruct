// Removing a wrongly uploaded drawing from the Drawings screen: a visible
// Remove per drawing, a confirmation naming the exact file, Cancel changes
// nothing, a failure keeps the drawing listed with a way to try again, and
// success removes only that drawing and closes it in the viewer. The real
// list (WorkspaceSources) and dialog are used; the document store is stubbed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

type Doc = { id: string; name: string; doc_type: string; discipline: string; status: string; current_revision_id: string };
const store = vi.hoisted(() => ({
  docs: [] as Doc[], listeners: new Set<() => void>(),
  removeCalls: [] as string[], nextResults: [] as ({ ok: true; filesNotRemoved: string[] } | { ok: false; error: string })[],
  citing: 0,
}));
const emit = () => store.listeners.forEach((l) => l());

vi.mock("@/hooks/useDocumentManagement", () => ({
  useDocumentManagement: () => {
    const docs = useSyncExternalStore((l) => { store.listeners.add(l); return () => store.listeners.delete(l); }, () => store.docs);
    return {
      docs,
      revsFor: (id: string) => [{ id: `r-${id}`, label: "Rev A", page_count: 1, original_filename: id === "mark" ? "12th mark sheet digi locker.pdf" : "Residential building.pdf" }],
      removeDocument: async (d: Doc) => {
        store.removeCalls.push(d.id);
        const r = store.nextResults.shift() ?? { ok: true as const, filesNotRemoved: [] };
        if (r.ok) { store.docs = store.docs.filter((x) => x.id !== d.id); emit(); }
        return r;
      },
    };
  },
  countLinesCitingDocument: async () => store.citing,
}));
vi.mock("@/components/app/projectShellContext", () => ({ useProjectShell: () => ({ projectId: "p1" }) }));
vi.mock("@/components/app/DrawingProcessingPanel", () => ({ default: () => null }));
vi.mock("@/components/ops/workspace/WorkspaceCanvas", () => ({ default: ({ documentId }: { documentId: string | null }) => <div data-testid="canvas">{documentId ?? "none"}</div> }));
vi.mock("@/components/ops/workspace/WorkspaceSourceManager", () => ({ default: () => null }));
vi.mock("@/lib/review/reviewStore", () => ({ loadReviewItems: async () => [] }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import ProjectDrawings from "./ProjectDrawings";

const Where = () => <div data-testid="where">{useLocation().search}</div>;
const renderAt = (url = "/x") => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[url]}><ProjectDrawings /><Where /></MemoryRouter></QueryClientProvider>,
);
const list = () => screen.getByRole("region", { name: "Project drawings" });

beforeEach(() => {
  store.docs = [
    { id: "plan", name: "Residential building", doc_type: "Architectural", discipline: "Architectural", status: "uploaded", current_revision_id: "r-plan" },
    { id: "mark", name: "12th mark sheet digi locker", doc_type: "Architectural", discipline: "Architectural", status: "uploaded", current_revision_id: "r-mark" },
  ];
  store.removeCalls = []; store.nextResults = []; store.citing = 0;
  toasts.success.mockReset(); toasts.warning.mockReset();
});

describe("Drawings — removing a wrongly uploaded drawing", () => {
  it("every drawing has a visible Remove button, beside (not inside) its row", () => {
    renderAt();
    expect(within(list()).getByRole("button", { name: "Remove Residential building" })).toBeVisible();
    expect(within(list()).getByRole("button", { name: "Remove 12th mark sheet digi locker" })).toBeVisible();
    expect(within(list()).getByRole("button", { name: /^12th mark sheet digi locker/ })).toBeInTheDocument(); // still selectable
  });

  it("asks first, naming the exact file and what happens to BOQ lines that cite it; Cancel changes nothing", async () => {
    store.citing = 2;
    renderAt();
    fireEvent.click(within(list()).getByRole("button", { name: "Remove 12th mark sheet digi locker" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("remove-drawing-file")).toHaveTextContent("12th mark sheet digi locker.pdf");
    expect(await within(dialog).findByText(/2 BOQ lines cite it: they keep their quantities, but the link to this drawing is removed/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(store.removeCalls).toEqual([]);
    expect(within(list()).getByRole("button", { name: /^12th mark sheet digi locker/ })).toBeInTheDocument();
  });

  it("removes only that drawing, says so, and closes it in the viewer", async () => {
    renderAt("/x?boq=b1&document=mark&page=2");
    expect(screen.getByTestId("canvas")).toHaveTextContent("mark");
    fireEvent.click(within(list()).getByRole("button", { name: "Remove 12th mark sheet digi locker" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(store.removeCalls).toEqual(["mark"]);
    expect(toasts.success).toHaveBeenCalledWith("Removed 12th mark sheet digi locker.pdf");
    expect(within(list()).queryByRole("button", { name: /^12th mark sheet digi locker/ })).toBeNull();
    expect(within(list()).getByRole("button", { name: /^Residential building/ })).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toHaveTextContent("none");
    expect(screen.getByTestId("where")).toHaveTextContent("?boq=b1");
  });

  it("a failure keeps the drawing listed, explains, and Try again can succeed", async () => {
    store.nextResults = [{ ok: false, error: "The drawing was not removed: network down." }];
    renderAt();
    fireEvent.click(within(list()).getByRole("button", { name: "Remove 12th mark sheet digi locker" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The drawing was not removed: network down. Nothing else was changed; you can try again.");
    // Still listed (the page behind the open dialog is hidden from the accessibility tree, not gone).
    const behind = screen.getByRole("region", { name: "Project drawings", hidden: true });
    expect(within(behind).getByRole("button", { name: /^12th mark sheet digi locker/, hidden: true })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(store.removeCalls).toEqual(["mark", "mark"]);
    expect(within(list()).queryByRole("button", { name: /^12th mark sheet digi locker/ })).toBeNull();
  });

  it("a stored file that could not be deleted is reported, not hidden", async () => {
    store.nextResults = [{ ok: true, filesNotRemoved: ["p1/mark/r.pdf"] }];
    renderAt();
    fireEvent.click(within(list()).getByRole("button", { name: "Remove 12th mark sheet digi locker" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(toasts.warning).toHaveBeenCalledWith(expect.stringMatching(/stored file could not be deleted/)));
  });
});
