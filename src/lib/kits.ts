import { Product } from "@/lib/supabase";

export type KitDef = {
  id: string;
  name: string;
  tag: "Most Popular" | "Contractor Pick" | "Quick Fix";
  emoji: string;
  /** Each slot defines one item in the kit; we pick the cheapest matching product */
  slots: { label: string; keywords: string[] }[];
};

export type ResolvedKit = {
  def: KitDef;
  products: Product[]; // unique, in slot order
  totalPrice: number;
};

export const KIT_DEFS: KitDef[] = [
  {
    id: "wall-mounting",
    name: "Wall Mounting Kit",
    tag: "Most Popular",
    emoji: "🔧",
    slots: [
      { label: "Drill machine", keywords: ["drill machine", "impact drill", "drill"] },
      { label: "Drill bits", keywords: ["drill bit"] },
      { label: "Screws", keywords: ["screw"] },
      { label: "Wall plugs", keywords: ["wall plug", "anchor"] },
      { label: "Measuring tape", keywords: ["measuring tape", "tape measure"] },
      { label: "Screwdriver set", keywords: ["screwdriver"] },
      { label: "Marker / pencil", keywords: ["marker", "pencil"] },
      { label: "Spirit level", keywords: ["spirit level", "level"] },
    ],
  },
  {
    id: "drilling-cutting",
    name: "Drilling & Cutting Kit",
    tag: "Contractor Pick",
    emoji: "🛠️",
    slots: [
      { label: "Drill machine", keywords: ["drill machine", "drill"] },
      { label: "Drill bits", keywords: ["drill bit"] },
      { label: "Cutting wheel", keywords: ["cutting wheel", "cutting disc"] },
      { label: "Grinding wheel", keywords: ["grinding wheel", "grinding disc"] },
      { label: "Clamps", keywords: ["clamp"] },
      { label: "Safety gloves", keywords: ["glove"] },
      { label: "Safety goggles", keywords: ["goggle", "safety glass"] },
    ],
  },
  {
    id: "plumbing",
    name: "Plumbing Kit",
    tag: "Most Popular",
    emoji: "🚿",
    slots: [
      { label: "Ball valve", keywords: ["ball valve", "valve"] },
      { label: "CPVC fitting", keywords: ["cpvc", "pvc fitting"] },
      { label: "Thread seal tape", keywords: ["thread seal", "teflon tape"] },
      { label: "Adjustable spanner", keywords: ["spanner", "wrench"] },
      { label: "Pipe cutter", keywords: ["pipe cutter"] },
      { label: "PU foam / sealant", keywords: ["pu foam", "sealant"] },
    ],
  },
  {
    id: "electrical",
    name: "Electrical Installation Kit",
    tag: "Contractor Pick",
    emoji: "⚡",
    slots: [
      { label: "Switch", keywords: ["switch"] },
      { label: "Socket", keywords: ["socket"] },
      { label: "Wire", keywords: ["wire", "cable"] },
      { label: "Insulation tape", keywords: ["insulation tape", "electrical tape"] },
      { label: "Voltage tester", keywords: ["tester", "voltage"] },
      { label: "Screwdriver set", keywords: ["screwdriver"] },
      { label: "Wire stripper", keywords: ["wire stripper", "stripper"] },
    ],
  },
  {
    id: "site-setup",
    name: "Temporary Site Setup Kit",
    tag: "Quick Fix",
    emoji: "🔌",
    slots: [
      { label: "Extension board", keywords: ["extension board", "extension"] },
      { label: "Wire", keywords: ["wire", "cable"] },
      { label: "Ceiling rose / holder", keywords: ["ceiling rose", "holder", "batten"] },
      { label: "LED bulb", keywords: ["led bulb", "bulb"] },
      { label: "Switch", keywords: ["switch"] },
      { label: "Insulation tape", keywords: ["insulation tape"] },
    ],
  },
  {
    id: "wall-repair",
    name: "Wall Repair Kit",
    tag: "Quick Fix",
    emoji: "🧱",
    slots: [
      { label: "Crack fill paste", keywords: ["crack fill", "crack"] },
      { label: "White cement / putty", keywords: ["white cement", "putty"] },
      { label: "Sand paper", keywords: ["sand paper", "sandpaper"] },
      { label: "Putty knife", keywords: ["putty knife"] },
      { label: "Masking tape", keywords: ["masking tape"] },
      { label: "Primer", keywords: ["primer"] },
    ],
  },
  {
    id: "carpentry",
    name: "Carpentry Kit",
    tag: "Contractor Pick",
    emoji: "🪚",
    slots: [
      { label: "Wood adhesive", keywords: ["wood adhesive", "wood glue"] },
      { label: "Screws", keywords: ["screw"] },
      { label: "Drill machine", keywords: ["drill"] },
      { label: "Screwdriver set", keywords: ["screwdriver"] },
      { label: "Measuring tape", keywords: ["measuring tape"] },
      { label: "Saw", keywords: ["saw"] },
      { label: "Sand paper", keywords: ["sand paper", "sandpaper"] },
    ],
  },
  {
    id: "fastening",
    name: "Fastening Kit",
    tag: "Most Popular",
    emoji: "🔩",
    slots: [
      { label: "Screws", keywords: ["screw"] },
      { label: "Bolts", keywords: ["bolt"] },
      { label: "Wall plugs", keywords: ["wall plug"] },
      { label: "Anchors", keywords: ["anchor"] },
      { label: "Nails", keywords: ["nail"] },
    ],
  },
  {
    id: "maintenance",
    name: "Maintenance Kit",
    tag: "Quick Fix",
    emoji: "🧰",
    slots: [
      { label: "Screwdriver set", keywords: ["screwdriver"] },
      { label: "Pliers", keywords: ["plier"] },
      { label: "Measuring tape", keywords: ["measuring tape"] },
      { label: "Adhesive", keywords: ["adhesive", "glue"] },
      { label: "Electrical tape", keywords: ["electrical tape", "insulation tape"] },
      { label: "Screws", keywords: ["screw"] },
    ],
  },
];

