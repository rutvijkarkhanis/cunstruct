// Curated DSR catalog — the single source of truth for what a residential BOQ
// pulls in. Each entry names an EXACT, verified DSR 2023 code (no fuzzy keyword
// matching, which used to grab bridge piers and raised-access-floor systems) and
// a quantity formula that returns the quantity in THAT code's own unit, so the
// AOR explosion downstream is meaningful.
//
// Codes were hand-verified against supabase/migrations/20260731001000_dsr_seed_civil.sql.
// boqDsrCatalog.test.ts asserts every code here exists in that seed.

import type { Spec } from "./boqSpec";

/** Everything a quantity formula needs, derived once from spec + project basics. */
export interface QtyContext {
  builtUpSqft: number;
  floors: number;
  floorSqm: number;     // total built-up area, m²
  footprintSqm: number; // ground-floor footprint, m²
  wallSqm: number;      // net wall face area estimate, m²
  perimeterM: number;   // building perimeter, m
  beds: number;
  baths: number;
  kitchens: number;
  living: number;
  rooms: number;        // total keyed rooms
}

export interface CatalogItem {
  key: string;
  section: string;
  /** Exact DSR code, or a chooser that returns one based on the spec. */
  code: string | ((spec: Spec) => string);
  label: string;        // fallback display if the DSR row can't be read
  unit: string;         // the DSR code's unit (documentation + sanity checks)
  /** Quantity in the code's unit. */
  qty: (c: QtyContext, spec: Spec) => number;
  /** Gate: include this line only when true (default: always). */
  when?: (spec: Spec) => boolean;
}

const SQFT_TO_SQM = 1 / 10.764;

export function buildContext(spec: Spec, project: { area_sqft: number | null; floors: number | null }): QtyContext {
  const builtUpSqft = project.area_sqft ?? 1000;
  const floors = Math.max(1, project.floors ?? 1);
  const floorSqm = builtUpSqft * SQFT_TO_SQM;
  const footprintSqm = floorSqm / floors;
  const perimeterM = 4 * Math.sqrt(Math.max(1, footprintSqm));
  const wallSqm = floorSqm * 3.0;
  const n = (k: string, d = 0) => { const v = spec[k]; return typeof v === "number" ? v : v == null ? d : Number(v) || d; };
  const beds = n("bedrooms", 2), baths = n("bathrooms", 2), kitchens = n("kitchens", 1), living = n("living", 1);
  return {
    builtUpSqft, floors, floorSqm, footprintSqm, wallSqm, perimeterM,
    beds, baths, kitchens, living,
    rooms: beds + kitchens + living + n("pooja") + n("utility"),
  };
}

const truthy = (v: unknown) => v === true || v === "true";

