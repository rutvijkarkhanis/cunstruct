// WorkspaceBoqPanel — Phase 11 Stage C3. Exercises the panel's own states
// (no BOQ / single BOQ / multiple BOQs / invalid ?boq= / creation) in
// isolation; the shared useBoqManagement hook's own mutation semantics are
// covered separately in useBoqManagement.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkspaceBoqPanel from "./WorkspaceBoqPanel";
import { computeCommercials } from "@/lib/boqDsrDocument";
import { formatINR } from "@/lib/forecastEngine";

// jsdom has no layout engine, so Radix Select's open-item scroll logic needs
// this polyfilled to open the dropdown at all in tests that pick a scope.
window.HTMLElement.prototype.scrollIntoView = () => {};

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const SCOPE = { id: "scope-1", project_id: "proj-1", name: "Residential", kind: "floor", sort: 0, status: "active" };
let boqs: { id: string; name: string; description: null; scope_id: string; sort: number; status: string; spec?: Record<string, unknown> }[] = [];
let lines: { id: string; description: string | null; unit: string | null; qty: number; dsr_rate: number | null; custom_rate: number | null; included: boolean }[] = [];
let changeLog: { boq_line_id: string; review_item_id: string | null }[] = [];
const inserted: Record<string, unknown[]> = {};

vi.mock("@/integrations/supabase/client", () => {
  const readChain = (getData: () => unknown) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order", "in", "not"].forEach((m) => { obj[m] = () => obj; });
    (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null; count?: number }) => void) =>
      resolve({ data: getData(), error: null, count: 0 });
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "project_scope") {
          const obj = readChain(() => [SCOPE]);
          obj.insert = (payload: unknown) => {
            (inserted[table] ??= []).push(payload);
            const insertObj: Record<string, unknown> = {};
            ["select", "single"].forEach((m) => { insertObj[m] = () => insertObj; });
            (insertObj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: { id: "new-scope-id" }, error: null });
            return insertObj;
          };
          return obj;
        }
        if (table === "boq") {
          const obj = readChain(() => boqs);
          obj.insert = (payload: unknown) => {
            (inserted[table] ??= []).push(payload);
            const insertObj: Record<string, unknown> = {};
            ["select", "single"].forEach((m) => { insertObj[m] = () => insertObj; });
            (insertObj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: { id: "new-boq-id" }, error: null });
            return insertObj;
          };
          return obj;
        }
        if (table === "boq_line") return readChain(() => lines);
        if (table === "boq_line_change_log") return readChain(() => changeLog);
        return readChain(() => []);
      },
    },
  };
});

beforeEach(() => {
  lines = [];
  changeLog = [];
});

function renderPanel(activeBoqId: string | null, onEnterMode = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkspaceBoqPanel projectId="proj-1" activeBoqId={activeBoqId} onEnterMode={onEnterMode} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onEnterMode;
}

describe("WorkspaceBoqPanel — no-BOQ state", () => {
  beforeEach(() => { boqs = []; Object.keys(inserted).forEach((k) => delete inserted[k]); });

  it("shows an honest empty state and a Create BOQ affordance, never a fabricated BOQ", async () => {
    renderPanel(null);
    expect(await screen.findByText(/No BOQ created yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create BOQ/i })).toBeInTheDocument();
  });
});

