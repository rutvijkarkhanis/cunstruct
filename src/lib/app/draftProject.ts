// DRAWING-FIRST PROJECT DRAFT — the project record a drawing upload creates,
// so work can start from the drawings without a questionnaire. Only the name
// is required by the schema; every other detail (client, location, type,
// floors, area…) can be added later and is left empty, never guessed.
//
// Ownership: the signed-in staff user is recorded as the project's owner and
// account manager, so the draft is attributable and stays visible to them in
// every list (the staff list shows it through the existing "Staff manage all
// projects" policy; /my-projects through "Owner views own project"). No other
// user gains access to it.
//
// Server processing (projects.ai_processing_enabled) stays as the person
// chose: off unless they explicitly allowed it. Drawing fingerprints and AI
// analysis both need it; neither is switched on behind their back.
import { supabase } from "@/integrations/supabase/client";
import { validateDrawingFile } from "@/lib/review/drawingStorage";

const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** A temporary, recognisable name: the first drawing's file name, or a dated
 *  placeholder. Rename it any time from the project header. */
export function draftProjectName(files: readonly { name: string }[], now: Date = new Date()): string {
  const stem = files[0]?.name.replace(/\.pdf$/i, "").trim();
  return stem ? `${stem} (draft)` : `Untitled project ${day(now)}`;
}

export interface FileCheck<F> { file: F; ok: boolean; error: string | null }

/** Each chosen file with the existing drawing rules applied (PDF only, size limit). */
export function checkDrawingFiles<F extends { name: string; type: string; size: number }>(files: readonly F[]): FileCheck<F>[] {
  return files.map((file) => {
    const r = validateDrawingFile(file);
    return { file, ok: r.ok, error: r.ok ? null : (r.error ?? "This file cannot be uploaded.") };
  });
}

/** Creates the draft. Throws with the database's message when it is refused. */
export async function createDraftProject(args: { name: string; userId: string; allowServerProcessing: boolean }): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase.from("projects")
    .insert({
      name: args.name,
      owner_id: args.userId,
      account_manager_id: args.userId,
      ai_processing_enabled: args.allowServerProcessing,
    })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; name: string };
}

/** Turns server processing on for one project, on the person's explicit request. */
export async function allowServerProcessing(projectId: string): Promise<void> {
  const { data, error } = await supabase.from("projects")
    .update({ ai_processing_enabled: true }).eq("id", projectId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("This project could not be updated. You may not have permission to change it.");
}

/** Renames a project (any project the person may already edit). */
export async function renameProject(projectId: string, name: string): Promise<void> {
  const to = name.trim();
  if (!to) throw new Error("Enter a project name.");
  const { data, error } = await supabase.from("projects").update({ name: to }).eq("id", projectId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("This project could not be renamed. You may not have permission to change it.");
}
