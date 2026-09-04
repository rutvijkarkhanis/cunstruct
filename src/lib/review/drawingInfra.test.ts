import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDrawingFile, buildDrawingPath, MAX_DRAWING_BYTES } from "./drawingStorage";
import { resolveDrawing, type StoredDrawing } from "./documentResolve";
import { resolvePageSpace } from "./evidenceCoords";
import { parseAnalysisV1 } from "./analysisSchemaV1";

describe("drawing upload validation", () => {
  it("accepts a PDF within the size cap", () => {
    expect(validateDrawingFile({ name: "plan.pdf", type: "application/pdf", size: 1_000 }).ok).toBe(true);
  });
  it("rejects non-PDF types (no silent acceptance of arbitrary files)", () => {
    expect(validateDrawingFile({ name: "x.exe", type: "application/x-msdownload", size: 10 }).ok).toBe(false);
    expect(validateDrawingFile({ name: "img.png", type: "image/png", size: 10 }).ok).toBe(false);
  });
  it("rejects an empty or oversized file", () => {
    expect(validateDrawingFile({ name: "a.pdf", type: "application/pdf", size: 0 }).ok).toBe(false);
    expect(validateDrawingFile({ name: "a.pdf", type: "application/pdf", size: MAX_DRAWING_BYTES + 1 }).ok).toBe(false);
  });
});

describe("storage path carries the project boundary", () => {
  it("puts the project id as the first path segment (RLS keys off it)", () => {
    expect(buildDrawingPath("proj-1", "doc-2", "rev-3")).toBe("proj-1/doc-2/rev-3.pdf");
  });
});

describe("document resolution — id first, then filename", () => {
  const drawings: StoredDrawing[] = [
    { documentId: "d1", name: "First Floor Plan", originalFilename: "floor-plan.pdf", filePath: "proj/d1/rev.pdf", pageCount: 6 },
    { documentId: "d2", name: "Elevations", originalFilename: "elevations.pdf", filePath: null, pageCount: null },
  ];
  it("resolves by document_id when present (most reliable)", () => {
    const r = resolveDrawing({ documentId: "d2", document: "floor-plan.pdf", evidence: [] }, drawings);
    expect(r?.documentId).toBe("d2");
    expect(r?.matchedBy).toBe("document_id");
  });
  it("does NOT fall back to a same-named doc when an explicit id misses", () => {
    expect(resolveDrawing({ documentId: "nope", document: "floor-plan.pdf", evidence: [] }, drawings)).toBeNull();
  });
  it("resolves by filename when no id is given", () => {
    const r = resolveDrawing({ document: "floor-plan.pdf", evidence: [] }, drawings);
    expect(r?.documentId).toBe("d1");
    expect(r?.filePath).toBe("proj/d1/rev.pdf");
    expect(r?.matchedBy).toBe("filename");
  });
  it("returns a match with filePath=null when the doc has no uploaded file", () => {
    const r = resolveDrawing({ document: "elevations.pdf", evidence: [] }, drawings);
    expect(r?.documentId).toBe("d2");
    expect(r?.filePath).toBeNull();
  });
  it("returns null when nothing matches (viewer shows unavailable)", () => {
    expect(resolveDrawing({ document: "ghost.pdf", evidence: [] }, drawings)).toBeNull();
    expect(resolveDrawing(undefined, drawings)).toBeNull();
  });
});

describe("coordinate convention — resolvePageSpace (single source of truth)", () => {
  it("prefers the analysis-declared page size", () => {
    expect(resolvePageSpace({ pageSize: { width: 2000, height: 1500 } }, { width: 612, height: 792 })).toEqual({ width: 2000, height: 1500 });
  });
  it("falls back to the PDF page's scale-1 size when none is declared", () => {
    expect(resolvePageSpace({}, { width: 612, height: 792 })).toEqual({ width: 612, height: 792 });
  });
  it("returns null when neither is available (never guesses)", () => {
    expect(resolvePageSpace(undefined, null)).toBeNull();
  });
});

describe("analysis schema — document_id + page_size are backward compatible", () => {
  it("parses document_id and page_size from source, keeps old JSON valid", () => {
    const r = parseAnalysisV1(JSON.stringify({ items: [
      { item: "W1", quantity: 3, source: { document_id: "d1", document: "floor-plan.pdf", page: 4, page_size: [2000, 1500], evidence: [{ bbox: [1, 2, 3, 4] }] } },
      { item: "W2", quantity: 1, source: { document: "old.pdf", page: 1, evidence: [] } }, // legacy, no id/page_size
    ] }));
    expect(r.ok).toBe(true);
    expect(r.analysis!.items[0].source?.documentId).toBe("d1");
    expect(r.analysis!.items[0].source?.pageSize).toEqual({ width: 2000, height: 1500 });
    expect(r.analysis!.items[1].source?.documentId).toBeUndefined();
    expect(r.analysis!.items[1].source?.pageSize).toBeUndefined();
  });
});

describe("drawing storage migration artifact", () => {
  const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/20260918000000_drawing_storage.sql"), "utf8").toLowerCase();
  it("adds file metadata columns to document_revision (additive)", () => {
    expect(SQL).toContain("add column if not exists mime_type");
    expect(SQL).toContain("add column if not exists file_size");
    expect(SQL).toContain("add column if not exists original_filename");
  });
  it("creates a PRIVATE bucket (public=false), never a public one", () => {
    expect(SQL).toMatch(/insert into storage\.buckets[\s\S]*'project-drawings'[\s\S]*false/);
    expect(SQL).not.toMatch(/'project-drawings'[\s\S]*?,\s*true\s*,/);
  });
  it("restricts PDF only and caps the size at 50MB", () => {
    expect(SQL).toContain("array['application/pdf']");
    expect(SQL).toContain("52428800");
  });
  it("gates storage.objects by the owning project via the path prefix", () => {
    expect(SQL).toMatch(/p\.id::text = \(storage\.foldername\(name\)\)\[1\] and p\.owner_id = auth\.uid\(\)/);
    expect(SQL).toContain("public.is_staff(auth.uid())");
    expect(SQL).not.toContain("using (true)");
  });
});
