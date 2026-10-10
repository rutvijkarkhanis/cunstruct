// WORKSPACE CANVAS — loading-state fix regression tests.
//
// Before this fix, WorkspaceCanvas handed PdfEvidenceViewer a `fileUrl: null`
// during BOTH its own metadata/signed-URL fetch windows AND the genuine
// "this revision has no file" case, with no `unavailableReason` set — so
// PdfEvidenceViewer's own fallback (`source?.document` is never populated
// here) always rendered its AI-analysis-flavored copy, "This item has no
// drawing source in the analysis", during ordinary loading and for a
// genuinely fileless revision alike.
//
// PdfEvidenceViewer itself is mocked — the same convention every
// BoqReviewWorkstation test file already uses for this exact component (pdf.js
// can't meaningfully render in jsdom) — as a thin stub that renders the props
// WorkspaceCanvas actually passes, so these tests assert the real contract
// between the two components rather than reaching into WorkspaceCanvas's
// internals. PdfEvidenceViewer.test.tsx separately proves `unavailableReason`
// itself renders as given text and takes precedence over the fallback.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import WorkspaceCanvas from "./WorkspaceCanvas";

vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: { fileUrl: string | null; unavailableReason?: string | null; documentName?: string | null }) => (
    <div data-testid="pdf-viewer" data-file-url={props.fileUrl ?? ""} data-document-name={props.documentName ?? ""}>
      {props.unavailableReason && <span>{props.unavailableReason}</span>}
    </div>
  ),
}));

// A deferred promise — lets a test control exactly when a mocked query
// settles, same convention BoqReviewWorkstationFindSimilarLifecycle.test.tsx
// already establishes for testing in-flight/loading states.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

let projectDocumentResult: ReturnType<typeof deferred<{ data: unknown }>>;
let documentRevisionResult: ReturnType<typeof deferred<{ data: unknown }>>;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => {
            if (table === "project_document") return projectDocumentResult.promise;
            if (table === "document_revision") return documentRevisionResult.promise;
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  },
}));

const signedDrawingUrlMock = vi.fn();
vi.mock("@/lib/review/drawingStorage", () => ({
  signedDrawingUrl: (...args: unknown[]) => signedDrawingUrlMock(...(args as [string])),
}));

function renderCanvas(documentId: string | null, page: number | null = null) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <WorkspaceCanvas documentId={documentId} page={page} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  projectDocumentResult = deferred();
  documentRevisionResult = deferred();
  signedDrawingUrlMock.mockReset();
});

describe("WorkspaceCanvas — loading vs. genuinely-no-file states", () => {
  it("shows a Workspace loading state while document metadata is loading, never the PdfEvidenceViewer fallback", async () => {
    renderCanvas("doc-1");

    expect(screen.getByText("Loading drawing…")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-viewer")).not.toBeInTheDocument();
    expect(screen.queryByText("Select a drawing from Sources to begin.")).not.toBeInTheDocument();

    // Resolves to a document with no current revision at all — confirms the
    // loading state above wasn't masking the no-file state, just preceding it.
    projectDocumentResult.resolve({ data: { id: "doc-1", name: "Floor Plan", current_revision_id: null } });
    await waitFor(() => expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument());
    expect(screen.getByText("No file has been uploaded for this revision yet.")).toBeInTheDocument();
  });

  it("keeps showing the loading state while the signed URL is still resolving, once metadata has resolved with a valid file path", async () => {
    renderCanvas("doc-1");
    projectDocumentResult.resolve({ data: { id: "doc-1", name: "Floor Plan", current_revision_id: "rev-1" } });
    documentRevisionResult.resolve({ data: { file_path: "projects/doc-1/rev-1.pdf", page_titles: null } });
    const urlDeferred = deferred<string>();
    signedDrawingUrlMock.mockReturnValue(urlDeferred.promise);

    await waitFor(() => expect(screen.getByText("Loading drawing…")).toBeInTheDocument());
    expect(screen.queryByTestId("pdf-viewer")).not.toBeInTheDocument();

    urlDeferred.resolve("https://signed.example/rev-1.pdf");
    await waitFor(() => expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument());
    expect(screen.getByTestId("pdf-viewer").getAttribute("data-file-url")).toBe("https://signed.example/rev-1.pdf");
    expect(screen.queryByText("No file has been uploaded for this revision yet.")).not.toBeInTheDocument();
  });

  it("once metadata resolves with no file path on the current revision, renders PdfEvidenceViewer with the exact Workspace unavailable-reason text", async () => {
    renderCanvas("doc-1");
    projectDocumentResult.resolve({ data: { id: "doc-1", name: "Floor Plan", current_revision_id: "rev-1" } });
    documentRevisionResult.resolve({ data: { file_path: null, page_titles: null } });

    await waitFor(() => expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument());
    expect(screen.getByText("No file has been uploaded for this revision yet.")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-viewer").getAttribute("data-file-url")).toBe("");
    // The real AI-analysis-flavored fallback text must never appear here.
    expect(screen.queryByText(/no drawing source in the analysis/i)).not.toBeInTheDocument();
    expect(signedDrawingUrlMock).not.toHaveBeenCalled();
  });

  it("no document selected preserves the existing empty-selection message", () => {
    renderCanvas(null);
    expect(screen.getByText("Select a drawing from Sources to begin.")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-viewer")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading drawing…")).not.toBeInTheDocument();
  });
});
