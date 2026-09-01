// Quantity methodology + status domain model.
//
// This layer answers "HOW is a BOQ item measured?" independently of any
// coverage ratio. It exists so the engine can distinguish a genuinely
// count-based item (a door, a WC) from one that is measured by running length
// (a kitchen counter, a wardrobe) or area (flooring, waterproofing) — and so an
// item whose geometry is unavailable can be marked PENDING with the CORRECT
// methodology, instead of being forced to a meaningless "1 nos".
//
// Nothing here invents a quantity or a ratio. Classification is a measurement
// TYPE, not a number.

/**
 * The fundamental way a quantity is arrived at.
 *   COUNT         — discrete objects (doors, WCs, sockets)
 *   AREA          — a measured surface (flooring, wall tiles, waterproofing)
 *   LENGTH        — a running length (skirting, counters, wardrobes, pipe)
 *   VOLUME        — a measured volume (brickwork, concrete)
 *   WEIGHT        — a weight (reinforcement / steel)
 *   COVERAGE      — a consumption ratio against another measure (putty, paint)
 *   DERIVED       — computed from other measured quantities
 *   SPECIFICATION — quoted against a spec, not a geometric measure (lift, HVAC)
 *   PENDING       — methodology unknown / not yet classified
 */
export type QuantityMethod =
  | "COUNT"
  | "AREA"
  | "LENGTH"
  | "VOLUME"
  | "WEIGHT"
  | "COVERAGE"
  | "DERIVED"
  | "SPECIFICATION"
  | "PENDING";

/**
 * The provenance/confidence of a produced quantity.
 *   MEASURED       — actual geometry produced the number
 *   COUNTED        — a discrete object/schedule produced the number
 *   DERIVED        — calculated from other measured quantities
 *   ESTIMATED      — a configured coverage/consumption rule produced the number
 *   PENDING        — applies/detected, but insufficient information to quantify
 *   NOT_APPLICABLE — the item/scope does not apply
 */
export type QuantityStatus =
  | "MEASURED"
  | "COUNTED"
  | "DERIVED"
  | "ESTIMATED"
  | "PENDING"
  | "NOT_APPLICABLE";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * Everything a quantity can carry about HOW it was arrived at. A quantity of
 * `null` is legitimate and means "not quantifiable yet" (status PENDING) — it is
 * never silently coerced to 1.
 */
export interface QuantityEvidence {
  method: QuantityMethod;
  status: QuantityStatus;
  qty: number | null;
  unit: string;
  /** Human-readable derivation, e.g. "Door schedule D1" or "340 wall sq.ft × 0.02". */
  basis?: string;
  /** Why a quantity is PENDING, e.g. "Running length unavailable". */
  reason?: string;
  /** Source drawing/schedule reference. */
  source?: string;
  confidence?: Confidence;
}

/** The unit a methodology is naturally expressed in when the item sets none. */
const CANONICAL_UNIT: Record<QuantityMethod, string> = {
  COUNT: "nos",
  AREA: "sq.ft",
  LENGTH: "rft",
  VOLUME: "cft",
  WEIGHT: "kg",
  COVERAGE: "",       // coverage rules carry their own unit
  DERIVED: "",
  SPECIFICATION: "job",
  PENDING: "",
};

export function canonicalUnit(method: QuantityMethod): string {
  return CANONICAL_UNIT[method];
}

