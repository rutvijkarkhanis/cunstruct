// AUDIT FINDINGS — deterministic matching, lifecycle and review roll-up.
//
// Turns validated audit findings (from auditJson.ts) into something the BOQ
// dashboard can show: each finding matched (where possible) to a BOQ line, a
// review summary bucketed the way the dashboard displays it, and a small
// lifecycle the user drives. NOTHING here mutates the BOQ — findings are advice.

import type { AuditFinding, FindingType } from "./auditJson";

/** The user-driven state of a finding. Findings never change the BOQ on their own. */
export type FindingState = "OPEN" | "ACCEPTED" | "DISMISSED" | "RESOLVED" | "KEPT_PENDING";

/** The persisted actions a user can take on a finding. */
export const FINDING_STATE_ACTIONS: Record<Exclude<FindingState, "OPEN">, string> = {
  ACCEPTED: "Accept",
  DISMISSED: "Dismiss",
  RESOLVED: "Resolve",
  KEPT_PENDING: "Keep Pending",
};

/** A minimal view of a BOQ line, enough to match a finding against it. */
export interface BoqLineRef {
  id: string;
  section?: string | null;
  description?: string | null;
  unit?: string | null;
  externalKey?: string | null;
  location?: string | null;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Match a finding to a BOQ line deterministically, most-reliable signal first:
 *   1) explicit boq_line_id
 *   2) shared external_key — AUTHORITATIVE: when the finding carries an
 *      external_key, ONLY a line with that same key matches. It never falls back
 *      to text, so two similar descriptions with different keys can't cross-match.
 *   3) (no key) exact item==description, with matching location when both give one
 *   4) (no key) description contains the item text, location compatible
 * Returns the matched line id, or null — never silently attaches to the wrong line.
 */
export function matchFindingToLine(finding: AuditFinding, lines: BoqLineRef[]): string | null {
  if (finding.boqLineId && lines.some((l) => l.id === finding.boqLineId)) return finding.boqLineId;

  // external_key is the strongest deterministic match and is EXCLUSIVE: if the
  // finding has one, the only acceptable match is the line with the same key.
  if (finding.externalKey) {
    const byKey = lines.find((l) => l.externalKey && norm(l.externalKey) === norm(finding.externalKey));
    return byKey ? byKey.id : null;
  }

  const item = norm(finding.item);
  if (!item) return null;
  const loc = norm(finding.location);
  const locOk = (l: BoqLineRef) => !loc || !norm(l.location) || norm(l.location) === loc;

  const exact = lines.find((l) => norm(l.description) === item && locOk(l));
  if (exact) return exact.id;

  const contains = lines.filter((l) => norm(l.description).includes(item) && locOk(l));
  if (contains.length === 1) return contains[0].id;

  return null;
}

/** A finding with its resolved line link, ready for the dashboard. */
export interface LinkedFinding extends AuditFinding {
  boqLineId?: string;
  matched: boolean;
}

/** Attach each finding to a BOQ line where possible (does not mutate anything). */
export function linkFindings(findings: AuditFinding[], lines: BoqLineRef[]): LinkedFinding[] {
  return findings.map((f) => {
    const id = matchFindingToLine(f, lines);
    return { ...f, boqLineId: id ?? f.boqLineId, matched: id != null };
  });
}

// ── Review summary (the dashboard's headline buckets) ────────────────────────
export interface ReviewSummary {
  covered: number;
  missing: number;
  pending: number;
  methodologyIssues: number;
  specificationIssues: number;
  duplicateOrProblematic: number;
  other: number;
}

const FINDING_BUCKET: Record<FindingType, keyof Omit<ReviewSummary, "covered">> = {
  MISSING_ITEM: "missing",
  MISSING_SCOPE: "missing",
  QUANTITY_PENDING: "pending",
  QUANTITY_ERROR: "duplicateOrProblematic",
  METHODOLOGY_ERROR: "methodologyIssues",
  UNIT_ERROR: "methodologyIssues",
  DUPLICATE_ITEM: "duplicateOrProblematic",
  MISSING_SPECIFICATION: "specificationIssues",
  INSUFFICIENT_EVIDENCE: "other",
  OTHER: "other",
};

/**
 * Roll findings + the generated-line count into the dashboard's review summary.
 * `coveredCount` is the number of adequately-quantified BOQ lines (supplied by
 * the caller from the completeness/quantity layer). Findings in a terminal state
 * (DISMISSED / RESOLVED) drop out of the issue buckets.
 */
export function reviewSummary(
  findings: AuditFinding[],
  coveredCount: number,
  states: Record<number, FindingState> = {},
): ReviewSummary {
  const summary: ReviewSummary = {
    covered: coveredCount,
    missing: 0,
    pending: 0,
    methodologyIssues: 0,
    specificationIssues: 0,
    duplicateOrProblematic: 0,
    other: 0,
  };
  findings.forEach((f, i) => {
    const state = states[i] ?? "OPEN";
    if (state === "DISMISSED" || state === "RESOLVED") return;
    summary[FINDING_BUCKET[f.findingType]] += 1;
  });
  return summary;
}
