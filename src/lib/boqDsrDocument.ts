/**
 * Client-ready quote for the DSR BOQ, structured like a real tender BOQ:
 * grouped by DSR SUB-HEAD (type of work) in chapter order — which is also the
 * construction sequence — with items numbered per sub-head (2.01, 2.02 …), the
 * full DSR specification, and Rate/Amount per line. A separate Abstract of
 * Cost page rolls the sub-heads up through the commercial waterfall
 * (cost index → contingency → overhead → cess → GST → grand total in words).
 *
 * GST: DSR 2023 item rates already INCLUDE GST @18% — CPWD Delhi Schedule of
 * Rates 2023, Vol. 1, Preface §6.2: "The effect of GST @18% on works contract
 * has been incorporated in all items." Only lines priced at the estimator's
 * own/custom rate are exclusive of GST, so the abstract adds GST on that part
 * only (see computeCommercials).
 *
 * Overheads & profit and labour cess: DSR 2023 item rates ALSO already include
 * water charges 1%, contractor's profit & overheads 15% (CPOH) and labour cess
 * 1% — CPWD Delhi Analysis of Rates (DAR) 2023 Vol. I builds every item rate
 * that way. The abstract therefore adds `_overhead_pct` and `_cess_pct` on the
 * non-DSR part only (see computeCommercials).
 */

import { roundRupee } from "./quantity";
import { BOQ_DRAFT_DISCLAIMER } from "./boqDraftDisclaimer";

export interface QuoteItem {
  no: string;            // sub-head item serial, e.g. "2.01"
  code: string | null;   // DSR reference code
  spec: string;          // full DSR nomenclature
  qty: number;
  unit: string;
  rate: number | null;   // DSR-rated: incl. GST @18%; own/custom rate: excl. GST
  amount: number | null;
  /** Where the rate came from (lib/boqRevision RateBasis): "dsr" = the DSR 2023
   *  rate itself (GST included), "custom" = the estimator's own rate (GST
   *  excluded). Absent = not stated (e.g. a caller that does not know). */
  rateBasis?: "dsr" | "custom" | "none" | null;
  /** Scope H — drawing-source traceability, read-only passthrough of whatever the
   *  caller already resolved (e.g. OpsBoqBuilder.tsx's drawingsById lookup). Never
   *  resolved or fabricated here: absent/null means no source reference at all, and
   *  a resolved document name with no page is rendered on its own. `sourcePage` is
   *  only ever shown alongside an actual resolved `sourceDocument` name — never as a
   *  bare page number — so a caller must leave it unset when the name itself did not
   *  resolve, even if a page value exists. */
  sourceDocument?: string | null;
  sourcePage?: string | null;
  /** The quantity's recorded basis label (lib/quantity quantityProvenance), when
   *  the caller has it. Absent = the document does not state a basis for this
   *  line (e.g. a stored revision frozen before basis was captured). */
  basis?: string | null;
}
export interface QuoteSubHead {
  no: number;            // sub-head number (1, 2, 3 …)
  name: string;          // DSR sub-head / trade
  lines: QuoteItem[];
  subtotal: number;
}
export interface CommercialInputs {
  costIndexPct: number;
  contingencyPct: number;
  overheadPct: number;
  cessPct: number;
  gstPct: number;
}
export interface QuoteCommercials extends CommercialInputs {
  works: number;
  costIndexAmt: number;
  worksAdjusted: number;
  contingencyAmt: number;
  overheadAmt: number;
  subTotal: number;
  cessAmt: number;
  gstAmt: number;
  grandTotal: number;
  grandTotalWords: string;
  /** Part of `works` priced at DSR 2023 rates — GST @18% already inside the
   *  rate, so no GST is added on it. Optional only because commercials frozen
   *  in a revision before this split existed do not carry it; computeCommercials
   *  always sets it. */
  dsrWorks?: number;
  /** works − dsrWorks: priced at the estimator's own/custom rates, excl. GST. */
  nonDsrWorks?: number;
  /** The amount GST @ gstPct is charged on: the non-DSR share of the taxable
   *  value (works after cost index, contingency, overhead and cess). */
  gstBase?: number;
  /** The amount overhead @ overheadPct is charged on: the non-DSR share of the
   *  works after cost index. Absent on commercials frozen before overhead/cess
   *  were split (those charged overhead and cess on the whole works). */
  overheadBase?: number;
  /** The amount cess @ cessPct is charged on: the non-DSR share of (works after
   *  cost index + contingency) plus the overhead. Absent as for overheadBase. */
  cessBase?: number;
}

/** GST rate CPWD states is already built into every DSR 2023 item rate. */
export const DSR_GST_INCLUDED_PCT = 18;
/** The one wording every view uses for the GST already inside DSR rates. */
export const DSR_GST_INCLUDED_LABEL = `GST @${DSR_GST_INCLUDED_PCT}% — included in DSR 2023 rates (DSR 2023 preface §6.2)`;
/** Label for the GST the abstract adds. When part of the works is DSR-rated the
 *  label says the GST is on the non-DSR items only. */
export const gstAddLabel = (c: Pick<QuoteCommercials, "gstPct" | "dsrWorks">): string =>
  (c.dsrWorks ?? 0) > 0 ? `Add: GST @ ${c.gstPct}% on non-DSR items` : `Add: GST @ ${c.gstPct}%`;
/** Contractor's profit & overheads and labour cess CPWD builds into every DSR
 *  2023 item rate (DAR 2023 Vol. I: "Add 15% CPOH on Y", "Add Cess @ 1% on Z"). */
export const DSR_CPOH_INCLUDED_PCT = 15;
export const DSR_CESS_INCLUDED_PCT = 1;
/** The one wording every view uses for the overhead and cess already inside DSR rates. */
export const DSR_CPOH_CESS_INCLUDED_LABEL =
  `Overheads & profit ${DSR_CPOH_INCLUDED_PCT}% and cess ${DSR_CESS_INCLUDED_PCT}% — included in DSR 2023 rates (CPWD DAR 2023 rate build-up)`;
/** True when these commercials charge overhead/cess on the non-DSR part only
 *  (computed by this version). Commercials frozen earlier charged them on the
 *  whole works and must keep their original wording. */
const overheadSplit = (c: Pick<QuoteCommercials, "dsrWorks" | "overheadBase">) => c.dsrWorks != null && c.overheadBase != null;
/** Labels for the overhead and cess the abstract adds; "on non-DSR items" when
 *  part of the works is DSR-rated and the split applies. */
export const overheadAddLabel = (c: Pick<QuoteCommercials, "overheadPct" | "dsrWorks" | "overheadBase">): string =>
  overheadSplit(c) && (c.dsrWorks ?? 0) > 0 ? `Add: Overhead & profit @ ${c.overheadPct}% on non-DSR items` : `Add: Overhead & profit @ ${c.overheadPct}%`;
export const cessAddLabel = (c: Pick<QuoteCommercials, "cessPct" | "dsrWorks" | "overheadBase">): string =>
  overheadSplit(c) && (c.dsrWorks ?? 0) > 0 ? `Add: Labour cess @ ${c.cessPct}% on non-DSR items` : `Add: Labour cess @ ${c.cessPct}%`;
