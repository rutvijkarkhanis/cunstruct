// BOQ <-> DOCUMENT PROVENANCE — PR #154, the first Coverage/Completeness
// prerequisite (see the Phase A follow-up product review). Persists the
// document -> BOQ mapping Analyze Project actually submitted and
// successfully executed into the EXISTING `boq_document` table (M:N,
// `unique (boq_id, document_id)` — see 20260901000000_project_workspace.sql).
//
// Before this file, that mapping existed only as Analyze Project's own
// session-local UI state (WorkspaceAnalyzePanel.tsx's `assignment` state) —
// nothing survived past the browser tab. Coverage's future evidence ->
// document -> BOQ traversal needs a durable answer to "which documents feed
// this BOQ," so this makes that answer durable. It does nothing else: no
// Coverage signal, no finding, no status, no new table, no AI call.
//
// Writes ONLY `boq_document` (Scope F additionally READS analysis_run_source/
// document_revision, via resolveAnalyzedRevisionId, to resolve the revision to
// write — it never writes either). Never touches boq_line, analysis_review_item,
// or any reconciliation/readiness logic — this module has no opinion on
// whether an analysis succeeded; its caller (projectAnalysis.ts's
// runProjectAnalysis) only ever invokes it AFTER a discipline's own BOQ
// analysis call has already succeeded.

import { supabase } from "@/integrations/supabase/client";
import { resolveAnalyzedRevisionId } from "./applyReview";

/**
 * Link every document in `documentIds` to `boqId`.
 *
 * Idempotent via the table's own `unique (boq_id, document_id)` constraint:
 * an upsert with `ignoreDuplicates: true` is `ON CONFLICT (boq_id,
 * document_id) DO NOTHING` — a pair already linked is left completely
 * untouched (including its existing `analyzed_revision_id`, even one a staff
 * member manually picked in BoqDocumentsPanel.tsx), never duplicated and
 * never silently overwritten with a value this run happens to have. The
 * constraint itself is never weakened or bypassed — this is also exactly why
 * Scope F needs no extra guard against clobbering a manual override: a row
 * that already exists is never touched by this call at all, regardless of
 * what `analyzed_revision_id` would otherwise resolve to below.
 *
 * ## `analyzed_revision_id` — resolution, Scope F
 *
 * For a genuinely NEW (boq_id, document_id) pair, resolved with the same
 * precedence Scope E established for `boq_line.source_revision_id`
 * (applyReview.ts's resolveSourceRevisionId/resolveAnalyzedRevisionId):
 *
 *   1. `runId` given, and exactly one SUCCEEDED analysis_run_source claim for
 *      (runId, documentId) names a document_revision_id that genuinely
 *      exists and belongs to documentId → that EXACT analyzed revision.
 *   2. No usable claim (no `runId`, no claim at all, or the one claim's
 *      revision is invalid/cross-document) → the pre-existing fallback:
 *      `project_document.current_revision_id`, read fresh at this moment —
 *      a best-effort "current revision as of persistence time," NOT
 *      necessarily the exact revision analyzed. Unchanged from before Scope F.
 *   3. More than one SUCCEEDED claim for (runId, documentId) naming
 *      DIFFERING revisions → `null`, explicitly — never an arbitrary pick,
 *      and never the fallback either (same conflict policy as Scope E).
 *
 * `runId` is optional so every existing caller that predates this parameter
 * (and any that legitimately has none — e.g. a future non-analysis caller)
 * keeps compiling and behaving exactly as before: omitting it always takes
 * path 2 above, unchanged.
 *
 * A document missing from the result entirely (deleted, or an id that
 * doesn't resolve) gets NULL — never a fabricated or stale guess.
 *
 * A no-op for an empty `documentIds` (never issues a query, never creates a
 * boq-with-nothing-linked row — there's nothing to link).
 */
export async function linkAnalyzedDocumentsToBoq(boqId: string, documentIds: string[], runId?: string | null): Promise<void> {
  if (documentIds.length === 0) return;

  const { data: docs, error: docsError } = await supabase
    .from("project_document")
    .select("id, current_revision_id")
    .in("id", documentIds);
  if (docsError) throw docsError;

  const currentRevisionById = new Map((docs ?? []).map((d) => [d.id as string, (d.current_revision_id as string | null) ?? null]));

  const rows = await Promise.all(documentIds.map(async (documentId) => {
    let analyzedRevisionId: string | null = null;
    if (runId) {
      const analyzed = await resolveAnalyzedRevisionId(runId, documentId);
      if (analyzed === null) {
        analyzedRevisionId = null; // conflicting claims — never guess, never fall back
      } else if (typeof analyzed === "string") {
        analyzedRevisionId = analyzed; // exact analyzed revision — highest precedence
      } else {
        analyzedRevisionId = currentRevisionById.get(documentId) ?? null; // no usable claim — existing fallback
      }
    } else {
      analyzedRevisionId = currentRevisionById.get(documentId) ?? null;
    }
    return { boq_id: boqId, document_id: documentId, analyzed_revision_id: analyzedRevisionId };
  }));

  const { error } = await supabase
    .from("boq_document")
    .upsert(rows, { onConflict: "boq_id,document_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** One persisted boq_document row's scope — exactly what coverageSignals.ts's
 *  CoverageBoqDocumentLink needs. */
export interface BoqDocumentLink {
  boqId: string;
  documentId: string;
}

/**
 * Read back the persisted (boq_id, document_id) scope for the given BOQs —
 * the authoritative boq_document rows linkAnalyzedDocumentsToBoq() above
 * writes. Added for Coverage orchestration (coverageOrchestration.ts),
 * which needs this exact scope to know which documents' LOCATION evidence
 * to evaluate against which BOQ — never re-derived from review-item
 * evidence (that is reconciliation's own, unrelated per-item mechanism).
 *
 * One query, scoped to exactly `boqIds` — never one per BOQ. A no-op (never
 * issues a query) for an empty `boqIds`, matching this file's own existing
 * no-op convention.
 */
export async function loadBoqDocumentLinks(boqIds: string[]): Promise<BoqDocumentLink[]> {
  if (boqIds.length === 0) return [];

  const { data, error } = await supabase
    .from("boq_document")
    .select("boq_id, document_id")
    .in("boq_id", boqIds);
  if (error) throw error;

  return (data ?? []).map((r) => ({ boqId: r.boq_id as string, documentId: r.document_id as string }));
}
