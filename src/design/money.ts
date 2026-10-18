/**
 * Money and quantity formatting for the design system (plan item D1).
 *
 *  - Grids use full rupees with Indian digit grouping: ₹12,34,567.
 *  - Summaries may use the compact lakh/crore form: ₹4.82 Cr, ₹38.6 L.
 *  - A missing value is "—" (em dash), NEVER 0: an unknown amount or
 *    quantity must not read as a real zero (CLAUDE.md: never invent
 *    quantities; keep uncertain items unresolved).
 */

/** The em dash shown for a missing / unresolved value. */
export const MISSING = "—";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const LAKH = 1e5;
const CRORE = 1e7;

type Maybe = number | null | undefined;

function isNumber(n: Maybe): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Avoid "-₹0" for tiny negatives that round to zero. */
function noNegativeZero(n: number, fractionDigits: number): number {
  return Math.abs(n) < 0.5 * 10 ** -fractionDigits ? 0 : n;
}

/** Grid format: "₹12,34,567", "-₹1,500", null → "—". Whole rupees. */
export function formatINR(n: Maybe): string {
  if (!isNumber(n)) return MISSING;
  return INR.format(noNegativeZero(n, 0));
}

/**
 * Summary format with lakh / crore units: "₹4.82 Cr", "₹38.6 L".
 * Three significant figures (integer crores from ₹100 Cr up); amounts under
 * ₹1 L fall back to the full grid format. null → "—".
 */
export function formatINRCompact(n: Maybe): string {
  if (!isNumber(n)) return MISSING;
  const abs = Math.abs(n);
  if (Math.round(abs) < LAKH) return formatINR(n);
  // Round to 3 significant figures BEFORE picking the unit, so 99,96,000
  // becomes "₹1.00 Cr" rather than "₹100.0 L".
  const r = abs >= 100 * CRORE ? Math.round(abs / CRORE) * CRORE : Number(abs.toPrecision(3));
  const [unit, label] = r >= CRORE ? [CRORE, "Cr"] : [LAKH, "L"];
  const v = r / unit;
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  const body = new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  return `${n < 0 ? "-" : ""}₹${body} ${label}`;
}

/**
 * Quantity format: Indian grouping, a FIXED number of decimals so a column
 * of tabular figures lines up ("1,234.50"). null → "—", never "0".
 */
export function formatQuantity(n: Maybe, decimals = 2): string {
  if (!isNumber(n)) return MISSING;
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
    noNegativeZero(n, decimals),
  );
}

/** Well-formed grouping of the integer part: Indian ("12,34,567") or international ("1,234,567"). */
const GROUPED_INT = /^(\d{1,2}(,\d{2})*,\d{3}|\d{1,3}(,\d{3})+)$/;

/**
 * Parse user input that may contain Indian grouping commas ("12,34,567.5").
 * Commas are accepted only as well-formed grouping: "4,5" is rejected, not
 * read as 45, so a comma typed as a decimal point never becomes 10× the value.
 */
export function parseNumericInput(raw: string): number | null {
  const t = raw.trim();
  if (t.includes(",") && !GROUPED_INT.test(t.replace(/^-/, "").split(".")[0])) return null;
  const s = t.replace(/,/g, "");
  if (s === "" || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
