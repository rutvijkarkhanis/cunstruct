// Price first (plan B4, built in the owner-only preview lane of plan v1.2 —
// not commercially complete). Before verification starts, every BOQ line gets
// either a provisional DSR 2023 rate or an explicit "no DSR match: market rate
// needed". Rates come from the catalogue the app holds; they are labelled
// provisional because the catalogue has not been checked against the CPWD
// documents (plan E3), and no cost index is applied because none is confirmed.
import type { DsrItem } from "@/lib/dsr/catalogue";
import type { DsrIndex } from "@/lib/dsr/match";
import { pricedAmount, quantityState, type QuantityFields, type QuantityState } from "@/lib/quantity";
import { buildPricingIndex, rateLine } from "./rateLine";

export const PROVISIONAL_LABEL = "Provisional — DSR 2023 catalogue, not verified against CPWD (E3)";
export const NO_MATCH_LABEL = "No DSR match: market rate needed";

export interface PriceFirstLine extends QuantityFields {
  id: string;
  description: string | null;
  unit: string | null;
  /** A DSR code the line states, if any. It is never replaced by another item. */
  dsr_code?: string | null;
}

export interface PricedLine {
  kind: "provisional_dsr";
  lineId: string;
  quantityState: QuantityState;
  code: string;
  rate: number;
  unit: string;
  basis: "stated_code" | "matcher_reliable";
  /** No cost index is confirmed (plan E3), so none is applied. */
  costIndex: null;
  label: typeof PROVISIONAL_LABEL;
  /** Whole rupees; null when the quantity is not established. */
  amount: number | null;
}

export interface NoMatchLine {
  kind: "no_match";
  lineId: string;
  quantityState: QuantityState;
  reason: string;
  /** The matcher's top candidates, for a person to review. Never a rate. */
  candidates: string[];
  label: typeof NO_MATCH_LABEL;
  amount: null;
}

export type LinePricing = PricedLine | NoMatchLine;

const isIndex = (c: DsrItem[] | DsrIndex): c is DsrIndex => !Array.isArray(c);

/** Price every line. Pass the catalogue, or an index built once with buildPricingIndex. */
export function priceFirst(lines: PriceFirstLine[], catalogue: DsrItem[] | DsrIndex): LinePricing[] {
  const ix = isIndex(catalogue) ? catalogue : buildPricingIndex(catalogue);
  return lines.map((line) => {
    const state = quantityState(line);
    const d = rateLine({ description: line.description, unit: line.unit, dsr_code: line.dsr_code }, ix);
    if (d.kind === "unrated") {
      const r: NoMatchLine = { lineId: line.id, quantityState: state, kind: "no_match", reason: d.reason, candidates: d.candidates, label: NO_MATCH_LABEL, amount: null };
      return r;
    }
    const r: PricedLine = {
      lineId: line.id, quantityState: state, kind: "provisional_dsr",
      code: d.code, rate: d.rate, unit: d.unit, basis: d.basis, costIndex: null, label: PROVISIONAL_LABEL,
      amount: pricedAmount({ qty: line.qty, quantity_status: line.quantity_status, basis: line.basis, dsr_rate: d.rate }),
    };
    return r;
  });
}

export interface PricingCoverage {
  lines: number;
  priced: number;
  noMatch: number;
  /** Priced lines whose quantity is not established: rate known, no amount. */
  pricedWithoutAmount: number;
  /** Sum of the amounts that can be stated (whole rupees). */
  pricedAmount: number;
  /** Lines the ₹ figures leave out: no match, or no established quantity. */
  excludedFromRupees: number;
  /** e.g. "₹ figures exclude 3 lines: 2 with no DSR match, 1 with no established quantity." */
  note: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function pricingCoverage(results: LinePricing[]): PricingCoverage {
  const priced = results.filter((r): r is PricedLine => r.kind === "provisional_dsr");
  const noMatch = results.length - priced.length;
  const pricedWithoutAmount = priced.filter((r) => r.amount == null).length;
  const pricedAmount = priced.reduce((s, r) => s + (r.amount ?? 0), 0);
  const excluded = noMatch + pricedWithoutAmount;
  const parts = [
    noMatch ? `${noMatch} with no DSR match` : null,
    pricedWithoutAmount ? `${pricedWithoutAmount} with no established quantity` : null,
  ].filter(Boolean);
  return {
    lines: results.length, priced: priced.length, noMatch, pricedWithoutAmount, pricedAmount, excludedFromRupees: excluded,
    note: excluded === 0
      ? "₹ figures include every line."
      : `₹ figures exclude ${plural(excluded, "line", "lines")}: ${parts.join(", ")}.`,
  };
}
