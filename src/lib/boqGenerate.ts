import { suggestQtyDetailed } from "./boq";
import { resolveCoverage, hasBasis } from "./coverageDefaults";
import { tierWastageDelta } from "./smartSuggest";
import type { Dimensions } from "./dimensions";

/**
 * Shared BOQ generation engine. Given a template item, room-derived dimensions,
 * the project's built-up area and quality tier, and the set of catalog products
 * we matched against, produce the priced line for that item.
 *
 * This is the single source of truth used by BOTH the contractor mobile builder
 * (`MyProjectOrder`) and the ops desktop BOQ tab (`OpsProjectBoq`), so the two
 * can never drift.
 */

export interface BoqTemplateItem {
  id: string;
  item_name: string;
  match_keyword?: string | null;
  unit?: string | null;
  qty_formula?: any;
  product_id?: string | null;
  sort?: number | null;
  project_type?: string | null;
  stage_id?: string | null;
}

export interface CatalogProduct {
  id: string | number;
  name?: string | null;
  selling_price?: number | null;
  unit?: string | null;
}

export interface BoqComputedLine {
  qty: number;
  price: number | null;
  unit: string;
  inCatalog: boolean;
  catalogProductId: string | null;
  explanation: string;
}

/** Resolve a template item to a catalog product: explicit product_id wins, else keyword match. */
export function matchProduct(item: BoqTemplateItem, products: CatalogProduct[]): CatalogProduct | null {
  if (item.product_id) return products.find((p) => String(p.id) === String(item.product_id)) ?? null;
  const kw = (item.match_keyword ?? "").toLowerCase();
  if (!kw) return null;
  return products.find((p) => (p.name ?? "").toLowerCase().includes(kw)) ?? null;
}

/** Compute the quantity, unit, price, and catalog status for a single template item. */
export function computeBoqLine(
  item: BoqTemplateItem,
  dims: Dimensions,
  builtUp: number | null,
  tier: string,
  catalogMatches: CatalogProduct[],
): BoqComputedLine {
  const match = matchProduct(item, catalogMatches);
  const cover = resolveCoverage(item.item_name);
  const formula = hasBasis(item.qty_formula) ? item.qty_formula : (cover ?? item.qty_formula ?? {});
  // Quality tier nudges the wastage buffer up (premium) or down (economy).
  const baseWastage = cover?.wastage_pct ?? 8;
  const wastage = Math.max(0, Math.min(40, baseWastage + tierWastageDelta(tier)));
  const detail = suggestQtyDetailed({ product_id: item.id, qty_formula: formula, buffer_pct: wastage }, dims, builtUp);
  const inCatalog = !!match;
  const price = match?.selling_price != null ? Number(match.selling_price)
    : (formula.unit_price != null ? Number(formula.unit_price) : null);
  const unit = item.unit ?? match?.unit ?? cover?.unit ?? "";
  return {
    qty: detail.qty,
    price,
    unit,
    inCatalog,
    catalogProductId: match ? String(match.id) : null,
    explanation: detail.explanation,
  };
}
