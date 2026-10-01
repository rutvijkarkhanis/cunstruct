// Shared BOQ-management hook — Phase 11 Stage C3. Exercises the mutation
// layer directly (no UI): scope resolution and plain-BOQ creation, the two
// capabilities ProjectBoqs.tsx and the Workspace BOQ panel both consume.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBoqManagement, NEW_SCOPE } from "./useBoqManagement";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const SCOPE = { id: "scope-1", project_id: "proj-1", name: "Residential", kind: "floor", sort: 0, status: "active" };
const BOQ = { id: "boq-1", name: "Ground Floor BOQ", description: null, scope_id: "scope-1", sort: 0, status: "active" };

let scopes: unknown[] = [SCOPE];
let boqs: unknown[] = [BOQ];
const inserted: Record<string, unknown[]> = {};

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string, getResult: () => { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order", "in"].forEach((m) => { obj[m] = () => obj; });
    obj.insert = (payload: unknown) => { (inserted[table] ??= []).push(payload); return obj; };
    obj.single = () => obj;
    (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null; count?: number }) => void) =>
      resolve({ data: table === "project_scope" ? { id: "new-scope-id" } : { id: "new-boq-id" }, error: null, count: 0 });
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "project_scope") {
          const obj = chain(table, () => ({ data: scopes, error: null }));
          // The plain read query (no insert) must return the list, not a single row.
          (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: scopes, error: null });
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
          const obj = chain(table, () => ({ data: boqs, error: null }));
          (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: boqs, error: null });
          obj.insert = (payload: unknown) => {
            (inserted[table] ??= []).push(payload);
            const insertObj: Record<string, unknown> = {};
            ["select", "single"].forEach((m) => { insertObj[m] = () => insertObj; });
            (insertObj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: { id: "new-boq-id" }, error: null });
            return insertObj;
          };
          return obj;
        }
        if (table === "boq_line") {
          const obj: Record<string, unknown> = {};
          ["select", "eq"].forEach((m) => { obj[m] = () => obj; });
          (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null; count: number }) => void) => resolve({ data: [], error: null, count: 0 });
          return obj;
        }
        return chain(table, () => ({ data: [], error: null }));
      },
    },
  };
});

function renderBm(projectId = "proj-1") {
  const qc = new QueryClient();
  return renderHook(() => useBoqManagement(projectId), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

describe("useBoqManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scopes = [SCOPE];
    boqs = [BOQ];
    Object.keys(inserted).forEach((k) => delete inserted[k]);
  });

  it("loads scopes and boqs for the project", async () => {
    const { result } = renderBm();
    await waitFor(() => expect(result.current.boqs).toEqual([BOQ]));
    expect(result.current.scopes).toEqual([SCOPE]);
    expect(result.current.scopeName("scope-1")).toBe("Residential");
    expect(result.current.scopeName(null)).toBe("—");
  });

  it("resolveScopeId returns the given id unchanged when it isn't the NEW_SCOPE sentinel", async () => {
    const { result } = renderBm();
    await waitFor(() => expect(result.current.boqs).toBeDefined());
    let id: string | null = null;
    await act(async () => { id = await result.current.resolveScopeId("scope-1", "", "floor"); });
    expect(id).toBe("scope-1");
    expect(inserted.project_scope).toBeUndefined();
  });

  it("resolveScopeId creates a new scope when given NEW_SCOPE + a name", async () => {
    const { result } = renderBm();
    await waitFor(() => expect(result.current.boqs).toBeDefined());
    let id: string | null = null;
    await act(async () => { id = await result.current.resolveScopeId(NEW_SCOPE, "Terrace", "structural"); });
    expect(id).toBe("new-scope-id");
    expect(inserted.project_scope).toEqual([{ project_id: "proj-1", name: "Terrace", kind: "structural", sort: 1 }]);
  });

  it("resolveScopeId rejects NEW_SCOPE with a blank name without hitting the network", async () => {
    const { result } = renderBm();
    await waitFor(() => expect(result.current.boqs).toBeDefined());
    let id: string | null = "unset";
    await act(async () => { id = await result.current.resolveScopeId(NEW_SCOPE, "   ", "floor"); });
    expect(id).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Enter the new scope name");
    expect(inserted.project_scope).toBeUndefined();
  });

  it("createBoq rejects a blank name without hitting the network", async () => {
    const { result } = renderBm();
    await waitFor(() => expect(result.current.boqs).toBeDefined());
    let id: string | null = "unset";
    await act(async () => { id = await result.current.createBoq({ name: "  ", scopeId: "scope-1" }); });
    expect(id).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Enter a BOQ name");
    expect(inserted.boq).toBeUndefined();
  });

  it("createBoq inserts the BOQ against the resolved scope and toasts success", async () => {
    const { result } = renderBm();
    await waitFor(() => expect(result.current.boqs).toBeDefined());
    let id: string | null = null;
    await act(async () => { id = await result.current.createBoq({ name: "Ground Floor BOQ", description: "d", scopeId: "scope-1" }); });
    expect(id).toBe("new-boq-id");
    expect(inserted.boq).toEqual([{ project_id: "proj-1", name: "Ground Floor BOQ", description: "d", scope_id: "scope-1", sort: 1, spec: {}, created_by: "user-1" }]);
    expect(toast.success).toHaveBeenCalledWith("BOQ created");
  });

  it("createBoq creates a new scope inline when scopeId is NEW_SCOPE", async () => {
    const { result } = renderBm();
    await waitFor(() => expect(result.current.boqs).toBeDefined());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.createBoq({ name: "Terrace BOQ", scopeId: NEW_SCOPE, newScopeName: "Terrace", newScopeKind: "structural" });
    });
    expect(id).toBe("new-boq-id");
    expect(inserted.project_scope).toEqual([{ project_id: "proj-1", name: "Terrace", kind: "structural", sort: 1 }]);
    expect(inserted.boq[0]).toMatchObject({ name: "Terrace BOQ", scope_id: "new-scope-id" });
  });
});
