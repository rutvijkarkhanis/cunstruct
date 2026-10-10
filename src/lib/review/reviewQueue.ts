// REVIEW QUEUE — deterministic review-item logic (no AI, no I/O).
//
// Turns validated analysis items into review items, orders the queue so items
// needing attention surface first, filters them, computes progress/summary, and
// preserves the AI value vs the reviewer's correction. Everything here is pure
// and client-side — the spec requires that Verify/Edit/Flag/Pending, progress and
// diffs never call an AI model.

// Relative + explicit extension — see the note in analysisSchemaV1.ts; this
// keeps buildReviewItems() importable from the Deno edge function too.
import type { AnalysisItemV1, AiStatus } from "./analysisSchemaV1.ts";

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

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

const dupeKey = (i: AnalysisItemV1) => `${norm(i.item)}¦${norm(i.location)}`;

/** Scopes an explicit key by location so a mark code reused across different
 *  locations (e.g. "W1" on the Stilt, Ground, and Typical floors) is not
 *  treated as one identity. A blank location collapses to the bare key,
 *  preserving today's behavior when no location is given. */
const scopedKey = (i: AnalysisItemV1) => {
  const loc = norm(i.location);
  return loc ? `${i.key}¦${loc}` : i.key;
};

/** A proxy for "this occurrence's own measured facts" — consulted ONLY when
 *  location is blank, where the bare key/item text alone is not enough
 *  evidence that two occurrences are the same physical instance: a mark
 *  code reused across floors (e.g. W1 on Stilt/Ground/Typical, each a
 *  different size or count) looks IDENTICAL to a genuine same-floor repeat
 *  once location drops out of both. Two blank-location occurrences are only
 *  linked as duplicates when this also agrees; any disagreement (a
 *  different quantity, dimension, or specification) is treated as evidence
 *  they are NOT the same instance — never guessed past, exactly like this
 *  file's other "never fabricate" rules.
 *
 *  KNOWN, DELIBERATELY UNRESOLVED LIMITATION (an adversarial review
 *  confirmed this reproducibly): quantity/dimension/specification agreeing
 *  is NOT proof of physical identity. Three genuinely distinct floors can
 *  legitimately share an identical count, size, and spec (e.g. "every floor
 *  has 10 Type-D1 doors, 900x2100, flush panel") — that input is BYTE-FOR-
 *  BYTE indistinguishable from one floor's row re-parsed three times, and
 *  this file has no way to tell them apart from quantity/dimension/
 *  specification alone. The `source` fold-in just below narrows this (a
 *  different page is real evidence of a different instance), but only for
 *  items that actually carry source tracking — when BOTH location AND
 *  source are absent, this remains unresolved. Closing it fully would need
 *  identity evidence this schema doesn't carry today (e.g. a stable
 *  per-occurrence id from the AI itself) — never invented here. */
const unlocatedFingerprint = (i: AnalysisItemV1) => {
  const measured = `${i.quantity ?? ""}¦${norm(i.dimension)}¦${norm(i.specification)}`;
  // Folded in ONLY when the occurrence actually tracked where it came from —
  // a different page/document is stronger, more direct evidence of a
  // different physical instance than quantity/dimension/specification ever
  // is (see analysisSchemaV1.ts's AnalysisSource). Absent on EITHER side,
  // this adds nothing and the comparison falls back to measured facts alone
  // (today's behavior, unchanged) — an item that tracked its source is
  // deliberately never matched against one that didn't, rather than
  // guessing they agree.
  const hasSource = i.source?.page != null || !!i.source?.documentId;
  const sourcePart = hasSource ? `¦${i.source!.documentId ?? ""}¦${i.source!.page ?? ""}` : "";
  return `${measured}${sourcePart}`;
};

