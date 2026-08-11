// ChatGPT drawing-evaluation workflow (copy/paste — NO API integration).
//
//   DRAWING → ChatGPT → evaluation → Cunstruct structures it → operator confirms
//   → existing BOQ engine.
//
// Cunstruct does NOT interpret drawings. It generates a ready-to-copy prompt; the
// operator runs ChatGPT externally and pastes the result back; we parse/structure
// it into editable project inputs and drawing-summary rows. Nothing is invented:
// unstated fields stay empty and every quantity is exactly what was pasted.

import { parseDrawingSummary, type DrawingBasis, type DrawingItem } from "./boqDrawing";

/** The prompt Cunstruct hands the operator to paste into ChatGPT (with the drawing). */
export function buildChatGptPrompt(): string {
  return `I am using Cunstruct to prepare a construction BOQ.

Analyse the attached project drawing and return a structured project assessment that I can paste directly back into Cunstruct.

Your job is to understand the drawing and identify the project's characteristics and important drawing-specific information.

DO NOT generate a BOQ.
DO NOT generate prices.
DO NOT provide DSR rates.
DO NOT invent quantities.
DO NOT make unsupported assumptions.

Determine:

## PROJECT TYPE
Choose the closest: Residential, Commercial, Retail, Office, Hospitality, Other.

## ARCHETYPE
Choose the closest: 1 BHK, 2 BHK, 3 BHK, 4 BHK, Villa, Duplex, Apartment, Shop, Office, Other.
If none fits, describe the closest archetype.

## FLOORS
Identify the number of floors / levels represented in the drawing.

## AREA
Provide built-up area, carpet area or covered area only when explicitly stated or reliably derivable.
Clearly identify which type of area it is. Do not invent an area.

## SPACES
List identifiable rooms / spaces and quantities, e.g.
- Living room — 1
- Kitchen — 1
- Bedroom — 3
- Bathroom — 3

## DISCIPLINES
Identify disciplines represented in the drawing: Civil, Architectural, Electrical, Plumbing, HVAC, Fire, Furniture, Other.

## DRAWING-SPECIFIC MEASUREMENTS
List useful measurements the Cunstruct operator should consider. Keep dimensions separate from quantities, e.g.
- Wall length — 10'-8"
- Switchboard height — 51"
- TV size — 55"
- Offset — 4" from BOS
Do not convert a dimension into a quantity unless the drawing explicitly supports that calculation.

## DRAWING-SPECIFIC REQUIREMENTS
Count the actual symbols on the drawing and return a row for EVERY countable requirement. Do NOT summarise as "shown", "multiple" or "indicated" — give a number for each. If a category is clearly present but you cannot count it confidently, still return a row with your best count, set Basis = Assumed, and add a confirmation below.

Return a markdown table with exactly these columns:
Requirement | Qty | Unit | Basis | Location / Note | Scope

- Basis: Counted, Measured, Derived or Assumed (Assumed only when unavoidable, and flag it).
- Location: the room if identifiable, otherwise write "Location unclear" — never guess a room.
- Scope: "Works" for contractor work (points, sockets, conduit, provisions) or "Equipment" for client-supplied items (the TV, projector, appliances themselves — not their electrical points).

Actively look for and count each of these where the discipline appears in the drawing:
- Electrical: lighting points; 6A sockets; 16A points; AC points; TV points; audio/speaker points; exhaust points (there may be several); switchboards (and module sizes); floor points / floor boxes; floor-to-ceiling conduits; appliance points (dishwasher, washing machine, oven, fridge, geyser); projector points; blind/curtain provisions.
- Plumbing: WC; wash basin; shower; sink; floor traps; water & waste points.
- HVAC: AC units; AC points; exhaust; ducting.
- Fire: detectors; sprinklers; alarm points; extinguishers.
- Architectural / Civil: doors; windows; grills; wardrobes; counters.
For any category clearly not present, write a row of "none seen" rather than omitting it silently.

Examples:
TV point | 1 | nos | Counted | Living / TV area | Works
6A socket | 4 | nos | Counted | Bedroom 1 | Works
55" TV | 1 | nos | Counted | Living / TV area | Equipment

## CONFIDENCE
Give confidence (High / Medium / Low) for: Project type, Archetype, Floors, Area, Major space identification.

## CONFIRMATIONS
List anything the Cunstruct operator should verify before generating the BOQ. If the drawing is ambiguous, do not guess.

## IMPORTANT
The human operator makes the final decision. Do not silently infer information not supported by the drawing. Return a clean structured response that can be pasted directly into Cunstruct.`;
}

export interface EvalArea { value: number; type: string; raw: string }
export interface EvalSpace { name: string; qty: number }
export interface EvalMeasurement { label: string; value: string; note?: string }

