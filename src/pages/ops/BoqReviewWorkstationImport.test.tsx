// IMPORT-TIME RESOLUTION — regression tests for the evidence-resolution fix.
//
// Three real-world failure modes, all traced from the actual Srikakulam project:
//   1. An item referencing a document only by `document_id` (no filename) used
//      to be invisible to resolution-detection (`needsDocResolution` only
//      checked `source.document`) and got imported silently unresolved.
//   2. A project with zero drawings uploaded yet used to skip resolution
//      entirely (`drawings.length === 0` short-circuit) — now it still shows
//      the selector, with an explicit "import unresolved, link later" choice.
//   3. A `document_id` that doesn't match any stored drawing must never be
//      silently re-matched by filename, even when the filename WOULD match —
//      resolveDrawing already guarantees this; this file proves ImportGate's
//      gate reaches it correctly.
//
// createAnalysisRun/loadReviewItems are mocked at the reviewStore boundary —
// ImportGate takes `drawings` as a prop, so no supabase/query mocking is needed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportGate } from "./BoqReviewWorkstation";
import type { StoredDrawing } from "@/lib/review/documentResolve";

const createAnalysisRun = vi.fn(async (args: { resolvedDocumentId?: string | null }) => ({ runId: "run-1" }));
const loadReviewItems = vi.fn(async () => []);

vi.mock("@/lib/review/reviewStore", () => ({
  createAnalysisRun: (args: unknown) => createAnalysisRun(args as { resolvedDocumentId?: string | null }),
  loadReviewItems: () => loadReviewItems(),
}));

const oneDrawing: StoredDrawing[] = [
  { documentId: "doc-1", name: "Floor Plan", originalFilename: "floor-plan.pdf", filePath: "p/doc-1/r1.pdf", pageCount: 5 },
];

function jsonWith(source: Record<string, unknown>) {
  return JSON.stringify({
    schema_version: "cunstruct.analysis.v1",
    items: [{ item: "Window W1", quantity: 7, confidence: 0.9, source }],
  });
}

function renderGate(drawings: StoredDrawing[]) {
  const onImported = vi.fn();
  render(
    <ImportGate
      boqId="boq-1" projectId="proj-1" projectType={null} boqName="Test BOQ"
      onImported={onImported} drawings={drawings} onBack={vi.fn()}
    />,
  );
  return { onImported };
}

beforeEach(() => { createAnalysisRun.mockClear(); loadReviewItems.mockClear(); });

describe("needsDocumentResolution fix — documentId-only reference", () => {
  it("shows the document selector for an item with only document_id (no filename)", async () => {
    renderGate(oneDrawing);
    fireEvent.change(screen.getByPlaceholderText(/Paste Cunstruct analysis JSON/), {
      target: { value: jsonWith({ document_id: "doc-999" }) },
    });
    fireEvent.click(screen.getByText("Validate & load for review"));

    // doc-999 doesn't match the one stored drawing → selector, not a silent import.
    expect(await screen.findByText("Select a drawing for this analysis")).toBeInTheDocument();
    expect(createAnalysisRun).not.toHaveBeenCalled();
  });
});

describe("conflicting document_id — never silently filename-matched", () => {
  it("still shows the selector when document_id conflicts, even though the filename would match", async () => {
    renderGate(oneDrawing);
    fireEvent.change(screen.getByPlaceholderText(/Paste Cunstruct analysis JSON/), {
      target: { value: jsonWith({ document_id: "doc-999", document: "floor-plan.pdf" }) },
    });
    fireEvent.click(screen.getByText("Validate & load for review"));

    expect(await screen.findByText("Select a drawing for this analysis")).toBeInTheDocument();
    expect(createAnalysisRun).not.toHaveBeenCalled();

    // Only an explicit pick may proceed — clicking it uses the CHOSEN doc, not a guess.
    fireEvent.click(screen.getByText("Use this drawing"));
    await waitFor(() => expect(createAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedDocumentId: "doc-1" }),
    ));
  });
});

describe("zero drawings — no silent skip, explicit unresolved import allowed", () => {
  it("shows the empty-state selector instead of importing silently", async () => {
    renderGate([]);
    fireEvent.change(screen.getByPlaceholderText(/Paste Cunstruct analysis JSON/), {
      target: { value: jsonWith({ document: "some-drawing.pdf" }) },
    });
    fireEvent.click(screen.getByText("Validate & load for review"));

    expect(await screen.findByText("Analysis drawing not found")).toBeInTheDocument();
    expect(createAnalysisRun).not.toHaveBeenCalled();
  });

  it("'Import without linking' proceeds with resolvedDocumentId left null, not guessed", async () => {
    renderGate([]);
    fireEvent.change(screen.getByPlaceholderText(/Paste Cunstruct analysis JSON/), {
      target: { value: jsonWith({ document: "some-drawing.pdf" }) },
    });
    fireEvent.click(screen.getByText("Validate & load for review"));

    fireEvent.click(await screen.findByText(/Import without linking/));
    await waitFor(() => expect(createAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedDocumentId: null }),
    ));
  });
});

describe("no document reference at all — imports directly, as before", () => {
  it("skips the selector entirely when nothing references a document", async () => {
    render(
      <ImportGate boqId="boq-1" projectId="proj-1" projectType={null} onImported={vi.fn()} drawings={oneDrawing} onBack={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste Cunstruct analysis JSON/), {
      target: { value: JSON.stringify({ schema_version: "cunstruct.analysis.v1", items: [{ item: "Generic line", quantity: 1, confidence: 0.9 }] }) },
    });
    fireEvent.click(screen.getByText("Validate & load for review"));

    await waitFor(() => expect(createAnalysisRun).toHaveBeenCalledWith(expect.objectContaining({ resolvedDocumentId: null })));
    expect(screen.queryByText("Select a drawing for this analysis")).toBeNull();
  });
});
