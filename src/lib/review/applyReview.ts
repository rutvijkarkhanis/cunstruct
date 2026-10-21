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
// on the line, so this never attempts it. (A NEW line's description is the
// one exception: it is created with the item's name plus the descriptive text
// the analysis extracted for it — see newLineDescription. Existing lines'
// descriptions are never touched.)
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
import { REVIEW_CORRECTED_BASIS, REVIEW_VERIFIED_BASIS, quantityState } from "@/lib/quantity";
import { addReviewItemAsLine, applyReviewQtyUnit } from "@/lib/applyFinding";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/untypedDb";
import type { StoredReviewItem } from "./reviewStore";
import { assertApplyAllowed, assessRunFreshness } from "./revisionFreshness";
import { isCountableUnit } from "./typeGrouping";

/** The subset of a boq_line row needed to classify a review item against it.
 *  `scope_name` is the line's resolved scope (its own boq_line.scope_id, if
 *  set, joined to project_scope.name) — null when unset. It is ONLY consulted
 *  when external_key collides across more than one line in the same batch;
 *  it plays no role at all in the single-candidate (today's normal) path. */
export interface BoqLineForApply {
  id: string;
  external_key: string | null;
  qty: number;
  unit: string | null;
  quantity_status: string | null;
  scope_name: string | null;
  /** The line's CURRENT source_document_id, if it has one. Consulted ONLY to
   *  decide whether an APPLY (matched-line) candidate should propose writing
   *  a source reference — a line that already carries one keeps it; see
   *  classifyReviewItem's `source` field below. Optional so every existing
   *  BoqLineForApply fixture/caller that predates this field keeps compiling
   *  unchanged; absent is treated identically to null — "no source yet",
   *  the safe default that only ever ENABLES a first-time population, never
   *  blocks one. */
  source_document_id?: string | null;
  /** The line's CURRENT basis, when loaded. Together with quantity_status it
   *  decides whether the line's quantity is pending (the shared rule,
   *  lib/quantity.ts quantityState) and is guarded at write time. Absent =
   *  not loaded: the status-only reading applies and it is not guarded. */
  basis?: string | null;
}

export type ApplyClassification =
  | "APPLY" | "NO_CHANGE" | "NEW_LINE" | "CANNOT_APPLY" | "NOT_ELIGIBLE" | "REVIEWED_NOT_APPLICABLE"
  // Two or more BOQ lines share the item's external_key and could not be
  // told apart by an exact, normalized location<->scope_name match. Never
  // resolved automatically — surfaced for a human to pick, exactly like
  // CANNOT_APPLY/REVIEWED_NOT_APPLICABLE are never auto-applied either.
  | "AMBIGUOUS";

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
  /** The reviewer's decision on the item (VERIFIED or EDITED for anything
   *  applicable) — recorded as the applied quantity's basis. */
  decision?: StoredReviewItem["reviewStatus"];
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
  newLine?: { description: string; unit: string | null; qty: number; pending: boolean; location: string | null };
  /** Populated ONLY for classification AMBIGUOUS — every boq_line id whose
   *  external_key matched, so the UI can list them for manual resolution.
   *  Never populated for any other classification. */
  candidateLineIds?: string[];
  /**
   * The matched boq_line's raw qty/unit at classification time — exactly
   * what `changes[].from` was derived from. Used by applyReviewPlan to make
   * the eventual write conditional on the row not having changed since this
   * candidate was classified: a guard against a stale snapshot across
   * SEPARATE apply calls (two reviewers, two tabs, or any apply operation
   * that ran between classification and this write), which the in-call
   * conflict tracking from #133/#134 cannot see. Populated only for
   * classification APPLY (there's a matched line to snapshot); never for
   * NEW_LINE or any other classification.
   */
  expectedLineState?: { qty: number; unit: string | null; quantity_status?: string | null; basis?: string | null };
  /** APPLY only: the reviewed quantity this candidate stands for (null =
   *  pending). Used when only the unit changes, so the line records that its
   *  quantity — now in the reviewed unit — was reviewed, without ever turning
   *  a pending quantity into an established one. */
  reviewedQty?: number | null;
  /**
   * The AI item's own drawing-source reference (Scope C — traceability),
   * proposed for writing ONLY when it is safe and non-destructive to do so:
   *   - NEW_LINE: always populated when item.ai.source.documentId is a
   *     non-empty string — there is no existing provenance to protect.
   *   - APPLY (matched line): populated ONLY when the matched line does not
   *     already carry a source_document_id (`!match.source_document_id`) —
   *     existing provenance is preserved by default, never silently
   *     replaced by a later Apply's source. A line that already has one
   *     keeps `source` undefined here, meaning "nothing to write."
   * `page` is carried through as a plain number (converted to text at the
   * write site, matching boq_line.source_page's column type) and is
   * genuinely optional — a source can be a whole-document reference with no
   * specific page. Never includes a revision id: AnalysisSource captures
   * none (see analysisSchemaV1.ts's own doc comment), so resolving
   * source_revision_id is applyReviewPlan's job, not this pure function's —
   * it requires an I/O lookup this function (documented pure, no I/O) must
   * never perform.
   */
  source?: { documentId: string; page: number | null };
}

function effectiveUnit(item: StoredReviewItem): string | null {
  if (item.reviewer && "unit" in item.reviewer) return item.reviewer.unit ?? null;
  return item.ai.unit ?? null;
}
function effectiveQty(item: StoredReviewItem): number | null {
  if (item.reviewer && "quantity" in item.reviewer) return item.reviewer.quantity ?? null;
  // The AI itself said this quantity is not established (aiStatus PENDING).
  // Verifying such an item without supplying a quantity confirms nothing
  // about the number (the workstation disables Verify for it for exactly this
  // reason) — it stays pending, never applied as an established quantity.
  if (item.ai.aiStatus === "PENDING") return null;
  return item.ai.quantity;
}
/** The line's quantity as the diff shows it: "pending" whenever the shared
 *  rule says the quantity is not established (marked pending by status OR
 *  basis, or a zero nobody confirmed), else the number — so a reviewer's
 *  confirmed 0 against an unconfirmed 0 is a real change, not "no change". */
const lineQtyDisplay = (line: BoqLineForApply) =>
  quantityState({ qty: line.qty, quantity_status: line.quantity_status, basis: line.basis }) === "pending" ? "pending" : String(line.qty);
const norm = (s: string | null | undefined) => (s ?? "").trim();

/** Spellings of "a count of discrete items" that mean exactly the same thing.
 *  "set" and "pair" are not here: they count groups, not single items. */
const COUNT_UNIT_SPELLINGS = new Set(["no", "no.", "nos", "nos.", "nr", "nr.", "number", "numbers", "each", "ea"]);
/** The app's one spelling of a single-item count (quantityMethod COUNT,
 *  measurement LineUnit, tender export). */
