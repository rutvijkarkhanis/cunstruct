// The patch for a quantity or unit typed into a BOQ editor — shared by the
// BOQ builder and the project journey's BOQ table so both apply the same rule.
import { MANUAL_BASIS, PENDING_BASIS } from "@/lib/quantity";

export interface QuantityEditLine {
  qty: number;
  basis?: string | null;
  quantity_status?: string | null;
  measurement_method?: string | null;
}

const markedPending = (line: Pick<QuantityEditLine, "basis" | "quantity_status">) =>
  line.basis === PENDING_BASIS || String(line.quantity_status ?? "").toUpperCase() === "PENDING";

/**
 * A positive quantity typed into a quantity-pending line is the confirmation
 * the editor asks for ("enter a quantity to price this line"), so it also
 * clears the pending marker — the same transition setLineQty makes when an
 * audit finding is resolved with a quantity (COUNTED for a count methodology,
 * else MEASURED). Zero or a negative number is not a confirmation: the line
 * stays pending, untouched apart from the number.
 *
 * Any quantity a person types is recorded as such (basis MANUAL): from then on
 * the number is no longer what a drawing summary, coefficient or assumption
 * produced, and the line must not keep claiming that it is. Undo restores
 * every field in the patch, the previous basis included.
 */
export function quantityEditPatch(line: QuantityEditLine, qty: number): { qty: number; basis?: string; quantity_status?: string } {
  if (markedPending(line)) {
    if (!(qty > 0)) return { qty };
    return { qty, basis: MANUAL_BASIS, quantity_status: (line.measurement_method ?? "").toUpperCase() === "COUNT" ? "COUNTED" : "MEASURED" };
  }
  return { qty, basis: MANUAL_BASIS };
}

/**
 * A unit typed into an editor changes what the quantity means ("4 nos" is not
 * "4 sqm"), so it is recorded as a manual change too — except on a line still
 * marked pending, whose pending marker must survive (it has no quantity whose
 * origin could be misrepresented).
 */
export function unitEditPatch(line: Pick<QuantityEditLine, "basis" | "quantity_status">, unit: string): { unit: string; basis?: string } {
  return markedPending(line) ? { unit } : { unit, basis: MANUAL_BASIS };
}
