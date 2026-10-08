// PROJECT READINESS COMPUTATION — Phase A. Turns "here are the BOQs Analyze
// Project just produced/reused, one per discipline" into the project-wide
// readiness rollup (readiness.ts) plus the flat exception list the "Review
// Exceptions" UI needs — by resolving each BOQ's current review items to
// their source document, reconciling each one (instanceReconciliation.ts),
// then aggregating.
//
// Dependency-injected (same convention as projectAnalysis.ts's
// ProjectAnalysisDeps) so this is testable without Supabase. The real deps
// (wired in WorkspaceAnalyzePanel.tsx) are thin wrappers over EXISTING reads
// — reviewStore.latestRunForBoq/loadReviewItems,
// locationObservations.latestLocationRunForDocument/loadLocationObservations
// — never a new persistence path.

import { resolveItemDrawing, type StoredDrawing } from "./documentResolve";
import { buildReconciliationInput } from "./reconciliationInput";
import { reconcileInstances, type ReconciliationStatus } from "./instanceReconciliation";
import { aggregateProjectReadiness, type ProjectReadiness, type BoqReadinessGroup } from "./readiness";
import type { StoredReviewItem } from "./reviewStore";
import type { LocationObservation } from "./locationObservations";

export interface DisciplineBoqRef {
  discipline: string;
  boqId: string;
  boqName: string;
}

export interface ReadinessComputeDeps {
  /** The BOQ's current analysis run (whatever Analyze Project just produced,
   *  or an earlier run if this discipline's call found nothing new) — null
   *  when the BOQ has never been analysed at all. */
  latestRunForBoq: (boqId: string) => Promise<{ id: string } | null>;
  loadReviewItems: (runId: string) => Promise<StoredReviewItem[]>;
  /** Whether LOCATION has actually run (successfully) for this document, and
   *  its observations if so — `ran: false` is "unknown, never checked," NOT
   *  "zero located" (see ReconciliationInput.locationRan's own doc). */
  loadLocationRun: (documentId: string) => Promise<{ ran: boolean; observations: LocationObservation[] }>;
}

export interface ExceptionRow {
  itemId: string;
  itemName: string;
  discipline: string;
  boqId: string;
  boqName: string;
  expectedQuantity: number | null;
  locatedCount: number | null;
  hasScheduleEntry: boolean;
  status: ReconciliationStatus;
}

export interface ProjectReadinessResult {
  projectReadiness: ProjectReadiness;
  exceptions: ExceptionRow[];
}

export async function computeProjectReadiness(
  boqRefs: DisciplineBoqRef[],
  drawings: StoredDrawing[],
  deps: ReadinessComputeDeps,
): Promise<ProjectReadinessResult> {
  // Memoized per documentId — the same drawing is very often shared across
  // several items/BOQs (that's the whole point of Phase A's multi-discipline
  // document assignment); never re-fetch its LOCATION state once resolved.
  const locationByDoc = new Map<string, { ran: boolean; observations: LocationObservation[] }>();
  const loadLocation = async (documentId: string) => {
    const cached = locationByDoc.get(documentId);
    if (cached) return cached;
    const resolved = await deps.loadLocationRun(documentId);
    locationByDoc.set(documentId, resolved);
    return resolved;
  };

  const groups: BoqReadinessGroup[] = [];
  const exceptions: ExceptionRow[] = [];

  for (const ref of boqRefs) {
    const run = await deps.latestRunForBoq(ref.boqId);
    if (!run) {
      groups.push({ boqId: ref.boqId, boqName: ref.boqName, discipline: ref.discipline, statuses: [] });
      continue;
    }
    const items = await deps.loadReviewItems(run.id);
    const statuses: ReconciliationStatus[] = [];

    for (const item of items) {
      const documentId = resolveItemDrawing(item.ai.source, drawings)?.documentId ?? null;
      const location = documentId ? await loadLocation(documentId) : { ran: false, observations: [] };
      const input = buildReconciliationInput(item, location.observations, location.ran);
      const status = reconcileInstances(input);
      statuses.push(status);

      if (status !== "GREEN") {
        exceptions.push({
          itemId: item.id,
          itemName: item.ai.item,
          discipline: ref.discipline,
          boqId: ref.boqId,
          boqName: ref.boqName,
          expectedQuantity: input.expectedQuantity,
          locatedCount: input.countable ? input.physicalLocatedCount : null,
          hasScheduleEntry: input.hasScheduleEntry,
          status,
        });
      }
    }

    groups.push({ boqId: ref.boqId, boqName: ref.boqName, discipline: ref.discipline, statuses });
  }

  return { projectReadiness: aggregateProjectReadiness(groups), exceptions };
}
