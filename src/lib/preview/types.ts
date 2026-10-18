// Shared types for the owner-only engineering preview engines (plan v1.2 §5B).
// Pure data: these engines never read or write a database.

/** A line's quantity state. Pending = no established quantity: never priced. */
export type QuantityState = "established" | "confirmed_zero" | "pending";

/** A line's review state in the verify flow. "verified" = checked against the drawing by a reviewer. */
export type ReviewState = "needs_review" | "accepted" | "corrected" | "verified";

export interface EngineLine {
  id: string;
  description: string;
  unit: string;
  /** The stored quantity. Ignored (treated as unknown) when quantityState is "pending". */
  quantity: number;
  quantityState: QuantityState;
  /** ₹ per unit; null = no DSR match (market rate needed). Never treated as 0. */
  rate: number | null;
  reviewState: ReviewState;
}

/** ₹ amount of a line, or null when it cannot be priced (pending quantity or no rate). */
export function lineAmount(l: Pick<EngineLine, "quantity" | "quantityState" | "rate">): number | null {
  if (l.quantityState === "pending" || l.rate == null || !Number.isFinite(l.rate) || !Number.isFinite(l.quantity)) return null;
  return Math.round(l.quantity * l.rate);
}
