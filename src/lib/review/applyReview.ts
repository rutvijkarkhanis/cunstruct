// APPLY TO BOQ — turn reviewed drawing-analysis decisions into explicit,
// confirmed boq_line writes.
//
// Nothing here runs automatically. `classifyReviewItem`/`buildApplyPlan` are
// pure and only compute what WOULD change — they never touch the database.
// `applyReviewPlan` writes to boq_line, and only for the exact candidates the
// reviewer selected in the confirmation screen, each already classified APPLY
// or NEW_LINE. PENDING_REVIEW, FLAGGED, and MARKED_PENDING items are never
// eligible, at any point in this file.
//
// Only quantity and unit are ever written to boq_line — those are the only two
// analysis-review fields with a corresponding boq_line column. Dimension,
// specification, and location stay visible in the review workstation but have
// no destination field on boq_line; writing them into basis_note or the
// `drawing` jsonb blob would risk overwriting unrelated structured data already
// on the line, so this never attempts it.
//
// Because those three fields have no destination, a reviewer correction to
// them must never be reported as "no change" — that would silently discard an
// approved correction. classifyReviewItem tracks them separately as
// `unsupportedChanges` and either classifies the item REVIEWED_NOT_APPLICABLE
// (nothing BOQ-side to apply, but a real correction exists) or, when the item
// also has a genuine qty/unit change, keeps it APPLY/NEW_LINE while still
// carrying `unsupportedChanges` so the confirmation screen can disclose them.
//
// The diff shown is always against the CURRENT boq_line value, not the
// original AI value — recomputed fresh from `lines` every time a plan is
// built, so a line changed elsewhere (or by a previous apply) is compared
// correctly on the next apply too.

import { PENDING_BASIS } from "@/lib/boqEvalJson";
import { addReviewItemAsLine, applyReviewQtyUnit } from "@/lib/applyFinding";
import { supabase } from "@/integrations/supabase/client";
import type { StoredReviewItem } from "./reviewStore";

/** The subset of a boq_line row needed to classify a review item against it. */
export interface BoqLineForApply {
  id: string;
  external_key: string | null;
  qty: number;
  unit: string | null;
  quantity_status: string | null;
}

export type ApplyClassification = "APPLY" | "NO_CHANGE" | "NEW_LINE" | "CANNOT_APPLY" | "NOT_ELIGIBLE" | "REVIEWED_NOT_APPLICABLE";

export interface FieldChange {
  field: "qty" | "unit";
  from: string;
  to: string;
}

/** A field the reviewer genuinely corrected but that boq_line has no column
 *  for — never written, and never allowed to be reported as "no change". */
export interface UnsupportedChange {
  field: "dimension" | "specification" | "location";
  from: string;
  to: string;
}

export interface ApplyCandidate {
  reviewItemId: string;
  itemKey: string;
  itemName: string;
  classification: ApplyClassification;
  matchedLineId: string | null;
  changes: FieldChange[];
  /** Reviewer corrections to dimension/specification/location that this apply
   *  workflow cannot write anywhere. Always populated when applicable,
   *  regardless of classification, so the UI can disclose them. */
  unsupportedChanges: UnsupportedChange[];
  reason?: string;
  newLine?: { description: string; unit: string | null; qty: number; pending: boolean };
}

function effectiveUnit(item: StoredReviewItem): string | null {
  if (item.reviewer && "unit" in item.reviewer) return item.reviewer.unit ?? null;
  return item.ai.unit ?? null;
}
function effectiveQty(item: StoredReviewItem): number | null {
  if (item.reviewer && "quantity" in item.reviewer) return item.reviewer.quantity ?? null;
  return item.ai.quantity;
}
const displayQty = (qty: number, status: string | null) => (status === "PENDING" ? "pending" : String(qty));
const norm = (s: string | null | undefined) => (s ?? "").trim();

const UNSUPPORTED_FIELDS = ["dimension", "specification", "location"] as const;

