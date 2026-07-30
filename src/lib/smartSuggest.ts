// Turns "Project basics" (type, area, floors, quality tier, room counts) into
// smart defaults for the BOQ builder: a starter room list with typical
// dimensions, and quality-tier tuning of the wastage buffer.

export type QualityTier = "economy" | "standard" | "premium";

export interface ProjectBasics {
  project_type?: string | null;
  area_sqft?: number | null;
  floors?: number | null;
  quality_tier?: QualityTier | string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  kitchens?: number | null;
}

export interface SuggestedRoom {
  name: string;
  room_type: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  count: number;
  electrical_points: number;
}

// Typical room dimensions (feet) + typical electrical points, Indian residential.
const ROOM_TEMPLATES: Record<string, Omit<SuggestedRoom, "count" | "name">> = {
  living: { room_type: "living", length_ft: 16, width_ft: 12, height_ft: 10, electrical_points: 6 },
  kitchen: { room_type: "kitchen", length_ft: 10, width_ft: 8, height_ft: 10, electrical_points: 6 },
  bedroom: { room_type: "bedroom", length_ft: 12, width_ft: 10, height_ft: 10, electrical_points: 5 },
  bathroom: { room_type: "bathroom", length_ft: 7, width_ft: 5, height_ft: 10, electrical_points: 2 },
};

// Premium homes run a little larger and wire a few more points per room.
const TIER_SIZE_SCALE: Record<QualityTier, number> = { economy: 0.92, standard: 1, premium: 1.12 };
const TIER_POINT_SCALE: Record<QualityTier, number> = { economy: 0.9, standard: 1, premium: 1.3 };

const asTier = (t?: QualityTier | string | null): QualityTier =>
  t === "economy" || t === "premium" ? t : "standard";

const half = (n: number) => Math.round(n * 2) / 2;

/**
 * Build a starter room list from the counts. Bedrooms/bathrooms are grouped
 * into a single row with a `count` (they share dimensions); the BOQ engine
 * multiplies by count. Returns [] when there's nothing to suggest.
 */
export function suggestRooms(b: ProjectBasics): SuggestedRoom[] {
  const tier = asTier(b.quality_tier);
  const sizeScale = TIER_SIZE_SCALE[tier];
  const pointScale = TIER_POINT_SCALE[tier];

  const make = (type: string, count: number): SuggestedRoom[] => {
    const t = ROOM_TEMPLATES[type];
    if (!t || count <= 0) return [];
    return [{
      name: "",
      room_type: t.room_type,
      length_ft: half(t.length_ft * sizeScale),
      width_ft: half(t.width_ft * sizeScale),
      height_ft: t.height_ft,
      count: Math.floor(count),
      electrical_points: Math.max(1, Math.round(t.electrical_points * pointScale)),
    }];
  };

  const bedrooms = Number(b.bedrooms) || 0;
  const bathrooms = Number(b.bathrooms) || 0;
  const kitchens = Math.max(bedrooms > 0 ? 1 : 0, Number(b.kitchens) || 0);
  const livings = bedrooms > 0 || bathrooms > 0 ? 1 : 0; // assume one hall for any real home

  return [
    ...make("living", livings),
    ...make("kitchen", kitchens),
    ...make("bedroom", bedrooms),
    ...make("bathroom", bathrooms),
  ];
}

/** True when the basics carry enough to suggest at least one room. */
export function canSuggestRooms(b: ProjectBasics): boolean {
  return (Number(b.bedrooms) || 0) + (Number(b.bathrooms) || 0) + (Number(b.kitchens) || 0) > 0;
}

/**
 * Quality-tier adjustment to the wastage buffer (percentage points).
 * Premium finishes waste more (cuts, patterns); economy trims it.
 */
export function tierWastageDelta(t?: QualityTier | string | null): number {
  switch (asTier(t)) {
    case "economy": return -2;
    case "premium": return 4;
    default: return 0;
  }
}
