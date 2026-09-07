import { describe, it, expect } from "vitest";
import { resolveDrawing, resolveDrawingWithDiagnostics, resolveItemDrawing, resolvePageTitle, type StoredDrawing } from "./documentResolve";
import type { AnalysisSource } from "./analysisSchemaV1";

const drawings: StoredDrawing[] = [
  {
    documentId: "doc-001",
    name: "Floor Plan",
    originalFilename: "floor-plan.pdf",
    filePath: "proj-a/doc-001/rev-1.pdf",
    pageCount: 5,
  },
  {
    documentId: "doc-002",
    name: "Srikakulam Drawing",
    originalFilename: "Srikakulam.pdf",
    filePath: "proj-a/doc-002/rev-2.pdf",
    pageCount: 10,
  },
  {
    documentId: "doc-003",
    name: "Specifications",
    originalFilename: null,
    filePath: null,
    pageCount: null,
  },
];

describe("resolveDrawing", () => {
  it("matches by explicit document_id", () => {
    const source: AnalysisSource = {
      documentId: "doc-001",
      document: "ignored-name.pdf",
      page: 1,
    };
    const resolved = resolveDrawing(source, drawings);
    expect(resolved).toBeDefined();
    expect(resolved?.documentId).toBe("doc-001");
    expect(resolved?.matchedBy).toBe("document_id");
  });

  it("matches by original filename (case-insensitive, ignoring path)", () => {
    const source: AnalysisSource = {
      document: "floor-plan.pdf",
      page: 1,
    };
    const resolved = resolveDrawing(source, drawings);
    expect(resolved?.documentId).toBe("doc-001");
    expect(resolved?.matchedBy).toBe("filename");
  });

  it("matches by display name", () => {
    const source: AnalysisSource = {
      document: "Floor Plan",
      page: 1,
    };
    const resolved = resolveDrawing(source, drawings);
    expect(resolved?.documentId).toBe("doc-001");
    expect(resolved?.matchedBy).toBe("name");
  });

  it("returns null when nothing matches", () => {
    const source: AnalysisSource = {
      document: "nonexistent.pdf",
      page: 1,
    };
    const resolved = resolveDrawing(source, drawings);
    expect(resolved).toBeNull();
  });

  it("returns null when documentId is specified but not found", () => {
    const source: AnalysisSource = {
      documentId: "doc-999",
      document: "floor-plan.pdf",
      page: 1,
    };
    const resolved = resolveDrawing(source, drawings);
    expect(resolved).toBeNull();
  });

  it("handles null source gracefully", () => {
    const resolved = resolveDrawing(undefined, drawings);
    expect(resolved).toBeNull();
  });

  it("handles drawing with no uploaded file (filePath=null)", () => {
    const source: AnalysisSource = {
      document: "Specifications",
      page: 1,
    };
    const resolved = resolveDrawing(source, drawings);
    expect(resolved?.documentId).toBe("doc-003");
    expect(resolved?.filePath).toBeNull();
    expect(resolved?.pageCount).toBeNull();
  });

  it("prefers exact id match over same name", () => {
    const singleMatch: StoredDrawing[] = [
      { documentId: "doc-a", name: "Floor", originalFilename: "floor.pdf", filePath: "p/doc-a/r1.pdf", pageCount: 1 },
      { documentId: "doc-b", name: "Different", originalFilename: null, filePath: null, pageCount: null },
    ];
    const source: AnalysisSource = {
      documentId: "doc-a",
      document: "nonexistent.pdf",
      page: 1,
    };
    const resolved = resolveDrawing(source, singleMatch);
    expect(resolved?.documentId).toBe("doc-a");
  });
});