export interface ChatGptEval {
  projectType?: string;
  archetype?: string;        // as ChatGPT phrased it, e.g. "3 BHK"
  archetypeKey?: string;     // mapped to an ARCHETYPES key, or undefined
  floors?: number;
  area: EvalArea | null;     // null = not provided (never invented)
  spaces: EvalSpace[];
  disciplines: string[];
  measurements: EvalMeasurement[];
  requirements: DrawingItem[];
  /** Categories ChatGPT saw but did not count — surfaced as a reminder, never as quantities. */
  keyInfo: string[];
  confidence: Record<string, string>;   // "project type" → "High" | "Medium" | "Low"
  confirmations: string[];
  /** true when at least one meaningful field was recognised. */
  ok: boolean;
}

// Exact heading labels → canonical section. Real ChatGPT output varies a lot
// (## headings, **bold**, "Field: value" on one line, alternative names), so we
// map generously. Exact matches win before any prefix match, so e.g. "IMPORTANT
// DIMENSIONS" maps to MEASUREMENTS rather than being swallowed by "IMPORTANT".
const ALIAS: Record<string, string> = {
  "PROJECT TYPE": "PROJECT TYPE", "PROJECT ASSESSMENT": "IGNORE", "ASSESSMENT": "IGNORE",
  "ARCHETYPE": "ARCHETYPE", "PROJECT ARCHETYPE": "ARCHETYPE",
  "FLOORS": "FLOORS", "FLOORS/LEVELS": "FLOORS", "FLOORS / LEVELS": "FLOORS", "LEVELS": "FLOORS", "NUMBER OF FLOORS": "FLOORS",
  "AREA": "AREA", "BUILT-UP AREA": "AREA", "BUILTUP AREA": "AREA", "CARPET AREA": "AREA",
  "SPACES": "SPACES", "ROOMS": "SPACES", "SPACES/ROOMS": "SPACES", "SPACES / ROOMS": "SPACES", "ROOMS/SPACES": "SPACES",
  "DISCIPLINES": "DISCIPLINES",
  "MEASUREMENTS": "MEASUREMENTS", "DIMENSIONS": "MEASUREMENTS",
  "DRAWING-SPECIFIC MEASUREMENTS": "MEASUREMENTS", "IMPORTANT DIMENSIONS": "MEASUREMENTS", "KEY DIMENSIONS": "MEASUREMENTS",
  "REQUIREMENTS": "REQUIREMENTS", "DRAWING-SPECIFIC REQUIREMENTS": "REQUIREMENTS",
  "DRAWING REQUIREMENTS": "REQUIREMENTS", "COUNTABLE REQUIREMENTS": "REQUIREMENTS",
  "KEY DRAWING INFORMATION": "KEY INFO", "KEY DRAWING INFO": "KEY INFO", "KEY INFORMATION": "KEY INFO", "OBSERVATIONS": "KEY INFO",
  "CONFIDENCE": "CONFIDENCE",
  "CONFIRMATIONS": "CONFIRMATIONS", "CONFIRMATION": "CONFIRMATIONS", "TO CONFIRM": "CONFIRMATIONS", "VERIFY": "CONFIRMATIONS",
  "IMPORTANT": "IGNORE", "NOTES": "IGNORE", "BOQ GENERATION RULES": "IGNORE", "RULES": "IGNORE", "SUMMARY": "IGNORE",
};
const PREFIX_CANON = ["PROJECT TYPE", "ARCHETYPE", "DISCIPLINES", "CONFIRMATIONS", "CONFIDENCE", "MEASUREMENTS", "REQUIREMENTS", "SPACES", "FLOORS", "AREA"];

