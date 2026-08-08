// Sanity bands — the trust layer. For the cost-driving items, we know the
// plausible quantity per built-up sqft (industry thumb-rules, kept generous so
// normal output never nags). A line outside its band is flagged so the estimator
// catches "steel looks low" before the contractor does — and can defend or fix it.
//
// Bands are DELIBERATELY wide plausibility ranges, not tight design values: the
// job is to catch a 10× error or a fat-fingered edit, not to second-guess a
// reasonable estimate.

interface Band { low: number; high: number; unit: string }

const BANDS: Record<string, Band> = {
  "4.1.8": { low: 0.005, high: 0.03, unit: "cum" },   // PCC
  "5.3": { low: 0.025, high: 0.07, unit: "cum" },     // RCC concrete
  "5.22.6": { low: 2.0, high: 6.0, unit: "kg" },      // reinforcement steel
  "6.4.2": { low: 0.01, high: 0.06, unit: "cum" },    // 230mm brick masonry
  "11.41.2": { low: 0.05, high: 0.10, unit: "sqm" },  // vitrified flooring
  "11.37": { low: 0.03, high: 0.10, unit: "sqm" },    // ceramic flooring
  "13.1.2": { low: 0.15, high: 0.40, unit: "sqm" },   // internal plaster
  "13.80": { low: 0.15, high: 0.40, unit: "sqm" },    // wall putty
  "13.82.2": { low: 0.15, high: 0.40, unit: "sqm" },  // emulsion paint
};

export type SanityLevel = "ok" | "low" | "high" | "none";
export interface SanityResult {
  level: SanityLevel;
  perSqft: number | null;
  message: string | null;   // ready-to-show tooltip when flagged
}

/** Check a line's quantity against its plausible band for the built-up area. */
export function sanityForCode(code: string | null, qty: number, builtUpSqft: number): SanityResult {
  const b = code ? BANDS[code] : undefined;
  if (!b || !builtUpSqft || builtUpSqft <= 0 || qty <= 0) return { level: "none", perSqft: null, message: null };
  const perSqft = qty / builtUpSqft;
  const level: SanityLevel = perSqft < b.low ? "low" : perSqft > b.high ? "high" : "ok";
  if (level === "ok") return { level, perSqft, message: null };
  const word = level === "low" ? "low" : "high";
  return {
    level, perSqft,
    message: `Looks ${word}: ${perSqft.toFixed(3)} ${b.unit}/sqft vs typical ${b.low}–${b.high} for ${builtUpSqft.toLocaleString("en-IN")} sqft built-up`,
  };
}

/** Count of flagged lines, for a header summary. */
export function countFlagged(lines: { dsr_code: string | null; qty: number; included: boolean }[], builtUpSqft: number): number {
  return lines.filter((l) => {
    if (!l.included) return false;
    const lvl = sanityForCode(l.dsr_code, l.qty, builtUpSqft).level;
    return lvl === "low" || lvl === "high";
  }).length;
}
