/**
 * Builds the contractor-facing deliverable: a clean, branded, printable
 * document with the full Bill of Quantities followed by the commercial offer
 * ("what we can supply"). Opens in a new window and triggers the print dialog,
 * so ops can hand over a PDF or paper copy — the actual "BOQ as a service".
 */

export interface DocLine {
  name: string;
  qty: number;
  unit: string;
  price: number | null;
  lineTotal: number;
  priced: boolean;
}
export interface DocStage {
  name: string;
  sequence: number;
  lines: DocLine[];
}
export interface BoqDocPayload {
  projectName: string;
  customerName?: string | null;
  location?: string | null;
  builtUpSqft?: number | null;
  floors?: number | null;
  qualityTier?: string | null;
  generatedOn: string; // pre-formatted date string
  stages: DocStage[];
  offerTotal: number;
  gapNames: string[];
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));

const inr = (n: number) =>
  "₹" + Math.round(n).toLocaleString("en-IN");

export function buildBoqDocumentHtml(p: BoqDocPayload): string {
  const meta = [
    p.customerName ? `Client: ${esc(p.customerName)}` : "",
    p.location ? `Location: ${esc(p.location)}` : "",
    p.builtUpSqft ? `Built-up: ${esc(p.builtUpSqft)} sqft` : "",
    p.floors ? `Floors: ${esc(p.floors)}` : "",
    p.qualityTier ? `Finish: ${esc(p.qualityTier)}` : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  const boqRows = p.stages.map((st) => `
    <tr class="stage"><td colspan="3">${st.sequence}. ${esc(st.name)}</td></tr>
    ${st.lines.map((l) => `
      <tr>
        <td>${esc(l.name)}</td>
        <td class="num">${esc(l.qty)}</td>
        <td class="unit">${esc(l.unit)}</td>
      </tr>`).join("")}
  `).join("");

  const offerStages = p.stages
    .map((st) => ({ ...st, lines: st.lines.filter((l) => l.priced) }))
    .filter((st) => st.lines.length > 0);

  const offerRows = offerStages.map((st) => {
    const sub = st.lines.reduce((s, l) => s + l.lineTotal, 0);
    return `
      <tr class="stage"><td colspan="4">${st.sequence}. ${esc(st.name)}<span class="sub">${inr(sub)}</span></td></tr>
      ${st.lines.map((l) => `
        <tr>
          <td>${esc(l.name)}</td>
          <td class="num">${esc(l.qty)} ${esc(l.unit)}</td>
          <td class="num">${l.price != null ? inr(l.price) : "—"}</td>
          <td class="num">${inr(l.lineTotal)}</td>
        </tr>`).join("")}
    `;
  }).join("");

  const gaps = p.gapNames.length
    ? `<div class="gaps"><b>Items to be sourced</b> (not currently stocked): ${p.gapNames.map(esc).join(", ")}.</div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>BOQ — ${esc(p.projectName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1b2233; margin: 0; padding: 32px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid #f59e0b; padding-bottom: 14px; margin-bottom: 18px; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
  .brand span { color:#f59e0b; }
  .doc-title { text-align:right; font-size: 12px; color:#667; }
  h1 { font-size: 18px; margin: 4px 0 2px; }
  .meta { font-size: 12px; color:#556; margin-bottom: 20px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.6px; color:#334; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin: 26px 0 8px; }
  table { width:100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align:left; color:#889; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; padding:6px 8px; border-bottom:1px solid #e5e7eb; }
  td { padding:5px 8px; border-bottom:1px solid #f1f2f4; }
  td.num, th.num { text-align:right; white-space:nowrap; }
  td.unit { color:#889; width:70px; }
  tr.stage td { background:#f7f8fa; font-weight:700; font-size:12px; padding-top:9px; padding-bottom:9px; }
  tr.stage .sub { float:right; font-weight:700; }
  .total { display:flex; justify-content:flex-end; gap:18px; align-items:center; margin-top:12px; padding-top:12px; border-top:2px solid #1b2233; }
  .total .label { color:#556; font-size:13px; }
  .total .val { font-size:20px; font-weight:800; }
  .gaps { margin-top:16px; font-size:11.5px; color:#667; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:10px 12px; }
  .foot { margin-top:28px; font-size:10.5px; color:#99a; border-top:1px solid #eee; padding-top:10px; }
  @media print { body { padding:0; } .noprint { display:none; } }
</style></head><body>
  <div class="head">
    <div>
      <div class="brand">cun<span>struct</span></div>
      <h1>${esc(p.projectName)}</h1>
      <div class="meta">${meta}</div>
    </div>
    <div class="doc-title">Bill of Quantities<br>&amp; Supply Offer<br>${esc(p.generatedOn)}</div>
  </div>

  <h2>Bill of Quantities</h2>
  <table>
    <thead><tr><th>Material</th><th class="num">Qty</th><th>Unit</th></tr></thead>
    <tbody>${boqRows || `<tr><td colspan="3">No items.</td></tr>`}</tbody>
  </table>

  <h2>Commercial Offer — what we can supply</h2>
  <table>
    <thead><tr><th>Material</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${offerRows || `<tr><td colspan="4">No priced items yet.</td></tr>`}</tbody>
  </table>
  <div class="total"><span class="label">Offer total</span><span class="val">${inr(p.offerTotal)}</span></div>
  ${gaps}

  <div class="foot">
    Quantities are estimates derived from the project's dimensions and standard coverage rates; final quantities may vary on site.
    Prices are indicative and valid for 15 days. Generated by Cunstruct.
  </div>

  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;
}

/** Open the document in a new tab and trigger the print dialog. */
export function openBoqDocument(p: BoqDocPayload) {
  const html = buildBoqDocumentHtml(p);
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
