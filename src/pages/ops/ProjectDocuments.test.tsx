// REGRESSION — PDFs could not be opened from the Documents section at all.
// documentRow() rendered an "Open" link ONLY for a URL-sourced revision
// (r.external_url); an uploaded PDF (source: "upload", file_path set,
// external_url null) had NO click target whatsoever — not a broken signed
// URL, not a pdf.js/worker bug, simply a missing affordance.
//
// The actual PDF render happens in the BROWSER's native viewer after
// window.open(signedUrl) — that boundary can't be exercised in jsdom. This
// test instead proves the full APPLICATION-level contract up to that
// boundary: clicking "Open" requests a signed URL for the EXACT stored
// path, and opens EXACTLY that resolved URL — or, on a null result (missing
// file / RLS-denied access), never opens a blank/broken tab and surfaces an
// error instead. That is the closest deterministic boundary available.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectDocuments from "./ProjectDocuments";
import { toast } from "sonner";

const signedDrawingUrl = vi.fn();

vi.mock("@/lib/review/drawingStorage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/review/drawingStorage")>("@/lib/review/drawingStorage");
  return { ...actual, signedDrawingUrl: (path: string) => signedDrawingUrl(path) };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const DOC = { id: "doc-1", project_id: "proj-1", name: "Ground Floor Plan", doc_type: "Architectural", discipline: "Architectural", current_revision_id: "rev-1", status: "uploaded", folder_id: null, created_at: "2026-01-01T00:00:00Z" };
const REV_UPLOADED = { id: "rev-1", document_id: "doc-1", label: "Rev A", revision_date: null, source: "upload", file_path: "proj-1/doc-1/rev-1.pdf", external_url: null, page_count: 3, status: "uploaded", created_at: "2026-01-01T00:00:00Z", mime_type: "application/pdf", file_size: 1000, original_filename: "Ground Floor Plan.pdf" };
const REV_URL_ONLY = { ...REV_UPLOADED, id: "rev-2", source: "url", file_path: null, external_url: "https://client.example/plan.pdf" };

// A mutable fixture the mock reads from — lets a single test swap in a
// different revision set without redefining the whole module mock.
let currentRevisions: unknown[] = [REV_UPLOADED];

vi.mock("@/integrations/supabase/client", () => {
  const chain = (getResult: () => { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "order", "in", "update", "insert"].forEach((m) => { obj[m] = () => obj; });
    (obj as { then: unknown }).then = (resolve: (r: { data: unknown; error: null }) => void) => resolve(getResult());
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "project_document") return chain(() => ({ data: [DOC], error: null }));
        if (table === "document_revision") return chain(() => ({ data: currentRevisions, error: null }));
        return chain(() => ({ data: [], error: null })); // document_folder, boq_document
      },
    },
  };
});

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/ops/projects/proj-1/documents"]}>
        <Routes><Route path="/ops/projects/:id/documents" element={<ProjectDocuments />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function expandTheDocument() {
  await screen.findByText("Ground Floor Plan");
  fireEvent.click(screen.getByLabelText("Toggle revisions"));
}

describe("Documents — opening an uploaded PDF revision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRevisions = [REV_UPLOADED];
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("requests a signed URL for the exact stored path and opens exactly that URL", async () => {
    signedDrawingUrl.mockResolvedValue("https://signed.example/proj-1/doc-1/rev-1.pdf?token=abc");
    renderPage();
    await expandTheDocument();
    fireEvent.click(await screen.findByText("Open"));

    await waitFor(() => expect(signedDrawingUrl).toHaveBeenCalledWith("proj-1/doc-1/rev-1.pdf"));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(
      "https://signed.example/proj-1/doc-1/rev-1.pdf?token=abc", "_blank", "noopener,noreferrer",
    ));
  });

  it("never opens a blank/broken tab when the file is missing or access is denied (signedDrawingUrl resolves null)", async () => {
    signedDrawingUrl.mockResolvedValue(null);
    renderPage();
    await expandTheDocument();
    fireEvent.click(await screen.findByText("Open"));

    await waitFor(() => expect(signedDrawingUrl).toHaveBeenCalled());
    expect(window.open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Could not open this drawing. It may be missing or you may not have access.");
  });

  it("shows a disabled 'Opening…' state while the signed URL is in flight", async () => {
    let resolve!: (v: string | null) => void;
    signedDrawingUrl.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    await expandTheDocument();
    fireEvent.click(await screen.findByText("Open"));

    await screen.findByText("Opening…");
    expect(screen.getByText("Opening…").closest("button")).toBeDisabled();

    resolve("https://signed.example/x.pdf");
    await waitFor(() => expect(window.open).toHaveBeenCalled());
  });

  it("does not show an Open control for a revision with no stored file (URL/paste-only revision)", async () => {
    // Regression guard in the other direction: a draft/paste revision (no
    // file_path) must not gain a broken "Open" button that calls
    // signedDrawingUrl with an empty/undefined path.
    currentRevisions = [REV_URL_ONLY];
    renderPage();
    await expandTheDocument();
    await screen.findByText("https://client.example/plan.pdf");

    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(signedDrawingUrl).not.toHaveBeenCalled();
  });
});
