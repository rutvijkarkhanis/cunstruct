import { suggestQtyDetailed, type QtyFormula } from "./boq";
import { resolveCoverage, hasBasis } from "./coverageDefaults";
import { resolveQuantityRule } from "./quantityRules";
import {
  pendingReason,
  type QuantityMethod,
  type QuantityStatus,
} from "./quantityMethod";
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
  qty_formula?: QtyFormula | null;
  product_id?: string | null;
  sort?: number | null;
  project_type?: string | null;
  category?: string | null;
  stage_id?: string | null;
}

export interface CatalogProduct {
  id: string | number;
  name?: string | null;
  selling_price?: number | null;
  unit?: string | null;
}

/**
 * How confidently a line is tied to a catalog product:
 *   - "linked"  — an exact SKU was set on the template item (trustworthy)
 *   - "keyword" — matched by a fuzzy name keyword (needs a human glance)
 *   - "none"    — no catalog product found (a gap, or awaiting a pick)
 */
export type MatchType = "linked" | "keyword" | "none";

export interface BoqComputedLine {
  /**
   * The computed quantity. 0 means either "nothing needed yet" (a basis whose
   * driver is zero) or PENDING — the two are told apart by `status`. It is never
   * a meaningless 1: an item we cannot measure is PENDING, not "1 nos".
   */
  qty: number;
  price: number | null;
  unit: string;
  inCatalog: boolean;
  catalogProductId: string | null;
  catalogProductName: string | null;
  matchType: MatchType;
  explanation: string;
  /** How this item is fundamentally measured (COUNT, AREA, LENGTH, …). */
  method: QuantityMethod;
  /** Provenance of the quantity (COUNTED, MEASURED, ESTIMATED, PENDING, …). */
  status: QuantityStatus;
  /** Why the quantity is PENDING, when it is. */
  reason?: string;
}

/** Resolve a template item to a catalog product: explicit product_id wins, else keyword match. */
export function matchProduct(item: BoqTemplateItem, products: CatalogProduct[]): CatalogProduct | null {
  if (item.product_id) return products.find((p) => String(p.id) === String(item.product_id)) ?? null;
  const kw = (item.match_keyword ?? "").toLowerCase();
  if (!kw) return null;
  return products.find((p) => (p.name ?? "").toLowerCase().includes(kw)) ?? null;
}

/** Classify how a template item matched (or didn't) against the catalog. */
export function matchType(item: BoqTemplateItem, products: CatalogProduct[]): MatchType {
  if (item.product_id && products.find((p) => String(p.id) === String(item.product_id))) return "linked";
  const kw = (item.match_keyword ?? "").toLowerCase();
  if (kw && products.find((p) => (p.name ?? "").toLowerCase().includes(kw))) return "keyword";
  return "none";
}

/** Provenance of a quantity that a real basis produced, from the formula shape. */
function statusForComputed(f: QtyFormula, method: QuantityMethod): QuantityStatus {
  // A 1:1 count driver (one door per room, one WC per bathroom) is COUNTED.
  if (f.per_room === 1 || f.per_bathroom === 1 || f.per_point === 1) return "COUNTED";
  // A direct area measure (ratio 1) is MEASURED; anything else with a ratio is a
  // consumption estimate.
  if (f.per_floor_sqft === 1 || f.per_wall_sqft === 1) return "MEASURED";
  if (method === "COUNT") return "COUNTED";
  return "ESTIMATED";
}

/**
 * Compute the quantity, unit, price, methodology and status for one template
 * item, in the context of a project type.
 *
 * `projectType` threads the project's type explicitly into rule resolution (no
 * global state). When no rule and no measurable basis exist, the line is PENDING
 * with the correct methodology — never a fabricated "1 nos".
 */
export function computeBoqLine(
  item: BoqTemplateItem,
  dims: Dimensions,
  builtUp: number | null,
  tier: string,
  catalogMatches: CatalogProduct[],
  projectType?: string | null,
): BoqComputedLine {
  const match = matchProduct(item, catalogMatches);
  const inCatalog = !!match;
  const catalogProductId = match ? String(match.id) : null;
  const catalogProductName = match?.name ?? null;
  const mt = matchType(item, catalogMatches);

  // Resolve the quantity rule (methodology + optional coverage/basis) with
  // deterministic precedence, threading the project type through.
  const rule = resolveQuantityRule({
    itemName: item.item_name,
    category: item.category ?? null,
    projectType: projectType ?? item.project_type ?? null,
    override: item.qty_formula,
  });

  // Coverage is still consulted for wastage/unit fallbacks so residential
  // numbers stay byte-identical to before (the generic-item layer IS this rule).
  const cover = resolveCoverage(item.item_name);
  const baseWastage = rule.formula?.wastage_pct ?? cover?.wastage_pct ?? 8;
  const wastage = Math.max(0, Math.min(40, baseWastage + tierWastageDelta(tier)));
  const unit = item.unit ?? match?.unit ?? rule.unit ?? cover?.unit ?? "";
  const price = match?.selling_price != null
    ? Number(match.selling_price)
    : (item.qty_formula?.unit_price != null ? Number(item.qty_formula.unit_price)
      : (rule.formula?.unit_price != null ? Number(rule.formula.unit_price) : null));

  const common = {
    price,
    unit,
    inCatalog,
    catalogProductId,
    catalogProductName,
    matchType: mt,
  };

  // No rule and no measurable basis → PENDING, with the methodology we DO know.
  if (!hasBasis(rule.formula)) {
    const reason = pendingReason(rule.method);
    return {
      ...common,
      qty: 0,
      explanation: `${rule.method.toLowerCase()} · pending — ${reason}`,
      method: rule.method,
      status: "PENDING",
      reason,
    };
  }

  const detail = suggestQtyDetailed(
    { product_id: item.id, qty_formula: rule.formula, buffer_pct: wastage },
    dims,
    builtUp,
  );

  // suggestQtyDetailed only falls back to 1 when NO basis is present; we already
  // guaranteed a basis, so this guards against that path ever surfacing here.
  if (detail.isFallback) {
    const reason = pendingReason(rule.method);
    return {
      ...common,
      qty: 0,
      explanation: `${rule.method.toLowerCase()} · pending — ${reason}`,
      method: rule.method,
      status: "PENDING",
      reason,
    };
  }

  const status: QuantityStatus =
    detail.qty > 0 ? statusForComputed(rule.formula, rule.method) : "NOT_APPLICABLE";
  return {
    ...common,
    qty: detail.qty,
    explanation: detail.explanation,
    method: rule.method,
    status,
  };
}