/** A requirement identified on the drawing but not yet quantified — listed for
 *  completeness, never priced (qty deliberately absent, not zero). */
export interface QuotePendingItem {
  no: string;
  spec: string;          // requirement description
  unit: string;
  /** The schedule code already chosen for it (e.g. an accepted DSR-check item), when any. */
  code?: string | null;
  note?: string;         // location / reason it is pending
  scope?: string;        // works | equipment | needs_confirmation
  /** The drawing the line came from, when known — shown like a priced line's source. */
  sourceDocument?: string | null;
  sourcePage?: string | null;
  /** Recorded quantity basis label, when known (see QuoteItem.basis). */
  basis?: string | null;
}
/** Loose client equipment identified on the drawing (TV, fridge, projector screen…)
 *  — not contractor works, shown for reference so it is never silently dropped, but
 *  kept out of the priced contract table. */
export interface QuoteDrawingItem {
  no: string;
  spec: string;
  qty: number;
  unit: string;
  note?: string;
  scope?: string;        // works | equipment | needs_confirmation
}
/** A drawing requirement that belongs to another allocation (e.g. Common Area) —
 *  seen in the drawing, deliberately excluded from THIS BOQ, shown for audit. */
export interface QuoteExcludedItem {
  spec: string;
  allocation?: string;
  qty?: number | null;
  unit?: string;
}
export interface DsrQuotePayload {
  boqName: string;
  projectName?: string | null;
  clientName?: string | null;
  location?: string | null;
  builtUpSqft?: number | null;
  floors?: number | null;
  generatedOn: string;
  rateYear?: string | null;
  projectType?: string | null;   // residential / commercial — project-size context
  flatsPerFloor?: number | null;
  firmName?: string | null;      // your own letterhead (architect firm); defaults to Cunstruct
  firmTagline?: string | null;
  blankRates?: boolean;          // issue for pricing: rates/amounts left blank
  subheads: QuoteSubHead[];
  abstract: { no: number; name: string; amount: number }[];
  commercials: QuoteCommercials;
  /** Identified-but-unquantified drawing requirements — rendered as an unpriced
   *  "pending" section so every drawing requirement appears in the document. */
  pendingItems?: QuotePendingItem[];
  /** Quantified drawing requirements not (yet) mapped to a priced catalogue item —
   *  kept visible as Drawing Items so nothing the drawing counted disappears. */
  drawingItems?: QuoteDrawingItem[];
  /** Drawing requirements excluded from this BOQ because they belong to another
   *  allocation (Common Area / other floor) — shown for audit, never priced. */
  excludedItems?: QuoteExcludedItem[];
  /** Drawing-review items for this BOQ that are still pending or flagged —
   *  never applied, so absent from every table here. Stated so the document
   *  is not read as the drawing's complete scope. */
  unresolvedReviewCount?: number | null;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
const inr = (n: number | null) => (n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
const qtyFmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Scope H — the compact, wrapping-safe inline source annotation appended to a
 *  contract-table line's spec cell. Never shown at all when the caller resolved no
 *  `sourceDocument`; `sourcePage` is only ever appended alongside a resolved name
 *  (the caller's own contract — see QuoteItem), never on its own. */
const srcRef = (l: Pick<QuoteItem, "sourceDocument" | "sourcePage" | "basis">) =>
  (l.basis ? `<span class="srcref"> · Basis: ${esc(l.basis)}</span>` : "") +
  (l.sourceDocument ? `<span class="srcref"> · ${esc(l.sourceDocument)}${l.sourcePage ? `, p.${esc(l.sourcePage)}` : ""}</span>` : "");

/** True when the document states a quantity basis for at least one line. */
const statesBasis = (subheads: QuoteSubHead[], pending: QuotePendingItem[] = []) =>
  subheads.some((sh) => sh.lines.some((l) => l.basis)) || pending.some((p) => p.basis);

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (x: number) => x < 20 ? ONES[x] : (TENS[Math.floor(x / 10)] + (x % 10 ? " " + ONES[x % 10] : ""));
const three = (x: number) => {
  const h = Math.floor(x / 100), r = x % 100;
  return (h ? ONES[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
};

/** Amount in words, Indian numbering (crore / lakh / thousand). */
export function amountInWords(amount: number): string {
  let n = Math.round(amount);
  if (n <= 0) return "Zero";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  return [
    crore ? three(crore) + " Crore" : "",
    lakh ? two(lakh) + " Lakh" : "",
    thousand ? two(thousand) + " Thousand" : "",
    n ? three(n) : "",
  ].filter(Boolean).join(" ");
}

/** Single rounding strategy for the whole document: every monetary amount is a
 *  whole number of rupees. Aggregates are ALWAYS sums of already-rounded child
 *  amounts, never a rounded sum of full-precision values — so what the reader sees
 *  adds up exactly (line amounts → sub-head subtotal → works → the abstract
 *  waterfall). This is why the printed parts previously summed to ₹58,764 while the
 *  grand total read ₹58,763: the parts were rounded for display but the total was a
 *  rounded full-precision sum. Round once, here, at every stage. */
export { roundRupee };

/**
 * CPWD-style abstract: works → +cost index → +contingency → +overhead → +cess → +GST.
 * Every stage is rounded to whole rupees and each subsequent stage is computed from
 * the rounded running value, so the waterfall the reader sees is internally exact.
 *
 * `dsrWorks` is the part of `works` priced AT the DSR 2023 rate (no override).
 * Those rates already include GST, contractor's profit & overheads (CPOH) and
 * labour cess. Source: CPWD Delhi Analysis of Rates (DAR) 2023 Vol. I, e.g. DSR
 * item 2.1.1, "Details of cost for 100 Sqm":
 *   labour total                                         9126.40  W
 *   Add 1 % Water charges on "W"                           91.26  X  9217.66
 *   Add GST on "X" (multiplying factor 0.2127)           1960.60  Y 11178.26
 *   Add 15% CPOH on "Y"                                  1676.74  Z 12855.00
 *   Add Cess @ 1% on "Z"                                  128.55    12983.55
 *   = 129.84/sqm, the DSR 2023 rate 129.85/sqm.
 * (DSR 2023 Vol. 1, Preface §6.2 also states GST @18% is incorporated.)
 *
 * So overhead @ overheadPct, cess @ cessPct and GST @ gstPct are charged only
 * on the non-DSR part (own/custom/catalogue rates, incl. a custom override of a
 * DSR item). Cost index (a location adjustment) and contingency (an
 * estimate-level allowance) still apply to the whole works, as before.
 *
 * Arithmetic: cost index and contingency are uniform uplifts on the whole
 * works, so the non-DSR part carries them in proportion to its share of works
 * (nonDsr ÷ works). Following the existing waterfall order:
 *   overheadBase = share(works after cost index)
 *   cessBase     = share(works after cost index + contingency) + overhead
 *   gstBase      = cessBase + cess
 * where share(x) = round(x × nonDsr ÷ works). With dsrWorks = 0 (the default)
 * share(x) = x and every stage is exactly the previous result; with an all-DSR
 * works only cost index and contingency are added.
 */
export function computeCommercials(works: number, i: CommercialInputs, dsrWorks = 0): QuoteCommercials {
  const w = roundRupee(works);
  const dsr = Math.min(Math.max(roundRupee(dsrWorks), 0), Math.max(w, 0));
  const nonDsrWorks = w - dsr;
  const share = (x: number) => (dsr === 0 ? x : w > 0 ? roundRupee(x * (nonDsrWorks / w)) : 0);
  const costIndexAmt = roundRupee(w * (i.costIndexPct / 100));
  const worksAdjusted = w + costIndexAmt;
  const contingencyAmt = roundRupee(worksAdjusted * (i.contingencyPct / 100));
  const overheadBase = share(worksAdjusted);
  const overheadAmt = roundRupee(overheadBase * (i.overheadPct / 100));
  const subTotal = worksAdjusted + contingencyAmt + overheadAmt;
  const cessBase = share(worksAdjusted + contingencyAmt) + overheadAmt;
  const cessAmt = roundRupee(cessBase * (i.cessPct / 100));
  const taxable = subTotal + cessAmt;
  const gstBase = cessBase + cessAmt;
  const gstAmt = roundRupee(gstBase * (i.gstPct / 100));
  const grandTotal = taxable + gstAmt;
  return {
    ...i, works: w, costIndexAmt, worksAdjusted, contingencyAmt, overheadAmt,
    subTotal, cessAmt, gstAmt, grandTotal, grandTotalWords: amountInWords(grandTotal),
    dsrWorks: dsr, nonDsrWorks, gstBase, overheadBase, cessBase,
  };
}

/** The abstract rows from "Cost of works" down to GST (the grand total row is
 *  the caller's). Shared by the single-BOQ and the project quote so both state
 *  the GST basis identically. Commercials frozen before the DSR split (no
 *  dsrWorks) render with neutral wording and GST on the whole, as computed. */
function abstractRowsHtml(c: QuoteCommercials): string {
  const row = (label: string, value: string) => `<tr><td>${label}</td><td class="num">${value}</td></tr>`;
  const wrow = (label: string, amt: number, show: boolean) => (show ? row(label, inr(amt)) : "");
  const split = c.dsrWorks != null;
  const dsrPart = c.dsrWorks ?? 0;
  const nonDsr = c.nonDsrWorks ?? c.works - dsrPart;
  const worksRows = !split
    ? row("Cost of works", inr(c.works))
    : dsrPart === 0
      ? row("Cost of works (own/custom rates, excl. GST)", inr(c.works))
      : row("Cost of works", inr(c.works)) +
        row("&nbsp;&nbsp;of which at DSR 2023 rates (incl. GST @18%)", inr(dsrPart)) +
        (nonDsr > 0 ? row("&nbsp;&nbsp;of which at own/custom rates (excl. GST)", inr(nonDsr)) : "");
  return worksRows +
    wrow(`Add: Cost index @ ${c.costIndexPct}%`, c.costIndexAmt, c.costIndexPct !== 0) +
    wrow(`Add: Contingencies @ ${c.contingencyPct}%`, c.contingencyAmt, c.contingencyPct !== 0) +
    (overheadSplit(c) && dsrPart > 0 ? row(esc(DSR_CPOH_CESS_INCLUDED_LABEL), "included") : "") +
    wrow(esc(overheadAddLabel(c)), c.overheadAmt, c.overheadPct !== 0 && (!overheadSplit(c) || nonDsr > 0)) +
    wrow(esc(cessAddLabel(c)), c.cessAmt, c.cessPct !== 0 && (!overheadSplit(c) || nonDsr > 0)) +
    (dsrPart > 0 ? row(esc(DSR_GST_INCLUDED_LABEL), "included") : "") +
    wrow(esc(gstAddLabel(c)), c.gstAmt, c.gstPct !== 0 && (!split || nonDsr > 0));
}

/** Small per-line note under a rate saying whether GST is inside it. */
const rateTag = (l: Pick<QuoteItem, "rate" | "rateBasis">) =>
  l.rate == null ? ""
    : l.rateBasis === "dsr" ? `<span class="rb">DSR 2023, incl. GST</span>`
    : l.rateBasis === "custom" ? `<span class="rb">own rate, excl. GST</span>`
    : "";

/** True when any priced line, or the commercials, are at DSR rates. */
const hasDsrRated = (subheads: QuoteSubHead[], c?: QuoteCommercials) =>
  (c?.dsrWorks ?? 0) > 0 || subheads.some((sh) => sh.lines.some((l) => l.rateBasis === "dsr" && l.rate != null));

const DSR_GST_NOTE = `Lines marked "DSR 2023, incl. GST" are priced at Delhi Schedule of Rates 2023 item rates, which already include GST @18% (DSR 2023 Vol. 1, Preface §6.2: "The effect of GST @18% on works contract has been incorporated in all items"); GST is not added on them again.`;
/** Stated wherever overhead/cess were charged on the non-DSR part only. */
const DSR_CPOH_NOTE = `DSR 2023 item rates also already include water charges 1%, contractor's profit & overheads 15% and labour cess 1% (CPWD Delhi Analysis of Rates 2023, Vol. I rate build-up), so overhead and cess are added in the abstract only on lines priced at own/custom rates.`;
const cpohNote = (c?: QuoteCommercials) => (c && overheadSplit(c) && (c.dsrWorks ?? 0) > 0 ? ` ${esc(DSR_CPOH_NOTE)}` : "");

const INCOMPLETE_SCOPE = "Incomplete scope.";
/** The one incomplete-scope statement every BOQ view and export uses: drawing-review
 *  items never applied are stated, never implied absent. Null when none are unresolved. */
export function incompleteScopeNotice(unresolvedReviewCount: number | null | undefined): string | null {
  const n = unresolvedReviewCount ?? 0;
  if (n <= 0) return null;
  return `${INCOMPLETE_SCOPE} ${n} drawing-review item${n === 1 ? " is" : "s are"} still pending or flagged and ${n === 1 ? "is" : "are"} not included in this BOQ.`;
}

/** The label for a stated grand total. Unpriced or pending lines: it covers the
 *  priced scope only. Otherwise, drawing-review items not yet in the BOQ: it is
 *  the BOQ as it stands, a working estimate, and says how many items are missing.
 *  Only a complete BOQ gets a plain "Grand total". The figure itself is unchanged. */
export function grandTotalLabel(o: { unpriced: number; pending: number; unresolvedReviewCount?: number | null }): string {
  if (o.unpriced > 0 || o.pending > 0) return "Grand total of currently priced scope only";
  const n = o.unresolvedReviewCount ?? 0;
  if (n > 0) return `Grand total of the BOQ as it stands (working estimate; ${n} drawing-review item${n === 1 ? " is" : "s are"} not yet in it)`;
  return "Grand total";
}

export function buildDsrQuoteHtml(p: DsrQuotePayload, opts?: { autoPrint?: boolean }): string {
  const flats = p.flatsPerFloor && p.flatsPerFloor > 1 ? `${p.flatsPerFloor} flats/floor` : "";
  const units = p.floors && p.flatsPerFloor && p.flatsPerFloor > 1 ? ` (${p.floors * p.flatsPerFloor} units)` : "";
  const meta = [
    p.clientName ? `Client: ${esc(p.clientName)}` : "",
    p.location ? `Location: ${esc(p.location)}` : "",
    p.projectType ? `Type: ${esc(p.projectType)}` : "",
    p.floors ? `Floors: ${esc(p.floors)}${units}` : "",
    flats,
    p.builtUpSqft ? `Built-up: ${esc(p.builtUpSqft)} sqft` : "",
    p.rateYear ? `Basis: DSR ${esc(p.rateYear)}` : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  const blank = !!p.blankRates;
  // DSR basis is asserted ONLY when a rate year was supplied (the operator explicitly
  // chose DSR pricing). Private projects carry no rateYear → neutral basis language,
  // never "Basis: DSR 2023".
  const dsr = !!p.rateYear;
  const money = (n: number | null) => (blank ? "" : inr(n));

  // A sub-head with lines still without a rate: its amount covers the priced
  // lines only, and says so — never read as the whole sub-head.
  const unratedIn = (no: number) => p.subheads.find((x) => x.no === no)?.lines.filter((l) => l.amount == null).length ?? 0;
  const toBePriced = (no: number) => { const n = unratedIn(no); return n ? ` + ${n} item${n === 1 ? "" : "s"} to be priced` : ""; };
  const rows = p.subheads.map((sh) => `
    <tr class="sub"><td colspan="6">${sh.no}.00 &nbsp; ${esc(sh.name).toUpperCase()}${blank ? "" : `<span class="ssub">${inr(sh.subtotal)}${toBePriced(sh.no)}</span>`}</td></tr>
    ${sh.lines.map((l) => `
      <tr>
        <td class="no">${esc(l.no)}</td>
        <td class="spec">${l.code ? `<span class="code">${esc(l.code)}</span>` : ""}${esc(l.spec)}${srcRef(l)}</td>
        <td class="num">${qtyFmt(l.qty)}</td>
        <td class="unit">${esc(l.unit)}</td>
        <td class="num">${money(l.rate)}${blank ? "" : rateTag(l)}</td>
        <td class="num amt">${money(l.amount)}</td>
      </tr>`).join("")}
  `).join("");

  // A sub-head whose every line has an amount is priced, even when that amount
  // is a confirmed ₹0 (e.g. confirmed-zero quantities); "To be priced" is said
  // only when a line still has no rate — never for a real zero.
  const fullyPriced = (no: number) => {
    const sh = p.subheads.find((x) => x.no === no);
    return !!sh && sh.lines.length > 0 && sh.lines.every((l) => l.amount != null);
  };
  const abstractRows = p.abstract.map((a) => `
    <tr><td class="no">${a.no}.00</td><td>${esc(a.name)}</td><td class="num">${blank ? "" : (a.amount > 0 || fullyPriced(a.no) ? `${inr(a.amount)}${toBePriced(a.no)}` : "To be priced")}</td></tr>`).join("");

  // Scope buckets used by both the cost status and the sections below.
  const pending = p.pendingItems ?? [];
  const drawing = p.drawingItems ?? [];
  const excludedList = p.excludedItems ?? [];
  const scopeLabel = (s?: string) =>
    s === "equipment" ? "Client equipment" : s === "needs_confirmation" ? "Needs confirmation" : "Works";

  const c = p.commercials;
  // Partial-pricing status: identified scope that is not (yet) priced — drawing
  // items awaiting a catalogue rate mapping, and requirements awaiting a quantity.
  // When present, the abstract total covers only the PRICED scope, so it is
  // labelled as such and never shown as the full project value. Generalized —
  // applies to any BOQ (drawing-driven or questionnaire).
  // Rate-pending WORKS lines: quantified, in the contract table, awaiting a rate.
  const unpricedCount = blank ? 0 : p.subheads.reduce((n, sh) => n + sh.lines.filter((l) => l.rate == null).length, 0);
  const equipmentCount = drawing.length;
  const pendingCount = pending.length;
  const excludedCount = excludedList.length;
  const partiallyPriced = !blank && (unpricedCount > 0 || pendingCount > 0);
  const grandLabel = partiallyPriced ? "Grand total of currently priced scope only" : "Grand total";
  const statusRow = partiallyPriced
    ? `<tr class="status"><td colspan="2">BOQ status: <b>Partially priced</b>. The amount above is the <b>currently priced scope only</b>, not the full project value.
        <br>Priced scope: ${inr(c.works)} &nbsp;·&nbsp; Rate pending: ${unpricedCount} item${unpricedCount === 1 ? "" : "s"} &nbsp;·&nbsp; Quantity pending: ${pendingCount} item${pendingCount === 1 ? "" : "s"}${equipmentCount ? ` &nbsp;·&nbsp; Client equipment: ${equipmentCount} item${equipmentCount === 1 ? "" : "s"}` : ""}${excludedCount ? ` &nbsp;·&nbsp; Excluded (other allocation): ${excludedCount} item${excludedCount === 1 ? "" : "s"}` : ""}.</td></tr>`
    : "";
  const summary = `
    <table class="summary">
      ${abstractRowsHtml(c)}
      <tr class="grand"><td>${grandLabel}</td><td class="num">${inr(c.grandTotal)}</td></tr>
      <tr class="words"><td colspan="2">Rupees ${esc(c.grandTotalWords)} only</td></tr>
      ${statusRow}
    </table>`;

  // Identified-but-unquantified drawing requirements — listed, never priced. A row
  // per requirement so nothing the drawing identified is dropped from the document;
  // the quantity column reads "—" (pending), never a fabricated 0.
  const notice = incompleteScopeNotice(p.unresolvedReviewCount);
  const reviewNotice = notice
    ? `<div class="foot" style="margin-top:14px;color:#b06d08"><b>${INCOMPLETE_SCOPE}</b>${esc(notice.slice(INCOMPLETE_SCOPE.length))}</div>`
    : "";
  const pendingSection = pending.length ? `
    <h2>Identified — Pending Quantification (not priced)</h2>
    <table class="pending">
      <thead><tr><th>Sl. No</th><th>Requirement</th><th>Unit</th><th>Scope</th><th class="num">Qty</th></tr></thead>
      <tbody>${pending.map((it) => `
        <tr>
          <td class="no">${esc(it.no)}</td>
          <td class="spec">${it.code ? `<b>${esc(it.code)}</b> ` : ""}${esc(it.spec)}${it.note ? `<span class="pnote"> — ${esc(it.note)}</span>` : ""}${srcRef(it)}</td>
          <td class="unit">${esc(it.unit)}</td>
          <td>${esc(scopeLabel(it.scope))}</td>
          <td class="num pend">pending</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="foot" style="margin-top:8px">These ${pending.length} requirement${pending.length === 1 ? " is" : "s are"} identified on the drawing but not yet quantified. They are listed for completeness and are <b>not included in the priced totals</b> — confirm a quantity for each to price it.</div>
  ` : "";

  // Loose client equipment identified on the drawing — not contractor works, shown
  // for reference with its drawing quantity, kept out of the priced contract table.
  const drawingSection = drawing.length ? `
    <h2>Client Equipment &amp; Loose Items — Not in Contract Works</h2>
    <table class="pending">
      <thead><tr><th>Sl. No</th><th>Item</th><th class="num">Qty</th><th>Unit</th><th>Scope</th></tr></thead>
      <tbody>${drawing.map((it) => `
        <tr>
          <td class="no">${esc(it.no)}</td>
          <td class="spec">${esc(it.spec)}${it.note ? `<span class="pnote"> — ${esc(it.note)}</span>` : ""}</td>
          <td class="num">${qtyFmt(it.qty)}</td>
          <td class="unit">${esc(it.unit)}</td>
          <td>${esc(scopeLabel(it.scope))}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="foot" style="margin-top:8px">These ${drawing.length} item${drawing.length === 1 ? " is" : "s are"} loose client equipment identified on the drawing (supplied by the client, not the contractor). They are listed for reference with the drawing quantity and are <b>excluded from the contract works and the priced totals</b>.</div>
  ` : "";

  // Common-area / other-allocation requirements seen in the drawing but owned by
  // a different BOQ — shown for audit so they never look "missed".
  const excludedSection = excludedList.length ? `
    <h2>Seen in Drawing — Excluded (Other Allocation)</h2>
    <table class="pending">
      <thead><tr><th>Requirement</th><th class="num">Qty</th><th>Unit</th><th>Allocation</th></tr></thead>
      <tbody>${excludedList.map((it) => `
        <tr>
          <td class="spec">${esc(it.spec)}</td>
          <td class="num">${it.qty == null ? "—" : qtyFmt(it.qty)}</td>
          <td class="unit">${esc(it.unit ?? "")}</td>
          <td>${esc(it.allocation ?? "Other")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="foot" style="margin-top:8px">These requirements are identified in the drawing but belong to another BOQ allocation, so they are <b>deliberately excluded from this BOQ</b> — listed here for audit, not missed.</div>
  ` : "";

  const brandHtml = p.firmName ? esc(p.firmName) : `cun<span>struct</span>`;
  const tagline = p.firmTagline ? `<div class="tagline">${esc(p.firmTagline)}</div>` : "";
  const docTitle = blank ? "Bill of Quantities<br>(for pricing)" : "Bill of Quantities<br>&amp; Priced Quote";
  const abstractSection = blank
    ? `<div class="foot" style="margin-top:22px"><b>Rates to be quoted by bidder.</b> This schedule of quantities is issued for pricing — enter a rate against each item; amounts and totals will follow.</div>`
    : `<div class="pagebreak"></div>
       <h2>Abstract of Cost</h2>
       <table class="abstract">
         <thead><tr><th>Sub-head</th><th>Type of work</th><th class="num">Amount</th></tr></thead>
         <tbody>${abstractRows}</tbody>
       </table>
       ${summary}`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>BOQ — ${esc(p.boqName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#1b2233; margin:0; padding:32px; font-size:12px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #f59e0b; padding-bottom:14px; margin-bottom:18px; }
  .brand { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
  .brand span { color:#f59e0b; }
  .tagline { font-size:11px; color:#778; margin-top:-2px; margin-bottom:2px; }
  .doc-title { text-align:right; font-size:12px; color:#667; }
  h1 { font-size:18px; margin:4px 0 2px; }
  .meta { font-size:11.5px; color:#556; margin-bottom:8px; }
  .draft-notice { border:1px solid #d97706; background:#fffbeb; color:#78350f; padding:10px 12px; margin:0 0 16px; border-radius:4px; font-size:11px; line-height:1.5; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:#334; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin:26px 0 8px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; color:#889; font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.4px; padding:7px 8px; border-bottom:1.5px solid #cdd3dd; background:#f7f8fa; }
  th.num { text-align:right; }
  td { padding:6px 8px; border-bottom:1px solid #f1f2f4; vertical-align:top; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.no { color:#556; white-space:nowrap; width:44px; font-variant-numeric:tabular-nums; }
  td.unit { color:#778; width:52px; }
  td.amt { font-weight:600; }
  td.spec { line-height:1.45; }
  td.spec .code { display:inline-block; font-family:ui-monospace,Menlo,monospace; font-size:10px; color:#b06d08; background:#fdf4e3; padding:0 5px; border-radius:3px; margin-right:6px; white-space:nowrap; }
  td.spec .srcref { color:#99a; font-size:10.5px; font-style:italic; }
  td.num .rb { display:block; color:#99a; font-size:9px; font-weight:400; }
  tr.sub td { background:#1b2233; color:#fff; font-weight:700; font-size:12px; padding:8px 8px; letter-spacing:.02em; }
  tr.sub .ssub { float:right; font-weight:700; color:#f7c877; }
  .summary { width:380px; margin-left:auto; margin-top:14px; }
  .summary td { border:none; padding:6px 8px; font-size:12.5px; color:#445; }
  .summary td.num { color:#1b2233; font-weight:600; }
  .summary tr.grand td { border-top:2px solid #1b2233; font-size:16px; font-weight:800; color:#1b2233; padding-top:10px; }
  .summary tr.words td { font-style:italic; color:#556; font-size:11.5px; padding-top:2px; }
  .summary tr.status td { border-top:1px dashed #c9ced8; margin-top:4px; padding-top:8px; font-size:11px; color:#b06d08; line-height:1.5; }
  .abstract { max-width:520px; }
  .abstract td { font-size:12.5px; }
  .pending td.pend { color:#b06d08; font-weight:600; font-style:italic; }
  .pending .pnote { color:#889; font-style:italic; }
  .foot { margin-top:26px; font-size:10px; color:#99a; border-top:1px solid #eee; padding-top:10px; line-height:1.5; }
  .toolbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; background:#1b2233; color:#fff; padding:10px 14px; border-radius:8px; margin-bottom:18px; font-size:12.5px; }
  .toolbar button { background:#f7c877; color:#1b2233; border:none; border-radius:6px; padding:8px 16px; font-size:13px; font-weight:700; cursor:pointer; }
  .toolbar button:hover { filter:brightness(1.05); }
  .toolbar .hint { color:#c9ced8; }
  @media print { body { padding:0; } tr { break-inside:avoid; } .pagebreak { break-before:page; } .no-print { display:none !important; } }
</style></head><body>
  <div class="toolbar no-print">
    <button type="button" onclick="window.print()">&#8681;&nbsp; Save as PDF</button>
    <span class="hint">Opens your browser's print dialog — choose <b>Save as PDF</b> (or your printer) to download this quote.</span>
  </div>
  <div class="draft-notice">${esc(BOQ_DRAFT_DISCLAIMER)}</div>
  <div class="head">
    <div>
      <div class="brand">${brandHtml}</div>
      ${tagline}
      <h1>${esc(p.boqName)}</h1>
      <div class="meta">${meta}</div>
    </div>
    <div class="doc-title">${docTitle}<br>${esc(p.generatedOn)}</div>
  </div>

  <h2>Bill of Quantities</h2>
  <table>
    <thead><tr>
      <th>Sl. No</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Amount</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="6">No items.</td></tr>`}</tbody>
  </table>

  ${reviewNotice}

  ${drawingSection}

  ${pendingSection}

  ${excludedSection}

  ${abstractSection}

  <div class="foot">
    <b>Basis &amp; conditions.</b> ${dsr
      ? `Rates are composite item rates from the Delhi Schedule of Rates ${esc(p.rateYear)} (material + labour + plant), adjusted by the stated cost index for location. DSR 2023 item rates include GST @18% (DSR 2023 Vol. 1, Preface §6.2: "The effect of GST @18% on works contract has been incorporated in all items"), so GST is not added on lines priced at the DSR rate. Rates entered by the estimator (own/custom rates) are exclusive of GST, which is added in the abstract on those lines only.${cpohNote(c)} Non-Schedule (NS) items, where shown, are outside the DSR and their rates are to be analysed from prevailing market / State PWD rates.`
      : `Rates are the estimator's own composite rates (material, labour and installation), exclusive of GST, and are confirmed separately with the architect/client. This is a private-project quotation and is not priced on any government schedule of rates.${hasDsrRated(p.subheads, c) ? ` ${esc(DSR_GST_NOTE)}${cpohNote(c)}` : ""}`}
    ${statesBasis(p.subheads, p.pendingItems)
      ? `<b>Each quantity states its recorded basis.</b> "From drawing summary" is the estimator's own reading of the supplied drawings, not an
    independent measurement; a calculated quantity states its derivation; an assumption is marked as an assumption; "as stated in imported data"
    repeats the import's own wording; "Basis not recorded" means nothing on record says where the quantity came from.`
      : `<b>This document does not state the basis of each quantity.</b>`} Requirements that cannot be defensibly quantified remain pending. Catalogue rates do not create quantities. Final measurements and
    specifications should be verified before execution. Items are grouped in construction sequence. This quotation is indicative and valid for
    15 days from the date above. Generated by Cunstruct.
  </div>

  ${opts?.autoPrint === false ? "" : `<script>(function(){function p(){try{window.focus();window.print();}catch(e){}}if(document.readyState==="complete"){setTimeout(p,300);}else{window.addEventListener("load",function(){setTimeout(p,300);});}})();</script>`}
</body></html>`;
}

// ---- Excel (CSV) export ----------------------------------------------------
export interface CsvRow {
  subhead: string;
  itemNo: string;
  code: string | null;
  spec: string;
  unit: string;
  qty: number;
  rate: number | null;
  /** Scope H — same read-only, never-fabricated contract as QuoteItem's fields of
   *  the same name (see there). Appended as new columns AFTER the existing 9 (past
   *  "Amount") so the `=F{n}*H{n}` formula's column letters are never disturbed. */
  sourceDocument?: string | null;
  sourcePage?: string | null;
  /** Recorded quantity basis label — appended after "Source Page" (column L)
   *  for the same reason as the source columns. Absent = not stated. */
  basis?: string | null;
  /** Where the reference rate came from (see QuoteItem.rateBasis) — column M,
   *  "Rate basis", saying whether GST is inside the rate. Absent = not stated. */
  rateBasis?: "dsr" | "custom" | "none" | null;
}

/** CSV "Rate basis" wording: whether GST is inside the reference rate. */
export const csvRateBasis = (r: Pick<CsvRow, "rate" | "rateBasis">): string =>
  r.rate == null ? ""
    : r.rateBasis === "dsr" ? "DSR 2023 rate (incl. GST @18%)"
    : r.rateBasis === "custom" ? "Own/custom rate (excl. GST)"
    : "";
export const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildBoqCsv(
  rows: CsvRow[],
  meta: {
    boqName: string; project?: string | null; generatedOn: string; unresolvedReviewCount?: number | null;
    /** The commercial abstract the priced PDF shows (same computation); its grand total is stated under the lines. */
    commercials?: Pick<QuoteCommercials, "works" | "grandTotal"> | null;
    /** A frozen revision's CSV: the totals are the revision's own, fixed when it
     *  was frozen (e.g. "Rev B, frozen 2026-10-05"), not computed at export. */
    frozenAs?: string | null;
  },
  pending?: { spec: string; unit: string; code?: string | null; note?: string; sourceDocument?: string | null; sourcePage?: string | null; basis?: string | null }[],
): string {
  const HEADER_LINE = 4;
  // Scope H — "Source Document"/"Source Page" are appended AFTER the existing 9
  // columns (A–I). The Amount formula below references columns F and H by letter
  // ("=F{n}*H{n}"); these new columns must never be inserted before Amount, or
  // every row's formula would silently point at the wrong cells.
  const head = ["Sub-head", "Item", "Code", "Specification", "Unit", "Qty", "Rate (ref)", "Your rate", "Amount", "Source Document", "Source Page", "Quantity basis", "Rate basis"];
  const lines: string[] = [
    csvCell(`Bill of Quantities — ${meta.boqName}`),
    csvCell(`${meta.project ?? "Standalone"}  ·  ${meta.generatedOn}  ·  Quantities from drawings; enter "Your rate". DSR 2023 rates include GST @18% (DSR 2023 preface §6.2); own/custom rates exclude GST · ${BOQ_DRAFT_DISCLAIMER}`),
    csvCell(incompleteScopeNotice(meta.unresolvedReviewCount) ?? ""),
    head.map(csvCell).join(","),
  ];
  rows.forEach((r, i) => {
    const ln = HEADER_LINE + 1 + i;
    const amount = r.rate != null ? `=F${ln}*H${ln}` : "";   // Qty(F) × Your rate(H)
    lines.push([
      r.subhead, r.itemNo, r.code ?? "", r.spec, r.unit, r.qty, r.rate ?? "", r.rate ?? "", amount,
      r.sourceDocument ?? "", r.sourceDocument ? (r.sourcePage ?? "") : "", r.basis ?? "", csvRateBasis(r),
    ].map(csvCell).join(","));
  });
  // Totals under the lines, as the priced PDF's abstract computes them (same
  // commercials): a live export's at the rates when exported, a frozen revision's
  // as fixed at freeze. Single-cell rows like the
  // section titles, so a reader of the table rows (lib/e2e/pipeline) skips them.
  if (rows.length && meta.commercials) {
    const unpriced = rows.filter((r) => r.rate == null).length;
    const pendingCount = pending?.length ?? 0;
    const partial = unpriced > 0 || pendingCount > 0;
    const rs = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
    const notIn = [unpriced ? `${unpriced} item${unpriced === 1 ? "" : "s"} without a rate` : "", pendingCount ? `${pendingCount} with a pending quantity` : ""].filter(Boolean).join(" and ");
    lines.push("",
      csvCell(`Cost of works (priced items): ${rs(meta.commercials.works)}${partial ? ` — currently priced scope only; ${notIn} not included` : ""}`),
      csvCell(`${grandTotalLabel({ unpriced, pending: pendingCount, unresolvedReviewCount: meta.unresolvedReviewCount })}, with contingency, overheads, cess and GST as in the priced PDF abstract: ${rs(meta.commercials.grandTotal)}`),
      csvCell(meta.frozenAs
        ? `These totals are those of ${meta.frozenAs}, fixed when it was frozen. The Amount column recalculates if you change "Your rate"; these totals do not.`
        : `These totals are at the rates when exported. The Amount column recalculates if you change "Your rate"; these totals do not.`));
  }
  // Identified-but-unquantified drawing requirements — listed with a blank Qty
  // (never a fabricated 0) so nothing the drawing identified is dropped, and none
  // of these is priced.
  if (pending?.length) {
    lines.push("", csvCell("IDENTIFIED — PENDING QUANTIFICATION (not priced; confirm a quantity to price)"));
    pending.forEach((p, i) => {
      lines.push([
        "Pending", `P.${String(i + 1).padStart(2, "0")}`, p.code ?? "", p.note ? `${p.spec} — ${p.note}` : p.spec, p.unit, "", "", "", "",
        p.sourceDocument ?? "", p.sourceDocument ? (p.sourcePage ?? "") : "", p.basis ?? "",
      ].map(csvCell).join(","));
    });
  }
  return lines.join("\r\n");
}

/** Trigger a client-side download of a .csv (opens in Excel). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Open the quote in a new tab. With `autoPrint` (the default) it also triggers
 *  the browser's print dialog, whose "Save as PDF" destination downloads a clean,
 *  vector, multi-page PDF of the styled quote. Pass `autoPrint: false` to just
 *  preview it in the tab. */
export function openDsrQuote(p: DsrQuotePayload, opts?: { autoPrint?: boolean }): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(buildDsrQuoteHtml(p, opts));
  w.document.close();
  return true;
}

/** A quote tab opened straight from the click (browsers allow a pop-up only
 *  there) BEFORE the lines are re-read, so the document can be built from what
 *  is saved now rather than from the copy on screen. Until `show` it states
 *  that it is reading the latest saved BOQ; `fail` replaces that with the
 *  reason no document was produced (never a stale or partial one). */
export interface QuoteWindow {
  show(p: DsrQuotePayload, opts?: { autoPrint?: boolean }): void;
  fail(message: string): void;
}

export const QUOTE_WINDOW_LOADING_TEXT = "Reading the latest saved BOQ before building this document…";

const statusPage = (title: string, text: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;padding:32px;color:#223"><p>${esc(text)}</p></body></html>`;

/** Opens the quote tab, or returns null when the pop-up was blocked. */
export function openQuoteWindow(): QuoteWindow | null {
  const w = window.open("", "_blank");
  if (!w) return null;
  const write = (html: string) => { w.document.open(); w.document.write(html); w.document.close(); };
  write(statusPage("Preparing BOQ", QUOTE_WINDOW_LOADING_TEXT));
  return {
    show: (p, opts) => write(buildDsrQuoteHtml(p, opts)),
    fail: (message) => write(statusPage("BOQ not exported", message)),
  };
}

// ---- Combined project quote (all BOQs, one shareable client PDF) ------------
export interface ProjectQuoteBoq {
  name: string;
  scope?: string | null;
  subheads: QuoteSubHead[];
  commercials: QuoteCommercials;   // computed from this BOQ's own commercial percentages
  /** Included lines with no established quantity — listed under this BOQ's table as
   *  pending, never priced and never shown as a Qty of 0. Optional; absent = none. */
  pendingItems?: QuotePendingItem[];
}
export interface ProjectQuotePayload {
  projectName: string;
  clientName?: string | null;
  location?: string | null;
  projectType?: string | null;
  floors?: number | null;
  builtUpSqft?: number | null;
  generatedOn: string;
  /** "firm" = your letterhead (for approval); "client" = the client's name, no firm
   *  branding (the final version to hand over). */
  branding: "firm" | "client";
  firmName?: string | null;
  firmTagline?: string | null;
}

/** One combined, client-facing priced quote covering every BOQ in the project. Each
 *  BOQ is its own section with a priced table and total; a project abstract sums the
 *  per-BOQ totals to a grand total. Rate-pending lines show a blank amount (never a
 *  fabricated 0). Branding is either the firm's letterhead or the client's name only. */
export function buildProjectQuoteHtml(p: ProjectQuotePayload, boqs: ProjectQuoteBoq[], opts?: { autoPrint?: boolean }): string {
  const client = !!p.clientName && p.branding === "client";
  const meta = [
    p.clientName ? `Client: ${esc(p.clientName)}` : "",
    p.location ? `Location: ${esc(p.location)}` : "",
    p.projectType ? `Type: ${esc(p.projectType)}` : "",
    p.floors ? `Floors: ${esc(p.floors)}` : "",
    p.builtUpSqft ? `Built-up: ${esc(p.builtUpSqft)} sqft` : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  const section = (b: ProjectQuoteBoq, i: number) => {
    const rows = b.subheads.map((sh) => `
      <tr class="sub"><td colspan="6">${sh.no}.00 &nbsp; ${esc(sh.name).toUpperCase()}<span class="ssub">${inr(sh.subtotal)}</span></td></tr>
      ${sh.lines.map((l) => `
        <tr>
          <td class="no">${esc(l.no)}</td>
          <td class="spec">${l.code ? `<span class="code">${esc(l.code)}</span>` : ""}${esc(l.spec)}${srcRef(l)}</td>
          <td class="num">${qtyFmt(l.qty)}</td>
          <td class="unit">${esc(l.unit)}</td>
          <td class="num">${inr(l.rate)}${rateTag(l)}</td>
          <td class="num amt">${inr(l.amount)}</td>
        </tr>`).join("")}`).join("");
    const c = b.commercials;
    // Same rows as the single-BOQ document's pending section: Qty reads "pending".
    const pending = b.pendingItems ?? [];
    const pendingTable = pending.length ? `
      <table class="pending">
        <thead><tr><th>Sl. No</th><th>Pending quantification — not priced</th><th>Unit</th><th class="num">Qty</th></tr></thead>
        <tbody>${pending.map((it) => `
          <tr>
            <td class="no">${esc(it.no)}</td>
            <td class="spec">${it.code ? `<b>${esc(it.code)}</b> ` : ""}${esc(it.spec)}${it.note ? `<span class="pnote"> — ${esc(it.note)}</span>` : ""}${srcRef(it)}</td>
            <td class="unit">${esc(it.unit)}</td>
            <td class="num pend">pending</td>
          </tr>`).join("")}
        </tbody>
      </table>` : "";
    return `
      <h2>${i + 1}. ${esc(b.name)}${b.scope ? ` <span style="color:#889;font-weight:400;text-transform:none">— ${esc(b.scope)}</span>` : ""}</h2>
      <table>
        <thead><tr><th>Sl. No</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">No priced items.</td></tr>`}</tbody>
      </table>${pendingTable}
      <table class="summary">
        ${abstractRowsHtml(c)}
        <tr class="grand"><td>${esc(b.name)} total</td><td class="num">${inr(c.grandTotal)}</td></tr>
      </table>`;
  };

  const projectTotal = boqs.reduce((s, b) => s + b.commercials.grandTotal, 0);
  const abstractRows = boqs.map((b, i) => `
    <tr><td class="no">${i + 1}</td><td>${esc(b.name)}${b.scope ? ` — ${esc(b.scope)}` : ""}</td><td class="num">${inr(b.commercials.grandTotal)}</td></tr>`).join("");
  const abstract = `
    <div class="pagebreak"></div>
    <h2>Project Abstract</h2>
    <table class="abstract">
      <thead><tr><th>#</th><th>Bill of Quantities</th><th class="num">Amount (incl. GST)</th></tr></thead>
      <tbody>${abstractRows}</tbody>
    </table>
    <table class="summary">
      <tr class="grand"><td>Project grand total</td><td class="num">${inr(projectTotal)}</td></tr>
      <tr class="words"><td colspan="2">Rupees ${esc(amountInWords(projectTotal))} only</td></tr>
    </table>`;

  const brand = p.branding === "firm" && p.firmName ? `<div class="brand">${esc(p.firmName)}</div>${p.firmTagline ? `<div class="tagline">${esc(p.firmTagline)}</div>` : ""}` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>BOQ — ${esc(p.projectName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#1b2233; margin:0; padding:32px; font-size:12px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #f59e0b; padding-bottom:14px; margin-bottom:18px; }
  .brand { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
  .tagline { font-size:11px; color:#778; margin-top:-2px; margin-bottom:2px; }
  .doc-title { text-align:right; font-size:12px; color:#667; }
  h1 { font-size:18px; margin:4px 0 2px; }
  .meta { font-size:11.5px; color:#556; margin-bottom:4px; }
  .draft-notice { border:1px solid #d97706; background:#fffbeb; color:#78350f; padding:10px 12px; margin:0 0 16px; border-radius:4px; font-size:11px; line-height:1.5; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:#334; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin:26px 0 8px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; color:#889; font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.4px; padding:7px 8px; border-bottom:1.5px solid #cdd3dd; background:#f7f8fa; }
  th.num { text-align:right; }
  td { padding:6px 8px; border-bottom:1px solid #f1f2f4; vertical-align:top; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.no { color:#556; white-space:nowrap; width:44px; font-variant-numeric:tabular-nums; }
  td.unit { color:#778; width:52px; }
  td.amt { font-weight:600; }
  td.spec { line-height:1.45; }
  td.spec .code { display:inline-block; font-family:ui-monospace,Menlo,monospace; font-size:10px; color:#b06d08; background:#fdf4e3; padding:0 5px; border-radius:3px; margin-right:6px; white-space:nowrap; }
  td.spec .srcref { color:#99a; font-size:10.5px; font-style:italic; }
  td.num .rb { display:block; color:#99a; font-size:9px; font-weight:400; }
  tr.sub td { background:#1b2233; color:#fff; font-weight:700; font-size:12px; padding:8px 8px; letter-spacing:.02em; }
  tr.sub .ssub { float:right; font-weight:700; color:#f7c877; }
  .summary { width:380px; margin-left:auto; margin-top:14px; }
  .summary td { border:none; padding:6px 8px; font-size:12.5px; color:#445; }
  .summary td.num { color:#1b2233; font-weight:600; }
  .summary tr.grand td { border-top:2px solid #1b2233; font-size:16px; font-weight:800; color:#1b2233; padding-top:10px; }
  .summary tr.words td { font-style:italic; color:#556; font-size:11.5px; padding-top:2px; }
  .abstract { max-width:520px; }
  .abstract td { font-size:12.5px; }
  .pending { margin-top:10px; }
  .pending td.pend { color:#b06d08; font-weight:600; font-style:italic; }
  .pending .pnote { color:#889; font-style:italic; }
  .foot { margin-top:26px; font-size:10px; color:#99a; border-top:1px solid #eee; padding-top:10px; line-height:1.5; }
  .toolbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; background:#1b2233; color:#fff; padding:10px 14px; border-radius:8px; margin-bottom:18px; font-size:12.5px; }
  .toolbar button { background:#f7c877; color:#1b2233; border:none; border-radius:6px; padding:8px 16px; font-size:13px; font-weight:700; cursor:pointer; }
  .toolbar .hint { color:#c9ced8; }
  @media print { body { padding:0; } tr { break-inside:avoid; } .pagebreak { break-before:page; } .no-print { display:none !important; } }
</style></head><body>
  <div class="toolbar no-print">
    <button type="button" onclick="window.print()">&#8681;&nbsp; Save as PDF</button>
    <span class="hint">Opens your browser's print dialog — choose <b>Save as PDF</b> to download this quote.</span>
  </div>
  <div class="draft-notice">${esc(BOQ_DRAFT_DISCLAIMER)}</div>
  <div class="head">
    <div>
      ${brand}
      <h1>${esc(p.projectName)}</h1>
      <div class="meta">${meta}</div>
      ${client ? `<div class="meta">Prepared for: <b>${esc(p.clientName)}</b></div>` : ""}
    </div>
    <div class="doc-title">Priced Bill of Quantities<br>${esc(p.generatedOn)}</div>
  </div>

  ${boqs.map(section).join("\n")}

  ${abstract}

  <div class="foot">
    <b>Basis &amp; conditions.</b> ${boqs.some((b) => statesBasis(b.subheads, b.pendingItems))
      ? "Each quantity states its recorded basis (the estimator's drawing summary, a calculation, an assumption, or \"Basis not recorded\") — not an independent measurement."
      : "This document does not state the basis of each quantity."} Rates are composite rates
    (material, labour and installation), exclusive of GST unless stated, and are confirmed separately. This is a private-project quotation and is
    not priced on any government schedule of rates.${boqs.some((b) => hasDsrRated(b.subheads, b.commercials)) ? ` ${esc(DSR_GST_NOTE)}` : ""}${boqs.map((b) => cpohNote(b.commercials)).find(Boolean) ?? ""} Final measurements and specifications should be verified before execution. This quotation is
    indicative and valid for 15 days from the date above.
  </div>

  ${opts?.autoPrint === false ? "" : `<script>(function(){function pr(){try{window.focus();window.print();}catch(e){}}if(document.readyState==="complete"){setTimeout(pr,300);}else{window.addEventListener("load",function(){setTimeout(pr,300);});}})();</script>`}
</body></html>`;
}

export function openProjectQuote(p: ProjectQuotePayload, boqs: ProjectQuoteBoq[], opts?: { autoPrint?: boolean }): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(buildProjectQuoteHtml(p, boqs, opts));
  w.document.close();
  return true;
}
