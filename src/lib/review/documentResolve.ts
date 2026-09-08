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
  /** Printed sheet title per page number, e.g. { "8": "DOOR/WINDOW SCHEDULE / GROUND FLOOR PLAN" }.
   *  Keys are page numbers as strings (JSON object keys). Optional — most
   *  revisions won't have this populated yet. Never invented by the client. */
  pageTitles?: Record<string, string> | null;
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
 * Resolve a source to a stored drawing, honoring an explicit override chosen
 * during import (e.g. via DocumentSelector) ahead of the normal id/filename/
 * name matching in `resolveDrawing`. Both the item panel and the evidence
 * viewer use this so they agree on what will actually resolve.
 */
export function resolveItemDrawing(
  source: AnalysisSource | undefined,
  drawings: StoredDrawing[],
  resolvedDocumentId?: string | null,
): ResolvedDrawing | null {
  if (resolvedDocumentId) {
    const doc = drawings.find((d) => d.documentId === resolvedDocumentId);
    if (doc) return { documentId: doc.documentId, filePath: doc.filePath ?? null, pageCount: doc.pageCount ?? null, matchedBy: "explicit_override" };
  }
  return resolveDrawing(source, drawings);
}

/**
 * The printed title of one page, if known. Null — never fabricated — when
 * the revision has no page_titles entry for this page.
 */
export function resolvePageTitle(pageTitles: Record<string, string> | null | undefined, page: number): string | null {
  return pageTitles?.[String(page)] ?? null;
}

/**
 * True when a source carries anything resolution should be attempted
 * against — an explicit document id, a filename, or evidence boxes with no
 * document reference. Deliberately broader than "has a document string":
 * an item that only carries `documentId` (no `document` filename) still
 * needs resolving, and skipping it would silently leave it unresolved.
 */
export function hasDocumentReference(source: AnalysisSource | undefined): boolean {
  if (!source) return false;
  return !!(source.documentId || source.document);
}

/** True when any item in the set carries a document reference to resolve. */
export function needsDocumentResolution(sources: (AnalysisSource | undefined)[]): boolean {
  return sources.some(hasDocumentReference);
}

export type DrawingLinkStatus = "linked" | "needs_attention" | "none";

/**
 * The analysis-run-level drawing link state, from actual per-item resolution —
 * never inferred from `resolved_document_id` alone, since a null override can
 * still mean every item resolves fine on its own (id/filename match).
 *   - "none": no item's source references a document at all.
 *   - "linked": every item that references a document resolves to a stored file.
 *   - "needs_attention": at least one item references a document but doesn't
 *     resolve to a stored file (missing mapping, stale id, or no file uploaded).
 */
export function computeDrawingLinkStatus(
  sources: (AnalysisSource | undefined)[],
  drawings: StoredDrawing[],
  resolvedDocumentId?: string | null,
): DrawingLinkStatus {
  const relevant = sources.filter(hasDocumentReference);
  if (relevant.length === 0) return "none";
  const allResolve = relevant.every((s) => !!resolveItemDrawing(s, drawings, resolvedDocumentId)?.filePath);
  return allResolve ? "linked" : "needs_attention";
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
