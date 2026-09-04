// DRAWING STORAGE — private-bucket upload / signed access / delete.
//
// Thin wrappers over Supabase Storage for project drawing PDFs. The bucket is
// PRIVATE; files are reached only through short-lived signed URLs, and RLS on
// storage.objects (see the migration) enforces that a user can only touch a
// drawing under a project they own or staff. No credentials reach the browser.

import { supabase } from "@/integrations/supabase/client";

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
