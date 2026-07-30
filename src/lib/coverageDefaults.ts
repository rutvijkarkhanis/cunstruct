// Starter coverage/wastage defaults for common materials, matched by product
// name (with a category hint). Used by the BOQ builder as a fallback when a
// mapping has no qty_formula of its own, so quantities are useful out of the box.
//
// These are industry rules-of-thumb, NOT gospel — every value is overridable
// per SKU in the mapping editor. Coverage is expressed as the ratio the BOQ
// engine multiplies against the matching dimension.
import type { QtyFormula } from "@/lib/boq";

export interface CoverageDefault extends QtyFormula {
  wastage_pct?: number;
  unit?: string;
}

// First matching keyword wins — order specific before generic.
const RULES: [RegExp, CoverageDefault][] = [
  // Finishes — wall area driven
  // Putty: a 40kg bag covers ~480–640 sq.ft over 2 coats (12–15 sq.ft/kg), so
  // ~1 bag per 500 sq.ft — NOT 1/30 (that over-ordered putty ~16x). [birlawhite/civilsir]
  [/\b(wall putty|putty)\b/i, { per_wall_sqft: 1 / 500, pack_size: 1, wastage_pct: 10, unit: "bag" }],
  [/\b(primer)\b/i, { per_wall_sqft: 1 / 90, wastage_pct: 10, unit: "L" }],
  // Emulsion: ~120 sq.ft/L/coat × 2 coats ≈ 60 sq.ft/L for the job. [asianpaints]
  [/\b(emulsion|paint|distemper|enamel)\b/i, { per_wall_sqft: 1 / 60, wastage_pct: 10, unit: "L" }],
  // Plaster (internal 12mm, 1:6): ~1 cement bag per ~110 sq.ft — not 1/40 (~3x over). [happho/civilsir]
  [/\b(plaster)\b/i, { per_wall_sqft: 1 / 110, pack_size: 1, wastage_pct: 12, unit: "bag" }],

  // Flooring — floor area driven
  [/\b(tile adhesive|adhesive)\b/i, { per_floor_sqft: 1 / 40, pack_size: 1, wastage_pct: 10, unit: "bag" }],
  // Tile cutting waste is really ~10% (15% for large-format/diagonal). [trybuildcalc]
  [/\b(tile|vitrified|marble|granite|flooring|skirting)\b/i, { per_floor_sqft: 1.0, wastage_pct: 10, unit: "sq.ft" }],

  // Electrical — per point driven
  [/\b(wire|cable)\b/i, { per_point: 15, wastage_pct: 5, unit: "m" }],
  [/\b(conduit|pipe.*elect)\b/i, { per_point: 3, wastage_pct: 5, unit: "m" }],
  [/\b(switch|socket|modular|db box|distribution board|mcb)\b/i, { per_point: 1, wastage_pct: 2, unit: "pc" }],
  [/\b(light|led|lamp|luminaire|fan)\b/i, { per_room: 1, wastage_pct: 0, unit: "pc" }],

  // Plumbing / sanitary — per bathroom driven
  [/\b(wc|closet|toilet|wash ?basin|basin|cistern|shower|geyser|cp fitting)\b/i, { per_bathroom: 1, wastage_pct: 0, unit: "pc" }],
  // CPVC hot+cold supply is ~20–30 m per bathroom; use 25 as a safer mid. [studiomatrx/ashirvad]
  [/\b(cpvc|upvc|\bpipe\b)\b/i, { per_bathroom: 25, wastage_pct: 8, unit: "m" }],

  // Doors & windows — per room
  [/\b(door|shutter|frame|hinge|handle)\b/i, { per_room: 1, wastage_pct: 0, unit: "pc" }],

  // Structural / masonry — built-up (per_sqft) driven
  // Cement: 0.4–0.5 bag/sq.ft; 0.45 is the working midpoint. [houseyog/civiconcepts]
  [/\b(cement)\b/i, { per_sqft: 0.45, pack_size: 1, wastage_pct: 5, unit: "bag" }],
  [/\b(sand)\b/i, { per_sqft: 1.2, wastage_pct: 10, unit: "cft" }],
  [/\b(aggregate|grit|stone)\b/i, { per_sqft: 0.9, wastage_pct: 10, unit: "cft" }],
  // TMT steel: residential norm is 4.0–4.5 kg/sq.ft; 3.5 was the slab-only floor. [steeloncall/civillead]
  [/\b(tmt|rebar|steel|reinforc)\b/i, { per_sqft: 4.0, wastage_pct: 5, unit: "kg" }],
  // Bricks per built-up sq.ft ≈ 5–5.5 (500–550 per 100 sq.ft); 8 was too high. [civilsir/lceted]
  [/\b(brick|block|aac)\b/i, { per_sqft: 5.5, wastage_pct: 8, unit: "pc" }],
];

/**
 * Resolve a starter coverage default for a product, or null if nothing matches.
 * `category` is accepted for future category-level rules but name wins today.
 */
export function resolveCoverage(name?: string | null, _category?: string | null): CoverageDefault | null {
  const n = name ?? "";
  for (const [re, def] of RULES) {
    if (re.test(n)) return def;
  }
  return null;
}

/** True if a qty_formula already carries a usable basis (so we skip the default). */
export function hasBasis(f?: QtyFormula | null): boolean {
  if (!f) return false;
  return (
    f.per_floor_sqft != null || f.per_wall_sqft != null || f.per_point != null ||
    f.per_bathroom != null || f.per_room != null || f.per_sqft != null ||
    f.per_unit != null || f.fixed != null
  );
}
