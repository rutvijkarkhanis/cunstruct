// The one rule that gives a BOQ line a DSR rate. Shared by the price-first
// engine (priceFirst.ts) and the E2 benchmark's ₹ weighting
// (scripts/benchmark/metrics.ts), so both price a line identically.
//
// A line is rated only by the code it states (when the matcher calls that
// code reliable for the line) or by the matcher's reliable description match,
// and only when the DSR unit equals the line's unit. Anything else is
// unpriced, with the reason. No rate is invented, no other item is
// substituted for a stated code, and no unit conversion is assumed.
import type { DsrItem } from "@/lib/dsr/catalogue";
import { buildDsrIndex, matchLine, type DsrIndex, type MatchableLine } from "@/lib/dsr/match";

/** The schedule rates come from. Cost index: none (not confirmed — plan E3). */
export const PRICING_SCHEDULE = { source: "DSR", year: "2023" } as const;

export const buildPricingIndex = (catalogue: DsrItem[]): DsrIndex =>
  buildDsrIndex(catalogue, PRICING_SCHEDULE.source, PRICING_SCHEDULE.year);

export interface RatedDecision { kind: "rated"; code: string; rate: number; unit: string; basis: "stated_code" | "matcher_reliable" }
export interface UnratedDecision { kind: "unrated"; reason: string; candidates: string[] }
export type RateDecision = RatedDecision | UnratedDecision;

const statedCode = (line: MatchableLine): string | null =>
  typeof line.dsr_code === "string" && line.dsr_code.trim() ? line.dsr_code.trim() : null;

export function rateLine(line: MatchableLine, ix: DsrIndex): RateDecision {
  const code = statedCode(line);
  const m = matchLine({ description: line.description, unit: line.unit, dsr_code: code }, ix);
  const best = m.candidates[0];
  const candidates = m.candidates.map((c) => c.item.code);
  if (code && m.basis !== "code") {
    return { kind: "unrated", reason: `Reference code ${code} is not an item in DSR ${PRICING_SCHEDULE.year}; no other item is substituted.`, candidates };
  }
  if (m.verdict !== "reliable" || !best) {
    return { kind: "unrated", reason: `${code ? `Reference code ${code}` : "Matcher"}: verdict ${m.verdict} — ${m.reasons.join(" ")}`.trim(), candidates };
  }
  if (best.unit !== "match") {
    return { kind: "unrated", reason: `DSR ${best.item.code} is in ${best.item.unit}, the line in ${line.unit}; no conversion is assumed.`, candidates };
  }
  if (best.item.rate == null) return { kind: "unrated", reason: `DSR ${best.item.code} has no rate in the seed.`, candidates };
  return { kind: "rated", code: best.item.code, rate: best.item.rate, unit: best.item.unit, basis: code ? "stated_code" : "matcher_reliable" };
}
