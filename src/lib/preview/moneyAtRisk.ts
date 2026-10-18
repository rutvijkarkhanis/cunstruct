// Money-at-risk ordering for the verify queue (B5 logic, PREVIEW ONLY).
//
//   risk ₹ = uncertainty(quantity state, review state) × rate × quantity
//
// The uncertainty score is a stated assumption, not a measured error rate: no
// calibration exists until a real benchmark (E2) does. Lines whose ₹ exposure
// cannot be computed are never given a number:
//   - a pending quantity is unknown, so it has no ₹ risk; it is listed first,
//     because it blocks sign-off, ordered by rate (the larger the rate, the
//     more a wrong guess would cost);
//   - a line with no DSR match has no rate; it is listed after the priced lines
//     and counted, never treated as ₹0.
import { lineAmount, type EngineLine, type ReviewState } from "./types";

/** Uncertainty per review state for an established quantity (assumption; see header). */
export const UNCERTAINTY: Record<ReviewState, number> = {
  needs_review: 0.5, // machine or unreviewed quantity
  accepted: 0.1, // accepted without change: the reviewer may have missed an error
  corrected: 0.05, // typed over by a reviewer
  verified: 0, // checked against the drawing
};

export type RiskReason =
  | "PENDING_QUANTITY" // no established quantity: blocks sign-off, no ₹ figure
  | "NO_DSR_MATCH" // no rate: market rate needed, excluded from ₹ figures
  | "KEY_ITEM" // amount ≥ materiality threshold: 100% review, never sampled
  | "UNREVIEWED" // still needs review
  | "ACCEPTED_UNCHANGED" // accepted without correction
  | "CORRECTED" // reviewer typed over the quantity
  | "VERIFIED" // checked against the drawing
  | "CONFIRMED_ZERO"; // a confirmed zero: ₹0 at risk, still shown

export type RiskBand = "unquantified" | "priced" | "unpriced";

export interface RankedLine {
  line: EngineLine;
  rank: number;
  band: RiskBand;
  /** Line amount, or null when it cannot be priced. */
  amount: number | null;
  uncertainty: number | null;
  /** uncertainty × amount, or null when the amount is unknown. */
  riskRs: number | null;
  isKey: boolean;
  reasons: RiskReason[];
}

export interface MoneyAtRiskResult {
  ranked: RankedLine[];
  /** Sum of riskRs over priced lines. */
  totalRiskRs: number;
  /** Lines left out of ₹ figures: pending quantity, or no DSR match. */
  excluded: { pending: number; noRate: number };
  materialityThreshold: number;
}

const BAND_ORDER: Record<RiskBand, number> = { unquantified: 0, priced: 1, unpriced: 2 };

function reasonsFor(l: EngineLine, isKey: boolean): RiskReason[] {
  const r: RiskReason[] = [];
  if (l.quantityState === "pending") r.push("PENDING_QUANTITY");
  if (l.rate == null) r.push("NO_DSR_MATCH");
  if (isKey) r.push("KEY_ITEM");
  if (l.quantityState === "confirmed_zero") r.push("CONFIRMED_ZERO");
  r.push(({ needs_review: "UNREVIEWED", accepted: "ACCEPTED_UNCHANGED", corrected: "CORRECTED", verified: "VERIFIED" } as const)[l.reviewState]);
  return r;
}

/**
 * Rank lines by money at risk. Deterministic: band, then risk ₹ (desc), then
 * amount (desc), then rate (desc), then id (asc).
 * @param materialityThreshold ₹; a line whose amount is ≥ this is a key item.
 */
export function rankByMoneyAtRisk(lines: EngineLine[], materialityThreshold: number): MoneyAtRiskResult {
  if (!Number.isFinite(materialityThreshold) || materialityThreshold <= 0) throw new Error("materialityThreshold must be a positive ₹ amount");
  const rows = lines.map((line) => {
    const amount = lineAmount(line);
    const band: RiskBand = line.quantityState === "pending" ? "unquantified" : amount == null ? "unpriced" : "priced";
    const uncertainty = band === "priced" ? UNCERTAINTY[line.reviewState] : null;
    const riskRs = band === "priced" ? Math.round(uncertainty! * amount!) : null;
    const isKey = amount != null && amount >= materialityThreshold;
    return { line, band, amount, uncertainty, riskRs, isKey, reasons: reasonsFor(line, isKey), rank: 0 };
  });
  rows.sort((a, b) =>
    BAND_ORDER[a.band] - BAND_ORDER[b.band]
    || (b.riskRs ?? -1) - (a.riskRs ?? -1)
    || (b.amount ?? -1) - (a.amount ?? -1)
    || (b.line.rate ?? -1) - (a.line.rate ?? -1)
    || (a.line.id < b.line.id ? -1 : a.line.id > b.line.id ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return {
    ranked: rows,
    totalRiskRs: rows.reduce((s, r) => s + (r.riskRs ?? 0), 0),
    excluded: {
      pending: rows.filter((r) => r.band === "unquantified").length,
      noRate: rows.filter((r) => r.line.quantityState !== "pending" && r.line.rate == null).length,
    },
    materialityThreshold,
  };
}

export const REASON_LABEL: Record<RiskReason, string> = {
  PENDING_QUANTITY: "Quantity pending — no ₹ figure",
  NO_DSR_MATCH: "No DSR match: market rate needed",
  KEY_ITEM: "Key item — 100% review",
  UNREVIEWED: "Not yet reviewed",
  ACCEPTED_UNCHANGED: "Accepted without change",
  CORRECTED: "Corrected by reviewer",
  VERIFIED: "Verified against drawing",
  CONFIRMED_ZERO: "Confirmed zero",
};
