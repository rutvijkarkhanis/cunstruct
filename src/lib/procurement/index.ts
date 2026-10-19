export * from "./procurement";
export * from "./fixtures";
import { phaseCallOffs, reconcileIssues, requirementsFromBoq } from "./procurement";
import {
  PREVIEW_COEFFICIENTS, PREVIEW_DEALER, PREVIEW_ISSUED, PREVIEW_LEAD_WEEKS, PREVIEW_PROCUREMENT_LINES,
  PREVIEW_SCHEDULE, PREVIEW_TOLERANCE_PCT, PREVIEW_WORK_DONE,
} from "./fixtures";

/** The whole preview plan, computed from the fixtures above (deterministic). */
export function buildPreviewProcurementPlan() {
  const requirements = requirementsFromBoq(PREVIEW_PROCUREMENT_LINES, PREVIEW_COEFFICIENTS);
  const phasing = phaseCallOffs(requirements.needs, PREVIEW_SCHEDULE, PREVIEW_DEALER, PREVIEW_LEAD_WEEKS);
  const reconciliation = reconcileIssues(
    PREVIEW_PROCUREMENT_LINES, PREVIEW_COEFFICIENTS, PREVIEW_WORK_DONE, PREVIEW_ISSUED, PREVIEW_TOLERANCE_PCT,
  );
  return { requirements, phasing, reconciliation };
}

export type PreviewProcurementPlan = ReturnType<typeof buildPreviewProcurementPlan>;
