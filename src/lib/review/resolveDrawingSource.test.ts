// Scope H follow-up — the shared source-reference resolution rule extracted
// from OpsBoqBuilder.tsx's single-BOQ export path (resolveLineSource) so the
// combined multi-BOQ export (ProjectBoqs.tsx) uses the exact same semantics
// instead of a second, competing resolution model. Pure function, no I/O —
// `drawingsById` is exactly what loadProjectDrawings(projectId) produces,
// already keyed and already project-scoped by that function's own query.
import { describe, it, expect } from "vitest";
import { resolveDrawingSource } from "./drawingStorage";
import type { StoredDrawing } from "./documentResolve";

const DRAWING: StoredDrawing = { documentId: "doc-1", name: "Floor 1 Plan" };

describe("resolveDrawingSource", () => {
  it("resolved id with a page: returns the real document name and the page", () => {
    const map = new Map([["doc-1", DRAWING]]);
    expect(resolveDrawingSource("doc-1", "3", map, false)).toEqual({
      sourceDocument: "Floor 1 Plan", sourcePage: "3",
    });
  });

  it("resolved id with no page: returns the name alone, never an invented page", () => {
    const map = new Map([["doc-1", DRAWING]]);
    expect(resolveDrawingSource("doc-1", null, map, false)).toEqual({
      sourceDocument: "Floor 1 Plan", sourcePage: null,
    });
  });

  it("unresolved id, loading finished: 'Source document unavailable', no page even if one was recorded", () => {
    const map = new Map<string, StoredDrawing>();
    expect(resolveDrawingSource("doc-missing", "7", map, false)).toEqual({
      sourceDocument: "Source document unavailable", sourcePage: null,
    });
  });

  it("id present but drawings still loading: no annotation yet — never a premature 'unavailable'", () => {
    const map = new Map<string, StoredDrawing>();
    expect(resolveDrawingSource("doc-missing", "7", map, true)).toEqual({
      sourceDocument: null, sourcePage: null,
    });
  });

  it("no source_document_id at all: no annotation, regardless of loading state", () => {
    const map = new Map([["doc-1", DRAWING]]);
    expect(resolveDrawingSource(null, null, map, false)).toEqual({ sourceDocument: null, sourcePage: null });
    expect(resolveDrawingSource(undefined, undefined, map, true)).toEqual({ sourceDocument: null, sourcePage: null });
  });

  it("project scoping: a document id that belongs to a DIFFERENT project's map never resolves here", () => {
    // Simulates two projects' own loadProjectDrawings results — disjoint maps,
    // exactly as the real project_id-filtered query produces. The same id
    // that resolves in project B's map must not leak a name when resolved
    // against project A's map, even though the id itself is identical.
    const projectAMap = new Map<string, StoredDrawing>([["doc-shared-id", { documentId: "doc-shared-id", name: "Project A's Drawing" }]]);
    const projectBMap = new Map<string, StoredDrawing>(); // doc-shared-id does not belong to project B

    expect(resolveDrawingSource("doc-shared-id", "1", projectAMap, false)).toEqual({
      sourceDocument: "Project A's Drawing", sourcePage: "1",
    });
    // Resolved against project B's (correctly scoped, disjoint) map, the same
    // id is simply not found — never falls back to project A's name.
    expect(resolveDrawingSource("doc-shared-id", "1", projectBMap, false)).toEqual({
      sourceDocument: "Source document unavailable", sourcePage: null,
    });
  });
});
