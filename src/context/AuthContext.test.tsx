// rolesReady — roles load AFTER `loading` turns false, so a role-based
// redirect taken on `loading` alone sends staff to the contractor home.
// These pin the contract: rolesReady stays false until the current user's
// roles are known, and every consumer that redirects waits for it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";

type Session = { user: { id: string } } | null;
let currentSession: Session = null;
let resolveRoles: ((roles: string[]) => void) | null = null;
let authListener: ((event: string, s: Session) => void) | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: Session) => void) => {
        authListener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: () => Promise.resolve({ data: { session: currentSession } }),
      signOut: () => Promise.resolve({}),
    },
    from: () => ({
      select: () => ({
        eq: () => new Promise((resolve) => {
          resolveRoles = (roles) => resolve({ data: roles.map((role) => ({ role })), error: null });
        }),
      }),
    }),
  },
}));

function Probe() {
  const { loading, rolesReady, isStaff, roles } = useAuth();
  return <div data-testid="probe">{JSON.stringify({ loading, rolesReady, isStaff, roles })}</div>;
}
const probe = () => JSON.parse(screen.getByTestId("probe").textContent!);

beforeEach(() => {
  currentSession = null;
  resolveRoles = null;
  authListener = null;
});

describe("AuthContext rolesReady", () => {
  it("is false while a signed-in user's roles are still loading, even after loading is false", async () => {
    currentSession = { user: { id: "staff-1" } };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe()).toMatchObject({ rolesReady: false, isStaff: false });

    await act(async () => resolveRoles!(["ops"]));
    expect(probe()).toMatchObject({ rolesReady: true, isStaff: true, roles: ["ops"] });
  });

  it("is true with isStaff false once a non-staff user's roles have loaded", async () => {
    currentSession = { user: { id: "contractor-1" } };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(resolveRoles).not.toBeNull());
    await act(async () => resolveRoles!(["contractor"]));
    expect(probe()).toMatchObject({ loading: false, rolesReady: true, isStaff: false });
  });

  it("is true immediately when nobody is signed in", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(probe()).toMatchObject({ loading: false, rolesReady: true, isStaff: false }));
  });

  it("does not reset for a token refresh of the same user", async () => {
    currentSession = { user: { id: "staff-1" } };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(resolveRoles).not.toBeNull());
    await act(async () => resolveRoles!(["admin"]));
    resolveRoles = null;
    await act(async () => {
      authListener!("TOKEN_REFRESHED", { user: { id: "staff-1" } });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(resolveRoles).toBeNull(); // no second roles request
    expect(probe()).toMatchObject({ rolesReady: true, isStaff: true });
  });
});

// Fresh sign-in from a logged-out state: rolesReady starts TRUE (nobody
// signed in), so it must drop to false in the same update that sets the new
// user — otherwise a redirect runs in the gap with isStaff still false.
describe("AuthContext rolesReady on fresh sign-in", () => {
  it("is never true for a newly signed-in user before their roles load", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(probe()).toMatchObject({ loading: false, rolesReady: true }));
    const seen: { signedIn: boolean; rolesReady: boolean }[] = [];
    const Watch = () => { const a = useAuth(); seen.push({ signedIn: !!a.user, rolesReady: a.rolesReady }); return null; };
    render(<AuthProvider><Watch /></AuthProvider>);
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ signedIn: false, rolesReady: true }));
    seen.length = 0;
    await act(async () => { authListener!("SIGNED_IN", { user: { id: "staff-1" } }); });
    expect(seen.filter((s) => s.signedIn && s.rolesReady)).toEqual([]);
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(resolveRoles).not.toBeNull();
    await act(async () => resolveRoles!(["ops"]));
    expect(seen.at(-1)).toEqual({ signedIn: true, rolesReady: true });
  });

  it("resets roles when a different user signs in", async () => {
    currentSession = { user: { id: "staff-1" } };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(resolveRoles).not.toBeNull());
    await act(async () => resolveRoles!(["ops"]));
    expect(probe()).toMatchObject({ isStaff: true, rolesReady: true });
    resolveRoles = null;
    await act(async () => { authListener!("SIGNED_IN", { user: { id: "contractor-1" } }); });
    // The previous user's ops role must not carry over to the new user.
    expect(probe()).toMatchObject({ isStaff: false, rolesReady: false, roles: [] });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await act(async () => resolveRoles!(["contractor"]));
    expect(probe()).toMatchObject({ isStaff: false, rolesReady: true, roles: ["contractor"] });
  });
});

// The real Auth page, driven by the real provider: a staff user whose roles
// arrive late must land on the staff project list (/app/projects), never be
// sent to /my-projects first.
describe("Auth page redirect waits for roles", () => {
  const renderAuth = async () => {
    const Auth = (await import("@/pages/Auth")).default;
    const seen: string[] = [];
    const Track = ({ name }: { name: string }) => { seen.push(name); return <div>{name}</div>; };
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/auth"]}>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/app/projects" element={<Track name="staff-projects" />} />
            <Route path="/my-projects" element={<Track name="contractor-home" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    return seen;
  };

  it("sends a staff user to /app/projects even when roles load slowly", async () => {
    currentSession = { user: { id: "staff-1" } };
    const seen = await renderAuth();
    await waitFor(() => expect(resolveRoles).not.toBeNull());
    // Well past the old 300ms fallback that redirected staff to /my-projects.
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(seen).toEqual([]);
    await act(async () => resolveRoles!(["ops"]));
    await waitFor(() => expect(seen).toEqual(["staff-projects"]));
  });

  it("signing in from logged out as ops lands on /app/projects, never /my-projects", async () => {
    const seen = await renderAuth(); // nobody signed in: the sign-in form shows
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await act(async () => { authListener!("SIGNED_IN", { user: { id: "staff-1" } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(seen).toEqual([]); // still waiting for roles
    await act(async () => resolveRoles!(["ops"]));
    await waitFor(() => expect(seen).toEqual(["staff-projects"]));
  });

  it("signing in from logged out as a contractor lands on /my-projects", async () => {
    const seen = await renderAuth();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await act(async () => { authListener!("SIGNED_IN", { user: { id: "contractor-1" } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await act(async () => resolveRoles!(["contractor"]));
    await waitFor(() => expect(seen).toEqual(["contractor-home"]));
  });

  it("sends a non-staff user to /my-projects once roles are known", async () => {
    currentSession = { user: { id: "contractor-1" } };
    const seen = await renderAuth();
    await waitFor(() => expect(resolveRoles).not.toBeNull());
    await act(async () => resolveRoles!(["contractor"]));
    await waitFor(() => expect(seen).toEqual(["contractor-home"]));
  });
});

describe("OpsLayout while roles load", () => {
  it("shows loading, not 'Operations access required', until roles are known", async () => {
    currentSession = { user: { id: "staff-1" } };
    const OpsLayout = (await import("@/components/ops/OpsLayout")).default;
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/ops"]}>
            <Routes><Route path="/ops" element={<OpsLayout />}><Route index element={<div>dashboard</div>} /></Route></Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(resolveRoles).not.toBeNull());
    expect(screen.queryByText(/Operations access required/)).toBeNull();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await act(async () => resolveRoles!(["contractor"]));
    expect(await screen.findByText(/Operations access required/)).toBeInTheDocument();
  });
});
