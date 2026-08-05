// Turn a saved BOQ questionnaire (boq.spec) into a set of "line intents": what
// DSR items to pull in, in which section, and roughly how much. Kept PURE — it
// emits intents with keyword hints + quantities; the builder resolves each intent
// against dsr_item (by keyword) and writes boq_line rows. This separation keeps
// the quantity maths unit-tested without a database.
//
// Quantities are first-pass estimates from built-up area + room counts. Every
// line is editable in the builder, so these are sensible starting points, not
// claims of precision.

import type { Spec } from "./boqSpec";

export interface LineIntent {
  section: string;       // DSR chapter / stage grouping
  keywords: string[];    // matched (ANY, ilike) against dsr_item.description
  qty: number;           // starting quantity (in the DSR item's unit)
  label: string;         // human label, used if no DSR match is found
  unitHint: string;      // expected unit, for display before a match
}

const SQFT_TO_SQM = 1 / 10.764;

/** Numeric spec accessor (spec values may be string|number|boolean). */
const num = (spec: Spec, key: string, dflt = 0): number => {
  const v = spec[key];
  return typeof v === "number" ? v : v == null ? dflt : Number(v) || dflt;
};

export interface ProjectBasics {
  area_sqft: number | null;   // total built-up area
  floors: number | null;
}

/**
 * Derive the full set of line intents from the questionnaire + project basics.
 * Rules are gated on spec answers, so unchecked scope (e.g. no compound wall)
 * simply produces no line.
 */
