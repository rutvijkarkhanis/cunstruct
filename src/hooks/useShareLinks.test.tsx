// useShareLinks — the staff-only management layer for project_share_link.
// Exercises the mutation layer directly (no UI), proving: a create inserts
// only a token HASH (never the raw token) and returns the raw token to the
// caller exactly once; revoke sets revoked_at and nothing else.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useShareLinks } from "./useShareLinks";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const LINK = { id: "link-1", name: "Client review", show_pricing: true, created_at: "2026-01-01T00:00:00Z", expires_at: null, revoked_at: null, last_accessed_at: null };

let links: unknown[] = [LINK];
const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order"].forEach((m) => { obj[m] = () => obj; });
    obj.insert = (payload: Record<string, unknown>) => { inserted.push(payload); return { ...obj, then: (resolve: (r: { error: null }) => void) => resolve({ error: null }) }; };
    obj.update = (payload: Record<string, unknown>) => { updated.push(payload); return { ...obj, then: (resolve: (r: { error: null }) => void) => resolve({ error: null }) }; };
    (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: links, error: null });
    return obj;
  };
  return { supabase: { from: () => chain() } };
});

function renderLinks(projectId = "proj-1") {
  const qc = new QueryClient();
  return renderHook(() => useShareLinks(projectId), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

describe("useShareLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    links = [LINK];
    inserted.length = 0;
    updated.length = 0;
  });

  it("lists existing links for the project", async () => {
    const { result } = renderLinks();
    await waitFor(() => expect(result.current.links).toHaveLength(1));
    expect(result.current.links![0].name).toBe("Client review");
  });

  it("createLink inserts only a token HASH, never the raw token, and returns the raw token to the caller", async () => {
    const { result } = renderLinks();
    await waitFor(() => expect(result.current.links).toBeDefined());

    const rawToken = await result.current.createLink({ name: "New reviewer", showPricing: false });

    expect(rawToken).toBeTruthy();
    expect(inserted).toHaveLength(1);
    const payload = inserted[0];
    expect(payload.token_hash).toBeTypeOf("string");
    expect(payload.token_hash).not.toBe(rawToken); // hash, not the raw value
    expect(JSON.stringify(payload)).not.toContain(rawToken as string); // the raw token never appears ANYWHERE in the write
    expect(payload.show_pricing).toBe(false);
    expect(payload.created_by).toBe("user-1");
  });

  it("createLink requires a name", async () => {
    const { result } = renderLinks();
    await waitFor(() => expect(result.current.links).toBeDefined());
    const rawToken = await result.current.createLink({ name: "", showPricing: true });
    expect(rawToken).toBeNull();
    expect(inserted).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });

  it("revokeLink sets revoked_at and touches no other field", async () => {
    const { result } = renderLinks();
    await waitFor(() => expect(result.current.links).toBeDefined());
    const ok = await result.current.revokeLink("link-1");
    expect(ok).toBe(true);
    expect(updated).toHaveLength(1);
    expect(Object.keys(updated[0])).toEqual(["revoked_at"]);
  });
});
