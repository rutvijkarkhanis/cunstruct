// /my-projects lists only projects the signed-in user OWNS. That is right for
// a contractor, but staff work on projects they do not own (e.g. onboarded in
// the Ops console), so staff are sent to the one staff project list instead
// of seeing a partial one. Nobody's access changes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/components/guide/StartGuideButton", () => ({ default: () => null }));
const reads = vi.hoisted(() => ({ projectFilters: [] as [string, unknown][] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { if (table === "projects") reads.projectFilters.push([c, v]); return q; };
      q.order = () => Promise.resolve({ data: table === "projects" ? [{ id: "own-1", name: "My house", status: "active", progress_pct: 0, created_at: "2026-10-01" }] : [], error: null });
      (q as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null });
      return q;
    },
  },
}));

import MyProjects from "./MyProjects";

const renderAt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/my-projects"]}>
      <Routes>
        <Route path="/my-projects" element={<MyProjects />} />
        <Route path="/app/projects" element={<div>Staff project list</div>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
const base = { user: { id: "u1", email: "u@example.com" }, loading: false, signOut: vi.fn() };

beforeEach(() => { reads.projectFilters = []; });

describe("/my-projects", () => {
  it("staff are sent to the staff project list and the owner-only list is not read", async () => {
    auth.value = { ...base, rolesReady: true, isStaff: true };
    renderAt();
    expect(await screen.findByText("Staff project list")).toBeInTheDocument();
    expect(reads.projectFilters).toEqual([]);
  });

  it("waits for roles before deciding, so staff never see a partial list first", async () => {
    auth.value = { ...base, rolesReady: false, isStaff: false };
    renderAt();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(reads.projectFilters).toEqual([]);
  });

  it("a contractor still sees only the projects they own", async () => {
    auth.value = { ...base, rolesReady: true, isStaff: false };
    renderAt();
    expect(await screen.findByText("My house")).toBeInTheDocument();
    await waitFor(() => expect(reads.projectFilters).toContainEqual(["owner_id", "u1"]));
    expect(screen.queryByText("Staff project list")).toBeNull();
  });
});
