// Maps a catalog product (by category, with a name-keyword fallback) to the
// construction stage it belongs to. Stage names MUST match stage_master.name.
// Used by the "Import from catalog" flow on the Stage → Material Mapping page.

// Exact stage names as seeded in stage_master.
export const STAGE_NAMES = [
  "Pre-Construction",
  "Excavation",
  "Foundation",
  "RCC Structure",
  "Masonry",
  "Plumbing Rough-In",
  "Electrical Rough-In",
  "Waterproofing",
  "Plastering",
  "Ceiling Works",
  "Flooring & Tiling",
  "Painting",
  "Doors & Windows",
  "Fixtures & Fittings",
  "Final Finishing",
  "Handover",
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

// Catalog main_category (lowercased) → stage. Mirrors the catalog_enriched view's
// intent, resolved to concrete stage_master rows.
const CATEGORY_STAGE: Record<string, StageName> = {
  "building materials": "Foundation",
  structural: "RCC Structure",
  "fasteners & hardware": "RCC Structure",
  "masonry tools": "Masonry",
  "plumbing & sanitary": "Plumbing Rough-In",
  electrical: "Electrical Rough-In",
  lighting: "Electrical Rough-In",
  fan: "Fixtures & Fittings",
  "fixtures & fittings": "Fixtures & Fittings",
  "adhesives & chemicals": "Waterproofing",
  sealants: "Waterproofing",
  "construction materials & finishes": "Painting",
  "doors & windows hardware": "Doors & Windows",
  ppe: "Pre-Construction",
  "tools & equipment": "Pre-Construction",
};

// Name-keyword fallback when the category is missing or unrecognised.
// Ordered: first match wins, so put the more specific rules first.
const KEYWORD_STAGE: [RegExp, StageName][] = [
  [/\b(tmt|rebar|binding wire|reinforc)/i, "RCC Structure"],
  [/\b(cement|sand|aggregate|concrete|rmc|grit|admixture)\b/i, "Foundation"],
  [/\b(brick|block|aac|fly ?ash)\b/i, "Masonry"],
  [/\b(cpvc|upvc|\bpipe\b|sanitary|faucet|\btap\b|closet|wash ?basin|cistern)/i, "Plumbing Rough-In"],
  [/\b(wire|cable|switch|socket|mcb|conduit|db box|distribution board)/i, "Electrical Rough-In"],
  [/\b(waterproof|bitumen|membrane|sealant)/i, "Waterproofing"],
  [/\b(plaster|wall putty|\bputty\b)/i, "Plastering"],
  [/\b(gypsum|\bpop\b|false ceiling|ceiling)/i, "Ceiling Works"],
  [/\b(tile|marble|granite|vitrified|flooring|skirting)/i, "Flooring & Tiling"],
  [/\b(paint|primer|emulsion|distemper|enamel)/i, "Painting"],
  [/\b(door|window|shutter|hinge|\block\b|handle)/i, "Doors & Windows"],
  [/\b(fan|\blight\b|\bled\b|\blamp\b|luminaire)/i, "Fixtures & Fittings"],
  [/\b(basin|toilet|shower|cp fitting|geyser)/i, "Fixtures & Fittings"],
];

export function mapCategoryToStage(
  category?: string | null,
  name?: string | null,
): StageName | null {
  const c = (category ?? "").toLowerCase().trim();
  if (c && CATEGORY_STAGE[c]) return CATEGORY_STAGE[c];

  const n = name ?? "";
  for (const [re, stage] of KEYWORD_STAGE) {
    if (re.test(n)) return stage;
  }
  return null;
}
