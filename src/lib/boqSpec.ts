// The BOQ questionnaire — the parameters that decide WHICH DSR items get pulled
// into a project's BOQ and HOW their quantities are computed. Data-driven so the
// questionnaire is easy to expand: add a field here and it renders + saves itself.
//
// The captured answers live in `boq.spec` (jsonb). Generation reads this spec to
// select DSR items (e.g. flooring=granite → pull the granite flooring DSR codes)
// and to size quantities (e.g. false_ceiling=living → ceiling area of living).

export type FieldType = "select" | "toggle" | "number";
export type SpecValue = string | number | boolean | undefined;
export type Spec = Record<string, SpecValue>;

export interface SpecField {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  suffix?: string;
  help?: string;
}
export interface SpecSection {
  key: string;
  title: string;
  hint?: string;
  fields: SpecField[];
}

const sel = (value: string, label: string) => ({ value, label });
const TIER = [sel("economy", "Economy"), sel("standard", "Standard"), sel("premium", "Premium")];

export const BOQ_SPEC: SpecSection[] = [
  {
    key: "building", title: "Building", hint: "Drives the structural quantities.",
    fields: [
      { key: "structure", label: "Structure type", type: "select", default: "rcc_framed",
        options: [sel("rcc_framed", "RCC framed"), sel("load_bearing", "Load-bearing")] },
      { key: "quality_tier", label: "Overall quality", type: "select", default: "standard", options: TIER,
        help: "Sets default finishes and the wastage buffer." },
      { key: "plot_area", label: "Plot area", type: "number", suffix: "sqft" },
      { key: "flats_per_floor", label: "Flats / units per floor", type: "number", default: 1,
        help: "For multi-unit buildings; drives project-size context on the BOQ." },
      { key: "wall_material", label: "Wall material", type: "select", default: "red_brick",
        options: [sel("red_brick", "Red brick"), sel("aac_block", "AAC block"), sel("fly_ash", "Fly-ash brick")] },
      { key: "ext_wall", label: "External wall", type: "select", default: "9in",
        options: [sel("9in", '9" thick'), sel("6in", '6" thick')] },
    ],
  },
  {
    key: "rooms", title: "Rooms", hint: "Counts drive finishing, electrical and plumbing quantities.",
    fields: [
      { key: "bedrooms", label: "Bedrooms", type: "number", default: 2 },
      { key: "bathrooms", label: "Bathrooms", type: "number", default: 2 },
      { key: "kitchens", label: "Kitchens", type: "number", default: 1 },
      { key: "living", label: "Living / dining", type: "number", default: 1 },
      { key: "balconies", label: "Balconies", type: "number", default: 1 },
      { key: "pooja", label: "Pooja / study", type: "number", default: 0 },
      { key: "utility", label: "Utility", type: "number", default: 0 },
    ],
  },
  {
    key: "flooring", title: "Flooring & tiling",
    fields: [
      { key: "living_floor", label: "Living / bedrooms", type: "select", default: "vitrified",
        options: [sel("vitrified", "Vitrified"), sel("ceramic", "Ceramic"), sel("granite", "Granite"), sel("marble", "Marble"), sel("wood", "Wooden")] },
      { key: "wet_floor", label: "Bath / balcony", type: "select", default: "antiskid",
        options: [sel("antiskid", "Anti-skid ceramic"), sel("granite", "Granite")] },
      { key: "skirting", label: "Skirting", type: "toggle", default: true },
    ],
  },
  {
    key: "walls", title: "Walls & ceiling",
    fields: [
      { key: "interior", label: "Interior walls", type: "select", default: "putty_emulsion",
        options: [sel("putty_emulsion", "Putty + emulsion"), sel("texture", "Texture finish")] },
      { key: "exterior", label: "Exterior walls", type: "select", default: "weatherproof",
        options: [sel("weatherproof", "Primer + weatherproof"), sel("texture", "Texture")] },
      { key: "false_ceiling", label: "False ceiling", type: "select", default: "living",
        options: [sel("none", "None"), sel("living", "Living only"), sel("living_beds", "Living + bedrooms"), sel("all", "All rooms")] },
    ],
  },
  {
    key: "openings", title: "Doors & windows",
    fields: [
      { key: "main_door", label: "Main door", type: "select", default: "teak",
        options: [sel("teak", "Teak"), sel("flush", "Flush")] },
      { key: "internal_doors", label: "Internal doors", type: "select", default: "flush",
        options: [sel("flush", "Flush"), sel("wpc", "WPC"), sel("panel", "Panel")] },
      { key: "windows", label: "Windows", type: "select", default: "upvc",
        options: [sel("upvc", "UPVC"), sel("aluminium", "Aluminium"), sel("wood", "Wooden")] },
      { key: "grills", label: "Window grills", type: "toggle", default: true },
    ],
  },
  {
    key: "kitchen", title: "Kitchen",
    fields: [
      { key: "platform", label: "Granite platform", type: "toggle", default: true },
      { key: "dado", label: "Dado tiling", type: "toggle", default: true },
      { key: "modular", label: "Modular units", type: "toggle", default: false },
    ],
  },
  {
    key: "bath", title: "Bathrooms",
    fields: [
      { key: "cp_tier", label: "CP fittings", type: "select", default: "standard", options: TIER },
      { key: "wall_tiling", label: "Wall tiling", type: "select", default: "full",
        options: [sel("full", "Full height (7 ft)"), sel("dado", "Dado (4 ft)")] },
      { key: "geyser", label: "Geyser point / bath", type: "toggle", default: true },
    ],
  },
  {
    key: "mep", title: "Electrical & plumbing",
    fields: [
      { key: "elec_density", label: "Electrical points", type: "select", default: "standard",
        options: [sel("basic", "Basic"), sel("standard", "Standard"), sel("premium", "Premium")] },
      { key: "elec_fixtures", label: "Include fans / lights", type: "toggle", default: false },
      { key: "oht", label: "Overhead tank", type: "toggle", default: true },
      { key: "sump", label: "Underground sump", type: "toggle", default: true },
      { key: "pump", label: "Water pump", type: "toggle", default: true },
    ],
  },
  {
    key: "external", title: "External & waterproofing",
    fields: [
      { key: "compound_wall", label: "Compound wall", type: "toggle", default: false },
      { key: "gate", label: "Main gate", type: "toggle", default: false },
      { key: "driveway", label: "Driveway paving", type: "toggle", default: false },
      { key: "wp_terrace", label: "Terrace waterproofing", type: "toggle", default: true },
      { key: "wp_bath", label: "Bathroom waterproofing", type: "toggle", default: true },
    ],
  },
];

/** Build the default spec object from the config (used to seed a new BOQ). */
export function defaultSpec(seed?: Spec): Spec {
  const out: Spec = {};
  for (const s of BOQ_SPEC) for (const f of s.fields) if (f.default !== undefined) out[f.key] = f.default;
  return { ...out, ...(seed ?? {}) };
}
