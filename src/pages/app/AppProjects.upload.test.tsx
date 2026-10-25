// The estimation home: drawing upload first, and one project list that keeps
// every existing project through a new project's creation, a refetch and a
// remount. The `projects` table is an in-memory stand-in; uploads and
// fingerprints are the real modules' call sites, stubbed at their boundary.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  listFails: false,
  insertFails: false,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "projects") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          order: async () => (db.listFails
            ? { data: null, error: { message: "network down" } }
            : { data: [...db.projects].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), error: null }),
        }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (db.insertFails) return { data: null, error: { message: "permission denied" } };
              db.inserts.push(row);
              const created = { id: `p${db.projects.length + 1}`, client_name: null, location: null, project_type: null, status: "active", created_at: `2026-10-25T10:0${db.inserts.length}:00Z`, ...row };
              db.projects.push(created);
              return { data: { id: created.id, name: row.name }, error: null };
            },
          }),
        }),
      };
    },
  },
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isStaff: true, rolesReady: true, roles: ["ops"] }) }));
vi.mock("@/components/guide/StartGuideButton", () => ({ default: () => null }));
const uploads = vi.hoisted(() => ({ calls: [] as { projectId: string; name: string }[], failNames: new Set<string>() }));
vi.mock("@/hooks/useDocumentManagement", () => ({
  uploadProjectDrawing: vi.fn(async (projectId: string, file: File) => {
    uploads.calls.push({ projectId, name: file.name });
    if (uploads.failNames.has(file.name)) throw new Error("storage unavailable");
  }),
}));
const fp = vi.hoisted(() => ({ compute: vi.fn() }));
vi.mock("@/lib/app/drawingFingerprints", () => ({ computeDrawingFingerprints: fp.compute }));
const ai = vi.hoisted(() => ({ generateAnalysis: vi.fn(), fetchPreflight: vi.fn() }));
vi.mock("@/lib/ai/analysisClient", () => ai);

import AppProjects from "./AppProjects";

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });
let qc: QueryClient;
const renderPage = () => render(
  <QueryClientProvider client={qc}><MemoryRouter><AppProjects /></MemoryRouter></QueryClientProvider>,
);
const choose = (files: File[]) => fireEvent.change(screen.getByTestId("upload-drawings-input"), { target: { files } });
const listedNames = () => within(screen.getByRole("list", { name: "Projects" })).getAllByRole("link").map((a) => a.textContent);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  db.projects = [
    { id: "old-1", name: "Tower A", client_name: "Client", location: "Pune", project_type: "Residential", status: "active", created_at: "2026-10-01T00:00:00Z" },
    { id: "old-2", name: "Clinic", client_name: null, location: null, project_type: null, status: "active", created_at: "2026-10-02T00:00:00Z" },
  ];
  db.inserts = []; db.listFails = false; db.insertFails = false;
  uploads.calls = []; uploads.failNames = new Set();
  fp.compute.mockReset(); ai.generateAnalysis.mockReset(); ai.fetchPreflight.mockReset();
});

