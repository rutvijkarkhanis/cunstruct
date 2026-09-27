// LOCATION OBSERVATIONS — read-only diagnostic access to a document's
// LOCATION extraction history. Answers "what exactly did Cunstruct extract
// from this drawing?" — a count alone (the Documents card) can't validate
// that; this is the smallest useful surface that can.
//
// Purely additive and read-only: every query here is a `.select()`; nothing
// in this file can insert, update, or delete anything, so it cannot create
// or modify BOQ lines (or anything else) — see locationObservations.test.ts's
// static-source check. Writes stay exclusively in the ai-analysis edge
// function's LOCATION branch, unchanged by this file.
//
// No observation-review mechanism existed before this file: analysis_observation
// was previously referenced only by that edge function's insert and its own
// migration (supabase/migrations/20260926000000_analysis_observation.sql) — no
// browser-side read path existed anywhere in the codebase.

import { supabase } from "@/integrations/supabase/client";
import type { AnalysisSource } from "./analysisSchemaV1";
import type { ObservationAttributes, ObservationType, EvidenceCompleteness } from "./observationSchemaV1";

/**
 * Mirrors analysis_run_source's own documented status lifecycle (see its
 * migration's "Status lifecycle" comment): no row at all = never claimed =
 * never run. PROCESSING/SUCCEEDED/FAILED are the exact column values.
 */
export type LocationRunStatus = "NOT_RUN" | "PROCESSING" | "SUCCEEDED" | "FAILED";

export interface LocationRunState {
  status: LocationRunStatus;
  runId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface LocationObservation {
  id: string;
  observationType: ObservationType;
  mark: string | null;
  scopeHint: string | null;
  locationText: string | null;
  attributes: ObservationAttributes;
  /** The exact parsed AnalysisSource persisted by the edge function — the
   *  same evidence/coordinate shape items already use, never a second one. */
  evidence: AnalysisSource;
  evidenceCompleteness: EvidenceCompleteness;
  createdAt: string;
}

/**
 * The most recent LOCATION-mode claim for this exact document. Never
 * throws — a query failure degrades to NOT_RUN rather than fabricating a
 * status; the caller can't tell "genuinely never run" apart from "couldn't
 * check" from this alone, which is acceptable for a diagnostic-only surface
 * that never gates a write.
 */
export async function latestLocationRunForDocument(projectId: string, documentId: string): Promise<LocationRunState> {
  const { data, error } = await supabase
    .from("analysis_run_source")
    .select("status, analysis_run_id, claimed_at, completed_at, error")
    .eq("project_id", projectId)
    .eq("document_id", documentId)
    .eq("mode", "LOCATION")
    .order("claimed_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) {
    return { status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null };
  }
  const row = data[0] as { status: string; analysis_run_id: string | null; claimed_at: string; completed_at: string | null; error: string | null };
  return {
    status: row.status as LocationRunStatus,
    runId: row.analysis_run_id,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

/**
 * Every analysis_observation row persisted for one LOCATION run, oldest
 * first. Always an array (never null/undefined) — a genuinely empty result
 * (the run succeeded with zero observations) and a query failure both
 * resolve to `[]`; the caller distinguishes "ran, found nothing" from "could
 * not check" using LocationRunState.status, not this return value alone.
 */
export async function loadLocationObservations(runId: string): Promise<LocationObservation[]> {
  const { data, error } = await supabase
    .from("analysis_observation")
    .select("id, observation_type, mark, scope_hint, location_text, attributes, evidence, evidence_completeness, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    observationType: r.observation_type as ObservationType,
    mark: (r.mark as string | null) ?? null,
    scopeHint: (r.scope_hint as string | null) ?? null,
    locationText: (r.location_text as string | null) ?? null,
    attributes: (r.attributes as ObservationAttributes) ?? {},
    evidence: r.evidence as AnalysisSource,
    evidenceCompleteness: r.evidence_completeness as EvidenceCompleteness,
    createdAt: r.created_at as string,
  }));
}
