import { Product } from "@/lib/supabase";

export type RecommendedSlot = { label: string; keywords: string[] };
export type RecommendedGroup = { title: string; slots: RecommendedSlot[] };

/**
 * Fixed cross-sell shortlist optimized for AOV — 30 products across 6 groups.
 * Each slot uses keyword variants matched against group_name / name.
 * Order is intentional and must be preserved at render time.
 */
export const RECOMMENDED_GROUPS: RecommendedGroup[] = [
  {
    title: "Tools",
    slots: [
      { label: "Screwdriver Set", keywords: ["screwdriver set", "screwdriver"] },
      { label: "Combination Plier", keywords: ["combination plier", "plier"] },
      { label: "Wire Stripper", keywords: ["wire stripper", "stripper"] },
      { label: "Adjustable Spanner", keywords: ["adjustable spanner", "spanner", "wrench"] },
      { label: "Measuring Tape", keywords: ["measuring tape", "tape measure"] },
      { label: "Spirit Level", keywords: ["spirit level", "level"] },
    ],
  },
  {
    title: "Fasteners",
    slots: [
      { label: "SS Screws", keywords: ["ss screw", "stainless screw", "screw"] },
      { label: "Concrete Nails", keywords: ["concrete nail", "masonry nail", "nail"] },
      { label: "Wall Plugs", keywords: ["wall plug", "rawl plug", "rawlplug"] },
      { label: "Hex Bolt Set", keywords: ["hex bolt", "bolt"] },
      { label: "Anchors", keywords: ["anchor"] },
    ],
  },
  {
    title: "Consumables",
    slots: [
      { label: "Thread Seal Tape", keywords: ["thread seal", "ptfe", "teflon"] },
      { label: "Insulation Tape", keywords: ["insulation tape", "electrical tape"] },
      { label: "Masking Tape", keywords: ["masking tape"] },
      { label: "Sand Paper", keywords: ["sand paper", "sandpaper", "emery"] },
      { label: "Adhesive SH", keywords: ["fevicol sh", "adhesive sh", "white glue", "wood adhesive"] },
    ],
  },
  {
    title: "Electrical",
    slots: [
      { label: "6A Socket", keywords: ["6a socket", "6 a socket"] },
      { label: "16A Socket", keywords: ["16a socket", "16 a socket"] },
      { label: "1 Way Switch", keywords: ["1 way switch", "one way switch", "1way"] },
      { label: "Ceiling Rose", keywords: ["ceiling rose"] },
      { label: "Indicator Lamp", keywords: ["indicator lamp", "indicator"] },
    ],
  },
  {
    title: "Lighting",
    slots: [
      { label: "LED Bulb", keywords: ["led bulb", "bulb"] },
      { label: "LED Panel Light", keywords: ["led panel", "panel light"] },
      { label: "Batten Light", keywords: ["batten light", "batten"] },
    ],
  },
  {
    title: "Fans",
    slots: [
      { label: "Ceiling Fan", keywords: ["ceiling fan"] },
      { label: "Exhaust Fan", keywords: ["exhaust fan"] },
    ],
  },
  {
    title: "Plumbing",
    slots: [
      { label: "Ball Valve", keywords: ["ball valve"] },
      { label: "CPVC Elbow", keywords: ["cpvc elbow", "cpvc fitting", "elbow"] },
      { label: "Pipe Cutter", keywords: ["pipe cutter"] },
      { label: "PTFE Tape", keywords: ["ptfe tape", "teflon tape"] },
    ],
  },
  {
    title: "Surface",
    slots: [
      { label: "Crack Fill Paste", keywords: ["crack fill", "crack"] },
      { label: "White Cement", keywords: ["white cement", "putty"] },
      { label: "Putty Knife", keywords: ["putty knife"] },
    ],
  },
  {
    title: "Safety",
    slots: [
      { label: "Safety Gloves", keywords: ["safety glove", "glove"] },
      { label: "Safety Goggles", keywords: ["safety goggle", "goggle", "safety glass"] },
    ],
  },
];

/** Find the cheapest product whose name/group_name matches any keyword. */
function findMatch(
  products: Product[],
  keywords: string[],
  used: Set<string>,
): Product | null {
  let best: Product | null = null;
  for (const p of products) {
    if (used.has(p.id)) continue;
    const hay = `${p.group_name ?? ""} ${p.name ?? ""}`.toLowerCase();
    if (keywords.some((k) => hay.includes(k.toLowerCase()))) {
      if (!best || (p.selling_price ?? Infinity) < (best.selling_price ?? Infinity)) {
        best = p;
      }
    }
  }
  return best;
}

export type ResolvedRecommendedGroup = {
  title: string;
  products: Product[];
};

/**
 * Resolve the fixed 30-SKU cross-sell list, grouped by category.
 * Preserves slot order. Skips slots with no match.
 */
export function resolveRecommendedGroups(
  products: Product[],
): ResolvedRecommendedGroup[] {
  const used = new Set<string>();
  return RECOMMENDED_GROUPS.map((group) => {
    const picked: Product[] = [];
    for (const slot of group.slots) {
      const match = findMatch(products, slot.keywords, used);
      if (match) {
        used.add(match.id);
        picked.push(match);
      }
    }
    return { title: group.title, products: picked };
  }).filter((g) => g.products.length > 0);
}

/** Backwards-compat: flat list of all resolved cross-sell products in order. */
export function resolveRecommendedProducts(products: Product[]): Product[] {
  return resolveRecommendedGroups(products).flatMap((g) => g.products);
}