function matchProduct(
  products: Product[],
  keywords: string[],
  used: Set<string>,
  usedImages: Set<string>,
): Product | null {
  let best: Product | null = null;
  for (const p of products) {
    if (used.has(p.id)) continue;
    if (p.image_url && usedImages.has(p.image_url)) continue;
    const hay = `${p.name ?? ""} ${p.group_name ?? ""} ${p.subcategory ?? ""} ${p.main_category ?? ""}`.toLowerCase();
    if (keywords.some((k) => hay.includes(k.toLowerCase()))) {
      if (!best || (p.selling_price ?? Infinity) < (best.selling_price ?? Infinity)) {
        best = p;
      }
    }
  }
  return best;
}

export function resolveKits(products: Product[]): ResolvedKit[] {
  return KIT_DEFS.map((def) => {
    const used = new Set<string>();
    const usedImages = new Set<string>();
    const picked: Product[] = [];
    for (const slot of def.slots) {
      const match = matchProduct(products, slot.keywords, used, usedImages);
      if (match) {
        used.add(match.id);
        if (match.image_url) usedImages.add(match.image_url);
        picked.push(match);
      }
    }
    return {
      def,
      products: picked,
      totalPrice: picked.reduce((s, p) => s + (p.selling_price ?? 0), 0),
    };
  }).filter((k) => k.products.length >= 3); // need a meaningful kit
}

/** Suggest one kit relevant to a freshly-added product. */
export function suggestKitFor(product: Product, kits: ResolvedKit[]): ResolvedKit | null {
  const hay = `${product.name ?? ""} ${product.group_name ?? ""} ${product.subcategory ?? ""}`.toLowerCase();
  for (const kit of kits) {
    for (const slot of kit.def.slots) {
      if (slot.keywords.some((k) => hay.includes(k.toLowerCase()))) {
        return kit;
      }
    }
  }
  return null;
}