export const CANONICAL_COUNT_UNIT = "nos";

/** A count unit in its one canonical spelling ("nr", "No.", "each" -> "nos");
 *  every other unit is returned exactly as given (trimmed). Never converts. */
export function canonicalApplyUnit(unit: string | null | undefined): string | null {
  const u = norm(unit);
  if (!u) return null;
  return COUNT_UNIT_SPELLINGS.has(u.toLowerCase()) ? CANONICAL_COUNT_UNIT : u;
}
const sameCountUnit = (a: string | null | undefined, b: string | null | undefined) =>
  COUNT_UNIT_SPELLINGS.has(norm(a).toLowerCase()) && COUNT_UNIT_SPELLINGS.has(norm(b).toLowerCase());

/**
 * The description a NEW line is created with: the item's name (usually its
 * drawing tag, "D3") followed by the descriptive text the analysis itself
 * extracted for it — `ai.description` when present, else `ai.specification`:
 * "D3 — Single leaf, solid timber …". The tag is kept for traceability; the
 * text is used verbatim, never composed or guessed. With no such text, the
 * name alone, as before. A specification the reviewer CORRECTED is not used
 * at all: the AI's text would contradict the reviewer, and the correction
 * itself stays disclosed as "not applied" and kept in the line's history
 * (unsupportedChangesFor), exactly as before.
 */
export function newLineDescription(item: StoredReviewItem): string {
  const name = norm(item.ai.item);
  const specCorrected = unsupportedChangesFor(item).some((u) => u.field === "specification");
  const text = norm(item.ai.description) || (specCorrected ? "" : norm(item.ai.specification));
  // Nothing to add when the text is the name again, or already part of it.
  if (!text || name.toLowerCase().includes(text.toLowerCase())) return name;
  return `${name} — ${text}`;
}

/**
 * The drawing-source reference to propose for this item, or undefined when
 * there is nothing safe to propose. `existingSourceDocumentId` is the
 * MATCHED line's current value (undefined/null for a NEW_LINE, which has no
 * existing line to protect) — a truthy value means the line already has
 * provenance, which this function must never silently replace.
 *
 * documentId is required (AnalysisSource.document, the by-name fallback,
 * is never used here — only the stable stored-document id is trustworthy
 * enough to persist as a foreign key). A missing/empty documentId yields
 * undefined, never a guessed or name-matched id.
 */
function sourceToPropose(
  item: StoredReviewItem,
  existingSourceDocumentId: string | null | undefined,
): { documentId: string; page: number | null } | undefined {
  if (existingSourceDocumentId) return undefined; // preserve existing provenance — never overwrite
  const documentId = item.ai.source?.documentId;
  if (!documentId) return undefined; // nothing safe to propose — never guessed
  const page = item.ai.source?.page;
  return { documentId, page: typeof page === "number" ? page : null };
}

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

/** The location this item is filed under: the reviewer's correction when
 *  they made one (an emptied field clears it), else the AI's own text. */
function effectiveLocation(item: StoredReviewItem): string {
  if (item.reviewer && "location" in item.reviewer) return norm(item.reviewer.location);
  return norm(item.ai.location);
}

/**
 * Classify one review item against the BOQ's current lines. Pure; no I/O.
 *
 * `scopeNames` — the project's existing project_scope names. When given, a
 * location is only trusted as a scope if it names one of them: AI free text
 * ("Various rooms", "Entrance Lobby") never stands for a different floor and
 * never becomes a new scope. Omitted by callers that predate it; Apply still
 * refuses to create a scope at write time (see findScopeIdForLocation).
 */
/** The basis an applied quantity records: what the reviewer did with it.
 *  Anything else (never applicable) records nothing rather than a guess. */
function reviewBasis(decision: ApplyCandidate["decision"]): string | null {
  return decision === "EDITED" ? REVIEW_CORRECTED_BASIS : decision === "VERIFIED" ? REVIEW_VERIFIED_BASIS : null;
}

