// RECONCILIATION INPUT — maps one StoredReviewItem (plus the LOCATION
// observations for the document it resolves to, and whether LOCATION has
// actually run for that document) into the ReconciliationInput
// instanceReconciliation.ts's reconcileInstances() needs.
//
// Exists so the Phase A readiness rollup (and any future caller) builds this
// mapping exactly once, the same way every time — never a second,
// independently-reasoned copy of "what counts as evidence/countable/
// flagged" alongside BoqReviewWorkstation.tsx's own (unrelated,
// display-only) instancesByItemId computation.
//
// Pure: only type-level imports from reviewStore.ts/locationObservations.ts
// (erased at compile time), no Supabase, no I/O.

import { isCountableUnit } from "./typeGrouping";
import { effectiveQuantity, criticalReasons } from "./reviewQueue";
import { physicalInstancesForType, hasScheduleEntryForType } from "./typeInstances";
import type { ReconciliationInput } from "./instanceReconciliation";
import type { StoredReviewItem } from "./reviewStore";
import type { LocationObservation } from "./locationObservations";

export function buildReconciliationInput(
  item: StoredReviewItem,
  observations: LocationObservation[],
  locationRan: boolean,
): ReconciliationInput {
  return {
    countable: isCountableUnit(item.ai.unit),
    expectedQuantity: effectiveQuantity(item),
    locationRan,
    physicalLocatedCount: physicalInstancesForType(
      { key: item.ai.key, dimension: item.ai.dimension, specification: item.ai.specification },
      observations,
    ).length,
    hasScheduleEntry: hasScheduleEntryForType({ key: item.ai.key }, observations),
    hasEvidence: (item.ai.source?.evidence.length ?? 0) > 0,
    criticalReasons: criticalReasons(item),
    explicitlyFlagged: item.reviewStatus === "FLAGGED",
  };
}