describe("estimation home — upload drawings first", () => {
  it("Upload drawings comes before the project list", async () => {
    renderPage();
    await screen.findByRole("list", { name: "Projects" });
    const upload = screen.getByRole("button", { name: "Upload drawings" });
    const list = screen.getByRole("list", { name: "Projects" });
    expect(upload.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uploading creates one owned draft project, uploads every drawing into it, and keeps the existing projects listed", async () => {
    renderPage();
    await screen.findByText("Tower A");
    choose([pdf("GF Plan.pdf"), pdf("Section A.pdf")]);
    await waitFor(() => expect(screen.getAllByText("Uploaded")).toHaveLength(2));
    expect(db.inserts).toEqual([{ name: "GF Plan (draft)", owner_id: "u1", account_manager_id: "u1", ai_processing_enabled: false }]);
    expect(uploads.calls).toEqual([{ projectId: "p3", name: "GF Plan.pdf" }, { projectId: "p3", name: "Section A.pdf" }]);
    // The new project joins the list; nothing existing disappears.
    await waitFor(() => expect(listedNames()).toEqual([
      expect.stringContaining("GF Plan (draft)"), expect.stringContaining("Clinic"), expect.stringContaining("Tower A"),
    ]));
    expect(screen.getByRole("link", { name: "Open GF Plan (draft)" })).toHaveAttribute("href", "/app/projects/p3/drawings");
    // No consent to server processing: no fingerprinting, and never an AI call.
    expect(fp.compute).not.toHaveBeenCalled();
    expect(ai.generateAnalysis).not.toHaveBeenCalled();
  });

  it("after a refresh (a fresh page and cache) every project, old and new, is still listed", async () => {
    const first = renderPage();
    await screen.findByText("Tower A");
    choose([pdf("GF Plan.pdf")]);
    await screen.findByText("Uploaded");
    first.unmount();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage();
    await waitFor(() => expect(listedNames()).toHaveLength(3));
    expect(listedNames().join("|")).toMatch(/GF Plan \(draft\).*Clinic.*Tower A/);
  });

  it("with server processing allowed, fingerprints are computed after upload — never an AI analysis", async () => {
    fp.compute.mockResolvedValue({ eligible: 1, fingerprinted: 1 });
    renderPage();
    await screen.findByText("Tower A");
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow server processing of these drawings" }));
    choose([pdf("GF Plan.pdf")]);
    expect(await screen.findByText("Fingerprinted 1 of 1 uploaded drawing.")).toBeInTheDocument();
    expect(db.inserts[0].ai_processing_enabled).toBe(true);
    expect(fp.compute).toHaveBeenCalledWith("p3");
    expect(ai.generateAnalysis).not.toHaveBeenCalled();
  });

  it("a fingerprinting failure is shown with Retry", async () => {
    fp.compute.mockRejectedValueOnce(new Error("Fingerprinting failed: network down")).mockResolvedValueOnce({ eligible: 1, fingerprinted: 1 });
    renderPage();
    await screen.findByText("Tower A");
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow server processing of these drawings" }));
    choose([pdf("GF Plan.pdf")]);
    expect(await screen.findByText("Fingerprinting failed: network down")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry fingerprints" }));
    expect(await screen.findByText("Fingerprinted 1 of 1 uploaded drawing.")).toBeInTheDocument();
  });

  it("files that are not accepted are listed with the reason, and create no project", async () => {
    renderPage();
    await screen.findByText("Tower A");
    choose([new File(["x"], "photo.png", { type: "image/png" })]);
    expect(await screen.findByText("Only PDF drawings are supported.")).toBeInTheDocument();
    expect(db.inserts).toEqual([]);
    expect(uploads.calls).toEqual([]);
  });

  it("a failed drawing can be retried into the same project; more drawings join it too", async () => {
    uploads.failNames.add("Section A.pdf");
    renderPage();
    await screen.findByText("Tower A");
    choose([pdf("GF Plan.pdf"), pdf("Section A.pdf")]);
    expect(await screen.findByText("storage unavailable")).toBeInTheDocument();
    uploads.failNames.clear();
    fireEvent.click(screen.getByRole("button", { name: "Retry Section A.pdf" }));
    await waitFor(() => expect(screen.getAllByText("Uploaded")).toHaveLength(2));
    choose([pdf("Elevation.pdf")]);
    await waitFor(() => expect(screen.getAllByText("Uploaded")).toHaveLength(3));
    expect(db.inserts).toHaveLength(1); // one project, never a second
    expect(new Set(uploads.calls.map((c) => c.projectId))).toEqual(new Set(["p3"]));
  });

  it("if the project cannot be created, nothing is uploaded and the error is shown", async () => {
    db.insertFails = true;
    renderPage();
    await screen.findByText("Tower A");
    choose([pdf("GF Plan.pdf")]);
    expect(await screen.findByText(/The project could not be created, so nothing was uploaded: permission denied/)).toBeInTheDocument();
    expect(uploads.calls).toEqual([]);
  });

  it("a failed project-list read is an error with Retry, not an empty list", async () => {
    db.listFails = true;
    renderPage();
    expect(await screen.findByText("Could not load projects.")).toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).toBeNull();
    db.listFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Tower A")).toBeInTheDocument();
  });
});