export function classifyReviewItem(item: StoredReviewItem, lines: BoqLineForApply[], scopeNames?: readonly string[]): ApplyCandidate {
  const base = { reviewItemId: item.id, itemKey: item.ai.key, itemName: item.ai.item, decision: item.reviewStatus };

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

  // A negative or non-numeric quantity has no meaning on a BOQ line (the
  // shared rule reads it as "not available") — never written, never guessed.
  if (qty != null && (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0)) {
    return {
      ...base, classification: "CANNOT_APPLY", matchedLineId: null, changes: [], unsupportedChanges,
      reason: `Quantity ${String(qty)} is not a valid quantity — edit it to zero or more, or mark it pending`,
    };
  }

  // Every line whose external_key matches this item's key — almost always 0
  // or 1. More than one means the same mark exists more than once in this
  // batch (e.g. the same code reused across floors in a consolidated BOQ)
  // and must be disambiguated by scope, never by which one happens to come
  // first.
  const candidates = item.ai.key ? lines.filter((l) => l.external_key && l.external_key === item.ai.key) : [];
  const itemLocation = effectiveLocation(item);
  const knownScopes = scopeNames ? new Set(scopeNames.map((n) => norm(n))) : null;

  let match: BoqLineForApply | undefined;
  if (candidates.length === 1) {
    const only = candidates[0];
    const lineScope = norm(only.scope_name);
    // The dominant, legacy case — no scope on the line at all — is
    // untouched: match unconditionally regardless of the item's own
    // location. Once the line DOES carry an explicit scope, an unconditional
    // match is only safe when the item's location agrees with it. Two ways
    // it can fail to agree:
    //   - EXPLICIT disagreement (item says "Ground", line is scoped "Stilt")
    //     — never possible before scope_id was set at line-creation time.
    //   - NO location on the item at all. An AI item can omit location even
    //     when it genuinely has one (the schema's `location` field is
    //     nullable by design) — without this check, that omission would
    //     silently overwrite THIS scoped line's quantity as if it were a
    //     confirmed match, purely because no second same-key line exists yet
    //     to trigger the multi-candidate disambiguation below. There is
    //     nothing here to safely disambiguate against, so it is treated
    //     exactly like the explicit-disagreement case.
    // Either way, falling through to "no matching line" lets it become its
    // own correctly-scoped NEW_LINE instead (or CANNOT_APPLY with no
    // description) — the same fallback this file already uses for the
    // explicit-disagreement case, not a new outcome invented for this one.
    if (lineScope && (!itemLocation || itemLocation !== lineScope)) {
      // Only a location naming ANOTHER existing scope is evidence of a
      // different floor (its own NEW_LINE). No location, or text that is not
      // a scope, is not: the same mark already in this BOQ would be counted
      // twice, so the reviewer decides instead.
      const otherKnownScope = !!itemLocation && (knownScopes ? knownScopes.has(itemLocation) : true);
      if (!otherKnownScope) {
        return {
          ...base, classification: "AMBIGUOUS", matchedLineId: null, changes: [], unsupportedChanges,
          candidateLineIds: [only.id],
          reason: itemLocation
            ? `This BOQ already has ${item.ai.key} in "${only.scope_name}"; "${itemLocation}" is not a project scope — set the location to confirm whether it is the same line`
            : `This BOQ already has ${item.ai.key} in "${only.scope_name}" and this item has no location — set the location to confirm whether it is the same line`,
        };
      }
      match = undefined;
    } else {
      match = only;
    }
  } else if (candidates.length > 1) {
    // Disambiguate ONLY on an exact, normalized location <-> scope_name
    // match — never on array order/position. Requires the item to actually
    // state a location AND exactly one candidate's scope_name to agree with
    // it; anything else (no location, no agreeing candidate, more than one
    // agreeing candidate, or candidates with no/identical scope_name to
    // distinguish them) is AMBIGUOUS, not a guess.
    const scopeMatches = itemLocation ? candidates.filter((c) => norm(c.scope_name) === itemLocation) : [];
    if (itemLocation && scopeMatches.length === 1) {
      match = scopeMatches[0];
    } else {
      return {
        ...base, classification: "AMBIGUOUS", matchedLineId: null, changes: [], unsupportedChanges,
        candidateLineIds: candidates.map((c) => c.id),
        reason: `${candidates.length} BOQ lines share this key with no unambiguous scope match`,
      };
    }
  }

  if (match) {
    // A location that picked this line's scope was used, not lost.
    const matchedScope = norm(match.scope_name);
    const unsupported = matchedScope && matchedScope === itemLocation
      ? unsupportedChanges.filter((u) => u.field !== "location")
      : unsupportedChanges;
    const changes: FieldChange[] = [];
    const wantPending = qty == null;
    const fromQty = lineQtyDisplay(match);
    const toQty = wantPending ? "pending" : String(qty);
    if (fromQty !== toQty) changes.push({ field: "qty", from: fromQty, to: toQty });

    const fromUnit = norm(match.unit);
    // Two spellings of the same count ("nr" on the line, "nos" reviewed) are
    // no change — the line keeps its own spelling. A real change is written
    // in the canonical spelling.
    const toUnit = sameCountUnit(match.unit, unit) ? fromUnit : norm(canonicalApplyUnit(unit));
    if (fromUnit !== toUnit) changes.push({ field: "unit", from: fromUnit || "—", to: toUnit || "—" });

    if (changes.length === 0) {
      // No qty/unit change. If the reviewer nonetheless corrected a field this
      // workflow can't write, that is NOT "no change" — it's a real correction
      // with nowhere to go, and must say so rather than disappear.
      if (unsupported.length > 0) {
        return { ...base, classification: "REVIEWED_NOT_APPLICABLE", matchedLineId: match.id, changes: [], unsupportedChanges: unsupported };
      }
      return { ...base, classification: "NO_CHANGE", matchedLineId: match.id, changes: [], unsupportedChanges: [] };
    }
    return {
      ...base, classification: "APPLY", matchedLineId: match.id, changes, unsupportedChanges: unsupported,
      expectedLineState: {
        qty: match.qty, unit: match.unit,
        // Guarded only when loaded (undefined = not selected by the caller).
        ...(match.quantity_status !== undefined ? { quantity_status: match.quantity_status } : {}),
        ...(match.basis !== undefined ? { basis: match.basis } : {}),
      },
      reviewedQty: qty,
      source: sourceToPropose(item, match.source_document_id),
    };
  }

  // No matching line. Only insertable when the item carries the one field the
  // existing insertion pattern (addFindingAsLine / addReviewItemAsLine) actually
  // requires: a non-empty description. Never fabricate a unit or a quantity.
  if (!item.ai.item?.trim()) {
    return { ...base, classification: "CANNOT_APPLY", matchedLineId: null, changes: [], unsupportedChanges, reason: "Cannot apply automatically — BOQ line not found" };
  }
  // A new line is scoped by its location, and only an existing scope may be
  // used — unverified text never creates one.
  if (itemLocation && knownScopes && !knownScopes.has(itemLocation)) {
    return {
      ...base, classification: "CANNOT_APPLY", matchedLineId: null, changes: [], unsupportedChanges,
      reason: `Location "${itemLocation}" is not a project scope — edit the location to an existing scope, or clear it`,
    };
  }
  // The location is used here (it picks the scope), so it is not reported
  // as a correction the BOQ cannot hold.
  const newLineUnsupported = unsupportedChanges.filter((u) => u.field !== "location");
  const newUnit = canonicalApplyUnit(unit);
  return {
    ...base,
    classification: "NEW_LINE",
    matchedLineId: null,
    changes: [
      { field: "qty", from: "—", to: qty == null ? "pending" : String(qty) },
      { field: "unit", from: "—", to: newUnit ?? "—" },
    ],
    unsupportedChanges: newLineUnsupported,
    newLine: { description: newLineDescription(item), unit: newUnit, qty: qty ?? 0, pending: qty == null, location: itemLocation || null },
    source: sourceToPropose(item, null),
  };
}

/** Classify every review item. Pure; safe to recompute on every render. */
export function buildApplyPlan(items: StoredReviewItem[], lines: BoqLineForApply[], scopeNames?: readonly string[]): ApplyCandidate[] {
  return items.map((it) => classifyReviewItem(it, lines, scopeNames));
}

export interface ApplyResult {
  appliedCount: number;
  skippedNoChange: number;
  unresolvedCount: number;
  /**
   * Review item ids classified APPLY but skipped because an earlier selected
   * candidate in this SAME call already wrote to the same matchedLineId. Both
   * candidates were classified against one pre-apply snapshot, so a later one
   * targeting a line an earlier one just changed is computing its "from"
   * value against data that's now stale — applying it would silently
   * overwrite the earlier, already-logged change with no warning. Never
   * done: each conflicted id is left untouched (no boq_line write, no audit
   * row) and counted in `unresolvedCount`, exactly like any other item that
   * needs a fresh apply pass to be classified correctly against the line's
   * current value.
   */
  conflictedReviewItemIds: string[];
  /**
   * Review item ids whose BOQ line WAS written but whose boq_line_change_log
   * rows could not be (e.g. the table is missing). The quantity change stands;
   * its audit record does not — reported so the caller never shows a plain
   * success for an unaudited change.
   */
  auditLogFailedReviewItemIds: string[];
  /**
   * Source documents whose current revision changed WHILE this call was
   * writing (after its own pre-write freshness check passed). Only set for a
   * call with a runId. The lines already written keep the analysed revision
   * as their source_revision_id, so their provenance stays true; this only
   * reports that the analysis is now stale so the reviewer can re-analyse.
   * Nothing is rolled back.
   */
  revisionChangedDuringApply?: string[];
}

