// QUANTITY — the single rule for what a BOQ line's quantity can be relied on
// for, and for its provenance as recorded on the line. Shared by the BOQ
// builder, the project journey, the workspace panel, the BOQ list, the PDF/CSV
// exports and the public-share edge function. Deliberately dependency-free
// (no "@/" imports, no I/O) so supabase/functions can import it by relative
// path, exactly like src/lib/review/analysisSchemaV1.ts.
//
// Governing rule: never represent a quantity as more certain, more complete or
// better evidenced than the stored record justifies. Unknown stays unknown.

// ── Quantity state ───────────────────────────────────────────────────────────

/** boq_line.basis marker for a line whose quantity is still to be established
 *  (the same value boqEvalJson.PENDING_BASIS writes). */
export const PENDING_BASIS = "PENDING";
/** boq_line.basis written by drawing-review Apply: the quantity a reviewer
 *  verified (accepted as extracted) or corrected, against the drawing
 *  evidence of that review item. */
export const REVIEW_VERIFIED_BASIS = "REVIEW_VERIFIED";
export const REVIEW_CORRECTED_BASIS = "REVIEW_CORRECTED";
/** boq_line.basis written when a person types or changes a line's quantity in
 *  an editor — from then on the quantity is no longer what any earlier basis
 *  (drawing take-off, coefficient, assumption…) produced. */
export const MANUAL_BASIS = "MANUAL";

/** Statuses that record a quantity a person or a measurement established. */
const ESTABLISHED_STATUSES = new Set(["MEASURED", "COUNTED"]);

export type QuantityState =
  /** A positive quantity that is not marked pending. */
  | "established"
  /** Zero, explicitly confirmed (quantity_status MEASURED or COUNTED) — "none required". */
  | "confirmed_zero"
  /** Marked pending, or a zero nobody confirmed (boq_line.qty is NOT NULL and
   *  stores 0 for "not yet measured"). */
  | "pending"
  /** No usable number at all (null, NaN, infinite or negative). */
  | "unavailable";

export interface QuantityFields {
  qty: number | null | undefined;
  quantity_status?: string | null;
  basis?: string | null;
}

const upper = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

export function quantityState(l: QuantityFields): QuantityState {
  const markedPending = upper(l.quantity_status) === "PENDING" || upper(l.basis) === PENDING_BASIS;
  const q = l.qty == null ? NaN : Number(l.qty);
  if (!Number.isFinite(q) || q < 0) return markedPending ? "pending" : "unavailable";
  if (markedPending) return "pending";
  if (q > 0) return "established";
  return ESTABLISHED_STATUSES.has(upper(l.quantity_status)) ? "confirmed_zero" : "pending";
}

/** True when the quantity may be priced and totalled. */
export const quantityEstablished = (l: QuantityFields) => {
  const s = quantityState(l);
  return s === "established" || s === "confirmed_zero";
};

/** True when a line has no established quantity — every total, revision and
 *  export leaves these out and lists them as pending instead. */
export const qtyPending = (l: QuantityFields): boolean => !quantityEstablished(l);

export const QUANTITY_STATE_LABEL: Record<QuantityState, string> = {
  established: "Quantity established",
  confirmed_zero: "Confirmed zero",
  pending: "Quantity pending",
  unavailable: "Quantity not available",
};

// ── Money ────────────────────────────────────────────────────────────────────

/** Every monetary amount is a whole number of rupees (see boqDsrDocument). */
export const roundRupee = (n: number): number => Math.round(n);

export interface RatedFields extends QuantityFields {
  dsr_rate?: number | null;
  custom_rate?: number | null;
}

/** The rate in effect: the estimator's override, else the DSR reference. */
export const effectiveRate = (l: Pick<RatedFields, "dsr_rate" | "custom_rate">): number | null =>
  l.custom_rate ?? l.dsr_rate ?? null;

/** A line's amount in whole rupees, or null when it cannot be stated: no
 *  established quantity, or no rate. A confirmed zero is a real ₹0. */
export function pricedAmount(l: RatedFields): number | null {
  const rate = effectiveRate(l);
  if (rate == null || !quantityEstablished(l)) return null;
  return roundRupee(Number(l.qty) * rate);
}

/** The amount a line contributes to totals (0 when it cannot be priced). */
export const countedAmount = (l: RatedFields): number => pricedAmount(l) ?? 0;

/** Works total of the included lines — pending and unrated lines add nothing. */
export const worksTotal = (lines: (RatedFields & { included: boolean })[]): number =>
  lines.filter((l) => l.included).reduce((s, l) => s + countedAmount(l), 0);

// ── Provenance ───────────────────────────────────────────────────────────────

/** basis_note written by applyFinding.addReviewItemAsLine. Apply now also
 *  writes REVIEW_VERIFIED / REVIEW_CORRECTED as the basis; this note remains
 *  the only marker on lines Apply created before that (their basis is null). */
