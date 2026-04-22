import { Product } from "@/lib/supabase";

/**
 * Fixed cross-sell shortlist optimized for AOV.
 * Each entry has keyword variants that match against group_name / name.
 * Order matters — it's the display order on "You Might Also Need".
 */
export const RECOMMENDED_SLOTS: { label: string; keywords: string[] }[] = [
  { label: "Thread Seal Tape", keywords: ["thread seal", "ptfe tape", "teflon tape"] },
  { label: "Insulation Tape", keywords: ["insulation tape", "electrical tape"] },
  { label: "SS Screws", keywords: ["ss screw", "stainless screw", "screw"] },
  { label: "Wall Plugs", keywords: ["wall plug", "rawl plug", "rawlplug"] },
  { label: "Measuring Tape", keywords: ["measuring tape", "tape measure"] },
  { label: "Screwdriver Set", keywords: ["screwdriver set", "screwdriver"] },
  { label: "Sand Paper", keywords: ["sand paper", "sandpaper", "emery"] },
  { label: "Adhesive SH", keywords: ["fevicol sh", "adhesive sh", "white glue", "wood adhesive"] },
  { label: "Electrical Socket", keywords: ["6a socket", "16a socket", "socket"] },
  { label: "Concrete Nails", keywords: ["concrete nail", "masonry nail", "nail"] },
];

/** Find the cheapest product whose name/group_name matches any keyword. */
function findMatch(products: Product[], keywords: string[], used: Set<string>): Product | null {
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

/**
 * Resolve the fixed 10-product cross-sell list against the catalog.
 * Preserves slot order. Skips slots with no match (rare).
 */
export function resolveRecommendedProducts(products: Product[]): Product[] {
  const used = new Set<string>();
  const picked: Product[] = [];
  for (const slot of RECOMMENDED_SLOTS) {
    const match = findMatch(products, slot.keywords, used);
    if (match) {
      used.add(match.id);
      picked.push(match);
    }
  }
  return picked;
}