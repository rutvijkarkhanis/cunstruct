/**
 * Client-ready quote for the DSR BOQ module. Unlike the template document, this
 * carries rates and amounts and a proper commercial summary (subtotal → overhead
 * & profit → GST → grand total), so an estimator/architect can hand it straight
 * to a client. Opens in a new tab and triggers the print dialog for PDF/paper.
 */

export interface QuoteLine {
  code: string | null;
  description: string;
  qty: number;
  unit: string;
  rate: number | null;
  amount: number | null;
}
export interface QuoteSection {
  name: string;
  lines: QuoteLine[];
  subtotal: number;
}
export interface QuoteCommercials {
  subtotal: number;
  overheadPct: number;
  overheadAmt: number;
  gstPct: number;
  gstAmt: number;
  grandTotal: number;
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
  sections: QuoteSection[];
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
    p.rateYear ? `DSR ${esc(p.rateYear)}` : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  const rows = p.sections.map((sec) => `
    <tr class="sec"><td colspan="5">${esc(sec.name)}<span class="sub">${inr(sec.subtotal)}</span></td></tr>
    ${sec.lines.map((l) => `
      <tr>
        <td class="code">${esc(l.code ?? "")}</td>
        <td>${esc(l.description)}</td>
        <td class="num">${qtyFmt(l.qty)} <span class="u">${esc(l.unit)}</span></td>
        <td class="num">${inr(l.rate)}</td>
        <td class="num">${inr(l.amount)}</td>
      </tr>`).join("")}
  `).join("");

  const c = p.commercials;
  const summary = `
    <table class="summary">
      <tr><td>Works subtotal (DSR rates)</td><td class="num">${inr(c.subtotal)}</td></tr>
      <tr><td>Overhead &amp; profit @ ${c.overheadPct}%</td><td class="num">${inr(c.overheadAmt)}</td></tr>
      <tr><td>GST @ ${c.gstPct}%</td><td class="num">${inr(c.gstAmt)}</td></tr>
      <tr class="grand"><td>Grand total</td><td class="num">${inr(c.grandTotal)}</td></tr>
    </table>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Quote — ${esc(p.boqName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#1b2233; margin:0; padding:32px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #f59e0b; padding-bottom:14px; margin-bottom:18px; }
  .brand { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
  .brand span { color:#f59e0b; }
  .doc-title { text-align:right; font-size:12px; color:#667; }
  h1 { font-size:18px; margin:4px 0 2px; }
  .meta { font-size:12px; color:#556; margin-bottom:20px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:0.6px; color:#334; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin:26px 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th { text-align:left; color:#889; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; padding:6px 8px; border-bottom:1px solid #e5e7eb; }
  td { padding:5px 8px; border-bottom:1px solid #f1f2f4; vertical-align:top; }
  td.num, th.num { text-align:right; white-space:nowrap; }
  td.num .u { color:#99a; font-size:11px; }
  td.code, th.code { font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#667; width:62px; white-space:nowrap; }
  tr.sec td { background:#f7f8fa; font-weight:700; font-size:12px; padding:9px 8px; }
  tr.sec .sub { float:right; font-weight:700; }
  .summary { width:340px; margin-left:auto; margin-top:16px; }
  .summary td { border:none; padding:6px 8px; font-size:13px; color:#445; }
  .summary td.num { color:#1b2233; font-weight:600; }
  .summary tr.grand td { border-top:2px solid #1b2233; font-size:16px; font-weight:800; color:#1b2233; padding-top:10px; }
  .foot { margin-top:28px; font-size:10.5px; color:#99a; border-top:1px solid #eee; padding-top:10px; }
  @media print { body { padding:0; } .noprint { display:none; } }
</style></head><body>
  <div class="head">
    <div>
      <div class="brand">cun<span>struct</span></div>
      <h1>${esc(p.boqName)}</h1>
      <div class="meta">${meta}</div>
    </div>
    <div class="doc-title">Bill of Quantities<br>&amp; Priced Quote<br>${esc(p.generatedOn)}</div>
  </div>

  <h2>Bill of Quantities</h2>
  <table>
    <thead><tr><th class="code">DSR</th><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5">No items.</td></tr>`}</tbody>
  </table>

  ${summary}

  <div class="foot">
    Rates are from the Delhi Schedule of Rates${p.rateYear ? ` ${esc(p.rateYear)}` : ""}. Quantities are estimates derived from
    project parameters and standard coverage; final quantities may vary on site. This quote is indicative and valid for 15 days. Generated by Cunstruct.
  </div>

  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;
}

/** Compute the commercial summary from a works subtotal + overhead/GST percentages. */
export function computeCommercials(subtotal: number, overheadPct: number, gstPct: number): QuoteCommercials {
  const overheadAmt = subtotal * (overheadPct / 100);
  const taxable = subtotal + overheadAmt;
  const gstAmt = taxable * (gstPct / 100);
  return { subtotal, overheadPct, overheadAmt, gstPct, gstAmt, grandTotal: taxable + gstAmt };
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