export function specToIntents(spec: Spec, project: ProjectBasics): LineIntent[] {
  const builtUpSqft = project.area_sqft ?? 1000;
  const floors = Math.max(1, project.floors ?? 1);
  const floorSqm = builtUpSqft * SQFT_TO_SQM;          // total built-up in sqm
  const footprintSqm = floorSqm / floors;               // ground-floor footprint
  const wallSqm = floorSqm * 3.0;                        // approx wall face area (both sides handled per item)
  const perimeterM = 4 * Math.sqrt(footprintSqm);       // square-plan approximation

  const beds = num(spec, "bedrooms", 2);
  const baths = num(spec, "bathrooms", 2);
  const kitchens = num(spec, "kitchens", 1);
  const living = num(spec, "living", 1);
  const rooms = beds + living + kitchens + num(spec, "pooja") + num(spec, "utility");

  const out: LineIntent[] = [];
  const add = (i: LineIntent) => { if (i.qty > 0) out.push({ ...i, qty: Math.round(i.qty * 100) / 100 }); };

  // --- Substructure ---------------------------------------------------------
  add({ section: "Earthwork", keywords: ["excavation", "earth work"], qty: footprintSqm * 0.5, label: "Excavation in foundation", unitHint: "cum" });
  add({ section: "Concrete", keywords: ["p.c.c", "plain cement concrete", "lean concrete"], qty: footprintSqm * 0.1, label: "PCC bed", unitHint: "cum" });

  // --- Superstructure -------------------------------------------------------
  add({ section: "RCC", keywords: ["reinforced cement concrete", "r.c.c", "rcc"], qty: floorSqm * 0.12, label: "RCC (footings, columns, beams, slab)", unitHint: "cum" });
  add({ section: "Steel", keywords: ["reinforcement", "tmt", "steel bar"], qty: floorSqm * 40, label: "Reinforcement steel", unitHint: "kg" });

  const wallKw = spec.wall_material === "aac_block" ? ["aac", "autoclaved", "block masonry"]
    : spec.wall_material === "fly_ash" ? ["fly ash", "fly-ash", "brick"]
    : ["brick work", "brick masonry"];
  add({ section: "Masonry", keywords: wallKw, qty: wallSqm * (spec.ext_wall === "6in" ? 0.15 : 0.23), label: "Wall masonry", unitHint: "cum" });

  // --- Finishing: plaster ---------------------------------------------------
  add({ section: "Plastering", keywords: ["internal plaster", "plaster", "cement plaster"], qty: wallSqm * 2, label: "Internal plaster", unitHint: "sqm" });
  add({ section: "Plastering", keywords: ["external plaster", "external", "plaster"], qty: perimeterM * 3 * floors, label: "External plaster", unitHint: "sqm" });

  // --- Flooring -------------------------------------------------------------
  const floorKw: Record<string, string[]> = {
    vitrified: ["vitrified"], ceramic: ["ceramic", "floor tile"], granite: ["granite"],
    marble: ["marble"], wood: ["wooden floor", "laminate", "wood floor"],
  };
  const lf = String(spec.living_floor ?? "vitrified");
  add({ section: "Flooring", keywords: floorKw[lf] ?? ["floor tile"], qty: floorSqm * 0.85, label: `${lf} flooring`, unitHint: "sqm" });
  add({ section: "Flooring", keywords: ["anti skid", "anti-skid", "ceramic"], qty: baths * 6 + num(spec, "balconies") * 8, label: "Anti-skid tiling (wet areas)", unitHint: "sqm" });
  if (spec.skirting) add({ section: "Flooring", keywords: ["skirting"], qty: floorSqm * 0.5, label: "Skirting", unitHint: "rmt" });

  // --- Painting -------------------------------------------------------------
  if (spec.interior === "texture") add({ section: "Painting", keywords: ["texture"], qty: wallSqm * 2, label: "Interior texture", unitHint: "sqm" });
  else add({ section: "Painting", keywords: ["emulsion", "putty", "distemper"], qty: wallSqm * 2, label: "Interior putty + emulsion", unitHint: "sqm" });
  add({ section: "Painting", keywords: ["weather", "exterior emulsion", "exterior paint"], qty: perimeterM * 3 * floors, label: "Exterior weatherproof paint", unitHint: "sqm" });

  // --- False ceiling --------------------------------------------------------
  const fcScope = String(spec.false_ceiling ?? "none");
  const fcRooms = fcScope === "all" ? rooms : fcScope === "living_beds" ? living + beds : fcScope === "living" ? living : 0;
  if (fcRooms > 0) add({ section: "Ceiling", keywords: ["false ceiling", "gypsum", "pop ceiling"], qty: fcRooms * 12, label: "False ceiling", unitHint: "sqm" });

  // --- Doors & windows ------------------------------------------------------
  add({ section: "Doors & Windows", keywords: spec.main_door === "teak" ? ["teak", "door frame"] : ["flush door", "door"], qty: 1, label: "Main door", unitHint: "nos" });
  const intDoorKw = spec.internal_doors === "wpc" ? ["wpc door", "wpc"] : spec.internal_doors === "panel" ? ["panel door"] : ["flush door"];
  add({ section: "Doors & Windows", keywords: intDoorKw, qty: beds + baths + kitchens, label: "Internal doors", unitHint: "nos" });
  const winKw = spec.windows === "aluminium" ? ["aluminium window", "aluminium"] : spec.windows === "wood" ? ["wooden window", "timber"] : ["upvc", "u.p.v.c"];
  add({ section: "Doors & Windows", keywords: winKw, qty: rooms + baths, label: "Windows", unitHint: "sqm" });
  if (spec.grills) add({ section: "Doors & Windows", keywords: ["m.s. grill", "grill", "steel grill"], qty: (rooms + baths) * 1.5, label: "Window grills", unitHint: "sqm" });

  // --- Kitchen --------------------------------------------------------------
  if (spec.platform) add({ section: "Kitchen", keywords: ["granite", "kitchen platform", "counter"], qty: kitchens * 2.5, label: "Kitchen granite platform", unitHint: "rmt" });
  if (spec.dado) add({ section: "Kitchen", keywords: ["dado", "glazed", "ceramic wall tile"], qty: kitchens * 6, label: "Kitchen dado tiling", unitHint: "sqm" });

  // --- Bathrooms ------------------------------------------------------------
  const tilingH = spec.wall_tiling === "dado" ? 12 : 20;
  add({ section: "Bathrooms", keywords: ["glazed", "wall tile", "ceramic wall"], qty: baths * tilingH, label: "Bathroom wall tiling", unitHint: "sqm" });
  add({ section: "Sanitary", keywords: ["water closet", "w.c", "e.w.c", "commode"], qty: baths, label: "WC", unitHint: "nos" });
  add({ section: "Sanitary", keywords: ["wash basin", "basin"], qty: baths, label: "Wash basin", unitHint: "nos" });
  add({ section: "Sanitary", keywords: ["c.p", "cp fitting", "tap", "mixer"], qty: baths * 3, label: "CP fittings", unitHint: "nos" });
  if (spec.geyser) add({ section: "Electrical", keywords: ["geyser point", "geyser"], qty: baths, label: "Geyser points", unitHint: "nos" });

  // --- MEP ------------------------------------------------------------------
  const density = spec.elec_density === "premium" ? 12 : spec.elec_density === "basic" ? 6 : 9;
  add({ section: "Electrical", keywords: ["wiring", "point wiring", "light point"], qty: rooms * density, label: "Electrical points", unitHint: "nos" });
  add({ section: "Plumbing", keywords: ["cpvc", "c.p.v.c", "water supply"], qty: baths * 12 + kitchens * 6, label: "Water supply lines", unitHint: "rmt" });
  add({ section: "Plumbing", keywords: ["pvc pipe", "drainage", "soil pipe"], qty: baths * 8, label: "Drainage lines", unitHint: "rmt" });
  if (spec.oht) add({ section: "Plumbing", keywords: ["overhead tank", "water tank", "sintex"], qty: 1, label: "Overhead tank", unitHint: "nos" });
  if (spec.sump) add({ section: "Plumbing", keywords: ["sump", "underground tank"], qty: 1, label: "Underground sump", unitHint: "nos" });
  if (spec.pump) add({ section: "Plumbing", keywords: ["pump", "motor"], qty: 1, label: "Water pump", unitHint: "nos" });

  // --- Waterproofing --------------------------------------------------------
  if (spec.wp_terrace) add({ section: "Waterproofing", keywords: ["waterproofing", "terrace", "app membrane"], qty: footprintSqm, label: "Terrace waterproofing", unitHint: "sqm" });
  if (spec.wp_bath) add({ section: "Waterproofing", keywords: ["waterproofing", "bathroom", "coating"], qty: baths * 8, label: "Bathroom waterproofing", unitHint: "sqm" });

  // --- External -------------------------------------------------------------
  if (spec.compound_wall) add({ section: "External", keywords: ["compound wall", "boundary wall"], qty: perimeterM * 1.5, label: "Compound wall", unitHint: "sqm" });
  if (spec.gate) add({ section: "External", keywords: ["gate", "m.s. gate"], qty: 1, label: "Main gate", unitHint: "nos" });
  if (spec.driveway) add({ section: "External", keywords: ["paver", "driveway", "interlocking"], qty: footprintSqm * 0.3, label: "Driveway paving", unitHint: "sqm" });

  return out;
}
