// A BOQ line's recorded history: the boq_line_change_log rows that every
// guarded edit (lib/lineEdit), audited rate edit (lib/manualRateEdit) and
// review Apply already write. Read-only. Where the table does not exist on
// this database, that is said — an empty history is never implied.
import { db, isMissingTable } from "@/lib/untypedDb";

export interface LineHistoryRow {
  id: string; field: string; old_value: string | null; new_value: string | null;
  changed_at: string; review_item_id: string | null;
}
export type LineHistory = { available: false } | { available: true; rows: LineHistoryRow[] };

export const lineHistoryKey = (lineId: string | null) => ["boq-line-history", lineId] as const;

export async function loadLineHistory(lineId: string): Promise<LineHistory> {
  const { data, error } = await db.from("boq_line_change_log")
    .select("id, field, old_value, new_value, changed_at, review_item_id")
    .eq("boq_line_id", lineId)
    .order("changed_at", { ascending: false });
  if (isMissingTable("boq_line_change_log", error)) return { available: false };
  if (error) throw error;
  return { available: true, rows: (data ?? []) as LineHistoryRow[] };
}

const FIELD: Record<string, string> = {
  qty: "Quantity", unit: "Unit", description: "Description", section: "Section", included: "Included",
  cost: "Cost", custom_rate: "Own rate", line_created: "Line created",
};

/** One history row as a sentence part: what changed, and why when it is known. */
export function describeChange(r: LineHistoryRow): { what: string; why: string } {
  const field = FIELD[r.field] ?? r.field;
  const show = (v: string | null) => (v == null || v === "" ? (r.field === "custom_rate" ? "none (DSR rate)" : "—") : v);
  // Removal and restore carry the whole line as JSON (lib/lineRemoval) — stated, never dumped.
  const what = r.field === "line_created" ? `Line created${r.new_value ? `: ${r.new_value}` : ""}`
    : r.field === "line_removed" ? "Line removed (the complete line is kept in this record)"
    : r.field === "line_restored" ? "Line restored"
    : `${field}: ${show(r.old_value)} → ${show(r.new_value)}`;
  const why = r.review_item_id ? "Applied from drawing review"
    : r.field === "line_created" ? "Added" : r.field === "line_removed" || r.field === "line_restored" ? "Manual" : "Manual edit";
  return { what, why };
}