/** Reviewer corrections to fields boq_line has no column for. A field only
 *  counts as "changed" when the reviewer actually overrode it AND that
 *  override differs from the AI value — re-saving the same value, or never
 *  touching the field, is not a correction. */
function unsupportedChangesFor(item: StoredReviewItem): UnsupportedChange[] {
  const out: UnsupportedChange[] = [];
  if (!item.reviewer) return out;
  for (const field of UNSUPPORTED_FIELDS) {
    if (!(field in item.reviewer)) continue;
    const rev = norm(item.reviewer[field]);
    const ai = norm(item.ai[field]);
    if (rev === ai) continue;
    out.push({ field, from: ai || "—", to: rev || "—" });
  }
  return out;
}

/** Classify one review item against the BOQ's current lines. Pure; no I/O. */
export function classifyReviewItem(item: StoredReviewItem, lines: BoqLineForApply[]): ApplyCandidate {
  const base = { reviewItemId: item.id, itemKey: item.ai.key, itemName: item.ai.item };

  if (item.reviewStatus === "PENDING_REVIEW") {
    return { ...base, classification: "NOT_ELIGIBLE", matchedLineId: null, changes: [], unsupportedChanges: [], reason: "Not yet reviewed" };
  }
  if (item.reviewStatus === "FLAGGED") {
    return { ...base, classification: "NOT_ELIGIBLE", matchedLineId: null, changes: [], unsupportedChanges: [], reason: "Flagged — resolve before applying" };
  }
  if (item.reviewStatus === "MARKED_PENDING") {
    return { ...base, classification: "NOT_ELIGIBLE", matchedLineId: null, changes: [], unsupportedChanges: [], reason: "Marked pending — resolve before applying" };
  }

  // VERIFIED or EDITED only from here on.
  const qty = effectiveQty(item);
  const unit = effectiveUnit(item);
  const unsupportedChanges = unsupportedChangesFor(item);
  const match = item.ai.key ? lines.find((l) => l.external_key && l.external_key === item.ai.key) : undefined;

  if (match) {
    const changes: FieldChange[] = [];
    const wantPending = qty == null;
    const fromQty = displayQty(match.qty, match.quantity_status);
    const toQty = wantPending ? "pending" : String(qty);
    if (fromQty !== toQty) changes.push({ field: "qty", from: fromQty, to: toQty });

    const fromUnit = norm(match.unit);
    const toUnit = norm(unit);
    if (fromUnit !== toUnit) changes.push({ field: "unit", from: fromUnit || "—", to: toUnit || "—" });

    if (changes.length === 0) {
      // No qty/unit change. If the reviewer nonetheless corrected a field this
      // workflow can't write, that is NOT "no change" — it's a real correction
      // with nowhere to go, and must say so rather than disappear.
      if (unsupportedChanges.length > 0) {
        return { ...base, classification: "REVIEWED_NOT_APPLICABLE", matchedLineId: match.id, changes: [], unsupportedChanges };
      }
      return { ...base, classification: "NO_CHANGE", matchedLineId: match.id, changes: [], unsupportedChanges: [] };
    }
    return { ...base, classification: "APPLY", matchedLineId: match.id, changes, unsupportedChanges };
  }

  // No matching line. Only insertable when the item carries the one field the
  // existing insertion pattern (addFindingAsLine / addReviewItemAsLine) actually
  // requires: a non-empty description. Never fabricate a unit or a quantity.
  if (!item.ai.item?.trim()) {
    return { ...base, classification: "CANNOT_APPLY", matchedLineId: null, changes: [], unsupportedChanges, reason: "Cannot apply automatically — BOQ line not found" };
  }
  return {
    ...base,
    classification: "NEW_LINE",
    matchedLineId: null,
    changes: [
      { field: "qty", from: "—", to: qty == null ? "pending" : String(qty) },
      { field: "unit", from: "—", to: unit ?? "—" },
    ],
    unsupportedChanges,
    newLine: { description: item.ai.item, unit, qty: qty ?? 0, pending: qty == null },
  };
}

