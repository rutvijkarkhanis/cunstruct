// TYPE GROUPING — derive a Category → Type view over existing review items,
// matching the reference product's Element Type / Instance hierarchy.
//
// Cunstruct's BOQ-mode extraction is already type-level: one AnalysisItemV1
// IS one type ("W1, 3'×4' UPVC, quantity: 6"). This module never merges
// distinct review items into one type (each StoredReviewItem stays its own
// Apply/review identity — see applyReview.ts, which classifies and writes
// exactly one boq_line per item, keyed on item.ai.key) and never invents an
// "instance count" for a continuous measure (a wall's sq ft is not N
// instances of a wall — see isCountableUnit). Category is a light, visible
// heuristic over the item's own key/name, not a classification the AI
// asserted — labeled as such everywhere it's shown.

import type { StoredReviewItem } from "./reviewStore";
import { criticalReasons, isCritical, type ReviewStatus } from "./reviewQueue";

export type ElementCategory =
  | "Windows" | "Doors" | "Columns" | "Beams" | "Walls" | "Slabs"
  | "Footings" | "Piles" | "Finishes" | "Other";

/** Units where the quantity genuinely counts discrete occurrences — the only
 *  case where "N instances" is a truthful way to describe item.quantity. */
const COUNTABLE_UNITS = new Set([
  "nos", "no", "no.", "each", "ea", "pcs", "pc", "piece", "pieces", "unit", "units", "set", "sets", "nr",
]);

export function isCountableUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  return COUNTABLE_UNITS.has(unit.trim().toLowerCase());
}

// Mark-style prefix (letters before the first digit/dash) is the primary,
// most reliable signal — "W1"->W, "D2"->D, "C-1"->C — matching how these
// drawings are actually marked. Falls back to a keyword match against the
// item's own name for keys that aren't mark-style; anything neither matches
// is "Other", never guessed into a category it doesn't clearly belong to.
const PREFIX_CATEGORY: Record<string, ElementCategory> = {
  W: "Windows", D: "Doors", C: "Columns", B: "Beams", SW: "Walls",
  S: "Slabs", F: "Footings", P: "Piles",
};
const KEYWORD_CATEGORY: [RegExp, ElementCategory][] = [
  [/\bwindow\b/i, "Windows"], [/\bdoor\b/i, "Doors"], [/\bcolumn\b/i, "Columns"],
  [/\bbeam\b/i, "Beams"], [/\bwall\b/i, "Walls"], [/\bslab\b/i, "Slabs"],
  [/\bfooting\b/i, "Footings"], [/\bpile\b/i, "Piles"],
  [/\bpaint\b|\bplaster\b|\bflooring\b|\btile\b|\bfinish\b/i, "Finishes"],
];

/** Derive a display category from an item's key/name. Pure, deterministic,
 *  presentation-only — never persisted, never fed back into extraction. */
export function categorize(item: { key: string; item: string }): ElementCategory {
  const m = /^([A-Za-z]{1,2})[\d-]/.exec((item.key ?? "").trim());
  if (m) {
    const prefix = m[1].toUpperCase();
    if (PREFIX_CATEGORY[prefix]) return PREFIX_CATEGORY[prefix];
  }
  for (const [re, cat] of KEYWORD_CATEGORY) {
    if (re.test(item.item ?? "")) return cat;
  }
  return "Other";
}

export interface TypeCard {
  reviewItem: StoredReviewItem;
  category: ElementCategory;
  /** Only meaningful when true — a continuous measure has no "instances". */
  countable: boolean;
  /** The resolved quantity, only when countable — real, already-extracted
   *  data (item.ai.quantity), never a separately computed/fabricated count. */
  instanceCount: number | null;
  reasons: string[];
  needsAttention: boolean;
  reviewStatus: ReviewStatus;
}

export function buildTypeCard(item: StoredReviewItem): TypeCard {
  const countable = isCountableUnit(item.ai.unit);
  return {
    reviewItem: item,
    category: categorize({ key: item.ai.key, item: item.ai.item }),
    countable,
    instanceCount: countable ? item.ai.quantity : null,
    reasons: criticalReasons(item),
    needsAttention: isCritical(item),
    reviewStatus: item.reviewStatus,
  };
}

export interface CategoryGroup {
  category: ElementCategory;
  types: TypeCard[];
  needsAttentionCount: number;
}

// Known building-element categories first, in the reference's own rough
// ordering convention (openings, then structure, then finishes); "Other"
// always last since it is the fallback, never a real classification.
const CATEGORY_ORDER: ElementCategory[] = [
  "Windows", "Doors", "Columns", "Beams", "Walls", "Slabs", "Footings", "Piles", "Finishes", "Other",
];

/** Group review items into categories of types. Pure; recomputes cleanly on
 *  every render — never mutates or reorders the underlying items array. */
export function groupByCategory(items: StoredReviewItem[]): CategoryGroup[] {
  const cards = items.map(buildTypeCard);
  const byCat = new Map<ElementCategory, TypeCard[]>();
  for (const c of cards) {
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category)!.push(c);
  }
  return CATEGORY_ORDER.filter((cat) => byCat.has(cat)).map((category) => {
    const types = byCat.get(category)!;
    return { category, types, needsAttentionCount: types.filter((t) => t.needsAttention).length };
  });
}
