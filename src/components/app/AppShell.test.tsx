// Project journey shell: role gating (waits for roles), step tabs, and the
// projects list's loading/empty/error/search states.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AppLayout from "./AppLayout";
import ProjectShell from "./ProjectShell";
import AppProjects from "@/pages/app/AppProjects";
import { useProjectShell } from "./projectShellContext";

let auth: Record<string, unknown> = {};
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

let tableData: Record<string, { data: unknown; error: unknown }> = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const obj: Record<string, unknown> = {};
      ["select", "eq", "order", "maybeSingle"].forEach((m) => { obj[m] = () => obj; });
      (obj as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(tableData[table] ?? { data: null, error: null });
      return obj;
    },
  },
}));

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };
const StepProbe = () => { const { project } = useProjectShell(); return <div>step for {project.name}</div>; };

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route path="projects" element={<AppProjects />} />
            <Route path="projects/:id" element={<ProjectShell />}>
              <Route path="overview" element={<StepProbe />} />
              <Route path="boq" element={<StepProbe />} />
            </Route>
          </Route>
          <Route path="/auth" element={<Where />} />
          <Route path="/my-projects" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const staff = { user: { id: "u1" }, loading: false, rolesReady: true, isStaff: true, signOut: vi.fn() };
const projectRow = { id: "p1", name: "Sample Apartment", client_name: "Acme", location: "Pune", project_type: "Residential", status: "active", created_at: "2026-10-01", area_sqft: 1200, floors: 2 };

beforeEach(() => {
  auth = staff;
  tableData = {};
});

describe("AppLayout gating", () => {
  it("shows loading (no redirect) while a signed-in user's roles are still loading", () => {
    auth = { ...staff, rolesReady: false, isStaff: false };
    renderAt("/app/projects");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByTestId("where")).toBeNull();
  });
  it("sends a non-staff user to their own home once roles are known", () => {
    auth = { ...staff, isStaff: false };
    renderAt("/app/projects");
    expect(screen.getByTestId("where")).toHaveTextContent("/my-projects");
  });
  it("sends a signed-out user to sign in with a return URL", () => {
    auth = { ...staff, user: null, isStaff: false };
    renderAt("/app/projects/p1/boq?boq=b1");
    expect(screen.getByTestId("where")).toHaveTextContent("/auth?returnUrl=%2Fapp%2Fprojects%2Fp1%2Fboq%3Fboq%3Db1");
  });
  it("renders the app for staff with a way back to the Ops console", async () => {
    tableData.projects = { data: [], error: null };
    renderAt("/app/projects");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ops console" })).toHaveAttribute("href", "/ops");
  });
});

describe("AppProjects", () => {
  it("lists projects and filters by search", async () => {
    tableData.projects = { data: [projectRow, { ...projectRow, id: "p2", name: "Clinic Fitout", client_name: "Beta", location: "Nashik" }], error: null };
    renderAt("/app/projects");
    const list = await screen.findByRole("list", { name: "Projects" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(within(list).getByRole("link", { name: /Sample Apartment/ })).toHaveAttribute("href", "/app/projects/p1");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "nashik" } });
    expect(within(list).getAllByRole("link")).toHaveLength(1);
    expect(within(list).getByText("Clinic Fitout")).toBeInTheDocument();
  });
  it("shows an empty state", async () => {
    tableData.projects = { data: [], error: null };
    renderAt("/app/projects");
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });
  it("shows an error with retry", async () => {
    tableData.projects = { data: null, error: { message: "boom" } };
    renderAt("/app/projects");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load projects");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("ProjectShell", () => {
  it("renders numbered step tabs, marks the active one, and keeps ?boq= across steps", async () => {
    tableData.projects = { data: projectRow, error: null };
    renderAt("/app/projects/p1/boq?boq=b1");
    expect(await screen.findByText("step for Sample Apartment")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Project steps" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Overview", "1Step 1: Project & drawings", "2Step 2: Review quantities", "3Step 3: Build BOQ", "4Step 4: Check & finalise", "5Step 5: Export"]);
    expect(within(nav).getByRole("link", { name: /Build BOQ$/ })).toHaveAttribute("aria-current", "page");
    for (const l of links) expect(l.getAttribute("href")).toMatch(/\?boq=b1$/);
  });
  it("links the previous and next step under each step, keeping ?boq=", async () => {
    tableData.projects = { data: projectRow, error: null };
    renderAt("/app/projects/p1/boq?boq=b1");
    await screen.findByText("step for Sample Apartment");
    const stepNav = screen.getByRole("navigation", { name: "Previous and next step" });
    expect(within(stepNav).getByRole("link", { name: /Back: Review quantities/ })).toHaveAttribute("href", "/app/projects/p1/review?boq=b1");
    expect(within(stepNav).getByRole("link", { name: /Next: Check & finalise/ })).toHaveAttribute("href", "/app/projects/p1/check?boq=b1");
  });
  it("names the BOQ phases: Quantity is current, later phases are marked unavailable and offer no action", async () => {
    tableData.projects = { data: projectRow, error: null };
    renderAt("/app/projects/p1/overview");
    await screen.findByText("step for Sample Apartment");
    const phases = screen.getByRole("list", { name: "BOQ phases" });
    const items = within(phases).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("div")?.textContent)).toEqual([
      "1. Quantity BOQ", "2. Specification BOQ", "3. Pricing BOQ", "4. Procurement BOQ", "5. Execution & variations",
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "step");
    expect(items[0]).toHaveTextContent("Current phase");
    for (const li of items.slice(1)) {
      expect(li).toHaveTextContent(/Not available yet|Later/);
      expect(within(li).queryByRole("link")).toBeNull();
      expect(within(li).queryByRole("button")).toBeNull();
    }
    // The first step has no "Back".
    expect(within(screen.getByRole("navigation", { name: "Previous and next step" })).queryByRole("link", { name: /Back:/ })).toBeNull();
  });
  it("says so when the project does not exist", async () => {
    tableData.projects = { data: null, error: null };
    renderAt("/app/projects/missing/overview");
    expect(await screen.findByRole("alert")).toHaveTextContent("Project not found");
  });
});
