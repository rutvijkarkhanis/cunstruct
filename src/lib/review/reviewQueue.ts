// REVIEW QUEUE — deterministic review-item logic (no AI, no I/O).
//
// Turns validated analysis items into review items, orders the queue so items
// needing attention surface first, filters them, computes progress/summary, and
// preserves the AI value vs the reviewer's correction. Everything here is pure
// and client-side — the spec requires that Verify/Edit/Flag/Pending, progress and
// diffs never call an AI model.

import type { AnalysisItemV1, AiStatus } from "./analysisSchemaV1";

/** The reviewer's decision on an item — distinct from the AI's status. */
export type ReviewStatus =
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "EDITED"
  | "FLAGGED"
  | "MARKED_PENDING";

export type FlagReason =
  | "DRAWING_UNCLEAR"
  | "CONFLICTING_DRAWINGS"
  | "INCORRECT_QUANTITY"
  | "INCORRECT_DIMENSION"
  | "INCORRECT_SPECIFICATION"
  | "MISSING_EVIDENCE"
  | "DUPLICATE"
  | "OTHER";

/** Fields the reviewer may override. Absent = keep the AI value. */
export interface ReviewerValues {
  quantity?: number | null;
  unit?: string;
  dimension?: string;
  specification?: string;
  location?: string;
  notes?: string;
}

export interface ReviewItem {
  /** The immutable AI analysis (never overwritten by a review). */
  ai: AnalysisItemV1;
  reviewStatus: ReviewStatus;
  reviewer?: ReviewerValues;
  flagReason?: FlagReason;
  reviewNote?: string;
  reviewedAt?: string;
  /** Set when this item duplicates an earlier one (same key or item+location). */
  duplicateOf?: string;
}

export type ReviewFilter = "ALL" | "NEEDS_REVIEW" | "CRITICAL" | "PENDING" | "VERIFIED" | "EDITED" | "FLAGGED";

/** A confidence at/below this is treated as low → needs attention. */
export const LOW_CONFIDENCE = 0.6;

const dupeKey = (i: AnalysisItemV1) =>
  `${(i.item ?? "").toLowerCase().trim()}¦${(i.location ?? "").toLowerCase().trim()}`;

/** Build review items from analysis items, tagging duplicates deterministically. */
export function buildReviewItems(items: AnalysisItemV1[]): ReviewItem[] {
  const seenKey = new Map<string, string>();   // dupeKey → first item key
  const seenId = new Map<string, string>();     // explicit key → first item key
  return items.map((ai) => {
    let duplicateOf: string | undefined;
    const k = dupeKey(ai);
    if (ai.key && seenId.has(ai.key)) duplicateOf = seenId.get(ai.key);
    else if (seenKey.has(k)) duplicateOf = seenKey.get(k);
    if (ai.key && !seenId.has(ai.key)) seenId.set(ai.key, ai.key);
    if (!seenKey.has(k)) seenKey.set(k, ai.key);
    return { ai, reviewStatus: "PENDING_REVIEW", duplicateOf };
  });
}

/** True when an item still needs a human decision. */
export function needsReview(it: ReviewItem): boolean {
  return it.reviewStatus === "PENDING_REVIEW";
}

/** True when an item warrants priority attention (before normal measured items). */
export function isCritical(it: ReviewItem): boolean {
  const { ai } = it;
  return (
    it.duplicateOf != null ||
    ai.aiStatus === "PENDING" ||
    ai.aiStatus === "INFERRED" ||
    ai.quantity == null ||
    (ai.confidence != null && ai.confidence <= LOW_CONFIDENCE) ||
    (ai.source?.evidence.length ?? 0) === 0
  );
}

