// WorkspaceBoqPanel — Phase 11 Stage C3. Exercises the panel's own states
// (no BOQ / single BOQ / multiple BOQs / invalid ?boq= / creation) in
// isolation; the shared useBoqManagement hook's own mutation semantics are
// covered separately in useBoqManagement.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkspaceBoqPanel from "./WorkspaceBoqPanel";

// jsdom has no layout engine, so Radix Select's open-item scroll logic needs
// this polyfilled to open the dropdown at all in tests that pick a scope.
window.HTMLElement.prototype.scrollIntoView = () => {};

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const SCOPE = { id: "scope-1", project_id: "proj-1", name: "Residential", kind: "floor", sort: 0, status: "active" };
let boqs: { id: string; name: string; description: null; scope_id: string; sort: number; status: string }[] = [];
const inserted: Record<string, unknown[]> = {};

vi.mock("@/integrations/supabase/client", () => {
  const readChain = (getData: () => unknown) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order", "in"].forEach((m) => { obj[m] = () => obj; });
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
        if (table === "boq_line") return readChain(() => []);
        return readChain(() => []);
      },
    },
  };
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
