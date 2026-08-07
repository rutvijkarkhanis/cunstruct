/**
 * Printable Project Intake Form — the thorough data-collection questionnaire an
 * estimator carries to a site/client meeting. It reuses the BOQ questionnaire
 * (so what you print is what drives generation) and wraps it with project/client,
 * a room-by-room table, services, externals, commercials and notes. Known values
 * are pre-filled; everything else prints as a blank line to complete by hand.
 * A `blank` flag clears all values for a fully-blank form.
 */

import { BOQ_SPEC } from "./boqSpec";

export interface IntakePayload {
  projectName?: string | null;
  projectType?: string | null;
  scope?: string | null;
  clientName?: string | null;
  location?: string | null;
  builtUpSqft?: number | null;
  floors?: number | null;
  firmName?: string | null;
  firmTagline?: string | null;
  generatedOn: string;
  spec: Record<string, unknown>;
  rooms: { room_type?: string; name?: string | null; length_ft?: number; width_ft?: number; height_ft?: number; count?: number; electrical_points?: number }[];
  blank?: boolean;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Resolve a questionnaire value to its human label (select → option label, toggle → Yes/No).
function specLabel(key: string, value: unknown): string {
  if (value == null || value === "") return "";
  for (const s of BOQ_SPEC) for (const f of s.fields) {
    if (f.key !== key) continue;
    if (f.type === "toggle") return value ? "Yes" : "No";
    if (f.type === "select") return f.options?.find((o) => o.value === value)?.label ?? String(value);
    if (f.type === "number") return `${value}${f.suffix ? " " + f.suffix : ""}`;
  }
  return String(value);
}

export function buildIntakeFormHtml(p: IntakePayload): string {
  const blank = !!p.blank;
  const v = (val: unknown) => (blank ? "" : esc(val ?? ""));
  const sv = (key: string) => (blank ? "" : esc(specLabel(key, p.spec[key])));

  // A labelled field: value if known, else a fill-in line.
  const field = (label: string, value: string) =>
    `<div class="fld"><span class="lbl">${esc(label)}</span><span class="val">${value || "&nbsp;"}</span></div>`;

  const projectSection = `
    <h2>1. Project &amp; Client</h2>
    <div class="grid2">
      ${field("Project name", v(p.projectName))}
      ${field("Project type", v(p.projectType))}
      ${field("Scope", v(p.scope))}
      ${field("Client name", v(p.clientName))}
      ${field("Contact no.", "")}
      ${field("Email", "")}
      ${field("Site address", v(p.location))}
      ${field("Plot area (sqft)", "")}
      ${field("Plot dimensions", "")}
      ${field("Facing / orientation", "")}
      ${field("Architect / consultant", "")}
      ${field("Prepared by", "")}
    </div>`;

  const buildingSection = `
    <h2>2. Building</h2>
    <div class="grid2">
      ${field("No. of floors", v(p.floors))}
      ${field("Built-up area (sqft)", v(p.builtUpSqft))}
      ${field("Foundation type", "")}
      ${field("Soil type", "")}
      ${BOQ_SPEC.find((s) => s.key === "building")!.fields.map((f) => field(f.label, sv(f.key))).join("")}
    </div>`;

  const roomRows = (blank ? [] : p.rooms).map((r) => `
    <tr>
      <td>${esc(r.room_type ?? "")}</td><td>${esc(r.name ?? "")}</td>
      <td class="c">${esc(r.length_ft ?? "")}</td><td class="c">${esc(r.width_ft ?? "")}</td>
      <td class="c">${esc(r.height_ft ?? "")}</td><td class="c">${esc(r.count ?? "")}</td><td class="c">${esc(r.electrical_points ?? "")}</td>
    </tr>`).join("");
  const blankRoomRows = Array.from({ length: Math.max(0, 14 - (blank ? 0 : p.rooms.length)) }, () =>
    `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  const roomsSection = `
    <h2>3. Rooms (room-by-room)</h2>
    <table class="rooms">
      <thead><tr><th>Room type</th><th>Label</th><th class="c">L (ft)</th><th class="c">W (ft)</th><th class="c">H (ft)</th><th class="c">Qty</th><th class="c">Elec. pts</th></tr></thead>
      <tbody>${roomRows}${blankRoomRows}</tbody>
    </table>`;

  // The remaining questionnaire sections, printed as a form.
  const specSectionKeys = ["flooring", "walls", "openings", "kitchen", "bath", "mep", "external"];
  const specSections = specSectionKeys.map((key, i) => {
    const s = BOQ_SPEC.find((x) => x.key === key);
    if (!s) return "";
    return `<h2>${i + 4}. ${esc(s.title)}</h2><div class="grid2">${s.fields.map((f) => field(f.label, sv(f.key))).join("")}</div>`;
  }).join("");

  const commercialsSection = `
    <h2>${specSectionKeys.length + 4}. Commercials &amp; timeline</h2>
    <div class="grid2">
      ${field("Budget range", "")}
      ${field("Target start", "")}
      ${field("Target completion", "")}
      ${field("Payment terms", "")}
    </div>`;

  const notesSection = `
    <h2>${specSectionKeys.length + 5}. Notes &amp; special requirements</h2>
    <div class="notes">${Array.from({ length: 6 }, () => `<div class="nline"></div>`).join("")}</div>`;

  const brandHtml = p.firmName ? esc(p.firmName) : `cun<span>struct</span>`;
  const tagline = p.firmTagline ? `<div class="tagline">${esc(p.firmTagline)}</div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Project Intake — ${esc(p.projectName ?? "")}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#1b2233; margin:0; padding:30px; font-size:12px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #f59e0b; padding-bottom:12px; margin-bottom:14px; }
  .brand { font-size:20px; font-weight:800; letter-spacing:-0.5px; }
  .brand span { color:#f59e0b; }
  .tagline { font-size:11px; color:#778; }
  .doc-title { text-align:right; font-size:13px; font-weight:700; color:#334; }
  .doc-title small { display:block; font-weight:400; color:#889; font-size:11px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:#1b2233; background:#eef1f6; padding:5px 8px; margin:16px 0 8px; border-radius:3px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:4px 24px; }
  .fld { display:flex; align-items:flex-end; gap:6px; padding:3px 0; }
  .lbl { color:#556; white-space:nowrap; }
  .val { flex:1; border-bottom:1px dotted #aab; min-height:15px; font-weight:600; color:#1b2233; padding-left:4px; }
  table.rooms { width:100%; border-collapse:collapse; }
  table.rooms th { background:#f7f8fa; border:1px solid #dfe3ea; padding:5px 6px; font-size:10px; text-transform:uppercase; letter-spacing:.3px; color:#667; text-align:left; }
  table.rooms td { border:1px solid #e5e7eb; padding:6px; height:24px; }
  table.rooms td.c, table.rooms th.c { text-align:center; }
  .notes .nline { border-bottom:1px dotted #aab; height:22px; }
  .foot { margin-top:20px; font-size:10px; color:#99a; border-top:1px solid #eee; padding-top:8px; }
  @media print { body { padding:0; } h2, table, .fld { break-inside:avoid; } }
</style></head><body>
  <div class="head">
    <div><div class="brand">${brandHtml}</div>${tagline}</div>
    <div class="doc-title">Project Intake Form<small>${esc(p.generatedOn)}</small></div>
  </div>
  ${projectSection}
  ${buildingSection}
  ${roomsSection}
  ${specSections}
  ${commercialsSection}
  ${notesSection}
  <div class="foot">Fill all applicable fields. Room dimensions and finishes drive the Bill of Quantities. Prepared with Cunstruct.</div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;
}

/** Open the intake form in a new tab and trigger print. */
export function openIntakeForm(p: IntakePayload): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(buildIntakeFormHtml(p));
  w.document.close();
  return true;
}
