// COVERAGE -> EXISTING FINDING ADAPTER — PR #156. Converts a pure,
// deterministic CoverageSignal (coverageSignals.ts) into the shape the
// EXISTING boq_audit_finding system already understands. Coverage is
// another PRODUCER of that existing Finding system, never a parallel
// status/taxonomy of its own: every Coverage signal becomes an ordinary
// MISSING_ITEM finding, reviewed/accepted/dismissed/resolved through the
// exact same lifecycle (auditImport.ts's setFindingState, BoqAuditReview.tsx)
// a human-pasted external audit finding already goes through today.
//
// Pure: no I/O, no Supabase, no mutation of the input signal. Persisting the
// result into boq_audit_run/boq_audit_finding is auditImport.ts's job
// (persistCoverageFindings), which extends the EXISTING import path rather
// than this module reaching into the database itself.

import type { FindingType } from "../auditJson";
import type { CoverageSignal } from "./coverageSignals";

/** boq_audit_run.source is already a free-text provenance label (see
 *  20260915000000_boq_audit.sql: "provenance label; NOT a provider
 *  lock-in", default 'external') — Coverage is simply a new value for the
 *  SAME existing column, never a new field. */
export const COVERAGE_FINDING_SOURCE = "coverage_engine";

/**
 * The existing FindingType that already means exactly what a Coverage
 * Potential Gap means — auditJson.ts's own module doc literally gives
 * "Detected on the plan but absent from the BOQ" as MISSING_ITEM's example.
 * Coverage never introduces a second missing-scope taxonomy (no
 * "POTENTIAL_GAP" FindingType) — it reuses this one, unconditionally.
 */
export const COVERAGE_FINDING_TYPE: FindingType = "MISSING_ITEM";

/** The fields this adapter actually populates on a boq_audit_finding row.
 *  Deliberately narrow: boq_line_id/external_key/action/scope/category/
 *  location/current_value/recommended_* are intentionally left for the
 *  caller to default to null — Coverage performs no line-matching beyond
 *  the signal's own deterministic identity (never a fuzzy/exclusive
 *  external_key match), proposes no value, and recommends no specific
 *  remediation action. */
export interface CoverageFindingInput {
  findingType: FindingType;
  /** The only "item" text Coverage honestly knows — the original,
   *  as-extracted mark (CoverageSignal.mark). Never a fabricated
   *  human-readable description. */
  item: string;
  /** Factual and advisory, verbatim from the signal — never claims
   *  "confirmed missing". */
  reason: string;
  /** Compact, human-readable provenance: which document, which normalized
   *  key, which evidence type(s), which observation ids — everything
   *  section 7 of the PR #156 spec asks a reviewer be able to see, packed
   *  into the one existing free-text field this schema offers for it
   *  (boq_audit_finding has no jsonb/payload column; only `evidence`/
   *  `reason`, both already free text). */
  evidence: string;
  /** CoverageSignal.signalKey, verbatim — the stable identity
   *  persistCoverageFindings() uses for idempotent insert-or-skip via the
   *  boq_audit_finding_signal_key_idx partial unique index. */
  signalKey: string;
}

/**
 * Convert one CoverageSignal into the fields an existing boq_audit_finding
 * row needs. Pure — never mutates `signal`, never touches the database.
 */
export function coverageSignalToFindingInput(signal: CoverageSignal): CoverageFindingInput {
  return {
    findingType: COVERAGE_FINDING_TYPE,
    item: signal.mark,
    reason: signal.reason,
    evidence: [
      `${COVERAGE_FINDING_SOURCE}`,
      `key "${signal.normalizedKey}"`,
      `document ${signal.documentId}`,
      `evidence: ${signal.evidenceTypes.join(", ")}`,
      `observations: ${signal.observationIds.join(", ")}`,
    ].join(" · "),
    signalKey: signal.signalKey,
  };
}