// Keyword → methodology. First match wins, so specific patterns precede generic
// ones. These are measurement TYPES only — no ratios, no quantities. The list
// deliberately covers the items the Srikakulam architectural set surfaces that
// were previously mis-counted as "1 nos" (counters, wardrobes, storage,
// balconies, greenscape, decks, façade).
const METHOD_RULES: [RegExp, QuantityMethod][] = [
  // ── SPECIFICATION — systems quoted against a spec, not a geometric measure ──
  [/\b(lift|elevator|escalator|travelator)/i, "SPECIFICATION"],
  [/\b(hvac|chiller|vrv|vrf|ahu|cassette unit|package unit)/i, "SPECIFICATION"],
  [/\b(fire fighting|sprinkler system|hydrant|fire pump)/i, "SPECIFICATION"],
  [/\b(stp|wtp|sewage treatment|water treatment|softener plant)/i, "SPECIFICATION"],
  [/\b(dg set|generator|transformer|solar (system|plant)|bms)/i, "SPECIFICATION"],

  // ── LENGTH — running-length joinery, linear finishes and linear services ──
  // Counters / platforms (kitchen, wet kitchen, vanity) are measured in rft.
  [/\b(counter|countertop|platform|kitchen slab|kitchen top|island)/i, "LENGTH"],
  [/\b(wardrobe|robe|dress(ing)? unit|wic\b|walk[- ]?in)/i, "LENGTH"],
  [/\b(overhead storage|utility storage|loft|storage unit|study unit|crockery unit)/i, "LENGTH"],
  [/\b(skirting|coping|cornice|beading|railing|handrail|balustrade|ledge)/i, "LENGTH"],
  [/\b(kitchen dado|dado)/i, "AREA"], // dado is a wall area, not a length — keep above generic pipe
  [/\b(cpvc|upvc|pipe|piping|plumbing line|conduit run|gi pipe|drain line)/i, "LENGTH"],

  // ── COUNT — discrete objects, fixtures, fittings, symbols on a schedule ──
  // Stems match leading-boundary only, so plurals/compounds (Doors, Windows,
  // Sockets) classify the same as their singular.
  [/\b(wc|water closet|closet|toilet|urinal|cistern)/i, "COUNT"],
  [/\b(wash ?basin|basin|sink|faucet|tap|mixer|cp fitting|health faucet|shower head)/i, "COUNT"],
  [/\b(geyser|water heater|exhaust fan)/i, "COUNT"],
  [/\b(door|shutter|ventilator|window)/i, "COUNT"],
  [/\b(switch|socket|point|db box|distribution board|mcb|rccb|isolator)/i, "COUNT"],
  [/\b(light|led|lamp|luminaire|fan|bell push|doorbell)/i, "COUNT"],
  [/\b(hinge|handle|tower bolt|aldrop|lock)/i, "COUNT"],

  // ── WEIGHT — reinforcement / structural steel ──
  [/\b(tmt|rebar|reinforc|structural steel|ms steel|steel)/i, "WEIGHT"],

  // ── VOLUME — masonry and cast concrete ──
  [/\b(brick|block|aac|masonry)/i, "VOLUME"],
  [/\b(pcc|rcc|concrete|footing|foundation|column|beam|raft|screed)/i, "VOLUME"],

  // ── COVERAGE — consumption ratios (paint, putty, adhesive, cement, sand) ──
  [/\b(putty|primer|emulsion|paint|distemper|enamel|texture|sealer|coating)/i, "COVERAGE"],
  [/\b(tile adhesive|adhesive|cement|sand|aggregate|grit|admixture)/i, "COVERAGE"],
  [/\b(waterproof(ing)? (chemical|coat|membrane)|epoxy)/i, "COVERAGE"],

  // ── AREA — measured surfaces ──
  [/\b(flooring|floor tiles?|vitrified|marble|granite|tiles?|cladding)/i, "AREA"],
  [/\b(plaster|false ceiling|gypsum|pop ceiling|ceiling)/i, "AREA"],
  [/\b(waterproofing|glazing|façade|facade|partition|wall panel)/i, "AREA"],
  [/\b(balcony|terrace|deck|greenscape|green ?pocket|landscape|paving|driveway|parking)/i, "AREA"],
];

/**
 * Classify the measurement methodology for an item by name (with optional
 * category hint). Returns PENDING when nothing matches — i.e. we honestly do
 * not know how to measure it yet, which is preferable to a wrong assumption.
 */
export function classifyMethod(name?: string | null, category?: string | null): QuantityMethod {
  const hay = `${name ?? ""} ${category ?? ""}`;
  for (const [re, method] of METHOD_RULES) {
    if (re.test(hay)) return method;
  }
  return "PENDING";
}

/** A plain-language reason for a PENDING quantity, tailored to its methodology. */
export function pendingReason(method: QuantityMethod): string {
  switch (method) {
    case "LENGTH":
      return "Running length unavailable from supplied information";
    case "AREA":
      return "Area unavailable from supplied information";
    case "VOLUME":
      return "Volume unavailable — structural/geometry information required";
    case "WEIGHT":
      return "Weight unavailable — structural drawings required";
    case "COUNT":
      return "Count unavailable — schedule or marked drawing required";
    case "SPECIFICATION":
      return "Specification required to quantify";
    case "COVERAGE":
      return "No coverage rule configured for this item";
    default:
      return "Insufficient information to quantify reliably";
  }
}