describe("resolveDrawingWithDiagnostics", () => {
  it("returns resolved drawing when match found", () => {
    const source: AnalysisSource = {
      document: "Floor Plan",
      page: 1,
    };
    const result = resolveDrawingWithDiagnostics(source, drawings);
    expect(result.resolved).toBeDefined();
    expect(result.diagnostics).toBeNull();
  });

  it("returns diagnostics when resolution fails", () => {
    const source: AnalysisSource = {
      document: "Missing Drawing.pdf",
      page: 1,
    };
    const result = resolveDrawingWithDiagnostics(source, drawings);
    expect(result.resolved).toBeNull();
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics?.searchedFor).toBe("Missing Drawing.pdf");
    expect(result.diagnostics?.availableDrawings).toHaveLength(3);
  });

  it("includes all available drawings in diagnostics", () => {
    const source: AnalysisSource = {
      document: "not found",
      page: 1,
    };
    const result = resolveDrawingWithDiagnostics(source, drawings);
    const available = result.diagnostics?.availableDrawings ?? [];
    expect(available.map((d) => d.documentId)).toEqual(["doc-001", "doc-002", "doc-003"]);
  });

  it("includes originalFilename in diagnostics when available", () => {
    const source: AnalysisSource = {
      document: "not found",
      page: 1,
    };
    const result = resolveDrawingWithDiagnostics(source, drawings);
    const doc001 = result.diagnostics?.availableDrawings.find((d) => d.documentId === "doc-001");
    expect(doc001?.originalFilename).toBe("floor-plan.pdf");
  });

  it("handles empty drawings array", () => {
    const source: AnalysisSource = {
      document: "anything",
      page: 1,
    };
    const result = resolveDrawingWithDiagnostics(source, []);
    expect(result.resolved).toBeNull();
    expect(result.diagnostics?.availableDrawings).toHaveLength(0);
  });
});

describe("resolveItemDrawing", () => {
  it("honors an explicit resolvedDocumentId override ahead of normal matching", () => {
    const source: AnalysisSource = { document: "floor-plan.pdf", evidence: [] };
    // Without an override, this would match doc-001 by filename.
    const result = resolveItemDrawing(source, drawings, "doc-003");
    expect(result?.documentId).toBe("doc-003");
    expect(result?.matchedBy).toBe("explicit_override");
  });

  it("falls back to normal resolution when no override is given", () => {
    const source: AnalysisSource = { document: "floor-plan.pdf", evidence: [] };
    const result = resolveItemDrawing(source, drawings, null);
    expect(result?.documentId).toBe("doc-001");
    expect(result?.matchedBy).toBe("filename");
  });

  it("falls back to normal resolution when the override id isn't among the loaded drawings", () => {
    const source: AnalysisSource = { document: "floor-plan.pdf", evidence: [] };
    const result = resolveItemDrawing(source, drawings, "doc-does-not-exist");
    expect(result?.documentId).toBe("doc-001");
    expect(result?.matchedBy).toBe("filename");
  });

  it("returns null when neither the override nor normal resolution match", () => {
    const source: AnalysisSource = { document: "unknown.pdf", evidence: [] };
    expect(resolveItemDrawing(source, drawings, undefined)).toBeNull();
  });
});

describe("resolvePageTitle", () => {
  // Verified directly against the real Srikakulam PDF (9 pages) — see
  // evidenceDisplay.test.ts for the full set. Only a subset is populated here
  // on purpose: a real drawing set won't have every page titled.
  const pageTitles: Record<string, string> = {
    "1": "STILT FLOOR PLAN",
    "5": "BRICKWORK DRAWING / GROUND FLOOR PLAN",
    "8": "DOOR/WINDOW SCHEDULE / GROUND FLOOR PLAN",
  };

  it("returns the title for a page that has one", () => {
    expect(resolvePageTitle(pageTitles, 8)).toBe("DOOR/WINDOW SCHEDULE / GROUND FLOOR PLAN");
  });

  it("returns null for a page with no title entry (never fabricated)", () => {
    expect(resolvePageTitle(pageTitles, 2)).toBeNull();
  });

  it("returns null when pageTitles is null", () => {
    expect(resolvePageTitle(null, 1)).toBeNull();
  });

  it("returns null when pageTitles is undefined", () => {
    expect(resolvePageTitle(undefined, 1)).toBeNull();
  });
});