// Quantity heuristics (all editable in the builder; these are starting points):
//   structural concrete ≈ 0.12 m³ per m² built-up; steel ≈ 4 kg per m² (→ per code unit)
//   plaster both faces ≈ 2× wall area; flooring ≈ 0.85× built-up floor area
export const DSR_CATALOG: CatalogItem[] = [
  // ---- Substructure & structure (verified: agent A) ----------------------
  { key: "excavation", section: "Earthwork", code: "2.8.1", label: "Excavation in foundation", unit: "cum",
    qty: (c) => c.footprintSqm * 0.5 },
  { key: "pcc_bed", section: "Concrete", code: "4.1.8", label: "PCC 1:4:8 bed", unit: "cum",
    qty: (c) => c.footprintSqm * 0.1 },
  { key: "rcc", section: "RCC", code: "5.3", label: "RCC M-20 (slabs, beams, columns)", unit: "cum",
    qty: (c) => c.floorSqm * 0.4 },      // ~0.04 m³/sqft built-up (framed structure)
  { key: "reinforcement", section: "RCC", code: "5.22.6", label: "TMT reinforcement steel", unit: "kg",
    qty: (c) => c.floorSqm * 38 },       // ~95 kg per m³ of RCC ≈ 3.5 kg/sqft
  { key: "formwork", section: "RCC", code: "5.9.3", label: "Centering & shuttering", unit: "sqm",
    qty: (c) => c.floorSqm * 2.5 },
  { key: "masonry_230", section: "Masonry", code: "6.4.2", label: "230mm brick masonry CM 1:6", unit: "cum",
    qty: (c) => (c.wallSqm / 2) * 0.23, when: (s) => s.ext_wall !== "6in" },  // wallSqm counts both faces
  { key: "masonry_115", section: "Masonry", code: "6.13.1", label: "115mm brick masonry", unit: "sqm",
    qty: (c) => c.wallSqm * 0.5, when: (s) => s.ext_wall === "6in" },
  { key: "grill", section: "Doors & Windows", code: "9.48.2", label: "MS window grills", unit: "kg",
    qty: (c) => (c.rooms + c.baths) * 25, when: (s) => truthy(s.grills) },

  // ---- Flooring & tiling (verified: agent B) -----------------------------
  { key: "floor_living", section: "Flooring", label: "Living/bedroom flooring", unit: "sqm",
    code: (s) => (s.living_floor === "ceramic" ? "11.37" : "11.41.2"),  // vitrified for stone/wood until stone-floor codes added

    qty: (c) => c.floorSqm * 0.85 },
  { key: "floor_wet", section: "Flooring", code: "11.37", label: "Anti-skid ceramic (wet areas)", unit: "sqm",
    qty: (c, s) => c.baths * 6 + (Number(s.balconies) || 0) * 8 },
  { key: "skirting", section: "Flooring", code: "11.6.1", label: "Skirting", unit: "sqm",
    qty: (c) => c.floorSqm * 0.08, when: (s) => truthy(s.skirting) },

  // ---- Plaster, paint, ceiling (verified: agent B) -----------------------
  // Internal plaster and internal paint cover the same area, so they must match.
  { key: "internal_plaster", section: "Plastering", code: "13.1.2", label: "12mm internal plaster", unit: "sqm",
    qty: (c) => c.wallSqm * 0.85 },
  { key: "external_plaster", section: "Plastering", code: "13.2.1", label: "External plaster", unit: "sqm",
    qty: (c) => c.perimeterM * 3 * c.floors },
  { key: "putty", section: "Painting", code: "13.80", label: "Wall putty", unit: "sqm",
    qty: (c) => c.wallSqm * 0.85 },
  { key: "primer", section: "Painting", code: "13.85.3", label: "Interior primer", unit: "sqm",
    qty: (c) => c.wallSqm * 0.85 },
  { key: "emulsion", section: "Painting", code: "13.82.2", label: "Interior emulsion", unit: "sqm",
    qty: (c) => c.wallSqm * 0.85 },
  { key: "exterior_paint", section: "Painting", code: "13.46.1", label: "Exterior weatherproof paint", unit: "sqm",
    qty: (c) => c.perimeterM * 3 * c.floors },
  { key: "false_ceiling", section: "Ceiling", code: "12.45.1", label: "Gypsum false ceiling", unit: "sqm",
    qty: (c, s) => {
      const scope = String(s.false_ceiling ?? "none");
      const n = scope === "all" ? c.rooms : scope === "living_beds" ? c.living + c.beds : scope === "living" ? c.living : 0;
      return n * 12;
    }, when: (s) => (s.false_ceiling ?? "none") !== "none" },

  // ---- Kitchen & bath tiling (verified: agent B) -------------------------
  { key: "kitchen_platform", section: "Kitchen", code: "8.2.3.2", label: "Granite kitchen platform", unit: "sqm",
    qty: (c) => c.kitchens * 2, when: (s) => truthy(s.platform) },
  { key: "kitchen_dado", section: "Kitchen", code: "8.31", label: "Kitchen dado tiling", unit: "sqm",
    qty: (c) => c.kitchens * 6, when: (s) => truthy(s.dado) },
  { key: "bath_tiling", section: "Bathrooms", code: "8.31", label: "Bathroom wall tiling", unit: "sqm",
    qty: (c, s) => c.baths * (s.wall_tiling === "dado" ? 12 : 20) },

  // ---- Waterproofing (verified: agent B) ---------------------------------
  { key: "wp_terrace", section: "Waterproofing", code: "22.7.1", label: "Terrace waterproofing", unit: "sqm",
    qty: (c) => c.footprintSqm, when: (s) => truthy(s.wp_terrace) },
  { key: "wp_bath", section: "Waterproofing", code: "22.7.1", label: "Bathroom waterproofing", unit: "sqm",
    qty: (c) => c.baths * 8, when: (s) => truthy(s.wp_bath) },

  // ---- Doors & windows (verified: agent C) -------------------------------
  { key: "door_shutter", section: "Doors & Windows", code: "9.21.1", label: "Flush door shutters", unit: "sqm",
    qty: (c) => (c.beds + c.baths + c.kitchens + 1) * 1.8 },
  { key: "door_frame", section: "Doors & Windows", code: "9.1.1", label: "Wooden door frames", unit: "cum",
    qty: (c) => (c.beds + c.baths + c.kitchens + 1) * 0.045 },
  { key: "window_glazed", section: "Doors & Windows", code: "9.147", label: "UPVC windows", unit: "sqm",
    qty: (c) => (c.rooms + c.baths) * 1.5, when: (s) => s.windows !== "aluminium" },
  { key: "window_alu", section: "Doors & Windows", code: "21.1.2.2", label: "Aluminium windows", unit: "kg",
    qty: (c) => (c.rooms + c.baths) * 15, when: (s) => s.windows === "aluminium" },

  // ---- Sanitary & plumbing (verified: agent C; no PVC drainage / tank in DSR) ----
  { key: "wc", section: "Sanitary", code: "17.2.1", label: "European WC (pan, seat, cistern)", unit: "each",
    qty: (c) => c.baths },
  { key: "basin", section: "Sanitary", code: "17.7.3", label: "Wash basins", unit: "each",
    qty: (c) => c.baths },
  { key: "cp_fittings", section: "Sanitary", code: "18.49.1", label: "CP bib cocks / taps", unit: "each",
    qty: (c) => c.baths * 3 },
  { key: "supply_pipe", section: "Plumbing", code: "18.8.1", label: "CPVC 15mm supply pipe", unit: "metre",
    qty: (c) => c.baths * 12 + c.kitchens * 6 },
  { key: "soil_pipe", section: "Plumbing", code: "17.35.1.1", label: "Cast-iron soil pipe 100mm", unit: "metre",
    qty: (c) => c.baths * 8 },

  // ---- External (verified: agent C) --------------------------------------
  { key: "compound_wall", section: "External", code: "6.4.2", label: "Compound wall (brick masonry)", unit: "cum",
    qty: (c) => c.perimeterM * 1.8 * 0.23, when: (s) => truthy(s.compound_wall) },
  { key: "gate", section: "External", code: "10.2", label: "MS gate (fabricated steel)", unit: "kg",
    qty: () => 150, when: (s) => truthy(s.gate) },
  { key: "driveway", section: "External", code: "16.68", label: "Interlocking paver driveway", unit: "sqm",
    qty: (c) => c.footprintSqm * 0.3, when: (s) => truthy(s.driveway) },
];

