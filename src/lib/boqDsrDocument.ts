/**
 * Client-ready quote for the DSR BOQ, structured like a real tender BOQ:
 * grouped by DSR SUB-HEAD (type of work) in chapter order — which is also the
 * construction sequence — with items numbered per sub-head (2.01, 2.02 …), the
 * full DSR specification, and Rate/Amount excluding GST. A separate Abstract of
 * Cost page rolls the sub-heads up through the commercial waterfall
 * (cost index → contingency → overhead → cess → GST → grand total in words).
 */

export interface QuoteItem {
  no: string;            // sub-head item serial, e.g. "2.01"
  code: string | null;   // DSR reference code
  spec: string;          // full DSR nomenclature
  qty: number;
  unit: string;
  rate: number | null;   // excl. GST
  amount: number | null;
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
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
const inr = (n: number | null) => (n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
const qtyFmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

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

/**
 * CPWD-style abstract: works → +cost index → +contingency → +overhead → +cess → +GST.
 */
export function computeCommercials(works: number, i: CommercialInputs): QuoteCommercials {
  const costIndexAmt = works * (i.costIndexPct / 100);
  const worksAdjusted = works + costIndexAmt;
  const contingencyAmt = worksAdjusted * (i.contingencyPct / 100);
  const overheadAmt = worksAdjusted * (i.overheadPct / 100);
  const subTotal = worksAdjusted + contingencyAmt + overheadAmt;
  const cessAmt = subTotal * (i.cessPct / 100);
  const taxable = subTotal + cessAmt;
  const gstAmt = taxable * (i.gstPct / 100);
  const grandTotal = taxable + gstAmt;
  return {
    ...i, works, costIndexAmt, worksAdjusted, contingencyAmt, overheadAmt,
    subTotal, cessAmt, gstAmt, grandTotal, grandTotalWords: amountInWords(grandTotal),
  };
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
  const money = (n: number | null) => (blank ? "" : inr(n));

  const rows = p.subheads.map((sh) => `
    <tr class="sub"><td colspan="6">${sh.no}.00 &nbsp; ${esc(sh.name).toUpperCase()}${blank ? "" : `<span class="ssub">${inr(sh.subtotal)}</span>`}</td></tr>
    ${sh.lines.map((l) => `
      <tr>
        <td class="no">${esc(l.no)}</td>
        <td class="spec">${l.code ? `<span class="code">${esc(l.code)}</span>` : ""}${esc(l.spec)}</td>
        <td class="num">${qtyFmt(l.qty)}</td>
        <td class="unit">${esc(l.unit)}</td>
        <td class="num">${money(l.rate)}</td>
        <td class="num amt">${money(l.amount)}</td>
      </tr>`).join("")}
  `).join("");

  const abstractRows = p.abstract.map((a) => `
    <tr><td class="no">${a.no}.00</td><td>${esc(a.name)}</td><td class="num">${blank ? "" : (a.amount > 0 ? inr(a.amount) : "To be priced")}</td></tr>`).join("");

  const c = p.commercials;
  const wrow = (label: string, amt: number, show = true) =>
    show ? `<tr><td>${label}</td><td class="num">${inr(amt)}</td></tr>` : "";
  const summary = `
    <table class="summary">
      <tr><td>Cost of works (at DSR rates, excl. GST)</td><td class="num">${inr(c.works)}</td></tr>
      ${wrow(`Add: Cost index @ ${c.costIndexPct}%`, c.costIndexAmt, c.costIndexPct !== 0)}
      ${wrow(`Add: Contingencies @ ${c.contingencyPct}%`, c.contingencyAmt, c.contingencyPct !== 0)}
      ${wrow(`Add: Overhead &amp; profit @ ${c.overheadPct}%`, c.overheadAmt, c.overheadPct !== 0)}
      ${wrow(`Add: Labour cess @ ${c.cessPct}%`, c.cessAmt, c.cessPct !== 0)}
      ${wrow(`Add: GST @ ${c.gstPct}%`, c.gstAmt, c.gstPct !== 0)}
      <tr class="grand"><td>Grand total</td><td class="num">${inr(c.grandTotal)}</td></tr>
      <tr class="words"><td colspan="2">Rupees ${esc(c.grandTotalWords)} only</td></tr>
    </table>`;

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
  tr.sub td { background:#1b2233; color:#fff; font-weight:700; font-size:12px; padding:8px 8px; letter-spacing:.02em; }
  tr.sub .ssub { float:right; font-weight:700; color:#f7c877; }
  .summary { width:380px; margin-left:auto; margin-top:14px; }
  .summary td { border:none; padding:6px 8px; font-size:12.5px; color:#445; }
  .summary td.num { color:#1b2233; font-weight:600; }
  .summary tr.grand td { border-top:2px solid #1b2233; font-size:16px; font-weight:800; color:#1b2233; padding-top:10px; }
  .summary tr.words td { font-style:italic; color:#556; font-size:11.5px; padding-top:2px; }
  .abstract { max-width:520px; }
  .abstract td { font-size:12.5px; }
  .foot { margin-top:26px; font-size:10px; color:#99a; border-top:1px solid #eee; padding-top:10px; line-height:1.5; }
  @media print { body { padding:0; } tr { break-inside:avoid; } .pagebreak { break-before:page; } }
</style></head><body>
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
      <th>Sl. No</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate (excl. GST)</th><th class="num">Amount (excl. GST)</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="6">No items.</td></tr>`}</tbody>
  </table>

  ${abstractSection}

  <div class="foot">
    <b>Basis &amp; conditions.</b> Rates are composite rates from the Delhi Schedule of Rates${p.rateYear ? ` ${esc(p.rateYear)}` : ""} (material + labour + plant),
    exclusive of GST, adjusted by the stated cost index for location. Non-Schedule (NS) items, where shown, are outside the DSR and their rates are to be
    analysed from prevailing market / State PWD rates. <b>Quantities are approximate</b>, derived from project parameters and room dimensions, and are
    <b>subject to detailed measurement on site</b>. Items are grouped by DSR sub-head in construction sequence. This quote is indicative and valid for
    15 days from the date above. Generated by Cunstruct.
  </div>

  ${opts?.autoPrint === false ? "" : `<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>`}
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
}
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildBoqCsv(rows: CsvRow[], meta: { boqName: string; project?: string | null; generatedOn: string }): string {
  const HEADER_LINE = 4;
  const head = ["Sub-head", "Item", "DSR code", "Specification", "Unit", "Qty", "Rate (ref, excl GST)", "Your rate", "Amount"];
  const lines: string[] = [
    csvCell(`Bill of Quantities — ${meta.boqName}`),
    csvCell(`${meta.project ?? "Standalone"}  ·  ${meta.generatedOn}  ·  Rates: DSR 2023 reference, excl. GST — edit "Your rate"`),
    "",
    head.map(csvCell).join(","),
  ];
  rows.forEach((r, i) => {
    const ln = HEADER_LINE + 1 + i;
    const amount = r.rate != null ? `=F${ln}*H${ln}` : "";   // Qty(F) × Your rate(H)
    lines.push([
      r.subhead, r.itemNo, r.code ?? "", r.spec, r.unit, r.qty, r.rate ?? "", r.rate ?? "", amount,
    ].map(csvCell).join(","));
  });
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
