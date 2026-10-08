// COVERAGE ORCHESTRATION — the missing wiring between the existing,
// already-merged pieces: generateCoverageSignals() (PR #155) and
// persistCoverageFindings() (PR #156) have no caller anywhere in the app
// until this file. This module is ONLY that wiring — it assembles
// generateCoverageSignals()'s three inputs from EXISTING reads, calls it,
// and persists whatever it returns via the EXISTING persistence function.
// It invents nothing: no new Coverage logic, no new matching, no new
// status, no AI, no BOQ write.
//
// Deliberately separate from computeProjectReadiness.ts (never modified by
// this file) rather than widening it: that module's contract is "compute a
// readiness result," already shipped and tested end-to-end in PR #157; this
// module's contract is "generate + persist Coverage findings." They happen
// to read overlapping data (a BOQ's review items, a document's LOCATION
// observations) via the exact same existing functions, so a run of Analyze
// Project fetches that data twice rather than once — an accepted, narrow
// inefficiency in exchange for zero behavioral risk to the already-merged,
// already-tested readiness computation.
//
// Coverage's document scope comes authoritatively from boq_document
// (loadBoqDocumentLinks, PR #154's own table) — never re-derived from a
// review item's own evidence (that is reconciliation's unrelated per-item
// mechanism; see computeProjectReadiness.ts's resolveItemDrawing).

import { generateCoverageSignals, type CoverageSignal, type CoverageBoqReviewItems, type CoverageDocumentObservations } from "./coverageSignals";
import type { BoqDocumentLink } from "./boqDocumentLinks";
import type { StoredReviewItem } from "./reviewStore";
import type { LocationObservation } from "./locationObservations";

export interface CoverageOrchestrationBoqRef {
  boqId: string;
}

export interface CoverageOrchestrationDeps {
  /** The BOQ's current analysis run, or null if never analysed — same
   *  shape computeProjectReadiness.ts's own ReadinessComputeDeps already
   *  uses, reusing the identical real functions (reviewStore.ts's
   *  latestRunForBoq/loadReviewItems) at the call site. */
  latestRunForBoq: (boqId: string) => Promise<{ id: string } | null>;
  loadReviewItems: (runId: string) => Promise<StoredReviewItem[]>;
  /** This document's LOCATION observations, or [] if LOCATION never ran —
   *  reusing locationObservations.ts's latestLocationRunForDocument/
   *  loadLocationObservations at the call site, same as
   *  computeProjectReadiness.ts's loadLocationRun. Whether LOCATION "ran"
   *  doesn't change Coverage's own behavior (no observations -> no
   *  signal, never a gap), so this returns observations only, not a
   *  ran flag. */
  loadLocationObservations: (documentId: string) => Promise<LocationObservation[]>;
  /** The authoritative boq_document scope for exactly these BOQs
   *  (boqDocumentLinks.ts's loadBoqDocumentLinks). */
  loadBoqDocumentLinks: (boqIds: string[]) => Promise<BoqDocumentLink[]>;
  /** auditImport.ts's existing, idempotent persistence function — this
   *  module never writes boq_audit_run/boq_audit_finding itself. */
  persistCoverageFindings: (args: { boqId: string; projectId?: string | null; signals: CoverageSignal[] }) => Promise<{ runId: string | null; createdCount: number; skippedCount: number }>;
}

export interface CoverageOrchestrationResult {
  /** Every signal generateCoverageSignals() produced this run, across all
   *  BOQs — before persistence, so a caller can report "N potential gaps
   *  detected" even if persistence encounters an error for one BOQ. */
  signals: CoverageSignal[];
  /** One entry per BOQ that had at least one signal to persist (a BOQ with
   *  zero signals is simply absent — never a zero-filled entry). */
  persistedByBoqId: Record<string, { runId: string | null; createdCount: number; skippedCount: number }>;
}

/**
 * Generate Coverage signals for exactly these BOQs and persist them into
 * the existing Finding system. Called once, after Analyze Project's BOQ
 * AND LOCATION phases have both fully resolved (runProjectAnalysis()
 * returns LOCATION results only after every BOQ call already
 * completed — see its own doc comment — so Coverage, which needs both,
 * can only run here, not inside that per-discipline loop).
 *
 * Per-BOQ persistence is sequential and independent, matching
 * runProjectAnalysis()'s own identical precedent (projectAnalysis.ts's
 * linkAnalyzedDocuments call): a BOQ's persistCoverageFindings failure is
 * NOT caught here, so it aborts this loop before a LATER boqId in
 * `boqRefs` is ever attempted — but it can never un-persist an EARLIER
 * boqId's findings, which already independently committed. The caller
 * decides how to treat the overall failure (see WorkspaceAnalyzePanel.tsx's
 * own best-effort wrapping of this whole call, matching its existing
 * precedent for a LOCATION failure never blocking the rest of Analyze
 * Project).
 */
export async function generateAndPersistCoverageFindings(
  boqRefs: CoverageOrchestrationBoqRef[],
  projectId: string | null,
  deps: CoverageOrchestrationDeps,
): Promise<CoverageOrchestrationResult> {
  const boqIds = boqRefs.map((r) => r.boqId);
  if (boqIds.length === 0) return { signals: [], persistedByBoqId: {} };

  const links = await deps.loadBoqDocumentLinks(boqIds);

  const boqs: CoverageBoqReviewItems[] = [];
  for (const boqId of boqIds) {
    const run = await deps.latestRunForBoq(boqId);
    const items = run ? await deps.loadReviewItems(run.id) : [];
    boqs.push({ boqId, items });
  }

  const distinctDocumentIds = [...new Set(links.map((l) => l.documentId))];
  const documents: CoverageDocumentObservations[] = [];
  for (const documentId of distinctDocumentIds) {
    const observations = await deps.loadLocationObservations(documentId);
    documents.push({ documentId, observations });
  }

  const signals = generateCoverageSignals({
    documents,
    boqs,
    boqDocumentLinks: links,
  });

  const persistedByBoqId: CoverageOrchestrationResult["persistedByBoqId"] = {};
  for (const boqId of boqIds) {
    const boqSignals = signals.filter((s) => s.boqId === boqId);
    if (boqSignals.length === 0) continue;
    persistedByBoqId[boqId] = await deps.persistCoverageFindings({ boqId, projectId, signals: boqSignals });
  }

  return { signals, persistedByBoqId };
}
