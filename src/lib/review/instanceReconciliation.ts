// INSTANCE RECONCILIATION — Phase A. The one place Cunstruct decides whether
// a BOQ item's quantity is GREEN ("ready"), AMBER ("needs review"), or RED
// ("unresolved") — and the one place that enforces the product's central
// accuracy principle:
//
//   An AI-found count is never "verified" merely because an AI model found
//   it. For a countable item, GREEN requires TWO INDEPENDENT signals to
//   agree — the physical location count (LOCATION mode's per-occurrence
//   detections) AND a schedule_entry (the schedule table independently
//   documenting the same mark) — never one vision pass alone, however
//   confident, and never two vision passes that could share the same blind
//   spot without a genuinely different kind of source backing them up.
//
// Pure, deterministic, no I/O, no Supabase, no AI call — callers (the review
// workstation, the project-level readiness rollup) supply already-computed
// facts; this file only applies the rule.

export type ReconciliationStatus = "GREEN" | "AMBER" | "RED";

export interface ReconciliationInput {
  /** isCountableUnit(ai.unit) — a non-countable item (sq ft, cum, kg, …) has
   *  no "instance count" concept at all; it is evaluated on evidence/
   *  confidence alone, never instance reconciliation. */
  countable: boolean;
  /** The AI-extracted expected quantity (effectiveQuantity/ai.quantity), or
   *  null when the analysis never resolved one. */
  expectedQuantity: number | null;
  /** Whether LOCATION extraction has actually produced a result for the
   *  document this item resolves to. False means "unknown," never "0
   *  located" — distinguishing "nothing found" from "never checked" is the
   *  whole point of this field. */
  locationRan: boolean;
  /** physicalInstancesForType(...).length (typeInstances.ts) — occurrences
   *  of a real PLACED element, schedule_entry already excluded by that
   *  function. Only meaningful when locationRan is true; ignored otherwise. */
  physicalLocatedCount: number;
  /** hasScheduleEntryForType(...) (typeInstances.ts) — whether the schedule
   *  TABLE independently documents this mark. Presence only, never a count
   *  (LOCATION mode asserts no schedule quantity — see typeInstances.ts). */
  hasScheduleEntry: boolean;
  /** Whether this item has any usable evidence at all
   *  ((ai.source?.evidence.length ?? 0) > 0). */
  hasEvidence: boolean;
  /** criticalReasons(item) (reviewQueue.ts) — the existing single-source
   *  AI-confidence/conflict/status signal. Its presence alone never produces
   *  RED here (a resolvable AI conflict, e.g. multiple candidates, is a
   *  reviewable AMBER case) — it can only hold GREEN back or confirm AMBER. */
  criticalReasons: string[];
  /** True when a human reviewer has explicitly flagged this item
   *  (reviewStatus === "FLAGGED") — a deliberate "something is wrong here"
   *  signal, distinct from and stronger than an AI-reported critical reason,
   *  and the one thing besides missing quantity/evidence that this function
   *  treats as RED rather than AMBER. */
  explicitlyFlagged: boolean;
}

/**
 * Decide GREEN / AMBER / RED for one item. See each branch's comment for the
 * exact rule it implements — every branch here corresponds to a worked
 * example and/or a required test case; do not reorder without re-checking
 * both (order matters: RED checks run first and are evaluated independently
 * of countable/non-countable, then countable items get the instance-count
 * checks non-countable items skip entirely).
 */
export function reconcileInstances(input: ReconciliationInput): ReconciliationStatus {
  const {
    countable, expectedQuantity, locationRan, physicalLocatedCount,
    hasScheduleEntry, hasEvidence, criticalReasons, explicitlyFlagged,
  } = input;

  // RED — the item cannot be meaningfully evaluated at all, regardless of
  // countable/non-countable. Applies uniformly: a missing quantity or zero
  // evidence is just as unevaluable for a continuous measure as for a count.
  if (expectedQuantity == null) return "RED";
  if (!hasEvidence) return "RED";
  // An AI-reported multi-candidate conflict is reviewable (routine, and the
  // reviewer can just pick the right one) — AMBER via criticalReasons below,
  // not RED. An explicit human FLAGGED status is a deliberate "this is
  // wrong" declaration — that is RED's "explicit conflict/flag" case.
  if (explicitlyFlagged) return "RED";

  if (!countable) {
    // No instance concept applies. Single-source evidence/confidence is the
    // honest ceiling here — GREEN means "a confident, evidenced claim with
    // nothing flagged against it," never "mathematically certain."
    return criticalReasons.length === 0 ? "GREEN" : "AMBER";
  }

  // Countable from here — instance-count reconciliation applies, and GREEN
  // requires every one of: LOCATION actually ran, the physical count
  // matches what was expected, an independent schedule-table source also
  // documents this mark, and nothing else is flagged.
  if (!locationRan) return "AMBER";                      // unknown, not verified
  if (physicalLocatedCount !== expectedQuantity) return "AMBER";
  if (!hasScheduleEntry) return "AMBER";                  // same-mechanism agreement only — never GREEN
  if (criticalReasons.length > 0) return "AMBER";

  return "GREEN";
}
