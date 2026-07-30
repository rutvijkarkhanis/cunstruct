// Logs BOQ items that aren't in the catalog into the onboarding queue
// (catalog_gaps), so the ops team can source / add those SKUs.
import { supabase } from "@/integrations/supabase/client";

export interface GapItem {
  item_name: string;
  requested_qty?: number | null;
  unit?: string | null;
}

export async function logGaps(
  projectId: string,
  stageId: string | null,
  items: GapItem[],
): Promise<number> {
  const rows = items
    .filter((i) => i.item_name)
    .map((i) => ({
      project_id: projectId,
      stage_id: stageId,
      item_name: i.item_name,
      requested_qty: i.requested_qty ?? null,
      unit: i.unit ?? null,
      source: "boq",
      status: "open",
    }));
  if (!rows.length) return 0;
  const { error } = await supabase.from("catalog_gaps").insert(rows);
  if (error) throw error;
  return rows.length;
}
