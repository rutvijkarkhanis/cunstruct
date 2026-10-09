// CALCULATION ADVISORY — read-time-only adapter wiring an analysis item's own
// structured calculation claim (if any) into the standalone, unmodified
// measurementValidator.ts (Scope A). Pure: no I/O, no Supabase, never
// mutates its input, never persists anything, never writes ai_json,
// reviewer_json, or boq_line.
//
// Compares the recomputed result ONLY against item.quantity/item.unit — the
// AI's own original, immutable claim. NEVER effectiveQuantity() and NEVER a
// reviewer-adjusted value: calculation_data is the model's statement about
// how it arrived at ITS OWN quantity, so the only honest question this
// module can answer is "is the AI self-consistent with itself" — orthogonal
// to, and never mixed with, whether a human reviewer agrees. See
// analysisSchemaV1.ts's CalculationDataV1 and measurementValidator.ts's own
// header comment for the full reasoning and declared blind spots.
//
// Absent calculationData, a null/missing quantity, or a missing unit all
// degrade to "no advisory" (null) — never a fabricated fallback, never a
// thrown exception. An unsupported formula, malformed inputs, or a failed
// recomputation inside measurementValidator.ts itself degrade the same way,
// one layer further in (see calculationAdvisoryText below).

import type { AnalysisItemV1 } from "./analysisSchemaV1";
import { validateCalculation, type CalculationRequest, type ValidationResult } from "./measurementValidator";

/** Map an analysis item's own fields into a CalculationRequest, or null when
 *  there is nothing safe to recompute against. Never reads item.reviewer or
 *  any reviewer-facing field — this module has no access to one. */
export function toCalculationRequest(item: AnalysisItemV1): CalculationRequest | null {
  const calc = item.calculationData;
  if (!calc) return null;
  if (item.quantity == null) return null;
  if (!item.unit) return null;
  return {
    formula: calc.formula,
    inputs: calc.inputs,
    statedQuantity: item.quantity,
    statedUnit: item.unit,
  };
}

/** Run the unmodified Scope A validator against this item's own claim, or
 *  null when toCalculationRequest() found nothing safe to check. */
export function validateItemCalculation(item: AnalysisItemV1): ValidationResult | null {
  const request = toCalculationRequest(item);
  if (!request) return null;
  return validateCalculation(request);
}

/**
 * The exact, required contractor-facing wording for each comparable outcome.
 * Returns null — no badge at all — when there is nothing to show: absent
 * calculation data, a missing/invalid stated quantity or unit, an
 * unsupported formula, malformed inputs, or a failed recomputation (all of
 * these leave `comparison` null, per measurementValidator.ts's own contract:
 * comparison is non-null exactly when calculation.recomputed is true).
 *
 * Never "Quantity verified," "Drawing verified," or any wording implying
 * that arithmetic agreement proves correct drawing interpretation.
 */
export function calculationAdvisoryText(result: ValidationResult | null): string | null {
  if (!result || !result.comparison) return null;
  switch (result.comparison.outcome) {
    case "EXACT_MATCH":
      return "Arithmetic matches — not drawing verification.";
    case "MISMATCH":
      return "Count calculation differs — advisory only.";
    case "ROUNDING_POLICY_UNRESOLVED":
      return "Continuous quantity difference; rounding policy unresolved.";
    case "INCOMPARABLE":
      return "Cannot compare safely.";
  }
}
