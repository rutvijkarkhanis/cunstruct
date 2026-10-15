// One call from drawing text + persisted LOCATION observations to the coverage
// report and draft quantities. Pure; the UI supplies the loaded text pages.

import { buildDrawingInventory, type DrawingTextPage } from "./drawingInventory";
import { reconcileRoomDimensions } from "./roomDimensionReconciliation";
import { buildDrawingCoverageReport, type CoverageObservation, type DrawingCoverageReport } from "./drawingCoverageReport";
import { measuredQuantitiesFor, type MeasuredQuantity } from "./measuredQuantities";
import type { LocationObservation } from "./locationObservations";

export function coverageObservationFrom(o: LocationObservation): CoverageObservation {
  return {
    id: o.id,
    observationType: o.observationType,
    mark: o.mark ?? undefined,
    scopeHint: o.scopeHint ?? undefined,
    attributes: { dimension: o.attributes.dimension },
    source: { page: o.evidence.page, pageSize: o.evidence.pageSize, evidence: o.evidence.evidence ?? [] },
  };
}

export interface DrawingCoverageAnalysis {
  report: DrawingCoverageReport;
  /** One per labelled space: ready only when reconciled with high confidence. */
  quantities: MeasuredQuantity[];
}

export function analyseDrawingCoverage(pages: DrawingTextPage[], observations: LocationObservation[]): DrawingCoverageAnalysis {
  const inventory = buildDrawingInventory(pages);
  const reconciliation = reconcileRoomDimensions(inventory);
  // Persisted observations carry no parse diagnostics (none are stored), so
  // rejections are reported as unknown, not zero.
  const report = buildDrawingCoverageReport(inventory, reconciliation, observations.map(coverageObservationFrom), null);
  return { report, quantities: measuredQuantitiesFor(reconciliation.rooms) };
}
