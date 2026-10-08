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
// Writes ONLY `boq_document`. Never touches boq_line, analysis_run_source,
// analysis_review_item, or any reconciliation/readiness logic — this module
// has no opinion on whether an analysis succeeded; its caller
// (projectAnalysis.ts's runProjectAnalysis) only ever invokes it AFTER a
// discipline's own BOQ analysis call has already succeeded.

import { supabase } from "@/integrations/supabase/client";

/**
 * Link every document in `documentIds` to `boqId`.
 *
 * Idempotent via the table's own `unique (boq_id, document_id)` constraint:
 * an upsert with `ignoreDuplicates: true` is `ON CONFLICT (boq_id,
 * document_id) DO NOTHING` — a pair already linked is left completely
 * untouched (including its existing `analyzed_revision_id`, if any),
 * never duplicated and never silently overwritten with a value this run
 * happens to have. The constraint itself is never weakened or bypassed.
 *
 * ## `analyzed_revision_id` — what it is, and what it deliberately is NOT
 *
 * This reads `project_document.current_revision_id` fresh, right now, at
 * the moment this discipline's analysis is known to have succeeded. That is
 * a best-effort "current revision as of persistence time," NOT the exact
 * revision the edge function actually downloaded and sent to OpenAI for
 * this run.
 *
 * The EXACT analyzed revision does exist, durably, server-side: the
 * ai-analysis edge function resolves `project_document.current_revision_id`
 * itself (loadEligibleFiles), downloads that exact `document_revision` row,
 * and records its id verbatim on the claim it inserts —
 * `analysis_run_source.document_revision_id` (see index.ts's
 * `document_revision_id: file.documentRevisionId` at the claim-insert
 * site). That is the authoritative value.
 *
 * This function does NOT read that column. `generateAnalysis()`'s
 * `GenerateResponse` (analysisClient.ts) never returns it, and neither
 * `runProjectAnalysis` nor `ProjectAnalysisResult` (projectAnalysis.ts)
 * carries it through today — getting it here would mean adding a new query
 * against `analysis_run_source` (by `run_id`/`project_id`+`document_id`+
 * `mode`), which is new plumbing this PR deliberately does not add scope
 * for. Audited and confirmed deliberately deferred, not overlooked.
 *
 * Consequence — a known, narrow, pre-existing class of risk, not something
 * this function introduces: if a document is re-uploaded (a new revision
 * becomes `current_revision_id`) in the brief window between the edge
 * function resolving/downloading the revision it analyzed and this
 * function's own later read of the same column, the row persisted here
 * will carry the NEWER revision id, not the one actually analyzed. This is
 * the exact same "current revision is a floating pointer, read at whatever
 * moment a caller happens to read it" convention `loadProjectDrawings()`
 * and the edge function's own `loadEligibleFiles` already rely on
 * elsewhere in this pipeline — not a new hazard, but documented here
 * explicitly rather than silently assumed safe.
 *
 * A document missing from the result entirely (deleted, or an id that
 * doesn't resolve) gets NULL — never a fabricated or stale guess.
 *
 * A no-op for an empty `documentIds` (never issues a query, never creates a
 * boq-with-nothing-linked row — there's nothing to link).
 */
export async function linkAnalyzedDocumentsToBoq(boqId: string, documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;

  const { data: docs, error: docsError } = await supabase
    .from("project_document")
    .select("id, current_revision_id")
    .in("id", documentIds);
  if (docsError) throw docsError;

  const revisionById = new Map((docs ?? []).map((d) => [d.id as string, (d.current_revision_id as string | null) ?? null]));

  const rows = documentIds.map((documentId) => ({
    boq_id: boqId,
    document_id: documentId,
    analyzed_revision_id: revisionById.get(documentId) ?? null,
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
