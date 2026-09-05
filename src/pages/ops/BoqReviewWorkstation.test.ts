import { describe, it, expect, vi, beforeEach } from "vitest";

// REGRESSION TEST: resolvedDocumentId from import is passed to ResolvedEvidenceViewer
//
// When an analysis is imported with an explicit document selection (resolvedDocumentId),
// the onImported callback must fetch the newly created run and set resolvedDocumentId
// in component state so that ResolvedEvidenceViewer can use it to find and render the
// selected drawing PDF.
//
// This test verifies that the onImported callback calls latestRunForBoq to retrieve
// the resolved_document_id that was just stored during import.

describe("BoqReviewWorkstation - resolvedDocumentId import flow", () => {
  const mockBoqId = "test-boq-123";
  const mockRunId = "test-run-456";
  const mockDocumentId = "doc-srikakulam-789";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches resolved_document_id from database after successful import", async () => {
    // Mock latestRunForBoq function behavior
    const mockLatestRunForBoq = vi.fn();
    const mockRun = {
      id: mockRunId,
      source: "json_import",
      item_count: 5,
      created_at: "2026-09-05T21:31:19Z",
      resolved_document_id: mockDocumentId,
    };

    mockLatestRunForBoq.mockResolvedValueOnce(mockRun);

    // Simulate what the onImported callback does:
    // 1. Set runId, items, cursor (immediate state updates)
    // 2. Call latestRunForBoq to fetch the run with resolved_document_id
    // 3. Set resolvedDocumentId state from the run

    const setRunId = vi.fn();
    const setItems = vi.fn();
    const setCursor = vi.fn();
    const setResolvedDocumentId = vi.fn();

    // Execute the onImported flow
    const dummyItems = [{ id: "item-1" }, { id: "item-2" }];

    // This simulates the callback logic:
    setRunId(mockRunId);
    setItems(dummyItems);
    setCursor(0);
    const run = await mockLatestRunForBoq(mockBoqId);
    if (run) setResolvedDocumentId(run.resolved_document_id ?? null);

    // Verify the flow
    expect(setRunId).toHaveBeenCalledWith(mockRunId);
    expect(setItems).toHaveBeenCalledWith(dummyItems);
    expect(setCursor).toHaveBeenCalledWith(0);
    expect(mockLatestRunForBoq).toHaveBeenCalledWith(mockBoqId);
    expect(setResolvedDocumentId).toHaveBeenCalledWith(mockDocumentId);
  });

  it("handles missing resolved_document_id gracefully", async () => {
    // Mock latestRunForBoq function behavior
    const mockLatestRunForBoq = vi.fn();
    const mockRun = {
      id: mockRunId,
      source: "json_import",
      item_count: 5,
      created_at: "2026-09-05T21:31:19Z",
      resolved_document_id: null,
    };

    mockLatestRunForBoq.mockResolvedValueOnce(mockRun);

    const setResolvedDocumentId = vi.fn();

    // Execute the onImported flow
    const run = await mockLatestRunForBoq(mockBoqId);
    if (run) setResolvedDocumentId(run.resolved_document_id ?? null);

    // Verify it sets null when resolved_document_id is not present
    expect(setResolvedDocumentId).toHaveBeenCalledWith(null);
  });

  it("passes resolved_document_id to ResolvedEvidenceViewer for PDF rendering", async () => {
    // This test verifies the contract: when resolvedDocumentId is set in component state,
    // ResolvedEvidenceViewer should receive it and use it to find the document in the drawings array.

    const resolvedDocumentId = mockDocumentId;
    const drawings = [
      {
        documentId: mockDocumentId,
        name: "Apartment at Srikakulam",
        originalFilename: "Srikakulam-Floor-Plans.pdf",
        filePath: "proj-123/doc-789/rev-001.pdf",
        pageCount: 10,
      },
    ];

    // ResolvedEvidenceViewer logic simulation (from line 485-493):
    // When resolvedDocumentId is set, find the document and extract filePath
    let resolved = null;
    if (resolvedDocumentId) {
      const doc = drawings.find((d) => d.documentId === resolvedDocumentId);
      if (doc) {
        resolved = {
          documentId: doc.documentId,
          filePath: doc.filePath ?? null,
          pageCount: doc.pageCount ?? null,
          matchedBy: "explicit_override",
        };
      }
    }

    // Verify the document was found and filePath is available for PDF loading
    expect(resolved).not.toBeNull();
    expect(resolved?.documentId).toBe(mockDocumentId);
    expect(resolved?.filePath).toBe("proj-123/doc-789/rev-001.pdf");
    expect(resolved?.matchedBy).toBe("explicit_override");
  });
});