/**
 * The existing project_scope whose name exactly matches a review item's
 * location (trimmed, exact — the same comparison classifyReviewItem uses), or
 * null. Never creates one: a location is model or reviewer text, and a
 * project scope is created only through the scope workflow (ProjectBoqs.tsx's
 * "+ New scope…"). The caller treats null as "not applicable", never as an
 * unscoped write.
 */
async function findScopeIdForLocation(projectId: string, location: string): Promise<string | null> {
  const name = location.trim();
  if (!name) return null;
  const { data: existing } = await supabase
    .from("project_scope")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  return existing ? (existing as { id: string }).id : null;
}

/**
 * Resolve the EXACT revision analysis_run_source durably recorded as having
 * been analyzed for this (run, document) pair — Scope E. The ai-analysis edge
 * function resolves project_document.current_revision_id itself at the
 * moment it downloads a file for OpenAI, and records that exact
 * document_revision id verbatim on the claim row it inserts
 * (analysis_run_source.document_revision_id), then stamps the claim with
 * analysis_run_id once the run that produced this review item's items
 * succeeds. That is the one place in this codebase where "which revision was
 * actually analyzed" is captured durably — see boqDocumentLinks.ts's
 * identical reasoning, which first identified this exact plumbing gap and
 * deliberately deferred closing it. Exported (Scope F) so
 * linkAnalyzedDocumentsToBoq can reuse this exact resolution/validation
 * logic for boq_document.analyzed_revision_id too, rather than
 * reimplementing it — the generic (run, document) -> analyzed-revision
 * question this answers is never specific to the Apply flow it was first
 * built for.
 *
 * Returns a three-way result, each meaning something distinct to the caller:
 *   - a revision id: exactly one SUCCEEDED claim for (runId, documentId)
 *     names a document_revision_id, and it genuinely exists AND belongs to
 *     documentId (same ownership discipline as the current-revision fallback
 *     below — never trusted on id alone). The caller persists this directly.
 *   - undefined: no SUCCEEDED claim for (runId, documentId) exists at all —
 *     a json_import run (which never creates analysis_run_source rows), an
 *     ai_api run from before this column was populated, or a document this
 *     run simply never claimed. Genuinely "no opinion": the caller falls
 *     back to the pre-existing current-revision resolution, exactly as if
 *     this function didn't exist. The SAME fallback applies when the one
 *     claim's revision turns out to be invalid/cross-document — that is
 *     also "no trustworthy run-source evidence," not a reason to persist
 *     something known to be wrong, but also not grounds to refuse the
 *     pre-existing, already-accepted-risk fallback either.
 *   - null: more than one SUCCEEDED claim for (runId, documentId) names
 *     DIFFERING revisions — active, contradictory evidence. Never
 *     arbitrarily picked from, and never handed to the current-revision
 *     fallback either (that would be an equally arbitrary pick in the face
 *     of disagreement): the caller persists null and stops there.
 */
export async function resolveAnalyzedRevisionId(runId: string, documentId: string): Promise<string | null | undefined> {
  const { data } = await supabase
    .from("analysis_run_source")
    .select("document_revision_id")
    .eq("analysis_run_id", runId)
    .eq("document_id", documentId)
    .eq("status", "SUCCEEDED")
    .not("document_revision_id", "is", null);
  const rows = (data ?? []) as { document_revision_id: string }[];
  if (rows.length === 0) return undefined; // no run-source evidence — caller falls back

  const distinctRevisionIds = new Set(rows.map((r) => r.document_revision_id));
  if (distinctRevisionIds.size > 1) return null; // conflicting evidence — never guess, never fall back

  const revisionId = rows[0].document_revision_id;
  const { data: revision } = await supabase
    .from("document_revision")
    .select("id")
    .eq("id", revisionId)
    .eq("document_id", documentId)
    .maybeSingle();
  return revision ? revisionId : undefined; // invalid/cross-document → no usable evidence, caller falls back
}

/**
 * Apply stopped part-way: an unexpected error after at least one line had
 * already been written. `partial` is exactly what was written (and what was
 * refused as a conflict) before the stop; `failedReviewItemId` is the item
 * whose write failed (null when its line was in fact written and only its
 * history failed); `notAttemptedReviewItemIds` were selected but never tried.
 * Nothing is rolled back. Re-running Apply is safe: it re-classifies against
 * the lines' current values, so written lines show as "no change" and are
 * never applied twice.
 */
export class ApplyInterruptedError extends Error {
  readonly partial: ApplyResult;
  readonly failedReviewItemId: string | null;
  readonly notAttemptedReviewItemIds: string[];
  readonly cause: unknown;
  constructor(partial: ApplyResult, failedReviewItemId: string | null, notAttemptedReviewItemIds: string[], cause: unknown) {
    const why = cause instanceof Error ? cause.message : (cause as { message?: string } | null)?.message ?? String(cause);
    const notWritten = (failedReviewItemId ? 1 : 0) + notAttemptedReviewItemIds.length;
    super(`Apply stopped part-way: ${partial.appliedCount} item${partial.appliedCount === 1 ? " was" : "s were"} written to the BOQ, ${notWritten} ${notWritten === 1 ? "was" : "were"} not (${why}). Reload and apply again to finish — written lines are not applied twice.`);
    this.name = "ApplyInterruptedError";
    this.partial = partial;
    this.failedReviewItemId = failedReviewItemId;
    this.notAttemptedReviewItemIds = notAttemptedReviewItemIds;
    this.cause = cause;
  }
}

/** Apply refused because a selected item's source document cannot be
 *  attributed from verified evidence. Thrown before any write. */
export class SourceProvenanceError extends Error {
  readonly reviewItemIds: string[];
  constructor(message: string, reviewItemIds: string[]) {
    super(message);
    this.name = "SourceProvenanceError";
    this.reviewItemIds = reviewItemIds;
  }
}

/**
 * The selected candidates' source documents, resolved from the run's own
 * SUCCEEDED analysis_run_source claims (documents of this BOQ's project
 * only) — the model's `source.documentId` is never persisted on its own word:
 *   - exactly one claimed document: every selected candidate proposing a
 *     source — and every NEW_LINE, which has no existing provenance to
 *     protect — is attributed to it, unless the model named a different
 *     real document of this project (a contradiction, so unresolved);
 *     a filename, sheet title or other non-document id is ignored;
 *   - several claimed documents: the model's id is accepted only as an
 *     exact match for one of them; anything else (a filename, a sheet title,
 *     nothing) is ambiguous;
 *   - no claims (a json_import run): a proposed id must be one of this
 *     project's documents; candidates proposing nothing are left unchanged.
 * Throws SourceProvenanceError naming every unresolved item; nothing is
 * written. An APPLY candidate with no proposal (its line already has
 * provenance) is never touched.
 */