// Ordering weight: lower sorts first. Unreviewed-critical first, then unreviewed,
// then reviewed items (kept, never discarded).
function priority(it: ReviewItem): number {
  const unreviewed = needsReview(it);
  if (unreviewed && it.duplicateOf) return 0;
  if (unreviewed && (it.ai.aiStatus === "PENDING" || it.ai.quantity == null)) return 1;
  if (unreviewed && it.ai.confidence != null && it.ai.confidence <= LOW_CONFIDENCE) return 2;
  if (unreviewed && it.ai.aiStatus === "INFERRED") return 3;
  if (unreviewed) return 4;         // normal measured, still to review
  return 5;                          // already reviewed — kept at the end
}

/** Stable ordering: attention-first, preserving input order within a tier. */
export function orderQueue(items: ReviewItem[]): ReviewItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => priority(a.it) - priority(b.it) || a.i - b.i)
    .map(({ it }) => it);
}

export function matchesFilter(it: ReviewItem, filter: ReviewFilter): boolean {
  switch (filter) {
    case "ALL": return true;
    case "NEEDS_REVIEW": return needsReview(it);
    case "CRITICAL": return needsReview(it) && isCritical(it);
    case "PENDING": return it.reviewStatus === "MARKED_PENDING" || it.ai.aiStatus === "PENDING";
    case "VERIFIED": return it.reviewStatus === "VERIFIED";
    case "EDITED": return it.reviewStatus === "EDITED";
    case "FLAGGED": return it.reviewStatus === "FLAGGED";
  }
}

export interface ReviewSummary {
  total: number;
  verified: number;
  edited: number;
  flagged: number;
  markedPending: number;
  remaining: number;
  /** 0..100, reviewed / total. */
  completionPct: number;
}

export function reviewSummary(items: ReviewItem[]): ReviewSummary {
  const total = items.length;
  let verified = 0, edited = 0, flagged = 0, markedPending = 0, remaining = 0;
  for (const it of items) {
    switch (it.reviewStatus) {
      case "VERIFIED": verified++; break;
      case "EDITED": edited++; break;
      case "FLAGGED": flagged++; break;
      case "MARKED_PENDING": markedPending++; break;
      case "PENDING_REVIEW": remaining++; break;
    }
  }
  const reviewed = total - remaining;
  return {
    total, verified, edited, flagged, markedPending, remaining,
    completionPct: total === 0 ? 0 : Math.round((reviewed / total) * 100),
  };
}

/** The effective value of a field: reviewer override if present, else the AI value. */
export function effectiveQuantity(it: ReviewItem): number | null {
  return it.reviewer && "quantity" in it.reviewer ? it.reviewer.quantity ?? null : it.ai.quantity;
}

export interface FieldDiff {
  field: string;
  aiValue: string;
  reviewerValue: string;
}

/** The AI-vs-reviewer differences for an edited item (both values retained). */
export function diffItem(it: ReviewItem): FieldDiff[] {
  const r = it.reviewer;
  if (!r) return [];
  const out: FieldDiff[] = [];
  const cmp = (field: string, ai: unknown, rev: unknown) => {
    if (rev === undefined) return;
    const a = ai == null ? "" : String(ai);
    const b = rev == null ? "" : String(rev);
    if (a !== b) out.push({ field, aiValue: a, reviewerValue: b });
  };
  cmp("quantity", it.ai.quantity, r.quantity);
  cmp("unit", it.ai.unit, r.unit);
  cmp("dimension", it.ai.dimension, r.dimension);
  cmp("specification", it.ai.specification, r.specification);
  cmp("location", it.ai.location, r.location);
  return out;
}

/** A compact "+1 correction" style delta for a numeric quantity edit, or null. */
export function quantityDelta(it: ReviewItem): string | null {
  if (!it.reviewer || !("quantity" in it.reviewer)) return null;
  const ai = it.ai.quantity;
  const rev = it.reviewer.quantity ?? null;
  if (ai == null || rev == null || ai === rev) return null;
  const d = rev - ai;
  return `${d > 0 ? "+" : ""}${d} correction`;
}