// ---- Non-Schedule (NS) items -----------------------------------------------
// Trades the civil DSR does not cover (electrical, water tanks/pumps, modular
// kitchen). A real BOQ can't just drop these — it lists them as Non-Schedule
// items whose rate is to be analysed from market / State PWD rates. We emit them
// with no DSR code and no rate, grouped under a "Non-Schedule Items" heading.

export interface NsItem {
  key: string;
  trade: string;
  label: string;
  unit: string;
  qty: (c: QtyContext, spec: Spec) => number;
  when?: (spec: Spec) => boolean;
}

export const NS_CATALOG: NsItem[] = [
  { key: "elec_points", trade: "Electrical", label: "Concealed electrical wiring with light/fan/socket points, incl. switches & accessories", unit: "point",
    qty: (c, s) => c.rooms * (s.elec_density === "premium" ? 12 : s.elec_density === "basic" ? 6 : 9) },
  { key: "elec_db", trade: "Electrical", label: "MCB distribution board with MCBs/RCCB, complete", unit: "nos",
    qty: () => 1 },
  { key: "geyser_pt", trade: "Electrical", label: "Geyser power points (15A) with wiring", unit: "point",
    qty: (c) => c.baths, when: (s) => truthy(s.geyser) },
  { key: "elec_fixtures", trade: "Electrical", label: "Light fixtures, fans & fittings (supply & installation)", unit: "nos",
    qty: (c) => c.rooms * 4, when: (s) => truthy(s.elec_fixtures) },
  { key: "oht", trade: "Water Supply", label: "Overhead water storage tank (HDPE/Sintex) with fittings", unit: "nos",
    qty: () => 1, when: (s) => truthy(s.oht) },
  { key: "sump", trade: "Water Supply", label: "Underground water sump with fittings", unit: "nos",
    qty: () => 1, when: (s) => truthy(s.sump) },
  { key: "pump", trade: "Water Supply", label: "Water pump / pressure pump set", unit: "nos",
    qty: () => 1, when: (s) => truthy(s.pump) },
  { key: "modular", trade: "Kitchen", label: "Modular kitchen units (base + wall cabinets + accessories)", unit: "job",
    qty: () => 1, when: (s) => truthy(s.modular) },
];