async function resolveRunProvenance(
  runId: string,
  projectId: string | null,
  candidates: ApplyCandidate[],
  selectedIds: Set<string>,
): Promise<ApplyCandidate[]> {
  const selected = candidates.filter((c) => selectedIds.has(c.reviewItemId) && (c.classification === "APPLY" || c.classification === "NEW_LINE"));
  if (selected.length === 0) return candidates;

  const { data: docRows, error: docErr } = projectId
    ? await db.from("project_document").select("id").eq("project_id", projectId)
    : { data: [], error: null };
  if (docErr) throw docErr;
  const projectDocIds = new Set(((docRows ?? []) as { id: string }[]).map((d) => d.id));

  const { data: claimRows, error: claimErr } = await db
    .from("analysis_run_source")
    .select("document_id")
    .eq("analysis_run_id", runId)
    .eq("status", "SUCCEEDED");
  if (claimErr) throw claimErr;
  const claimed = [...new Set(((claimRows ?? []) as { document_id: string | null }[]).map((r) => r.document_id))]
    .filter((id): id is string => !!id && projectDocIds.has(id));

  const unresolved: ApplyCandidate[] = [];
  const resolved = candidates.map((c) => {
    if (!selected.includes(c)) return c;
    const proposes = !!c.source || c.classification === "NEW_LINE";
    if (!proposes) return c;
    let documentId: string | undefined;
    if (claimed.length === 1) {
      // A model id naming a DIFFERENT real document of this project
      // contradicts the run's evidence — never silently re-attributed.
      const names = c.source?.documentId;
      documentId = names && projectDocIds.has(names) && names !== claimed[0] ? undefined : claimed[0];
    }
    else if (claimed.length > 1) documentId = c.source && claimed.includes(c.source.documentId) ? c.source.documentId : undefined;
    else if (!c.source) return c;
    else documentId = projectDocIds.has(c.source.documentId) ? c.source.documentId : undefined;
    if (!documentId) { unresolved.push(c); return c; }
    return { ...c, source: { documentId, page: c.source?.page ?? null } };
  });

  if (unresolved.length) {
    const names = unresolved.map((c) => c.itemName || c.itemKey).join(", ");
    const why = claimed.length > 1
      ? "this analysis read several drawings and the item does not identify which one"
      : "its source drawing is not a document of this project";
    throw new SourceProvenanceError(`Nothing was applied: the source drawing for ${names} cannot be verified (${why}). Re-link the drawing or re-analyse before applying.`, unresolved.map((c) => c.reviewItemId));
  }
  return resolved;
}

/**
 * Resolve a document id to the revision id to persist as
 * boq_line.source_revision_id (a real foreign key to document_revision,
 * unlike project_document.current_revision_id itself — see
 * drawingStorage.ts's loadProjectDrawings, the only other place in this
 * codebase that already resolves this same soft reference).
 *
 * Scope E: when `runId` is given (the analysis run that produced the review
 * item being applied), the EXACT analyzed revision is tried first via
 * resolveAnalyzedRevisionId — see that function's own doc comment for its
 * three-way result and exactly which cases fall through to the resolution
 * below versus return null outright. `runId` is optional so every existing
 * caller/fixture that predates this parameter keeps compiling and behaving
 * unchanged — omitting it always takes the fallback path, exactly as before
 * this parameter existed.
 *
 * Fallback — project_document.current_revision_id is an unchecked soft
 * reference (see the project_workspace migration's "avoids circular FK"
 * comment) — it can point at a revision row that exists but belongs to a
 * DIFFERENT document, if it's ever stale or corrupted. document_revision.
 * document_id IS a real, FK-enforced column (references project_document
 * (id)), so the existence check below filters on BOTH `id` and
 * `document_id`: a revision that exists but doesn't belong to `documentId`
 * is treated exactly like one that doesn't exist at all — never persisted
 * as this document's source.
 *
 * KNOWN LIMITATION of this fallback path, stated rather than solved: it
 * resolves the document's CURRENT revision at Apply time, which is the best
 * available signal when no run-source evidence exists, but is not
 * necessarily the exact revision the AI analysis read if the document was
 * re-uploaded between analysis and Apply. Never fabricated: returns null
 * (never a guess) when the document has no current_revision_id, that id
 * does not resolve to a real document_revision row, or that row belongs to
 * a different document.
 */
async function resolveSourceRevisionId(documentId: string, runId?: string | null): Promise<string | null> {
  if (runId) {
    const analyzed = await resolveAnalyzedRevisionId(runId, documentId);
    if (analyzed === null) return null; // conflicting evidence — explicit null, no fallback
    if (typeof analyzed === "string") return analyzed; // exact analyzed revision — highest precedence
    // analyzed === undefined → no usable run-source evidence; fall through below.
  }
  const { data: doc } = await supabase
    .from("project_document")
    .select("current_revision_id")
    .eq("id", documentId)
    .maybeSingle();
  const revisionId = (doc as { current_revision_id: string | null } | null)?.current_revision_id;
  if (!revisionId) return null;
  const { data: revision } = await supabase
    .from("document_revision")
    .select("id")
    .eq("id", revisionId)
    .eq("document_id", documentId)
    .maybeSingle();
  return revision ? revisionId : null;
}

/**
 * Execute the reviewer's confirmed selection. Only candidates in `selectedIds`
 * with classification APPLY or NEW_LINE are written; everything else (including
 * a candidate that IS selected but isn't APPLY/NEW_LINE — which the UI should
 * never allow) is skipped defensively. Every actual field change is recorded in
 * boq_line_change_log with the before/after value, who, and when.
 *
 * Layers protect against a candidate's diff being computed from a stale
 * boq_line snapshot: `modifiedLineIds`/`createdNewLineIdentities` below catch
 * same-batch collisions cheaply, in memory, before any DB call (see #133/
 * #134). Both write paths are additionally guarded at the database level for
 * a stale snapshot from a SEPARATE apply call — a different reviewer, a
 * different tab, or any apply that ran between classification and this one:
 * APPLY via applyReviewQtyUnit's `expected` compare-and-swap param, and
 * NEW_LINE via the boq_line identity unique indexes
 * (20260929000000_boq_line_identity_constraint.sql) that addReviewItemAsLine
 * translates a 23505 violation from into `null` rather than a fabricated
 * success.
 */
