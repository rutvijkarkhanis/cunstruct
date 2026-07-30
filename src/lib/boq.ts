// BOQ-to-Order helpers. Turns a stage's material mappings into a bill of
// quantities (pre-suggested from room-by-room dimensions), then places an order.
import { supabase } from "@/integrations/supabase/client";
import type { Dimensions } from "@/lib/dimensions";

/**
 * Quantity formula stored in stage_material_mapping.qty_formula (jsonb).
 * Exactly one basis drives the quantity; the engine picks the first present
 * (in the order below) that has data to multiply against.
 */
export interface QtyFormula {
  per_floor_sqft?: number; // × floor/carpet area  (tiles, flooring, adhesive)
  per_wall_sqft?: number; //  × wall area          (paint, putty, plaster)
  per_point?: number; //      × electrical points  (wire, switches, conduit)
  per_bathroom?: number; //   × bathroom count     (sanitaryware)
  per_room?: number; //       × room count         (doors, lights)
  per_sqft?: number; //       × built-up area      (generic / structural)
  per_unit?: number; //       flat quantity
  fixed?: number; //          flat quantity (alias of per_unit)
  unit_price?: number; //     optional price override
  pack_size?: number; //      round the final qty up to a multiple of this
}

export interface BoqMapping {
  product_id: string;
  product_name?: string | null;
  unit?: string | null;
  qty_formula?: QtyFormula | null;
  buffer_pct?: number | null; // wastage %
  priority?: string | null;
}

const BASES: { key: keyof QtyFormula; dim: keyof Dimensions; label: string }[] = [
  { key: "per_floor_sqft", dim: "floorAreaSqft", label: "floor sq.ft" },
  { key: "per_wall_sqft", dim: "wallAreaSqft", label: "wall sq.ft" },
  { key: "per_point", dim: "points", label: "points" },
  { key: "per_bathroom", dim: "bathrooms", label: "bathrooms" },
  { key: "per_room", dim: "rooms", label: "rooms" },
  { key: "per_sqft", dim: "floorAreaSqft", label: "sq.ft" }, // built-up ≈ floor when no separate value
];

export interface QtyResult {
  qty: number;
  /** Human-readable derivation, e.g. "340 wall sq.ft × 0.025 = 9 (+10% wastage) → 10". */
  explanation: string;
  /** True when no basis matched and we fell back to 1. */
  isFallback: boolean;
}

// Round up, guarding against float artifacts (e.g. 50 * 1.1 = 55.00000001).
const ceilSafe = (n: number) => Math.ceil(Number(n.toFixed(6)));

/** Detailed quantity: the number plus how it was derived. */
export function suggestQtyDetailed(m: BoqMapping, dims: Dimensions, builtUpSqft?: number | null): QtyResult {
  const f = m.qty_formula ?? {};
  const wastage = Number(m.buffer_pct ?? 0);
  const pack = Number(f.pack_size ?? 0);

  let base: number | null = null;
  let detail = "";

  for (const b of BASES) {
    const ratio = f[b.key];
    if (ratio == null) continue;
    // per_sqft prefers an explicit built-up area, else floor area.
    const dimVal = b.key === "per_sqft" && builtUpSqft != null ? Number(builtUpSqft) : Number(dims[b.dim]);
    if (!dimVal) continue;
    base = Number(ratio) * dimVal;
    detail = `${dimVal.toLocaleString("en-IN")} ${b.label} × ${ratio}`;
    break;
  }

  if (base == null) {
    const flat = f.per_unit ?? f.fixed;
    if (flat != null) {
      base = Number(flat);
      detail = `${flat} (flat)`;
    }
  }

  if (base == null) {
    return { qty: 1, explanation: "no coverage set — defaulted to 1", isFallback: true };
  }

  let qty = base * (1 + wastage / 100);
  const wastageNote = wastage ? ` (+${wastage}% wastage)` : "";
  const rawRounded = ceilSafe(qty);

  if (pack > 0) {
    qty = Math.ceil(Number((qty / pack).toFixed(6))) * pack;
    return {
      qty: Math.max(0, qty),
      explanation: `${detail} = ${ceilSafe(base)}${wastageNote} → ${qty} (packs of ${pack})`,
      isFallback: false,
    };
  }

  return {
    qty: Math.max(0, rawRounded),
    explanation: `${detail} = ${ceilSafe(base)}${wastageNote} → ${rawRounded}`,
    isFallback: false,
  };
}

/** Just the quantity (convenience wrapper). */
export function suggestQty(m: BoqMapping, dims: Dimensions, builtUpSqft?: number | null): number {
  return suggestQtyDetailed(m, dims, builtUpSqft).qty;
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
 * current price frozen onto each line. Lines with qty 0 are dropped.
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
