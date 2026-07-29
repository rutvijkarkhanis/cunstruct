// BOQ-to-Order helpers. Turns a stage's material mappings into a bill of
// quantities (pre-suggested from project area), then places a real order.
import { supabase } from "@/integrations/supabase/client";

/** A stage_material_mapping row as the BOQ builder needs it. */
export interface BoqMapping {
  product_id: string;
  product_name?: string | null;
  unit?: string | null;
  qty_formula?: { per_sqft?: number; fixed?: number; unit_price?: number } | null;
  buffer_pct?: number | null;
  priority?: string | null;
}

/**
 * Pre-suggested quantity for a BOQ line — same math the forecast engine uses:
 * per_sqft × area, else a fixed count, then a wastage buffer, rounded up.
 */
export function suggestQty(m: BoqMapping, areaSqft?: number | null): number {
  const f = m.qty_formula ?? {};
  let qty = 1;
  if (f.per_sqft && areaSqft) qty = Number(f.per_sqft) * Number(areaSqft);
  else if (f.fixed) qty = Number(f.fixed);
  const buffer = Number(m.buffer_pct ?? 0);
  const withBuffer = qty * (1 + buffer / 100);
  // Round to 6 dp first so float artifacts (e.g. 50 * 1.1 = 55.00000000001)
  // don't push a clean result up a whole unit.
  return Math.max(0, Math.ceil(Number(withBuffer.toFixed(6))));
}

export interface BoqLine {
  product_id: string;
  product_name?: string | null;
  unit?: string | null;
  qty: number;
  unit_price: number | null; // live price, snapshotted onto the order
  stage_id?: string | null;
}

export interface PlaceOrderArgs {
  projectId: string;
  forecastId?: string | null;
  customerPhone?: string | null;
  source?: string;
  lines: BoqLine[];
}

export interface PlacedOrder {
  orderId: string;
  total: number;
  lineCount: number;
}

/**
 * Create a real order: one sales_orders row + its order_items, with the
 * current price frozen onto each line so a later price change never rewrites
 * a placed order. Lines with qty 0 are dropped.
 */
export async function placeOrder(args: PlaceOrderArgs): Promise<PlacedOrder> {
  const lines = args.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Add at least one item before placing the order.");

  const total = lines.reduce((s, l) => s + (Number(l.unit_price) || 0) * l.qty, 0);

  const { data: order, error: orderErr } = await supabase
    .from("sales_orders")
    .insert({
      project_id: args.projectId,
      forecast_id: args.forecastId ?? null,
      customer_phone: args.customerPhone ?? null,
      total_amount: total,
      status: "pending",
      source: args.source ?? "boq",
    })
    .select("id")
    .single();
  if (orderErr) throw orderErr;

  const rows = lines.map((l) => ({
    order_id: order.id,
    product_id: l.product_id,
    product_name: l.product_name ?? null,
    stage_id: l.stage_id ?? null,
    qty: l.qty,
    unit: l.unit ?? null,
    unit_price: l.unit_price,
    line_total: (Number(l.unit_price) || 0) * l.qty,
  }));
  const { error: itemsErr } = await supabase.from("order_items").insert(rows);
  if (itemsErr) throw itemsErr;

  return { orderId: order.id, total, lineCount: lines.length };
}
