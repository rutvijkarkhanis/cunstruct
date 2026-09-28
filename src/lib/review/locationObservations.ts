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
// Safe to import into the browser: a version string + provider name, not the
// server-only pricing/model-selection table. The `model` dimension of
// preflight's identity is NOT imported from here — modelConfig.ts is
// explicitly forbidden from src/ by its own header comment — it is instead
// passed in by the caller, sourced from fetchPreflight()'s admin-only
// `internal.model` (see latestLocationRunForDocument's doc comment below).
import { ANALYSIS_CONTRACT_VERSION, DEFAULT_PROVIDER } from "../../../supabase/functions/_shared/contract.ts";

/**
 * Mirrors analysis_run_source's own documented status lifecycle (see its
 * migration's "Status lifecycle" comment): no row at all = never claimed =
 * never run. PROCESSING/SUCCEEDED/FAILED are the exact column values.
 *
 * The two CONTENT_MATCHED_* statuses are NOT ledger column values — they are
 * this module's own honest labeling of a fallback, hash-level match: this
 * exact document was never itself claimed, but its current content is
 * byte-identical to a file that WAS successfully analysed under LOCATION
 * mode (which is exactly why preflight/eligibility refuses to re-send it —
 * see computePreflight()'s content-hash-only matching). Never conflate this
 * with SUCCEEDED, which means this document's own document_id was claimed.
 */
export type LocationRunStatus =
  | "NOT_RUN" | "PROCESSING" | "SUCCEEDED" | "FAILED"
  | "CONTENT_MATCHED_OTHER_DOCUMENT"
  | "CONTENT_MATCHED_UNATTRIBUTED";

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

const NOT_RUN: LocationRunState = { status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null };

/**
 * The current revision's content hash for a document, via the SAME
 * document -> current_revision_id -> document_revision path
 * loadProjectDrawings() (drawingStorage.ts) already uses for file identity —
 * not a new join pattern. Returns null if the document has no current
 * revision, or that revision hasn't been hashed yet (see
 * document_revision.content_hash's own nullability comment in the
 * ai_analysis_pipeline migration).
 */
async function currentRevisionContentHash(documentId: string): Promise<string | null> {
  const { data: doc } = await supabase.from("project_document").select("current_revision_id").eq("id", documentId).maybeSingle();
  if (!doc?.current_revision_id) return null;
  const { data: rev } = await supabase.from("document_revision").select("content_hash").eq("id", doc.current_revision_id).maybeSingle();
  return (rev?.content_hash as string | null) ?? null;
}

/**
 * Fallback lookup using preflight's EXACT identity dimensions (see
 * computePreflight()/loadLedger() in the edge function) instead of
 * document_id: project_id + content_hash + contract_version + provider +
 * model + mode. `model` is the exact string the caller already obtained from
 * fetchPreflight()'s admin-only `internal.model` field — the same value
 * resolveModel() resolved server-side for this project's LOCATION eligibility
 * — never imported from the server-only modelConfig.ts. A hash match under a
 * DIFFERENT model must NOT be reported here: preflight itself would not
 * consider that content already analysed under the current model (see
 * contract.ts's note that a model upgrade makes previously-analysed files
 * eligible again), so neither can this diagnostic without recreating the
 * exact contradiction this fallback exists to eliminate. Only ever reports a
 * SUCCEEDED match: a PROCESSING/FAILED hash-level row doesn't explain "No new
 * eligible files to analyse" the way a SUCCEEDED one does (see
 * computePreflight's alreadyAnalysed vs inFlight).
 */
async function latestSucceededLocationRunForContentHash(
  projectId: string, contentHash: string, model: string,
): Promise<{ runId: string | null; claimedAt: string | null; completedAt: string | null; documentId: string | null } | null> {
  const { data, error } = await supabase
    .from("analysis_run_source")
    .select("analysis_run_id, claimed_at, completed_at, document_id")
    .eq("project_id", projectId)
    .eq("content_hash", contentHash)
    .eq("contract_version", ANALYSIS_CONTRACT_VERSION)
    .eq("provider", DEFAULT_PROVIDER)
    .eq("model", model)
    .eq("mode", "LOCATION")
    .eq("status", "SUCCEEDED")
    .order("claimed_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const row = data[0] as { analysis_run_id: string | null; claimed_at: string; completed_at: string | null; document_id: string | null };
  return { runId: row.analysis_run_id, claimedAt: row.claimed_at, completedAt: row.completed_at, documentId: row.document_id };
}

/**
 * The most recent LOCATION-mode claim for this exact document — preserving
 * the original document_id-scoped lookup exactly. Never throws — a query
 * failure degrades to NOT_RUN rather than fabricating a status.
 *
 * If nothing is claimed under this document_id, falls back to a hash-level
 * match (see latestSucceededLocationRunForContentHash above) so a genuine
 * "this content was already analysed under a different or since-deleted
 * document" is never misreported as "extraction has not been run" — the
 * exact contradiction a real production document exposed: preflight
 * correctly refuses to re-send already-analysed content (content-hash-keyed,
 * cross-document by design), while this document_id-scoped lookup alone
 * could report NOT_RUN for that same content. This fallback NEVER claims
 * extraction ran for THIS document — it reports a clearly distinct status
 * instead (CONTENT_MATCHED_OTHER_DOCUMENT / CONTENT_MATCHED_UNATTRIBUTED).
 *
 * `model` is required and must be the exact model preflight resolved for
 * this project's LOCATION eligibility (the caller already has this from
 * fetchPreflight()'s `internal.model`) — without it, the fallback could
 * report "already analysed" for content that only a DIFFERENT model
 * analysed, which preflight itself would not treat as already analysed.
 */
export async function latestLocationRunForDocument(
  projectId: string, documentId: string, model: string,
): Promise<LocationRunState> {
  const { data, error } = await supabase
    .from("analysis_run_source")
    .select("status, analysis_run_id, claimed_at, completed_at, error")
    .eq("project_id", projectId)
    .eq("document_id", documentId)
    .eq("mode", "LOCATION")
    .order("claimed_at", { ascending: false })
    .limit(1);

  if (!error && data?.length) {
    const row = data[0] as { status: string; analysis_run_id: string | null; claimed_at: string; completed_at: string | null; error: string | null };
    return {
      status: row.status as LocationRunStatus,
      runId: row.analysis_run_id,
      claimedAt: row.claimed_at,
      completedAt: row.completed_at,
      error: row.error,
    };
  }

  const contentHash = await currentRevisionContentHash(documentId);
  if (!contentHash) return NOT_RUN;

  const hashMatch = await latestSucceededLocationRunForContentHash(projectId, contentHash, model);
  if (!hashMatch) return NOT_RUN;

  return {
    status: hashMatch.documentId == null ? "CONTENT_MATCHED_UNATTRIBUTED" : "CONTENT_MATCHED_OTHER_DOCUMENT",
    runId: hashMatch.runId,
    claimedAt: hashMatch.claimedAt,
    completedAt: hashMatch.completedAt,
    error: null,
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
