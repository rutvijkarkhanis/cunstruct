// Quantity-rule resolver — the single entry point that decides, for one BOQ
// item in the context of a project, WHICH quantity rule applies and by what
// methodology it should be measured.
//
// It supersedes bare resolveCoverage() (which keyed on item name alone) by
// threading the project type through and layering rules with a deterministic
// precedence:
//
//   PROJECT-SPECIFIC OVERRIDE   (a qty_formula set on the item itself)
//        ↓
//   PROJECT-TYPE + ITEM         (e.g. a future "Commercial + TMT" rule)
//        ↓
//   PROJECT-TYPE + CATEGORY
//        ↓
//   GENERIC ITEM                (the existing name-based coverage rules)
//        ↓
//   GENERIC CATEGORY
//        ↓
//   NO RULE → PENDING
//
// Coverage is ONE rule type here, not the universal mechanism. Where no rule
// exists we do NOT invent a ratio — the item is returned with its methodology
// and a null formula so the caller can mark it PENDING.

import type { QtyFormula } from "./boq";
import { resolveCoverage, hasBasis, type CoverageDefault } from "./coverageDefaults";
import { classifyMethod, canonicalUnit, type QuantityMethod } from "./quantityMethod";

export type RulePrecedence =
  | "project-override"
  | "project-type-item"
  | "project-type-category"
  | "generic-item"
  | "generic-category"
  | "none";

export interface QuantityRuleContext {
  itemName: string;
  category?: string | null;
  projectType?: string | null;
  /** A project-specific qty_formula stored on the item — the highest precedence. */
  override?: QtyFormula | null;
}

export interface ResolvedQuantityRule {
  method: QuantityMethod;
  /** Canonical/coverage unit; the caller may still prefer an item-level unit. */
  unit: string;
  /** The usable coverage/basis to multiply, or null when no rule applies. */
  formula: (QtyFormula & CoverageDefault) | null;
  /** Which precedence layer produced the formula. "none" ⇒ PENDING downstream. */
  precedence: RulePrecedence;
}

// A rule entry: a predicate over (name, category) → a coverage/basis formula.
type Rule = { test: (name: string, category?: string | null) => boolean; formula: CoverageDefault };

// ── Project-type layers — intentionally EMPTY ────────────────────────────────
// This is the extension point for genuinely project-type-specific rules such as
// Residential+TMT vs Commercial+TMT vs Hospital+TMT. It is empty on purpose: we
// do NOT invent project-type ratios. Adding a rule later is a single entry here
// (or, if it grows, a small config table) with NO change to the resolver or the
// generation pipeline. Keyed by the project's `project_type` string, so no
// project type is hardcoded into the architecture.
const PROJECT_TYPE_ITEM_RULES: Record<string, Rule[]> = {};
const PROJECT_TYPE_CATEGORY_RULES: Record<string, Rule[]> = {};

function firstMatch(rules: Rule[] | undefined, name: string, category?: string | null): CoverageDefault | null {
  if (!rules) return null;
  for (const r of rules) if (r.test(name, category)) return r.formula;
  return null;
}

/**
 * Infer a methodology from a coverage formula's basis, used only as a fallback
 * when the name/category classifier can't decide. Never invents anything.
 */
function methodFromFormula(f: QtyFormula | null | undefined): QuantityMethod {
  if (!f) return "PENDING";
  if (f.per_bathroom != null || f.per_room != null) return "COUNT";
  if (f.per_point != null) return "COUNT";
  if (f.per_floor_sqft === 1 || f.per_wall_sqft === 1) return "AREA";
  if (f.per_floor_sqft != null || f.per_wall_sqft != null || f.per_sqft != null) return "COVERAGE";
  if (f.per_unit != null || f.fixed != null) return "COUNT";
  return "PENDING";
}

/**
 * Resolve the quantity rule for an item. Always returns a methodology (so a
 * PENDING item still knows how it OUGHT to be measured); `formula` is null when
 * no rule applies.
 */
export function resolveQuantityRule(ctx: QuantityRuleContext): ResolvedQuantityRule {
  const { itemName, category, projectType, override } = ctx;

  // Methodology is classified from the item itself and is independent of whether
  // a coverage ratio exists — that is the whole point of the methodology layer.
  const classified = classifyMethod(itemName, category);

  const finish = (
    formula: (QtyFormula & CoverageDefault) | null,
    precedence: RulePrecedence,
  ): ResolvedQuantityRule => {
    const method = classified !== "PENDING" ? classified : methodFromFormula(formula);
    const unit = formula?.unit ?? canonicalUnit(method);
    return { method, unit, formula, precedence };
  };

  // 1) Project-specific override — a real basis set on the item itself wins.
  if (hasBasis(override)) return finish(override as QtyFormula & CoverageDefault, "project-override");

  // 2) Project-type + item.
  if (projectType) {
    const pt = firstMatch(PROJECT_TYPE_ITEM_RULES[projectType], itemName, category);
    if (pt) return finish(pt as QtyFormula & CoverageDefault, "project-type-item");
    // 3) Project-type + category.
    const ptc = firstMatch(PROJECT_TYPE_CATEGORY_RULES[projectType], itemName, category);
    if (ptc) return finish(ptc as QtyFormula & CoverageDefault, "project-type-category");
  }

  // 4) Generic item — the existing, validated name-based coverage rules.
  const generic = resolveCoverage(itemName, category);
  if (generic) return finish(generic as QtyFormula & CoverageDefault, "generic-item");

  // 5) Generic category — reserved layer (no invented category ratios today).
  //    resolveCoverage already consults the category; nothing more to add yet.

  // 6) No rule — methodology is known (or PENDING) but there is no formula.
  return finish(null, "none");
}