describe("WorkspaceBoqPanel — single BOQ (no real ambiguity)", () => {
  beforeEach(() => {
    boqs = [{ id: "boq-1", name: "Ground Floor BOQ", description: null, scope_id: "scope-1", sort: 0, status: "active" }];
    Object.keys(inserted).forEach((k) => delete inserted[k]);
  });

  it("shows it directly as the active BOQ without requiring ?boq=", async () => {
    renderPanel(null);
    expect(await screen.findByText("Ground Floor BOQ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open BOQ/i })).toHaveAttribute("href", "/ops/projects/proj-1/boqs/boq-1");
  });

  it("'Change BOQ' reveals the list/create view even with only one BOQ", async () => {
    renderPanel(null);
    await screen.findByText("Ground Floor BOQ");
    fireEvent.click(screen.getByRole("button", { name: "Change BOQ" }));
    expect(await screen.findByRole("button", { name: /Create BOQ/i })).toBeInTheDocument();
  });
});

describe("WorkspaceBoqPanel — multiple BOQs, none chosen via URL", () => {
  beforeEach(() => {
    boqs = [
      { id: "boq-1", name: "Ground Floor BOQ", description: null, scope_id: "scope-1", sort: 0, status: "active" },
      { id: "boq-2", name: "First Floor BOQ", description: null, scope_id: "scope-1", sort: 1, status: "active" },
    ];
    Object.keys(inserted).forEach((k) => delete inserted[k]);
  });

  it("shows the list rather than silently guessing one as active", async () => {
    renderPanel(null);
    expect(await screen.findByText("Ground Floor BOQ")).toBeInTheDocument();
    expect(await screen.findByText("First Floor BOQ")).toBeInTheDocument();
    // Neither is rendered as "the" active summary (no "Open BOQ" link yet).
    expect(screen.queryByRole("link", { name: /Open BOQ/i })).not.toBeInTheDocument();
  });

  it("selecting a BOQ from the list calls onEnterMode('boq', id)", async () => {
    const onEnterMode = renderPanel(null);
    fireEvent.click(await screen.findByText("First Floor BOQ"));
    expect(onEnterMode).toHaveBeenCalledWith("boq", "boq-2");
  });

  it("an explicit ?boq= selects that BOQ's compact summary directly", async () => {
    renderPanel("boq-2");
    expect(await screen.findByText("First Floor BOQ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open BOQ/i })).toHaveAttribute("href", "/ops/projects/proj-1/boqs/boq-2");
  });
});

describe("WorkspaceBoqPanel — invalid ?boq= (stale link, deleted, or another project's BOQ)", () => {
  beforeEach(() => {
    boqs = [{ id: "boq-1", name: "Ground Floor BOQ", description: null, scope_id: "scope-1", sort: 0, status: "active" }];
    Object.keys(inserted).forEach((k) => delete inserted[k]);
  });

  it("never silently substitutes another BOQ — shows an honest notice and a way to pick a real one", async () => {
    renderPanel("boq-does-not-exist");
    expect(await screen.findByText(/couldn't be found in this project/)).toBeInTheDocument();
    // Falls through to the one real BOQ this project actually has.
    expect(await screen.findByText("Ground Floor BOQ")).toBeInTheDocument();
  });
});

describe("WorkspaceBoqPanel — creating a BOQ", () => {
  beforeEach(() => { boqs = []; Object.keys(inserted).forEach((k) => delete inserted[k]); });

  it("creates via the shared hook and makes the new BOQ active without navigating away", async () => {
    const onEnterMode = renderPanel(null);
    fireEvent.click(await screen.findByRole("button", { name: /Create BOQ/i }));
    // The project's one real scope is auto-selected once it loads (no real
    // ambiguity to ask about) — confirm the dialog reflects that itself
    // before relying on it, rather than re-selecting it manually.
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Residential"));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Ground Floor BOQ"), { target: { value: "Ground Floor BOQ" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(inserted.boq).toBeDefined());
    expect(inserted.boq[0]).toMatchObject({ name: "Ground Floor BOQ", scope_id: "scope-1" });
    await waitFor(() => expect(onEnterMode).toHaveBeenCalledWith("boq", "new-boq-id"));
  });
});

describe("WorkspaceBoqPanel — Stage C4: advanced management stays reachable", () => {
  beforeEach(() => { boqs = []; Object.keys(inserted).forEach((k) => delete inserted[k]); });

  it("links to the dedicated management page for rename/reorder/delete/share/import/move — capabilities this compact panel never took on", async () => {
    renderPanel(null);
    const link = await screen.findByText(/Manage all BOQs/);
    expect(link.closest("a")).toHaveAttribute("href", "/ops/projects/proj-1/boqs/manage");
  });
});

describe("WorkspaceBoqPanel — Stage C5A: selected BOQ with zero lines", () => {
  beforeEach(() => {
    boqs = [{ id: "boq-1", name: "Ground Floor BOQ", description: null, scope_id: "scope-1", sort: 0, status: "active", spec: {} }];
    lines = [];
    changeLog = [];
    Object.keys(inserted).forEach((k) => delete inserted[k]);
  });

  it("shows the honest zero-line message rather than an empty preview/total", async () => {
    renderPanel(null);
    await screen.findByText("Ground Floor BOQ");
    expect(await screen.findByText("This BOQ has no line items yet.")).toBeInTheDocument();
    expect(screen.queryByText("Subtotal")).not.toBeInTheDocument();
    expect(screen.queryByText("Grand Total")).not.toBeInTheDocument();
  });
});

describe("WorkspaceBoqPanel — Stage C5A: selected BOQ with line items", () => {
  beforeEach(() => {
    boqs = [{ id: "boq-1", name: "Ground Floor BOQ", description: null, scope_id: "scope-1", sort: 0, status: "active", spec: {} }];
    lines = [
      { id: "line-1", description: "Cement bags", unit: "bag", qty: 10, dsr_rate: 100, custom_rate: null, included: true },
      { id: "line-2", description: "Excluded line", unit: "bag", qty: 5, dsr_rate: 50, custom_rate: null, included: false },
    ];
    changeLog = [];
    Object.keys(inserted).forEach((k) => delete inserted[k]);
  });

  it("renders the line preview (description, qty/unit/rate, amount) and the authoritative Subtotal/Grand Total — reusing computeCommercials, never a second calculation", async () => {
    renderPanel(null);
    await screen.findByText("Ground Floor BOQ");
    expect(await screen.findByText("2 lines")).toBeInTheDocument();

    // Only the included line (qty 10 * rate 100 = 1000) counts toward the
    // total; the excluded line must never be silently folded in.
    const commercials = computeCommercials(1000, { costIndexPct: 0, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18 });
    expect(await screen.findByText("Subtotal")).toBeInTheDocument();
    expect(await screen.findByText("Grand Total")).toBeInTheDocument();
    expect((await screen.findAllByText(formatINR(commercials.works))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(formatINR(commercials.grandTotal))).length).toBeGreaterThan(0);

    // Line preview itself: description, qty+unit+rate, and the line's own
    // amount — both lines show (preview isn't filtered to included-only).
    expect(await screen.findByText("Cement bags")).toBeInTheDocument();
    expect(await screen.findByText("Excluded line")).toBeInTheDocument();
    expect(await screen.findByText(`10 bag · ${formatINR(100)}`)).toBeInTheDocument();
    expect(await screen.findByText(`5 bag · ${formatINR(50)}`)).toBeInTheDocument();
  });

  it("shows no 'Reviewed' badge for a line with no persisted boq_line_change_log row — never fabricates Review provenance", async () => {
    renderPanel(null);
    await screen.findByText("Cement bags");
    expect(screen.queryByText("Reviewed")).not.toBeInTheDocument();
  });

  it("shows a 'Reviewed' badge for a line genuinely linked via boq_line_change_log, and clicking it enters Review mode for this BOQ", async () => {
    changeLog = [{ boq_line_id: "line-1", review_item_id: "review-item-1" }];
    const onEnterMode = renderPanel(null);
    await screen.findByText("Cement bags");
    const badge = await screen.findByText("Reviewed");
    fireEvent.click(badge.closest("button")!);
    expect(onEnterMode).toHaveBeenCalledWith("review", "boq-1");

    // The OTHER line, with no change-log row, still shows no badge.
    const excludedRow = (await screen.findByText("Excluded line")).closest("div")!;
    expect(excludedRow.textContent).not.toContain("Reviewed");
  });
});

describe("WorkspaceBoqPanel — Stage C5A: line preview cap", () => {
  beforeEach(() => {
    boqs = [{ id: "boq-1", name: "Ground Floor BOQ", description: null, scope_id: "scope-1", sort: 0, status: "active", spec: {} }];
    lines = Array.from({ length: 8 }, (_, i) => ({
      id: `line-${i + 1}`, description: `Item ${i + 1}`, unit: "nos", qty: 1, dsr_rate: 10, custom_rate: null, included: true,
    }));
    changeLog = [];
    Object.keys(inserted).forEach((k) => delete inserted[k]);
  });

  it("caps the preview and shows an honest '+N more' indicator rather than rendering every line", async () => {
    renderPanel(null);
    await screen.findByText("8 lines");
    expect(await screen.findByText("Item 1")).toBeInTheDocument();
    expect(await screen.findByText("Item 6")).toBeInTheDocument();
    expect(screen.queryByText("Item 7")).not.toBeInTheDocument();
    expect(screen.queryByText("Item 8")).not.toBeInTheDocument();
    expect(await screen.findByText(/\+2 more lines? — open the full BOQ to see all\./)).toBeInTheDocument();
  });
});