/** Build review items from analysis items, tagging duplicates deterministically. */
export function buildReviewItems(items: AnalysisItemV1[]): ReviewItem[] {
  const seenKey = new Map<string, string>();   // dupeKey → first item key
  const seenId = new Map<string, string>();     // scoped key → first item key
  // Location-BLANK occurrences only, grouped by bucket (scoped key or
  // dupeKey) and then by unlocatedFingerprint within that bucket. A bucket
  // can hold more than one distinct fingerprint group at once — e.g. "W1"
  // reused across three floors (three different fingerprints, none of them
  // linked to each other) plus a genuine same-floor repeat (sharing one of
  // those fingerprints, and so correctly linked to it). A bucket whose
  // occurrences carry an EXPLICIT location never touches these maps at all;
  // that path is completely unchanged from before.
  const unlocatedGroupsById = new Map<string, Map<string, string>>();   // sk -> (fingerprint -> first item key)
  const unlocatedGroupsByDupe = new Map<string, Map<string, string>>(); // k  -> (fingerprint -> first item key)

  return items.map((ai) => {
    let duplicateOf: string | undefined;
    const k = dupeKey(ai);
    const sk = scopedKey(ai);
    const hasLocation = norm(ai.location) !== "";
    const fp = hasLocation ? null : unlocatedFingerprint(ai);

    // Same two-branch shape as before Fix B: a scoped-key revisit is handled
    // here and never falls through to the looser dupeKey branch below; only
    // the FIRST occurrence of a given scoped identity (or a no-key item) can
    // reach that branch at all — unchanged from the original control flow.
    if (ai.key && seenId.has(sk)) {
      duplicateOf = hasLocation ? seenId.get(sk) : unlocatedGroupsById.get(sk)?.get(fp!);
    } else if (seenKey.has(k)) {
      duplicateOf = hasLocation ? seenKey.get(k) : unlocatedGroupsByDupe.get(k)?.get(fp!);
    }

    if (ai.key && !seenId.has(sk)) seenId.set(sk, ai.key);
    if (!seenKey.has(k)) seenKey.set(k, ai.key);

    // Record this occurrence's own fingerprint in its bucket(s) — even when
    // it didn't itself match anything — so a LATER occurrence that agrees
    // with THIS one (not necessarily the bucket's very first occurrence) can
    // still be linked. This is what lets a same-floor repeat land anywhere
    // in the batch relative to the other, genuinely distinct floors.
    if (!hasLocation) {
      if (ai.key) {
        const group = unlocatedGroupsById.get(sk) ?? new Map<string, string>();
        if (!group.has(fp!)) group.set(fp!, ai.key);
        unlocatedGroupsById.set(sk, group);
      }
      const dupeGroup = unlocatedGroupsByDupe.get(k) ?? new Map<string, string>();
      if (!dupeGroup.has(fp!)) dupeGroup.set(fp!, ai.key);
      unlocatedGroupsByDupe.set(k, dupeGroup);
    }

    return { ai, reviewStatus: "PENDING_REVIEW", duplicateOf };
  });
}

/** True when an item still needs a human decision. */
export function needsReview(it: ReviewItem): boolean {
  return it.reviewStatus === "PENDING_REVIEW";
}

/** Human-readable reasons this item needs review-time attention — the exact
 *  same conditions isCritical() checks, but named, so the UI can show a
 *  factual "Review required — <reasons>" banner instead of a bare flag. */
export function criticalReasons(it: ReviewItem): string[] {
  const { ai } = it;
  const reasons: string[] = [];
  if (it.duplicateOf != null) reasons.push("Possible duplicate");
  if ((ai.candidates?.length ?? 0) > 1) reasons.push(`Conflicting sources (${ai.candidates!.length} candidates)`);
  if (ai.aiStatus === "PENDING" || ai.quantity == null) reasons.push("Pending — no quantity");
  if (ai.aiStatus === "INFERRED") reasons.push("Inferred");
  if (ai.confidence != null && ai.confidence <= LOW_CONFIDENCE) reasons.push("Low confidence");
  if ((ai.source?.evidence.length ?? 0) === 0) reasons.push("No evidence");
  return reasons;
}

/** True when an item warrants priority attention (before normal measured items). */
export function isCritical(it: ReviewItem): boolean {
  return criticalReasons(it).length > 0;
}

// Ordering weight: lower sorts first. Unreviewed-critical first, then unreviewed,
// then reviewed items (kept, never discarded).
function priority(it: ReviewItem): number {
  const unreviewed = needsReview(it);
  if (unreviewed && it.duplicateOf) return 0;
  if (unreviewed && (it.ai.candidates?.length ?? 0) > 1) return 0.5; // conflicting sources — actionable, resolve next
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
