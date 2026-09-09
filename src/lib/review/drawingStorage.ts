// DRAWING STORAGE — private-bucket upload / signed access / delete.
//
// Thin wrappers over Supabase Storage for project drawing PDFs. The bucket is
// PRIVATE; files are reached only through short-lived signed URLs, and RLS on
// storage.objects (see the migration) enforces that a user can only touch a
// drawing under a project they own or staff. No credentials reach the browser.

import { supabase } from "@/integrations/supabase/client";
import type { StoredDrawing } from "./documentResolve";

export const DRAWINGS_BUCKET = "project-drawings";
/** 50 MB — matches the bucket's file_size_limit. */
export const MAX_DRAWING_BYTES = 52_428_800;
export const ALLOWED_DRAWING_MIME = ["application/pdf"] as const;
/** Signed-URL lifetime (seconds). Short-lived; regenerated on demand, never stored. */
export const SIGNED_URL_TTL = 600;

export interface DrawingValidationResult {
  ok: boolean;
  error?: string;
}

/** Validate a chosen file before upload: PDF only, within the size cap. Pure. */
export function validateDrawingFile(file: { name: string; type: string; size: number }): DrawingValidationResult {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return { ok: false, error: "Only PDF drawings are supported." };
  if (file.type && !(ALLOWED_DRAWING_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, error: `Unsupported file type: ${file.type}.` };
  }
  if (file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_DRAWING_BYTES) {
    return { ok: false, error: `File is too large (max ${Math.round(MAX_DRAWING_BYTES / 1024 / 1024)} MB).` };
  }
  return { ok: true };
}

/**
 * The storage object path for a drawing revision:
 *   "<project_id>/<document_id>/<revision_id>.pdf"
 * The first segment is the project id, which the storage RLS policy checks — so
 * the path itself carries the authorization boundary.
 */
export function buildDrawingPath(projectId: string, documentId: string, revisionId: string, ext = "pdf"): string {
  return `${projectId}/${documentId}/${revisionId}.${ext}`;
}

/** Upload a validated PDF to the private bucket. Throws on failure. */
export async function uploadDrawing(path: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from(DRAWINGS_BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
}

/**
 * A short-lived signed URL for a stored drawing, or null if it can't be signed
 * (missing object, or the caller isn't authorized — RLS denies it). Never throws
 * so the viewer can show a graceful "source drawing unavailable" state.
 */
export async function signedDrawingUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(DRAWINGS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** Remove a stored drawing object. Throws on failure so callers can react. */
export async function deleteDrawing(path: string): Promise<void> {
  const { error } = await supabase.storage.from(DRAWINGS_BUCKET).remove([path]);
  if (error) throw error;
}

/**
 * Load a project's stored drawings for evidence resolution — one entry per
 * project_document, carrying its CURRENT revision's file metadata.
 *
 * Fetches document_revision by the FK-enforced `document_id` column and picks
 * each document's current revision client-side, rather than by
 * `current_revision_id` directly: that column is an intentional soft
 * reference with no foreign key (see the project_workspace migration's
 * "avoids circular FK" comment), so nothing guarantees it's well-formed or
 * still points at a real revision. Filtering document_revision by `id IN
 * (current_revision_id, ...)` batches every document's soft reference into
 * one request — one bad value fails the whole batch, silently blanking
 * every document's filePath, not just the bad one. Filtering by `document_id`
 * (a real FK) can't fail that way: a stale/missing current_revision_id then
 * only fails to resolve its own document.
 *
 * Throws on either query's error rather than degrading to an empty result —
 * a real fetch failure should surface as a fetch failure, not silently read
 * as "no file uploaded".
 */
export async function loadProjectDrawings(projectId: string): Promise<StoredDrawing[]> {
  const { data: docs, error: docsError } = await supabase.from("project_document")
    .select("id, name, current_revision_id").eq("project_id", projectId);
  if (docsError) throw docsError;

  const docIds = (docs ?? []).map((d) => d.id);
  const { data: revs, error: revsError } = docIds.length
    ? await supabase.from("document_revision")
        .select("id, document_id, file_path, original_filename, page_count, page_titles")
        .in("document_id", docIds)
    : { data: [], error: null };
  if (revsError) throw revsError;

  const revById = new Map((revs ?? []).map((r) => [r.id, r]));
  return (docs ?? []).map((d) => {
    const r = d.current_revision_id ? revById.get(d.current_revision_id) : undefined;
    return {
      documentId: d.id, name: d.name, originalFilename: r?.original_filename ?? null,
      filePath: r?.file_path ?? null, pageCount: r?.page_count ?? null,
      pageTitles: (r?.page_titles as Record<string, string> | null | undefined) ?? null,
    };
  });
}