// ---- Construction-stage taxonomy -------------------------------------------
// A real BOQ is read by stage (the sequence a site is built in), with the DSR
// sub-head / trade as the "type of work" within each stage. Stage is derived
// from a line's DSR code, so it needs no extra column and covers manual lines
// (added from the catalog browser) via a chapter fallback.

export const STAGE_ORDER = [
  "Site & Earthwork", "Foundation & Footings", "RCC Superstructure", "Masonry",
  "Waterproofing", "Internal Plumbing", "Plastering", "Flooring & Tiling",
  "Doors & Windows", "False Ceiling", "Painting", "Sanitary & Fixtures",
  "External Works", "Non-Schedule Items", "Other Works",
];

const SECTION_STAGE: Record<string, string> = {
  "Earthwork": "Site & Earthwork", "Concrete": "Foundation & Footings", "RCC": "RCC Superstructure",
  "Masonry": "Masonry", "Waterproofing": "Waterproofing", "Plumbing": "Internal Plumbing",
  "Plastering": "Plastering", "Flooring": "Flooring & Tiling", "Kitchen": "Flooring & Tiling",
  "Bathrooms": "Flooring & Tiling", "Doors & Windows": "Doors & Windows", "Ceiling": "False Ceiling",
  "Painting": "Painting", "Sanitary": "Sanitary & Fixtures", "External": "External Works",
};

// Coarse fallback by DSR chapter number, for manually-added lines not in the catalog.
const CHAPTER_STAGE: Record<string, string> = {
  "1": "Site & Earthwork", "2": "Site & Earthwork", "3": "Foundation & Footings", "4": "Foundation & Footings",
  "5": "RCC Superstructure", "6": "Masonry", "7": "Masonry", "8": "Flooring & Tiling", "9": "Doors & Windows",
  "10": "Doors & Windows", "11": "Flooring & Tiling", "12": "False Ceiling", "13": "Painting",
  "16": "External Works", "17": "Sanitary & Fixtures", "18": "Internal Plumbing", "19": "Internal Plumbing",
  "21": "Doors & Windows", "22": "Waterproofing",
};

const CODE_SECTION: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const specs: Spec[] = [{}, { living_floor: "ceramic" }, { living_floor: "vitrified" }, { windows: "aluminium" }, { windows: "upvc" }];
  // Keep the first occurrence — a code reused across sections (e.g. brick
  // masonry 6.4.2 for both walls and compound wall) resolves to its primary use.
  const put = (code: string, section: string) => { if (!(code in m)) m[code] = section; };
  for (const it of DSR_CATALOG) {
    if (typeof it.code === "string") put(it.code, it.section);
    else for (const s of specs) put(it.code(s), it.section);
  }
  return m;
})();

/** Map a DSR code to the construction stage it belongs to. */
export function stageForCode(code: string | null | undefined): string {
  if (!code) return "Other Works";
  const sec = CODE_SECTION[code];
  if (sec && SECTION_STAGE[sec]) return SECTION_STAGE[sec];
  return CHAPTER_STAGE[code.split(".")[0]] ?? "Other Works";
}

