/**
 * Tender-grade quote for the DSR BOQ module. Structured the way a real Bill of
 * Quantities reads: grouped by construction STAGE, then by TYPE OF WORK (the DSR
 * sub-head), with numbered items carrying the FULL DSR specification, unit, qty,
 * rate and amount — followed by an Abstract of Cost (stage-wise) and a commercial
 * summary (subtotal → overhead & profit → GST → grand total). Opens in a new tab
 * and triggers the print dialog for PDF/paper.
 */

export interface QuoteLine {
  itemNo: number;
  code: string | null;
  spec: string;          // full DSR nomenclature / specification
  qty: number;
  unit: string;
  rate: number | null;
  amount: number | null;
}
export interface QuoteSection {          // a "type of work" (DSR sub-head) within a stage
  name: string;
  lines: QuoteLine[];
  subtotal: number;
}
export interface QuoteStage {
  name: string;
  sections: QuoteSection[];
  subtotal: number;
}
export interface CommercialInputs {
  costIndexPct: number;    // DSR is Delhi-base; location cost index added on top
  contingencyPct: number;  // unforeseen site conditions (CPWD ~3–5%)
  overheadPct: number;     // contractor overhead & profit
  cessPct: number;         // statutory BOCW labour welfare cess (1%)
  gstPct: number;          // GST on works contract (18%)
}
export interface QuoteCommercials extends CommercialInputs {
  works: number;           // at DSR rates
  costIndexAmt: number;
  worksAdjusted: number;   // works + cost index
  contingencyAmt: number;
  overheadAmt: number;
  subTotal: number;        // worksAdjusted + contingency + overhead
  cessAmt: number;
  gstAmt: number;
  grandTotal: number;
  grandTotalWords: string;
}

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
  const parts = [
    crore ? three(crore) + " Crore" : "",
    lakh ? two(lakh) + " Lakh" : "",
    thousand ? two(thousand) + " Thousand" : "",
    n ? three(n) : "",
  ].filter(Boolean);
  return parts.join(" ");
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
  stages: QuoteStage[];
  abstract: { stage: string; amount: number }[];
  commercials: QuoteCommercials;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));

const inr = (n: number | null) =>
  n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");

const qtyFmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function buildDsrQuoteHtml(p: DsrQuotePayload): string {
  const meta = [
    p.clientName ? `Client: ${esc(p.clientName)}` : "",
    p.location ? `Location: ${esc(p.location)}` : "",
    p.builtUpSqft ? `Built-up: ${esc(p.builtUpSqft)} sqft` : "",
    p.floors ? `Floors: ${esc(p.floors)}` : "",
    p.rateYear ? `Basis: DSR ${esc(p.rateYear)}` : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  const stageBlocks = p.stages.map((st, si) => {
    const sections = st.sections.map((sec) => `
      <tr class="sub"><td colspan="6">${esc(sec.name)}</td></tr>
      ${sec.lines.map((l) => `
        <tr>
          <td class="no">${si + 1}.${l.itemNo}</td>
          <td class="spec"><span class="code">${esc(l.code ?? "")}</span>${esc(l.spec)}</td>
          <td class="num">${qtyFmt(l.qty)}</td>
          <td class="unit">${esc(l.unit)}</td>
          <td class="num">${inr(l.rate)}</td>
          <td class="num amt">${inr(l.amount)}</td>
        </tr>`).join("")}
    `).join("");
    return `
      <tr class="stage"><td colspan="6">Stage ${si + 1} — ${esc(st.name)}<span class="ssub">${inr(st.subtotal)}</span></td></tr>
      ${sections}`;
  }).join("");

  const abstractRows = p.abstract.map((a, i) => `
    <tr><td class="no">${i + 1}</td><td>${esc(a.stage)}</td><td class="num">${
      a.stage === "Non-Schedule Items" ? "Rate to be analysed" : inr(a.amount)
    }</td></tr>`).join("");

  const c = p.commercials;
  const row = (label: string, amt: number, show = true) =>
    show ? `<tr><td>${label}</td><td class="num">${inr(amt)}</td></tr>` : "";
  const summary = `
    <table class="summary">
      <tr><td>Cost of works (at DSR rates)</td><td class="num">${inr(c.works)}</td></tr>
      ${row(`Add: Cost index @ ${c.costIndexPct}%`, c.costIndexAmt, c.costIndexPct !== 0)}
      ${row(`Add: Contingencies @ ${c.contingencyPct}%`, c.contingencyAmt, c.contingencyPct !== 0)}
      ${row(`Add: Overhead &amp; profit @ ${c.overheadPct}%`, c.overheadAmt, c.overheadPct !== 0)}
      ${row(`Add: Labour cess @ ${c.cessPct}%`, c.cessAmt, c.cessPct !== 0)}
      ${row(`Add: GST @ ${c.gstPct}%`, c.gstAmt, c.gstPct !== 0)}
      <tr class="grand"><td>Grand total</td><td class="num">${inr(c.grandTotal)}</td></tr>
      <tr class="words"><td colspan="2">Rupees ${esc(c.grandTotalWords)} only</td></tr>
    </table>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>BOQ &amp; Quote — ${esc(p.boqName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#1b2233; margin:0; padding:32px; font-size:12px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #f59e0b; padding-bottom:14px; margin-bottom:18px; }
  .brand { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
  .brand span { color:#f59e0b; }
  .doc-title { text-align:right; font-size:12px; color:#667; }
  h1 { font-size:18px; margin:4px 0 2px; }
  .meta { font-size:11.5px; color:#556; margin-bottom:8px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:#334; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin:26px 0 8px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; color:#889; font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.4px; padding:7px 8px; border-bottom:1.5px solid #cdd3dd; background:#f7f8fa; }
  th.num { text-align:right; }
  td { padding:6px 8px; border-bottom:1px solid #f1f2f4; vertical-align:top; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.no { color:#667; white-space:nowrap; width:38px; font-variant-numeric:tabular-nums; }
  td.unit { color:#778; width:52px; }
  td.amt { font-weight:600; }
  td.spec { line-height:1.45; }
  td.spec .code { display:inline-block; font-family:ui-monospace,Menlo,monospace; font-size:10px; color:#b06d08; background:#fdf4e3; padding:0 5px; border-radius:3px; margin-right:6px; white-space:nowrap; }
  tr.stage td { background:#1b2233; color:#fff; font-weight:700; font-size:12px; padding:8px 8px; letter-spacing:.02em; }
  tr.stage .ssub { float:right; font-weight:700; color:#f7c877; }
  tr.sub td { background:#eef1f6; font-weight:700; font-size:11px; color:#334; padding:5px 8px; }
  .summary { width:360px; margin-left:auto; margin-top:14px; }
  .summary td { border:none; padding:6px 8px; font-size:12.5px; color:#445; }
  .summary td.num { color:#1b2233; font-weight:600; }
  .summary tr.grand td { border-top:2px solid #1b2233; font-size:16px; font-weight:800; color:#1b2233; padding-top:10px; }
  .summary tr.words td { font-style:italic; color:#556; font-size:11.5px; padding-top:2px; }
  .abstract { max-width:520px; }
  .abstract td { font-size:12.5px; }
  .foot { margin-top:26px; font-size:10px; color:#99a; border-top:1px solid #eee; padding-top:10px; line-height:1.5; }
  @media print { body { padding:0; } tr { break-inside:avoid; } }
</style></head><body>
  <div class="head">
    <div>
      <div class="brand">cun<span>struct</span></div>
      <h1>${esc(p.boqName)}</h1>
      <div class="meta">${meta}</div>
    </div>
    <div class="doc-title">Bill of Quantities<br>&amp; Priced Quote<br>${esc(p.generatedOn)}</div>
  </div>

  <h2>Bill of Quantities — by stage &amp; type of work</h2>
  <table>
    <thead><tr>
      <th>Item</th><th>Specification</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Amount</th>
    </tr></thead>
    <tbody>${stageBlocks || `<tr><td colspan="6">No items.</td></tr>`}</tbody>
  </table>

  <h2>Abstract of Cost</h2>
  <table class="abstract">
    <thead><tr><th>#</th><th>Stage</th><th class="num">Amount</th></tr></thead>
    <tbody>${abstractRows}</tbody>
  </table>

  ${summary}

  <div class="foot">
    <b>Basis &amp; conditions.</b> Rates are composite rates from the Delhi Schedule of Rates${p.rateYear ? ` ${esc(p.rateYear)}` : ""} (material + labour + plant),
    adjusted by the stated cost index for location. Non-Schedule (NS) items, where shown, are outside the DSR and their rates are to be analysed
    from prevailing market rates / State PWD schedules before finalisation.
    <b>Quantities are approximate</b>, derived from project parameters and standard coverage; they are <b>subject to detailed measurement on site as per IS 1200</b>
    and may vary. Items are grouped by construction stage and type of work. GST is on the works-contract value. This quote is indicative and valid for 15 days
    from the date above. Generated by Cunstruct.
  </div>

  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;
}

/**
 * Compute the CPWD-style abstract of cost from the works value (at DSR rates)
 * and the commercial percentages:
 *   works → +cost index → +contingency → +overhead & profit → +cess → +GST.
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

// ---- Excel (CSV) export ----------------------------------------------------
// A structured take-off the estimator prices their own way: quantities are
// filled, "Your rate" starts from the DSR reference and is editable, and Amount
// is a live Excel formula (Qty × Your rate) that recalculates as they retype.

export interface CsvRow {
  stage: string;
  section: string;
  itemNo: number | string;
  code: string | null;
  spec: string;
  unit: string;
  qty: number;
  dsrRate: number | null;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildBoqCsv(rows: CsvRow[], meta: { boqName: string; project?: string | null; generatedOn: string }): string {
  const HEADER_LINE = 4; // title, meta, blank, header
  const head = ["Stage", "Type of work", "Item", "DSR code", "Specification", "Unit", "Qty", "Rate (ref)", "Your rate", "Amount"];
  const lines: string[] = [
    csvCell(`Bill of Quantities — ${meta.boqName}`),
    csvCell(`${meta.project ?? "Standalone"}  ·  ${meta.generatedOn}  ·  Rates: DSR 2023 (reference — edit "Your rate")`),
    "",
    head.map(csvCell).join(","),
  ];
  rows.forEach((r, i) => {
    const ln = HEADER_LINE + 1 + i;            // this data row's spreadsheet line
    const yourRate = r.dsrRate ?? "";          // pre-fill from DSR; blank for NS items
    const amount = r.dsrRate != null ? `=G${ln}*I${ln}` : "";
    lines.push([
      r.stage, r.section, r.itemNo, r.code ?? "", r.spec, r.unit,
      r.qty, r.dsrRate ?? "", yourRate, amount,
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

/** Open the quote in a new tab and trigger the print dialog. */
export function openDsrQuote(p: DsrQuotePayload): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(buildDsrQuoteHtml(p));
  w.document.close();
  return true;
}