export const REVIEW_APPLY_NOTE = "Added from drawing analysis review";

export type QuantityOrigin =
  | "drawing"     // counted / stated on a drawing
  | "derived"     // calculated (from drawing dimensions or coefficients)
  | "assumption"  // rule-of-thumb / archetype assumption
  | "review"      // created by drawing-review Apply
  | "manual"      // typed or changed by a person in an editor
  | "pending"     // marked as awaiting a quantity
  | "unknown";    // nothing recorded says where it came from

export interface QuantityProvenance {
  origin: QuantityOrigin;
  /** User-facing wording; never shown without `stated` context where relevant. */
  label: string;
  /** True when the basis is free text from imported data, not a code the
   *  system itself wrote — reported as stated, not as established fact. */
  stated: boolean;
  /** The line's own basis_note, verbatim (never generated), when present. */
  note: string | null;
  /** The raw stored basis value, for audit. */
  code: string | null;
}

/** Codes written by the system (generator, editors, Apply), per
 *  supabase/migrations/20260810120000_boq_line_basis.sql. DRAWING_INPUT and
 *  DRAWING_DERIVED were set by the former generator from the estimator's own
 *  written drawing summary (boq.spec._drawing) — the labels say exactly that,
 *  never that the system measured or verified a take-off. */
const BASIS_CODES: Record<string, { origin: QuantityOrigin; label: string }> = {
  DRAWING_INPUT: { origin: "drawing", label: "From drawing summary (estimator's reading)" },
  DRAWING_DERIVED: { origin: "derived", label: "Calculated from drawing summary" },
  DSR_AOR: { origin: "derived", label: "Derived from DSR coefficients" },
  HEURISTIC: { origin: "assumption", label: "Assumption" },
  [MANUAL_BASIS]: { origin: "manual", label: "Changed manually" },
  [REVIEW_VERIFIED_BASIS]: { origin: "review", label: "Verified in drawing review" },
  [REVIEW_CORRECTED_BASIS]: { origin: "review", label: "Corrected in drawing review" },
  [PENDING_BASIS]: { origin: "pending", label: "Awaiting quantity" },
};

/** Free-text basis words seen in imported evaluation JSON (e.g. "Counted").
 *  Reported in the import's own word, as stated — never as verified, and never
 *  as "from a drawing" (the import does not say what was counted). */
const STATED_WORDS: [RegExp, QuantityOrigin, string][] = [
  [/^(counted|count)$/i, "drawing", "Counted (as stated in imported data)"],
  [/^(measured|measure)$/i, "drawing", "Measured (as stated in imported data)"],
  [/^(derived|calculated)$/i, "derived", "Calculated (as stated in imported data)"],
  [/^(assumed|assumption|estimated|estimate)$/i, "assumption", "Assumption (as stated in imported data)"],
];

export const UNKNOWN_ORIGIN_LABEL = "Basis not recorded";

/**
 * Where a line's quantity came from, as far as the stored record says — and no
 * further. Reads ONLY basis and basis_note: a numeric value, a drawing
 * reference, a review status or quantity_status MEASURED/COUNTED are never
 * taken as evidence of origin (Apply and the editors set MEASURED for any
 * established quantity, whatever its source). Anything not recorded is
 * "unknown".
 */
export function quantityProvenance(l: { basis?: string | null; basis_note?: string | null; quantity_status?: string | null }): QuantityProvenance {
  const code = (l.basis ?? "").trim() || null;
  const note = (l.basis_note ?? "").trim() || null;
  if (code) {
    const known = BASIS_CODES[code.toUpperCase()];
    if (known && known.origin === "review") {
      // Apply writes the review basis and the method together (COUNTED for a
      // count, MEASURED otherwise), so for these two codes — and only these —
      // the status is part of the recorded provenance.
      const how = upper(l.quantity_status) === "COUNTED" ? "Counted on drawing" : upper(l.quantity_status) === "MEASURED" ? "Measured on drawing" : null;
      const what = code.toUpperCase() === REVIEW_CORRECTED_BASIS ? "corrected in review" : "verified in review";
      return { ...known, label: how ? `${how}, ${what}` : known.label, stated: false, note, code };
    }
    if (known) return { ...known, stated: false, note, code };
    const word = STATED_WORDS.find(([re]) => re.test(code));
    if (word) return { origin: word[1], label: word[2], stated: true, note, code };
    return { origin: "unknown", label: UNKNOWN_ORIGIN_LABEL, stated: false, note, code };
  }
  if (note === REVIEW_APPLY_NOTE) return { origin: "review", label: "From drawing review", stated: false, note: null, code: null };
  return { origin: "unknown", label: UNKNOWN_ORIGIN_LABEL, stated: false, note, code: null };
}

/** Explanation shown alongside every basis label: legacy lines may have been
 *  edited before edits were recorded on the line. */
export const PROVENANCE_CAVEAT =
  "As recorded on the line. Quantity changes made before basis tracking began are not reflected.";