/** Is this line a section heading? Returns its canonical name + any inline value. */
function headerInfo(line: string): { name: string; inline: string } | null {
  const t = line.trim();
  if (!t || /^[-*•]/.test(t)) return null;                     // bullets are content, never headings
  if (/^[|:—–-]+$/.test(t.replace(/\s/g, ""))) return null;    // table separators
  const decorated = /^#{1,6}\s/.test(t) || /^\*\*.+\*\*/.test(t.replace(/:.*$/, ""));
  const bare = t.replace(/^#{1,6}\s*/, "").replace(/^>+\s*/, "").replace(/^\*\*|\*\*/g, "").trim();
  const ci = bare.indexOf(":");
  const labelRaw = (ci >= 0 ? bare.slice(0, ci) : bare).trim();
  const inline = ci >= 0 ? bare.slice(ci + 1).trim() : "";
  const label = labelRaw.replace(/[*_`#.]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!label) return null;
  const words = labelRaw.split(/\s+/).length;
  // Guard against treating ordinary prose as a heading.
  if (!decorated) { if (ci < 0 && words > 5) return null; if (ci >= 0 && words > 6) return null; }
  let name = ALIAS[label];
  if (!name) name = PREFIX_CANON.find((c) => label === c || label.startsWith(c + " ") || label.startsWith(c + "/"));
  return name ? { name, inline } : null;
}

/** Split the pasted response into { SECTION: text }, keeping inline "Field: value". */
function splitSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => { if (current && current !== "IGNORE") out[current] = ((out[current] ? out[current] + "\n" : "") + buf.join("\n")).trim(); buf.length = 0; };
  for (const line of (text || "").split(/\r?\n/)) {
    const h = headerInfo(line);
    if (h) { flush(); current = h.name; if (h.inline) buf.push(h.inline); }
    else if (current) buf.push(line);
  }
  flush();
  return out;
}

// The option that appears EARLIEST in the text — so "Likely 3 BHK, but could be
// 2 BHK" resolves to the primary "3 BHK", not whichever we happened to list first.
function firstOf(sec: string | undefined, opts: string[]): string | undefined {
  if (!sec) return undefined;
  let best: string | undefined; let bestIdx = Infinity;
  for (const o of opts) {
    const m = sec.match(new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
    if (m && m.index != null && m.index < bestIdx) { bestIdx = m.index; best = o; }
  }
  return best;
}

function archetypeKeyFor(label?: string): string | undefined {
  if (!label) return undefined;
  const t = label.toLowerCase();
  const bhk = t.match(/([1-4])\s*bhk/);
  if (bhk) return bhk[1] === "1" ? "1bhk" : bhk[1] === "2" ? "2bhk" : bhk[1] === "3" ? "3bhk" : "villa";
  if (t.includes("villa") || t.includes("bungalow")) return "villa";
  if (t.includes("duplex")) return "duplex";
  if (t.includes("apartment")) return "apartment_floor";
  if (t.includes("shop")) return "shop";
  return undefined;   // office / other → operator picks
}

function parseFloors(sec?: string): number | undefined {
  if (!sec) return undefined;
  const gp = sec.match(/\bG\s*\+\s*(\d+)/i);
  if (gp) return Number(gp[1]) + 1;
  if (/\b(single|one)\b/i.test(sec) && /floor|storey|level/i.test(sec)) return 1;
  const m = sec.match(/\b(\d+)\b/);
  return m ? Number(m[1]) : undefined;
}

function parseArea(sec?: string): EvalArea | null {
  if (!sec) return null;
  if (/\bnot\s+(provided|available|stated|specified|derivable|given|mentioned)\b/i.test(sec)) return null;
  const m = sec.match(/([\d,]+(?:\.\d+)?)\s*(sq\.?\s?ft|sqft|sq\.?\s?m|sqm|square\s*(?:feet|metres?|meters?))/i);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  if (!(value > 0)) return null;
  const type = /carpet/i.test(sec) ? "carpet" : /covered/i.test(sec) ? "covered" : "built-up";
  return { value, type, raw: m[0].trim() };
}

function parseSpaces(sec?: string): EvalSpace[] {
  if (!sec) return [];
  const out: EvalSpace[] = [];
  for (let line of sec.split(/\r?\n/)) {
    line = line.trim().replace(/^[-*•]\s*/, "");
    if (!line || /^spaces?$/i.test(line)) continue;
    const m = line.match(/^(.+?)[\s|:—–-]+(\d+)\s*(?:nos?|units?)?\.?$/i);
    if (m) { const name = m[1].replace(/[|:—–-]+$/, "").trim(); if (name) out.push({ name, qty: Number(m[2]) }); }
  }
  return out;
}

const DISCIPLINE_WORDS = ["Civil", "Architectural", "Electrical", "Plumbing", "HVAC", "Fire", "Furniture"];
function parseDisciplines(sec?: string): string[] {
  if (!sec) return [];
  const found = new Set<string>();
  for (const line of sec.split(/\r?\n/)) {
    if (/\b(not identified|not shown|not present|none|absent|n\/a|not applicable)\b/i.test(line)) continue;
    for (const d of DISCIPLINE_WORDS) if (new RegExp(`\\b${d}\\b`, "i").test(line)) found.add(d);
  }
  return DISCIPLINE_WORDS.filter((d) => found.has(d));
}

function parseMeasurements(sec?: string): EvalMeasurement[] {
  if (!sec) return [];
  const out: EvalMeasurement[] = [];
  for (let line of sec.split(/\r?\n/)) {
    line = line.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;
    if (line.includes("|")) {
      const cols = line.split("|").map((c) => c.trim());
      if (cols[0] === "") cols.shift();
      if (cols[cols.length - 1] === "") cols.pop();
      if (/^(measurement|item)$/i.test(cols[0] ?? "") || cols.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
      if (cols[0] && cols[1]) out.push({ label: cols[0], value: cols[1], note: cols.slice(2).join(" · ").trim() || undefined });
      continue;
    }
    // "Label: value" (colon, unambiguous) or "Label — value" (spaced dash)
    let m = line.match(/^(.+?):\s*(.+)$/);
    if (!m) m = line.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (m && m[1] && m[2]) out.push({ label: m[1].trim(), value: m[2].trim() });
  }
  return out;
}

/** Categories/observations ChatGPT noted without a count — a reminder to count them. */
function parseKeyInfo(sec?: string): string[] {
  if (!sec) return [];
  return sec.split(/\r?\n/).map((l) => l.trim().replace(/^[-*•]\s*/, "").trim()).filter((l) => l.length > 2);
}

function normBasis(s?: string): DrawingBasis {
  const t = (s || "").toLowerCase();
  if (t.includes("measur")) return "Measured";
  if (t.includes("deriv")) return "Derived";
  if (t.includes("assum")) return "Assumed";
  return "Counted";
}

/** Requirements table → DrawingItems (reusing the drawing-summary schema). */
function parseRequirements(sec?: string): DrawingItem[] {
  if (!sec) return [];
  const items: DrawingItem[] = [];
  const loose: string[] = [];
  for (let line of sec.split(/\r?\n/)) {
    line = line.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;
    if (/\bnone seen\b|\bnot present\b|\bnot applicable\b/i.test(line)) continue;   // explicit "no items" rows
    if (line.includes("|")) {
      const cols = line.split("|").map((c) => c.trim());
      if (cols[0] === "") cols.shift();
      if (cols[cols.length - 1] === "") cols.pop();
      if (/^requirement$/i.test(cols[0] ?? "") || cols.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
      const [req, qtyRaw, unit, basisRaw] = cols;
      const rest = cols.slice(4);
      const qty = Number((qtyRaw || "").match(/[\d.]+/)?.[0]);
      if (req && qty > 0) {
        // A trailing Works/Equipment cell is the Scope column — the rest is the location/note.
        let equipment: boolean | undefined;
        if (rest.length && /^(works?|equipment|client(?:\s*supplied)?)$/i.test(rest[rest.length - 1])) {
          equipment = /equip|client/i.test(rest.pop() as string);
        }
        items.push({ match: req, qty, unit: unit?.trim() || undefined, basis: normBasis(basisRaw), equipment, note: rest.join(" · ").trim() || undefined });
      } else if (req) {
        loose.push(line.replace(/\|/g, " "));
      }
      continue;
    }
    loose.push(line);
  }
  if (loose.length) items.push(...parseDrawingSummary(loose.join("\n")));
  return items;
}

function parseConfidence(sec?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!sec) return out;
  for (let line of sec.split(/\r?\n/)) {
    line = line.trim().replace(/^[-*•]\s*/, "");
    const m = line.match(/^(.+?)\s*[—–:|-]\s*(high|medium|low)\b/i);
    if (m) out[m[1].trim().toLowerCase()] = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  }
  return out;
}

function parseConfirmations(sec?: string): string[] {
  if (!sec) return [];
  return sec.split(/\r?\n/).map((l) => l.trim().replace(/^[-*•]\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter((l) => l.length > 3);
}

/** Parse a pasted ChatGPT evaluation into structured, editable project inputs. */
export function parseChatGptEvaluation(text: string): ChatGptEval {
  const s = splitSections(text);
  const projectType = firstOf(s["PROJECT TYPE"], ["Residential", "Commercial", "Retail", "Office", "Hospitality", "Other"]);
  const archetype = firstOf(s["ARCHETYPE"], ["1 BHK", "2 BHK", "3 BHK", "4 BHK", "Villa", "Duplex", "Apartment", "Shop", "Office"]);
  const requirements = parseRequirements(s["REQUIREMENTS"]);
  const spaces = parseSpaces(s["SPACES"]);
  const area = parseArea(s["AREA"]);
  const floors = parseFloors(s["FLOORS"]);
  const eval_: ChatGptEval = {
    projectType,
    archetype,
    archetypeKey: archetypeKeyFor(archetype),
    floors,
    area,
    spaces,
    disciplines: parseDisciplines(s["DISCIPLINES"]),
    measurements: parseMeasurements(s["MEASUREMENTS"]),
    requirements,
    keyInfo: parseKeyInfo(s["KEY INFO"]),
    confidence: parseConfidence(s["CONFIDENCE"]),
    confirmations: parseConfirmations(s["CONFIRMATIONS"]),
    ok: false,
  };
  eval_.ok = Boolean(projectType || eval_.archetypeKey || archetype || floors || area || spaces.length || requirements.length || eval_.keyInfo.length);
  return eval_;
}
