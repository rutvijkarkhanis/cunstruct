// DOCUMENT RESOLUTION — analysis source → stored Cunstruct drawing.
//
// An analysis item's `source` may reference the drawing by a stable id
// (`document_id`, preferred) or only by filename (`document`). This resolves
// either to a stored project document deterministically, preferring the id so
// resolution doesn't depend on fragile filename matching. Pure; no I/O.

import type { AnalysisSource } from "./analysisSchemaV1";

/** A stored drawing candidate the workstation already loaded for the project. */
export interface StoredDrawing {
  documentId: string;
  name: string;
  originalFilename?: string | null;
  /** Storage path of the current revision's uploaded file, or null if none. */
  filePath?: string | null;
  pageCount?: number | null;
}

export type MatchBasis = "document_id" | "filename" | "name" | "explicit_override" | "none";

export interface ResolvedDrawing {
  documentId: string;
  filePath: string | null;
  pageCount: number | null;
  matchedBy: MatchBasis;
}

export interface ResolutionDiagnostics {
  searchedFor: string | null;
  availableDrawings: { documentId: string; name: string; originalFilename?: string | null }[];
}

const base = (s: string | null | undefined) =>
  (s ?? "").split(/[\\/]/).pop()!.toLowerCase().trim();

/**
 * Resolve a source to a stored drawing, most-reliable signal first:
 *   1) source.documentId → the document with that id;
 *   2) source.document (filename) → a document whose original filename matches;
 *   3) source.document → a document whose display name matches.
 * Returns null when nothing matches (the viewer then shows an unavailable state).
 * A match with no uploaded file returns filePath=null (page reference only).
 */
export function resolveDrawing(source: AnalysisSource | undefined, drawings: StoredDrawing[]): ResolvedDrawing | null {
  if (!source) return null;

  if (source.documentId) {
    const byId = drawings.find((d) => d.documentId === source.documentId);
    if (byId) return { documentId: byId.documentId, filePath: byId.filePath ?? null, pageCount: byId.pageCount ?? null, matchedBy: "document_id" };
    // An explicit id that isn't among the loaded drawings resolves to nothing —
    // we do NOT silently fall back to a same-named different document.
    return null;
  }

  const wanted = base(source.document);
  if (!wanted) return null;

  const byFile = drawings.find((d) => d.originalFilename && base(d.originalFilename) === wanted);
  if (byFile) return { documentId: byFile.documentId, filePath: byFile.filePath ?? null, pageCount: byFile.pageCount ?? null, matchedBy: "filename" };

  const byName = drawings.find((d) => base(d.name) === wanted || d.name.toLowerCase().trim() === (source.document ?? "").toLowerCase().trim());
  if (byName) return { documentId: byName.documentId, filePath: byName.filePath ?? null, pageCount: byName.pageCount ?? null, matchedBy: "name" };

  return null;
}

/**
 * Attempt document resolution and return diagnostics if it fails.
 * Helps users understand why a document reference couldn't be matched
 * and what alternatives are available.
 */
export function resolveDrawingWithDiagnostics(
  source: AnalysisSource | undefined,
  drawings: StoredDrawing[],
): { resolved: ResolvedDrawing; diagnostics: null } | { resolved: null; diagnostics: ResolutionDiagnostics } {
  const resolved = resolveDrawing(source, drawings);
  if (resolved) return { resolved, diagnostics: null };

  return {
    resolved: null,
    diagnostics: {
      searchedFor: source?.document ?? null,
      availableDrawings: drawings.map((d) => ({ documentId: d.documentId, name: d.name, originalFilename: d.originalFilename })),
    },
  };
}
