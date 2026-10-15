// The patch for a quantity typed into a BOQ editor — shared by the BOQ
// builder and the project journey's BOQ table so both apply the same rule.
import { PENDING_BASIS } from "@/lib/boqEvalJson";

export interface QuantityEditLine {
  qty: number;
  basis?: string | null;
  quantity_status?: string | null;
  measurement_method?: string | null;
}

/**
 * A positive quantity typed into a quantity-pending line is the confirmation
 * the editor asks for ("enter a quantity to price this line"), so it also
 * clears the pending marker — the same transition setLineQty makes when an
 * audit finding is resolved with a quantity (COUNTED for a count methodology,
 * else MEASURED). Zero or a negative number is not a confirmation: the line
 * stays pending. A line that isn't pending changes only its quantity. Undo
 * restores every field in the patch.
 */
export function quantityEditPatch(line: QuantityEditLine, qty: number): { qty: number; basis?: null; quantity_status?: string } {
  const markedPending = line.basis === PENDING_BASIS || String(line.quantity_status ?? "").toUpperCase() === "PENDING";
  if (!markedPending || !(qty > 0)) return { qty };
  return { qty, basis: null, quantity_status: (line.measurement_method ?? "").toUpperCase() === "COUNT" ? "COUNTED" : "MEASURED" };
}
