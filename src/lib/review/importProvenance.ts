// IMPORT PROVENANCE — ties an imported analysis to the one stored drawing
// revision it was extracted from, by the file's SHA-256 (the same digest the
// ai-analysis function stores as document_revision.content_hash).
//
// A JSON import otherwise creates no analysis_run_source claim, so the Apply
// freshness gate treats its source as unknown. With a verified match, the
// import records exactly what an AI run records — one SUCCEEDED claim naming
// the document and revision — and the existing freshness and provenance
// safeguards apply unchanged. No match, or more than one, means the import is
// refused before anything is written: provenance is never guessed.

import { db } from "@/lib/untypedDb";
import { supabase } from "@/integrations/supabase/client";
import type { AnalysisV1 } from "./analysisSchemaV1";

export interface DrawingRevisionMatch {
  documentId: string;
  documentName: string;
  revisionId: string;
  filename: string | null;
}

export type DrawingMatchResult =
  | { ok: true; match: DrawingRevisionMatch }
  | { ok: false; reason: string };

/** The project's drawing whose CURRENT revision has exactly this content hash. */
export async function findDrawingRevisionByHash(projectId: string, sha256: string): Promise<DrawingMatchResult> {
  const { data: docs, error: docErr } = await db.from("project_document").select("id, name, current_revision_id").eq("project_id", projectId);
  if (docErr) throw docErr;
  const byRevision = new Map(((docs ?? []) as { id: string; name: string; current_revision_id: string | null }[])
    .filter((d) => d.current_revision_id).map((d) => [d.current_revision_id as string, d]));
  if (byRevision.size === 0) return { ok: false, reason: "This project has no uploaded drawings." };
  const { data: revs, error: revErr } = await db.from("document_revision")
    .select("id, document_id, content_hash, original_filename").in("id", [...byRevision.keys()]);
  if (revErr) throw revErr;
  const hits = ((revs ?? []) as { id: string; document_id: string; content_hash: string | null; original_filename: string | null }[])
    .filter((r) => r.content_hash === sha256 && byRevision.get(r.id)?.id === r.document_id);
  if (hits.length === 0) {
    return { ok: false, reason: "The analysed drawing is not the current revision of any drawing in this project, or its fingerprint has not been computed yet. Upload it if it is missing, then open Ops console → this project → Workspace → Analyze Project (that computes drawing fingerprints on the server and runs no AI), and import again." };
  }
  if (hits.length > 1) {
    return { ok: false, reason: `The analysed drawing matches ${hits.length} drawings in this project — it cannot be attributed to one.` };
  }
  const r = hits[0];
  return { ok: true, match: { documentId: r.document_id, documentName: byRevision.get(r.id)!.name, revisionId: r.id, filename: r.original_filename } };
}

/** Items that cite a source but no document get the matched drawing; an item
 *  naming a DIFFERENT document is inconsistent with the stated source. */
export function attributeItemsToDrawing(analysis: AnalysisV1, documentId: string): { ok: true; analysis: AnalysisV1 } | { ok: false; reason: string } {
  const other = analysis.items.filter((it) => it.source?.documentId && it.source.documentId !== documentId);
  if (other.length) {
    return { ok: false, reason: `${other.length} item(s) name a different drawing than the analysis's stated source — not imported.` };
  }
  return {
    ok: true,
    analysis: { ...analysis, items: analysis.items.map((it) => ({ ...it, source: { evidence: [], ...(it.source ?? {}), documentId } })) },
  };
}

/** Record the verified source of an imported run, exactly as an AI run's claim. */
export async function recordImportedRunSource(args: {
  runId: string; projectId: string; boqId: string | null; sha256: string; match: DrawingRevisionMatch; extractor?: string;
}): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const { error } = await db.from("analysis_run_source").insert({
    project_id: args.projectId,
    boq_id: args.boqId,
    content_hash: args.sha256,
    contract_version: "json-import-v1",
    provider: "json_import",
    model: args.extractor ?? "unspecified",
    mode: "BOQ",
    status: "SUCCEEDED",
    document_id: args.match.documentId,
    document_revision_id: args.match.revisionId,
    filename_at_time_of_analysis: args.match.filename,
    analysis_run_id: args.runId,
    claimed_by: userData?.user?.id ?? null,
    completed_at: now,
  });
  if (error) throw error;
}