export async function applyReviewPlan(args: {
  boqId: string;
  candidates: ApplyCandidate[];
  selectedIds: Set<string>;
  /** Scope E — the analysis run that produced every candidate in this call
   *  (every candidate here is always classified from the SAME StoredReviewItem[]
   *  array, which is itself always loaded from exactly one run — see
   *  BoqReviewWorkstation.tsx's single `runId` state; items from two runs
   *  never coexist there). Passed through to resolveSourceRevisionId so it
   *  can try the exact analyzed revision before falling back to "current
   *  revision at Apply time." Optional so every existing caller/fixture that
   *  predates this parameter keeps compiling and behaving unchanged.
   *
   *  When given, Apply is also gated on revision freshness
   *  (revisionFreshness.ts): before ANY write, every source document of this
   *  run — its analysis_run_source claims, every selected candidate's source
   *  document, and `referencedDocumentIds` — is re-read, and the call throws
   *  AnalysisRevisionBlockedError unless each one's recorded analysed
   *  revision is still its current revision. Unknown provenance blocks too:
   *  it is never attributed to whatever revision is current now. */
  runId?: string | null;
  /** Further documents the reviewer's evidence was resolved against (by
   *  filename, or the run's re-linked drawing) — assessed alongside the
   *  candidates' own sources. Only used with `runId`. */
  referencedDocumentIds?: string[];
  /** documentId -> current revision id the reviewer was shown as fresh. If
   *  any assessed source's current revision differs (or the source wasn't in
   *  the snapshot), nothing is written. Only used with `runId`. */
  expectedCurrentRevisionIds?: Record<string, string | null>;
}): Promise<ApplyResult> {
  const { data: userData } = await supabase.auth.getUser();
  const changedBy = userData?.user?.id ?? null;
  let appliedCount = 0;
  // Looked up at most once per call, only if some NEW_LINE's scope or some
  // candidate's source-document check actually needs it (see
  // resolveBoqProjectId below). undefined = not yet looked up; null = looked
  // up, boq has no project_id.
  let projectId: string | null | undefined;
  /** This BOQ's own project_id, resolved at most once per call and cached in
   *  the `projectId` closure variable above. Shared by NEW_LINE's scope
   *  resolution and documentStillExists below — both need "which project is
   *  this Apply call writing into," never a second, independent lookup. */
  async function resolveBoqProjectId(): Promise<string | null> {
    if (projectId === undefined) {
      const { data: boqRow } = await supabase.from("boq").select("project_id").eq("id", args.boqId).single();
      projectId = (boqRow as { project_id: string | null } | null)?.project_id ?? null;
    }
    return projectId;
  }
  // Lines this call has already written to. Every candidate's `changes` was
  // computed by classifyReviewItem against ONE static pre-apply snapshot, so
  // a second selected candidate targeting a line the first one already wrote
  // to is working from a now-stale "from" value — applying it would silently
  // overwrite the first candidate's change with no warning (see the
  // conflictedReviewItemIds bug this guards against).
  const modifiedLineIds = new Set<string>();
  // (external_key, normalized location) identities this call has already
  // created a NEW_LINE for. Two selected candidates with no existing boq_line
  // yet are both classified NEW_LINE against the SAME pre-apply snapshot —
  // neither knows the other is about to create a matching line — so without
  // this, both would insert a separate row for the identical mark, silently
  // duplicating the BOQ entry (and double-counting its quantity).
  const createdNewLineIdentities = new Set<string>();
  const conflictedReviewItemIds: string[] = [];
  const auditLogFailedReviewItemIds: string[] = [];
  // Resolved at most once per distinct documentId in this call (see
  // resolveSourceRevisionId) — never re-looked-up per candidate. Cached by
  // documentId alone, never by (runId, documentId): args.runId is a single
  // value for this entire call (see the field's own doc comment above), so
  // it adds no variation the cache key would need to account for.
  const revisionIdByDocumentId = new Map<string, string | null>();
  async function resolveCachedRevisionId(documentId: string): Promise<string | null> {
    if (!revisionIdByDocumentId.has(documentId)) {
      revisionIdByDocumentId.set(documentId, await resolveSourceRevisionId(documentId, args.runId));
    }
    return revisionIdByDocumentId.get(documentId) ?? null;
  }
  // Resolved at most once per distinct documentId in this call, same caching
  // discipline as resolveCachedRevisionId above. Needed because
  // source_document_id is a real FK to project_document(id): if the document
  // was deleted between analysis and this Apply call, writing its id would
  // violate that FK. resolveSourceRevisionId's own project_document lookup
  // only runs on its fallback path (no runId, or no usable run-source
  // evidence) — the exact-analyzed-revision path never touches
  // project_document at all — so document existence needs its own check
  // regardless of which revision-resolution path ran.
  //
  // Scoped to THIS call's own boq project, not just "does this id exist
  // anywhere": project_document.project_id is NOT NULL (project_workspace
  // migration), so a row belonging to a different project must never be
  // accepted as this item's live source — "exists somewhere" is not the same
  // claim as "exists for this project" and resolveDrawingSource's own
  // export-side lookup (loadProjectDrawings(projectId)) already holds to the
  // stricter one. If resolveBoqProjectId can't resolve a project_id for this
  // boq at all, there is no project to scope the check against, so the
  // document is treated as NOT verified (never falls back to a global,
  // unscoped match just because scoping failed).
  //
  // A query error here is a genuinely unexpected failure (network blip, RLS
  // misconfiguration) — never evidence the document is gone. It is thrown,
  // not swallowed, matching the established convention in applyFinding.ts's
  // insertLineResilient/updateLineResilient (`if (error) throw error`): any
  // error that isn't one of their own specifically-matched, narrow retry/
  // conflict cases still throws. Propagating here means this whole Apply
  // call fails loudly — through applyReviewPlan's existing uncaught-throw
  // behavior (see its own candidate loop, which has no per-candidate
  // try/catch) — instead of silently reporting the source gone and the
  // candidate successfully applied.
  const documentExistsByDocumentId = new Map<string, boolean>();
  async function documentStillExists(documentId: string): Promise<boolean> {
    if (!documentExistsByDocumentId.has(documentId)) {
      const boqProjectId = await resolveBoqProjectId();
      if (!boqProjectId) {
        documentExistsByDocumentId.set(documentId, false);
      } else {
        const { data, error } = await supabase
          .from("project_document")
          .select("id")
          .eq("id", documentId)
          .eq("project_id", boqProjectId)
          .maybeSingle();
        if (error) throw error;
        documentExistsByDocumentId.set(documentId, !!data);
      }
    }
    return documentExistsByDocumentId.get(documentId)!;
  }
  /** The source columns to include in a write, or {} when `c.source` is
   *  undefined (nothing proposed — see classifyReviewItem/sourceToPropose) OR
   *  when the proposed document was deleted since analysis ran — never
   *  attempt a write that would violate boq_line.source_document_id's own FK
   *  to project_document; degrade exactly like "no source on the item" rather
   *  than letting qty/unit fail alongside a doomed source write. Never
   *  overwrites an unrelated column; merged into an existing patch. */
  async function sourcePatchFor(c: ApplyCandidate): Promise<Record<string, unknown>> {
    if (!c.source) return {};
    if (!(await documentStillExists(c.source.documentId))) return {};
    const revisionId = await resolveCachedRevisionId(c.source.documentId);
    return {
      source_document_id: c.source.documentId,
      source_revision_id: revisionId,
      source_page: c.source.page == null ? null : String(c.source.page),
    };
  }

  // Revision freshness gate — before any write. Re-read here, not trusted
  // from the screen: the reviewer's check may be minutes old.
  const toWrite = args.candidates.filter((c) => args.selectedIds.has(c.reviewItemId) && (c.classification === "APPLY" || c.classification === "NEW_LINE"));
  let assessedSources: { documentId: string; documentName: string | null; currentRevisionId: string | null }[] = [];
  if (args.runId && toWrite.length > 0) {
    const freshness = await assessRunFreshness({
      runId: args.runId,
      projectId: await resolveBoqProjectId(),
      referencedDocumentIds: [...(args.referencedDocumentIds ?? []), ...toWrite.flatMap((c) => (c.source ? [c.source.documentId] : []))],
    });
    assertApplyAllowed(freshness, args.expectedCurrentRevisionIds);
    assessedSources = freshness.sources.map((s) => ({ documentId: s.documentId, documentName: s.documentName, currentRevisionId: s.currentRevision?.id ?? null }));
  }

  // Source provenance — before any write. With a runId, the document a line
  // is attributed to comes from the run's own verified analysis_run_source
  // claims, never from the model's output alone (which can name a filename,
  // a sheet title or nothing at all). Unresolvable → throws, nothing written.
  // After the freshness gate, which already assesses every claimed document.
  const candidates = args.runId
    ? await resolveRunProvenance(args.runId, await resolveBoqProjectId(), args.candidates, args.selectedIds)
    : args.candidates;

  // Counts as of now — used for the normal result and, if a write throws
  // part-way, for the partial result ApplyInterruptedError carries.
  const resultSoFar = (): ApplyResult => {
    const skippedNoChange = args.candidates.filter((c) => c.classification === "NO_CHANGE").length;
    const staticUnresolvedCount = args.candidates.filter((c) =>
      c.classification === "NOT_ELIGIBLE" || c.classification === "CANNOT_APPLY"
      || c.classification === "REVIEWED_NOT_APPLICABLE" || c.classification === "AMBIGUOUS",
    ).length;
    // A same-batch conflict is discovered only during execution (it depends on
    // apply order), never from a candidate's static classification, so it is
    // added on top of the statically-classified unresolved count rather than
    // replacing it — the two sets never overlap (a conflicted candidate was
    // always classified APPLY/NEW_LINE, never one of the four above).
    const unresolvedCount = staticUnresolvedCount + conflictedReviewItemIds.length;
    return {
      appliedCount, skippedNoChange, unresolvedCount,
      conflictedReviewItemIds: [...conflictedReviewItemIds], auditLogFailedReviewItemIds: [...auditLogFailedReviewItemIds],
    };
  };
  const attemptedIds = new Set<string>();

  for (const c of candidates) {
    if (!args.selectedIds.has(c.reviewItemId)) continue;
    if (c.classification !== "APPLY" && c.classification !== "NEW_LINE") continue;
    attemptedIds.add(c.reviewItemId);
    // Set the moment this candidate's boq_line write has taken effect, so an
    // error after it (e.g. while recording history) is never reported as
    // "not written".
    let lineWritten = false;
    try {

    if (c.classification === "APPLY" && c.matchedLineId && modifiedLineIds.has(c.matchedLineId)) {
      // Never silently apply on top of another selected candidate's write in
      // this same call: no boq_line update, no fabricated audit row. Left
      // for a fresh apply pass, which will re-classify against the line's
      // now-current value instead of the stale snapshot this plan used.
      conflictedReviewItemIds.push(c.reviewItemId);
      continue;
    }

    // Only meaningful for NEW_LINE; null for APPLY (and for a malformed
    // NEW_LINE with no newLine payload, handled by the `continue` below).
    const newLineIdentityKey = c.classification === "NEW_LINE" && c.newLine
      ? `${c.itemKey}¦${norm(c.newLine.location)}`
      : null;
    if (newLineIdentityKey && createdNewLineIdentities.has(newLineIdentityKey)) {
      // Same (external_key, location) identity as an earlier selected
      // NEW_LINE candidate in this same call — its line already exists now,
      // but this candidate's classification was computed before it did.
      // Never insert a second row for it: left for a fresh apply pass, which
      // will re-classify against the now-existing line instead of a stale
      // "nothing exists yet" snapshot.
      conflictedReviewItemIds.push(c.reviewItemId);
      continue;
    }

    let lineId: string;
    let logRows: { boq_id: string; boq_line_id: string; review_item_id: string; field: string; old_value: string | null; new_value: string | null; changed_by: string | null }[];

    if (c.classification === "APPLY" && c.matchedLineId) {
      lineId = c.matchedLineId;
      const patch: Record<string, unknown> = {};
      const qtyChange = c.changes.find((f) => f.field === "qty");
      const unitChange = c.changes.find((f) => f.field === "unit");
      // Guard the write on the row's CURRENT qty/unit still matching what
      // this candidate's diff was computed from — a compare-and-swap against
      // a stale snapshot from a SEPARATE apply call (two reviewers, two
      // tabs, or any apply that ran between classification and this write).
      // Only the field(s) actually being changed are guarded; an unrelated
      // field drifting elsewhere never blocks this write.
      const expected: { qty?: number; unit?: string | null; quantity_status?: string | null; basis?: string | null } = {};
      const targetUnit = unitChange ? (unitChange.to === "—" ? null : unitChange.to) : c.expectedLineState?.unit;
      // The line's quantity meaning (status/basis) is guarded alongside qty
      // whenever it was loaded: the diff "pending → 5" or "0 → 5" was
      // computed from it, and a line re-marked pending or confirmed zero
      // elsewhere (same qty, different meaning) must not be overwritten.
      const guardMeaning = () => {
        if (!c.expectedLineState) return;
        expected.qty = c.expectedLineState.qty;
        if ("quantity_status" in c.expectedLineState) expected.quantity_status = c.expectedLineState.quantity_status ?? null;
        if ("basis" in c.expectedLineState) expected.basis = c.expectedLineState.basis ?? null;
      };
      if (qtyChange) {
        const pending = qtyChange.to === "pending";
        patch.qty = pending ? 0 : Number(qtyChange.to);
        // The quantity is now the one a reviewer verified or corrected —
        // recorded as such, never left as "basis not recorded".
        patch.basis = pending ? PENDING_BASIS : reviewBasis(c.decision);
        // A count is recorded as COUNTED, anything else as MEASURED — the
        // method, alongside the reviewer's decision in basis.
        patch.quantity_status = pending ? "PENDING" : isCountableUnit(targetUnit) ? "COUNTED" : "MEASURED";
        guardMeaning();
      } else if (unitChange && c.reviewedQty != null && c.decision != null && reviewBasis(c.decision)) {
        // Only the unit changes, but that changes what the (unchanged) number
        // means — "4 nos" is not "4 set". The reviewer checked the number in
        // this unit, so the line records the review basis and method, exactly
        // as a qty change would. A pending quantity (reviewedQty null) keeps
        // its pending marker untouched.
        patch.basis = reviewBasis(c.decision);
        patch.quantity_status = isCountableUnit(targetUnit) ? "COUNTED" : "MEASURED";
        guardMeaning();
      }
      if (unitChange) {
        patch.unit = targetUnit ?? null;
        if (c.expectedLineState) expected.unit = c.expectedLineState.unit;
      }
      // Source-traceability (Scope C): rides along on the SAME conditional
      // update as qty/unit above — c.source is only ever populated when the
      // candidate also has a real qty/unit change (see classifyReviewItem),
      // so this never becomes an unguarded, isolated write to a possibly
      // stale row.
      Object.assign(patch, await sourcePatchFor(c));
      const applied = await applyReviewQtyUnit(lineId, patch, expected);
      lineWritten = applied;
      if (!applied) {
        // The row no longer matches the snapshot this diff was computed
        // from — something else changed it since classification. Never
        // overwrite blindly: no boq_line write took place, so nothing to
        // log. Left for a fresh apply pass to re-classify against the
        // line's actual current value.
        conflictedReviewItemIds.push(c.reviewItemId);
        continue;
      }
      modifiedLineIds.add(lineId);
      logRows = [...c.changes, ...c.unsupportedChanges].map((ch) => ({
        boq_id: args.boqId, boq_line_id: lineId, review_item_id: c.reviewItemId,
        field: ch.field, old_value: ch.from, new_value: ch.to, changed_by: changedBy,
      }));
    } else if (c.classification === "NEW_LINE" && c.newLine) {
      let scopeId: string | null = null;
      const location = (c.newLine.location ?? "").trim();
      if (location) {
        const boqProjectId = await resolveBoqProjectId();
        if (boqProjectId) scopeId = await findScopeIdForLocation(boqProjectId, location);
        if (!scopeId) {
          // Not an existing scope of this project: never written unscoped
          // and never creates a scope — left for the reviewer to resolve.
          conflictedReviewItemIds.push(c.reviewItemId);
          continue;
        }
      }
      // Source-traceability (Scope C) — a brand-new line has no existing
      // provenance to protect, so this is always included when the item
      // carries a mappable source (see classifyReviewItem/sourceToPropose).
      const sourcePatch = await sourcePatchFor(c);
      const insertedLineId = await addReviewItemAsLine({
        boqId: args.boqId, description: c.newLine.description, unit: c.newLine.unit,
        qty: c.newLine.qty, pending: c.newLine.pending, externalKey: c.itemKey, scopeId,
        basis: c.newLine.pending ? undefined : reviewBasis(c.decision),
        sourceDocumentId: (sourcePatch.source_document_id as string | undefined) ?? null,
        sourceRevisionId: (sourcePatch.source_revision_id as string | undefined) ?? null,
        sourcePage: (sourcePatch.source_page as string | undefined) ?? null,
      });
      if (insertedLineId == null) {
        // The database's boq_line identity index rejected this insert as a
        // duplicate of an existing (boq_id, external_key, scope) row — a
        // SEPARATE, independent apply call already created it since this
        // candidate was classified (the in-memory createdNewLineIdentities
        // check above only sees THIS call's own inserts). Never treat this
        // as success: no row was created here, so nothing to log.
        conflictedReviewItemIds.push(c.reviewItemId);
        continue;
      }
      lineId = insertedLineId;
      lineWritten = true;
      if (newLineIdentityKey) createdNewLineIdentities.add(newLineIdentityKey);
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
        // Reviewer corrections boq_line has no column for (dimension,
        // specification): kept in the line's history rather than dropped.
        ...c.unsupportedChanges.map((u) => ({ ...base, field: u.field, old_value: u.from, new_value: u.to })),
      ];
    } else {
      continue;
    }

    if (logRows.length) {
      const { error: logErr } = await supabase.from("boq_line_change_log").insert(logRows);
      if (logErr) auditLogFailedReviewItemIds.push(c.reviewItemId);
    }
    appliedCount++;
    } catch (err) {
      if (lineWritten) {
        // Its line was written; only what followed failed — saved, unaudited.
        appliedCount++;
        auditLogFailedReviewItemIds.push(c.reviewItemId);
      }
      // Nothing written at all by this call: the original error is the whole
      // truth (no partial state to report).
      if (appliedCount === 0) throw err;
      // Some lines WERE written before this failure. Never let the caller
      // read this as "nothing applied" (or as a success): stop here — no
      // further writes after an unexplained database error — and report
      // exactly what was and was not written.
      const notAttempted = candidates
        .filter((x) => args.selectedIds.has(x.reviewItemId) && (x.classification === "APPLY" || x.classification === "NEW_LINE") && !attemptedIds.has(x.reviewItemId))
        .map((x) => x.reviewItemId);
      throw new ApplyInterruptedError(resultSoFar(), lineWritten ? null : c.reviewItemId, notAttempted, err);
    }
  }

  const result: ApplyResult = resultSoFar();

  // The pre-write gate cannot be atomic with the writes (no transaction spans
  // them), so re-read afterwards and report — never hide — a change that
  // landed in between.
  if (assessedSources.length > 0) {
    const changed: string[] = [];
    for (const s of assessedSources) {
      const { data, error } = await db.from("project_document").select("current_revision_id").eq("id", s.documentId).maybeSingle();
      const now = error ? undefined : ((data as { current_revision_id: string | null } | null)?.current_revision_id ?? null);
      if (now !== s.currentRevisionId) changed.push(s.documentName ?? s.documentId);
    }
    result.revisionChangedDuringApply = changed;
  }
  return result;
}
