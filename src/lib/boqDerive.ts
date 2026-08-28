// LEVEL-2 GEOMETRIC DERIVATION.
//
// A quantity may be DERIVED — but ONLY from an explicit dimension the drawing gave.
// This is the one sanctioned exception to the strict "never manufacture a quantity"
// rule (boqEvidence.ts): a room dimension read off the plan (10'-8" × 12'-4") is
// drawing evidence, so multiplying it out to a floor area is defensible. A
// room-count or built-up-area coefficient is NOT evidence and is never derived here.
//
// Every derived value carries its `calculation` string so the architect can verify
// it, and is stamped measurement_method = "derived". Nothing is rounded away or
// invented: a dimension we cannot parse yields no derivation (the item stays pending),
// never a guess.

import type { DrawingItem, MeasurementMethod } from "./boqDrawing";

export interface EvalMeasurementLike {
  label?: string;
  value?: string;
  location?: string;
  note?: string;
}

/** Parse a single feet/inches token to decimal feet. Accepts the shapes drawings and
 *  ChatGPT/iPhone exports actually produce:
 *    10'-8"   10' 8"   10'8"   10'   10 ft   10.5'   10.5 ft   8" (inches only)   10
 *  Straight OR curly quotes/primes are accepted. Returns null if nothing numeric is
 *  present (so we never derive from an unreadable dimension). */
export function parseFeet(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  // Normalise curly primes/quotes to straight, collapse whitespace.
  const s = String(raw)
    .replace(/[′’‵ʹ´`]/g, "'")   // ′ ’ ‵ ʹ ´ ` → '
    .replace(/[″”‶〃ʺ]/g, '"')     // ″ ” ‶ 〃 ʺ → "
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  // feet + inches: 10'-8"  /  10' 8"  /  10'8"  /  10' - 8 "
  let m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"?$/);
  if (m) return Number(m[1]) + Number(m[2]) / 12;

  // feet only: 10'  /  10 ft  /  10 feet  /  10.5'
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)$/i);
  if (m) return Number(m[1]);

  // inches only: 8"  /  8 in  /  8 inch
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)$/i);
  if (m) return Number(m[1]) / 12;

  // bare number — treat as feet (drawings quote room sizes in feet).
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]);

  return null;
}

/** The two size tokens either side of a × / x / X / * separator. Tolerates the
 *  ASCII "x", the multiplication sign "×", and stray spacing. Returns null unless
 *  BOTH sides parse to a positive length. */
export function parseDimensionPair(raw: string | null | undefined): { a: number; b: number } | null {
  if (!raw) return null;
  const parts = String(raw).split(/\s*[x×X*]\s*/);
  if (parts.length !== 2) return null;
  const a = parseFeet(parts[0]);
  const b = parseFeet(parts[1]);
  if (a == null || b == null || a <= 0 || b <= 0) return null;
  return { a, b };
}

/** Pretty a decimal-feet length back to feet-inches for the calculation string, e.g.
 *  10.667 → 10'-8". Whole feet render without an inch part. */
export function feetToText(ft: number): string {
  const whole = Math.floor(ft + 1e-9);
  const inches = Math.round((ft - whole) * 12);
  if (inches === 0) return `${whole}'`;
  if (inches === 12) return `${whole + 1}'`;
  return `${whole}'-${inches}"`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Derive a floor/wall area (sqft) from an explicit "L × W" dimension string.
 *  Returns the area and a human-readable calculation, or null if the string does not
 *  carry two readable lengths. Never guesses. */
export function deriveArea(dimension: string | null | undefined): { qty: number; unit: "sqft"; calculation: string } | null {
  const pair = parseDimensionPair(dimension);
  if (!pair) return null;
  const area = round2(pair.a * pair.b);
  return { qty: area, unit: "sqft", calculation: `${feetToText(pair.a)} × ${feetToText(pair.b)} = ${area} sqft` };
}

// A requirement whose quantity is naturally an AREA (so an L×W derivation applies).
// Keyed on the kind of work, not on specific product names.
const AREA_WORK = /\b(floor(?:ing)?|tile[sd]?|tiling|skirting|dado|marble|granite|vitrified|screed|plaster|putty|paint(?:ing)?|emulsion|primer|false\s*ceiling|ceiling\s*(?:work|finish|gypsum|pop)|cladding|water\s*proofing|waterproofing)\b/i;
// …but NOT these look-alikes, which are counts/points, not areas.
const AREA_WORK_EXCLUDE = /\b(floor\s*(?:trap|drain|point|box|spring|outlet|lamp)|ceiling\s*(?:lamp|light|fan|point|rose))\b/i;

/** Does this requirement measure an area (so a room L×W derivation is meaningful)? */
export function isAreaRequirement(label: string): boolean {
  const l = label || "";
  return AREA_WORK.test(l) && !AREA_WORK_EXCLUDE.test(l);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Does a room-dimension measurement's location refer to the same space a
 *  requirement is scoped to? Matches on shared significant word(s) — "Master
 *  Bedroom" ↔ "Master Bedroom flooring". Conservative: needs a real token overlap,
 *  not a substring coincidence. */
function sameSpace(measurementLocation: string | undefined, requirement: DrawingItem): boolean {
  const loc = norm(measurementLocation ?? "");
  if (!loc) return false;
  const hay = norm([requirement.note, requirement.match].filter(Boolean).join(" "));
  const stop = new Set(["room", "the", "and", "of", "area", "flooring", "floor", "wall", "ceiling"]);
  const tokens = loc.split(" ").filter((t) => t.length > 2 && !stop.has(t));
  if (!tokens.length) return false;
  return tokens.every((t) => hay.includes(t));
}

/**
 * DERIVE area quantities for pending, area-based requirements from explicit room
 * dimensions in the evaluation's measurements[].
 *
 * A requirement is upgraded from pending → derived ONLY when:
 *   • it is area-based (isAreaRequirement) and currently has no defensible quantity, AND
 *   • exactly one room-dimension measurement resolves to the same space (sameSpace).
 * The derived quantity is the L×W area, the unit becomes sqft, measurement_method is
 * "derived", and `calculation` records the arithmetic. If two or more dimensions could
 * apply (ambiguous) or none do, the requirement is left pending — never guessed.
 *
 * Pure and idempotent: an already-quantified requirement is returned untouched, so a
 * counted value is never overwritten by a derivation.
 */
export function deriveAreaQuantities(items: DrawingItem[], measurements: EvalMeasurementLike[] | undefined): DrawingItem[] {
  const dims = (measurements ?? [])
    .map((m) => ({ loc: m.location, area: deriveArea(m.value) }))
    .filter((d): d is { loc: string | undefined; area: NonNullable<ReturnType<typeof deriveArea>> } => !!d.area);
  if (!dims.length) return items;

  return items.map((it) => {
    const hasQty = it.qty != null && Number.isFinite(it.qty) && (it.qty as number) > 0;
    if (hasQty || !isAreaRequirement(it.match)) return it;   // never overwrite a real count; only area work
    const applicable = dims.filter((d) => sameSpace(d.loc, it));
    if (applicable.length !== 1) return it;                   // ambiguous or unmatched → stay pending
    const { area } = applicable[0];
    return {
      ...it,
      qty: area.qty,
      unit: "sqft",
      pending: false,
      basis: "Derived",
      measurement_method: "derived" as MeasurementMethod,
      calculation: area.calculation,
    };
  });
}
