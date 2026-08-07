// Project archetypes — the "anchor" that makes output-before-input possible.
// Each archetype is a reference project an estimator recognizes instantly; it
// seeds the questionnaire spec + area/floors so a full draft BOQ can be generated
// from a single tap, before any form is filled. Everything stays editable after.

import { defaultSpec, type Spec } from "./boqSpec";

export interface Archetype {
  key: string;
  label: string;
  hint: string;
  area: number;   // typical built-up area (sqft)
  floors: number;
  spec: Partial<Spec>;
}

export const ARCHETYPES: Archetype[] = [
  { key: "1bhk", label: "1 BHK flat", hint: "~650 sqft", area: 650, floors: 1,
    spec: { bedrooms: 1, bathrooms: 1, kitchens: 1, living: 1, balconies: 1, quality_tier: "standard" } },
  { key: "2bhk", label: "2 BHK flat", hint: "~1,000 sqft", area: 1000, floors: 1,
    spec: { bedrooms: 2, bathrooms: 2, kitchens: 1, living: 1, balconies: 1, quality_tier: "standard" } },
  { key: "3bhk", label: "3 BHK flat", hint: "~1,500 sqft", area: 1500, floors: 1,
    spec: { bedrooms: 3, bathrooms: 3, kitchens: 1, living: 1, balconies: 2, quality_tier: "standard" } },
  { key: "villa", label: "Villa / bungalow", hint: "G+1 · ~2,500 sqft", area: 2500, floors: 2,
    spec: { bedrooms: 4, bathrooms: 4, kitchens: 1, living: 2, balconies: 2, quality_tier: "premium", false_ceiling: "living_beds", living_floor: "vitrified" } },
  { key: "duplex", label: "Duplex", hint: "2 floors · ~1,800 sqft", area: 1800, floors: 2,
    spec: { bedrooms: 3, bathrooms: 3, kitchens: 1, living: 2, balconies: 2, quality_tier: "standard" } },
  { key: "apartment_floor", label: "Apartment floor", hint: "multi-unit", area: 4000, floors: 1,
    spec: { bedrooms: 6, bathrooms: 6, kitchens: 3, living: 3, balconies: 3, flats_per_floor: 3, quality_tier: "standard" } },
  { key: "shop", label: "Shop / commercial", hint: "open floor", area: 800, floors: 1,
    spec: { bedrooms: 0, bathrooms: 1, kitchens: 0, living: 1, balconies: 0, false_ceiling: "all", quality_tier: "standard" } },
];

/** Build a full spec for an archetype, with the estimator's quick-lever overrides. */
export function archetypeSpec(a: Archetype, overrides?: { area?: number; floors?: number; tier?: string }): Spec {
  const spec = defaultSpec({ ...a.spec });
  spec._area_sqft = overrides?.area ?? a.area;
  spec._floors = overrides?.floors ?? a.floors;
  if (overrides?.tier) spec.quality_tier = overrides.tier;
  return spec;
}