/** Classify every review item. Pure; safe to recompute on every render. */
export function buildApplyPlan(items: StoredReviewItem[], lines: BoqLineForApply[]): ApplyCandidate[] {
  return items.map((it) => classifyReviewItem(it, lines));
}

export interface ApplyResult {
  appliedCount: number;
  skippedNoChange: number;
  unresolvedCount: number;
}

/**
 * Execute the reviewer's confirmed selection. Only candidates in `selectedIds`
 * with classification APPLY or NEW_LINE are written; everything else (including
 * a candidate that IS selected but isn't APPLY/NEW_LINE — which the UI should
 * never allow) is skipped defensively. Every actual field change is recorded in
 * boq_line_change_log with the before/after value, who, and when.
 */
export async function applyReviewPlan(args: {
  boqId: string;
  candidates: ApplyCandidate[];
  selectedIds: Set<string>;
}): Promise<ApplyResult> {
  const { data: userData } = await supabase.auth.getUser();
  const changedBy = userData?.user?.id ?? null;
  let appliedCount = 0;

  for (const c of args.candidates) {
    if (!args.selectedIds.has(c.reviewItemId)) continue;
    if (c.classification !== "APPLY" && c.classification !== "NEW_LINE") continue;

    let lineId: string;
    let logRows: { boq_id: string; boq_line_id: string; review_item_id: string; field: string; old_value: string | null; new_value: string | null; changed_by: string | null }[];

    if (c.classification === "APPLY" && c.matchedLineId) {
      lineId = c.matchedLineId;
      const patch: Record<string, unknown> = {};
      const qtyChange = c.changes.find((f) => f.field === "qty");
      const unitChange = c.changes.find((f) => f.field === "unit");
      if (qtyChange) {
        const pending = qtyChange.to === "pending";
        patch.qty = pending ? 0 : Number(qtyChange.to);
        patch.basis = pending ? PENDING_BASIS : null;
        patch.quantity_status = pending ? "PENDING" : "MEASURED";
      }
      if (unitChange) patch.unit = unitChange.to === "—" ? null : unitChange.to;
      await applyReviewQtyUnit(lineId, patch);
      logRows = c.changes.map((ch) => ({
        boq_id: args.boqId, boq_line_id: lineId, review_item_id: c.reviewItemId,
        field: ch.field, old_value: ch.from, new_value: ch.to, changed_by: changedBy,
      }));
    } else if (c.classification === "NEW_LINE" && c.newLine) {
      lineId = await addReviewItemAsLine({
        boqId: args.boqId, description: c.newLine.description, unit: c.newLine.unit,
        qty: c.newLine.qty, pending: c.newLine.pending, externalKey: c.itemKey,
      });
      // Field-level records for the actual values the line was created with —
      // "line_created" is kept alongside as provenance (which review item and
      // description produced this line), never as a substitute for them. A
      // unit row is added only when a real unit was written; nothing here
      // invents a before/after pair for a field that stayed empty.
      const base = { boq_id: args.boqId, boq_line_id: lineId, review_item_id: c.reviewItemId, changed_by: changedBy };
      logRows = [
        { ...base, field: "qty", old_value: null, new_value: c.newLine.pending ? "pending" : String(c.newLine.qty) },
        ...(c.newLine.unit ? [{ ...base, field: "unit", old_value: null, new_value: c.newLine.unit }] : []),
        { ...base, field: "line_created", old_value: null, new_value: c.newLine.description },
      ];
    } else {
      continue;
    }

    if (logRows.length) await supabase.from("boq_line_change_log").insert(logRows);
    appliedCount++;
  }

  const skippedNoChange = args.candidates.filter((c) => c.classification === "NO_CHANGE").length;
  const unresolvedCount = args.candidates.filter((c) =>
    c.classification === "NOT_ELIGIBLE" || c.classification === "CANNOT_APPLY" || c.classification === "REVIEWED_NOT_APPLICABLE",
  ).length;
  return { appliedCount, skippedNoChange, unresolvedCount };
}
