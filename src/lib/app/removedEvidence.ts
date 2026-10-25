// Reviewed drawing evidence that has left the BOQ: a review item verified or
// corrected on the drawings whose BOQ line was REMOVED (the change history
// holds that line, with the item's key) and that no current line carries.
// Never inferred from absence alone — an item merely not applied yet is
// Review's business, not this check's. Read-only.
import { db, isMissingTable } from "@/lib/untypedDb";
import type { EvidenceItem } from "@/lib/lineEvidence";

export interface RemovalRecord { old_value: string | null; changed_at: string }
export interface RemovedReviewedItem { key: string; item: string; decision: "VERIFIED" | "EDITED"; removedAt: string; description: string | null }

/** `items` newest first (lib/lineEvidence loadBoqEvidenceItems): the newest decision per key counts. */
export function removedReviewedItems(items: EvidenceItem[], lines: { external_key?: string | null }[], removals: RemovalRecord[]): RemovedReviewedItem[] {
  const current = new Set(lines.map((l) => l.external_key).filter(Boolean));
  const removed = new Map<string, { at: string; description: string | null }>();
  for (const r of removals) {
    let row: { external_key?: unknown; description?: unknown } | null = null;
    try { row = r.old_value ? JSON.parse(r.old_value) : null; } catch { row = null; }
    const key = typeof row?.external_key === "string" ? row.external_key : null;
    if (!key) continue;
    const prev = removed.get(key);
    if (!prev || r.changed_at > prev.at) removed.set(key, { at: r.changed_at, description: typeof row?.description === "string" ? row.description : null });
  }
  const seen = new Set<string>();
  const out: RemovedReviewedItem[] = [];
  for (const it of items) {
    const key = it.ai.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (it.reviewStatus !== "VERIFIED" && it.reviewStatus !== "EDITED") continue;
    const rm = removed.get(key);
    if (rm && !current.has(key)) out.push({ key, item: it.ai.item, decision: it.reviewStatus, removedAt: rm.at, description: rm.description });
  }
  return out;
}

/** The BOQ's recorded line removals; none where change history is not set up (removal is refused there). */
export async function loadRemovals(boqId: string): Promise<RemovalRecord[]> {
  const { data, error } = await db.from("boq_line_change_log").select("old_value, changed_at").eq("boq_id", boqId).eq("field", "line_removed");
  if (isMissingTable("boq_line_change_log", error)) return [];
  if (error) throw error;
  return (data ?? []) as RemovalRecord[];
}
