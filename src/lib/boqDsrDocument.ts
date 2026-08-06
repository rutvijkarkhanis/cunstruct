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
    <tr><td class="no">${i + 1}</td><td>${esc(a.stage)}</td><td class="num">${inr(a.amount)}</td></tr>`).join("");

  const c = p.commercials;
  const summary = `
    <table class="summary">
      <tr><td>Works subtotal (DSR rates)</td><td class="num">${inr(c.subtotal)}</td></tr>
      <tr><td>Overhead &amp; profit @ ${c.overheadPct}%</td><td class="num">${inr(c.overheadAmt)}</td></tr>
      <tr><td>GST @ ${c.gstPct}%</td><td class="num">${inr(c.gstAmt)}</td></tr>
      <tr class="grand"><td>Grand total</td><td class="num">${inr(c.grandTotal)}</td></tr>
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
    Rates are from the Delhi Schedule of Rates${p.rateYear ? ` ${esc(p.rateYear)}` : ""} and are composite (material + labour + plant).
    Quantities are estimates derived from project parameters and standard coverage rates; final quantities are subject to detailed measurement on site.
    Items are grouped by construction stage and type of work. This quote is indicative and valid for 15 days from the date above. Generated by Cunstruct.
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
