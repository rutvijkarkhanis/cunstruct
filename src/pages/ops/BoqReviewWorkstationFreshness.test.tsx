// Revision freshness in the review workstation (revisionFreshness.ts):
// the evidence viewer renders the revision the analysis read — or labels the
// provenance unknown — and the Apply dialog is disabled with the reason and
// the existing re-analysis entry point when any source is not current.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResolvedEvidenceViewer, ApplyToBoqDialog, AnalysisFreshnessNotice } from "./BoqReviewWorkstation";
import { classifyRunFreshness, drawingsAsAnalyzed, type ClaimRow } from "@/lib/review/revisionFreshness";
import type { ApplyCandidate } from "@/lib/review/applyReview";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import type { StoredDrawing } from "@/lib/review/documentResolve";

vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: { fileUrl: string | null; documentName: string }) => (
    <div data-testid="pdf-viewer" data-file-url={props.fileUrl ?? ""} data-document-name={props.documentName} />
  ),
}));
const signedDrawingUrl = vi.fn(async (path: string) => `https://signed.example/${path}`);
vi.mock("@/lib/review/drawingStorage", () => ({ signedDrawingUrl: (path: string) => signedDrawingUrl(path) }));

const item: StoredReviewItem = {
  id: "item-1", reviewStatus: "VERIFIED",
  ai: { key: "W1", item: "Window W1", quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED", source: { documentId: "doc-a", page: 1, evidence: [] } },
} as StoredReviewItem;

// What loadProjectDrawings returns: the CURRENT revision's file.
const currentDrawings: StoredDrawing[] = [
  { documentId: "doc-a", name: "Plan A", originalFilename: "plan-rev-b.pdf", filePath: "drawings/rev-b.pdf", pageCount: 1, pageTitles: null },
];
const documents = [{ id: "doc-a", name: "Plan A", current_revision_id: "rev-b" }];
const revisions = [
  { id: "rev-a", document_id: "doc-a", label: "Rev A", file_path: "drawings/rev-a.pdf", original_filename: "plan-rev-a.pdf", page_count: 1, page_titles: null },
  { id: "rev-b", document_id: "doc-a", label: "Rev B", file_path: "drawings/rev-b.pdf", original_filename: "plan-rev-b.pdf", page_count: 1, page_titles: null },
];
const freshnessFor = (claims: ClaimRow[]) => classifyRunFreshness({ runId: "run-1", claims, documents, revisions, referencedDocumentIds: ["doc-a"] });

beforeEach(() => signedDrawingUrl.mockClear());

describe("ResolvedEvidenceViewer — analysed revision", () => {
  it("superseded: renders the analysed revision's file and says the current revision is newer", async () => {
    const freshness = freshnessFor([{ document_id: "doc-a", document_revision_id: "rev-a", status: "SUCCEEDED" }]);
    render(<ResolvedEvidenceViewer item={item} drawings={drawingsAsAnalyzed(currentDrawings, freshness)} freshness={freshness} freshnessChecking={false} />);

    await waitFor(() => expect(screen.getByTestId("pdf-viewer").getAttribute("data-file-url")).toBe("https://signed.example/drawings/rev-a.pdf"));
    expect(signedDrawingUrl).toHaveBeenCalledWith("drawings/rev-a.pdf");
    expect(signedDrawingUrl).not.toHaveBeenCalledWith("drawings/rev-b.pdf");
    expect(screen.getByTestId("evidence-provenance").textContent).toBe("Showing Rev A, the revision this analysis read. The current revision is now Rev B.");
  });

  it("unknown provenance (JSON import): the current drawing is shown only with an explicit 'source revision unknown' label", async () => {
    const freshness = freshnessFor([]);
    render(<ResolvedEvidenceViewer item={item} drawings={drawingsAsAnalyzed(currentDrawings, freshness)} freshness={freshness} freshnessChecking={false} />);

    await waitFor(() => expect(screen.getByTestId("pdf-viewer").getAttribute("data-file-url")).toBe("https://signed.example/drawings/rev-b.pdf"));
    expect(screen.getByTestId("evidence-provenance").textContent).toMatch(/^Source revision unknown\. This is the current drawing \(Rev B\)/);
  });

  it("current: no provenance notice (existing view unchanged)", async () => {
    const current = classifyRunFreshness({
      runId: "run-1", documents, revisions, referencedDocumentIds: [],
      claims: [{ document_id: "doc-a", document_revision_id: "rev-b", status: "SUCCEEDED" }],
    });
    render(<ResolvedEvidenceViewer item={item} drawings={drawingsAsAnalyzed(currentDrawings, current)} freshness={current} freshnessChecking={false} />);

    await waitFor(() => expect(screen.getByTestId("pdf-viewer").getAttribute("data-file-url")).toBe("https://signed.example/drawings/rev-b.pdf"));
    expect(screen.queryByTestId("evidence-provenance")).toBeNull();
  });

  it("while the check is running the drawing is labelled as not yet confirmed", async () => {
    render(<ResolvedEvidenceViewer item={item} drawings={currentDrawings} freshness={undefined} freshnessChecking />);
    expect(screen.getByTestId("evidence-provenance").textContent).toBe("Checking which revision this analysis read…");
    await waitFor(() => expect(screen.getByTestId("pdf-viewer").getAttribute("data-file-url")).not.toBe(""));
  });
});

describe("Apply dialog — blocked by revision freshness", () => {
  const candidates: ApplyCandidate[] = [{
    reviewItemId: "1", itemKey: "W1", itemName: "Window W1", classification: "APPLY", matchedLineId: "line-1",
    changes: [{ field: "qty", from: "9", to: "8" }], unsupportedChanges: [],
  }];

  it("lists the stale source, disables Apply, and offers the existing re-analysis action", () => {
    const freshness = freshnessFor([{ document_id: "doc-a", document_revision_id: "rev-a", status: "SUCCEEDED" }]);
    const onApply = vi.fn();
    const onReanalyse = vi.fn();
    render(
      <ApplyToBoqDialog candidates={candidates} selectedIds={new Set(["1"])} onToggle={() => {}} onSelectAll={() => {}} onApply={onApply} applying={false}
        blockedNotice={<AnalysisFreshnessNotice freshness={freshness} onReanalyse={onReanalyse} />} />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Plan A: this analysis read Rev A, but the current revision is now Rev B.");
    const apply = screen.getByRole("button", { name: /Apply 1 to BOQ/ });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Re-analyse current drawings" }));
    expect(onReanalyse).toHaveBeenCalledTimes(1);
  });

  it("an imported analysis with no drawing record says how to make it applicable; a stale revision does not get that hint", () => {
    const { unmount } = render(<AnalysisFreshnessNotice freshness={freshnessFor([])} onReanalyse={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("add \"source_drawing\": { \"sha256\": \"…\" } (the drawing file's SHA-256) to the JSON and load it again");
    unmount();
    render(<AnalysisFreshnessNotice freshness={freshnessFor([{ document_id: "doc-a", document_revision_id: "rev-a", status: "SUCCEEDED" }])} onReanalyse={() => {}} />);
    expect(screen.getByRole("alert").textContent).not.toContain("source_drawing");
  });

  it("without a blocked notice, Apply is enabled exactly as before", () => {
    render(<ApplyToBoqDialog candidates={candidates} selectedIds={new Set(["1"])} onToggle={() => {}} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    expect(screen.getByRole("button", { name: /Apply 1 to BOQ/ })).toBeEnabled();
  });
});
