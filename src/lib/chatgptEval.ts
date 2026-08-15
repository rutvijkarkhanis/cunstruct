// ChatGPT drawing-evaluation workflow (copy/paste — NO API integration).
//
//   DRAWING → ChatGPT → evaluation → Cunstruct structures it → operator confirms
//   → existing BOQ engine.
//
// Cunstruct does NOT interpret drawings. It generates a ready-to-copy prompt; the
// operator runs ChatGPT externally and pastes the result back; we parse/structure
// it into editable project inputs and drawing-summary rows. Nothing is invented:
// unstated fields stay empty and every quantity is exactly what was pasted.

import { defaultSpec, type Spec } from "./boqSpec";
import { parseDrawingSummary, type DrawingBasis, type DrawingItem } from "./boqDrawing";

// Spec keys seeded from a ChatGPT evaluation (drawing requirements, measurements,
// spaces, provenance). They must survive a spec reset — e.g. when the operator
// changes the archetype after the evaluation — or the parsed requirements are lost.
export const SEED_CARRY_KEYS = ["_drawing", "_measurements", "_spaces", "_source", "_area_type", "_floor_scope", "_boq_allocation"] as const;

// Room-count spec fields. When a drawing evaluation is present these are driven
// ONLY by the identified spaces — never by an archetype template — so a generic
// "apartment" default (6 beds / 6 baths / 3 kitchens…) can never masquerade as a
// drawing-derived count. A room type the drawing does not name is left blank.
const ROOM_KEYS = ["bedrooms", "bathrooms", "kitchens", "living", "balconies", "pooja", "utility"] as const;

/** Copy the ChatGPT-seed keys from `current` onto a freshly built base spec. */
export function carrySeed<T extends Record<string, unknown>>(next: T, current: Record<string, unknown> | undefined): T {
  if (!current) return next;
  for (const k of SEED_CARRY_KEYS) if (current[k] !== undefined) (next as Record<string, unknown>)[k] = current[k];
  return next;
}

/** The prompt Cunstruct hands the operator to paste into ChatGPT (with the drawing). */
export function buildChatGptPrompt(): string {
  return `I am using Cunstruct to prepare a construction BOQ. Perform a comprehensive PROJECT SCOPE INVENTORY of the attached drawing FIRST, then return the structured assessment below. Capture the WHOLE scope of work the drawing shows — not only the electrical / MEP points, but the architectural, interior and joinery scope too (feature walls, wardrobes, wine racks, consoles, counters, TV units, entrance features, panelling, false ceilings, etc.). Inventory everything relevant, not every label.

Source boundary:
You may ONLY use the drawing supplied in this conversation. Do not assume any other project documents exist. Do not reference, cite, or ask me to consult CAD files, architectural schedules, legends, specifications, plumbing/fire/electrical/interior drawings, or any other document unless it has actually been supplied here. If something cannot be established from the supplied drawing, say "Not assessable from supplied drawing." Never ask me to obtain another document.

Analyse the attached project drawing and return a structured project assessment that I can paste directly back into Cunstruct.

Core rules:
- DO NOT generate a BOQ, prices, or DSR rates.
- UNKNOWN IS BETTER THAN INVENTED. Be conservative: do not invent quantities or make unsupported assumptions.
- Never create an "Assumed" quantity from an unclear, illegible, ambiguous or partially visible symbol. Either Count it when the drawing clearly supports it, or mark it "Not assessable from supplied drawing" and leave the quantity blank.
- DO NOT DROP an item just because you cannot quantify it. If a feature is clearly drawn but its quantity, area, size or material is not given (e.g. a feature wall, a wardrobe run, an entrance feature), you must still RETAIN it as scope, leave Qty blank, and set Status to "Identified — Needs detail". Silently omitting identified scope is worse than flagging it.
- Do not put a specification (e.g. 16A, 20A, "on ceiling", "concealed") into the quantity field. Keep specifications in the requirement text or the Location / Note.
- Keep dimensions separate from quantities. A dimension (51", 4" from BOS, 10'-8") is a measurement, never a quantity.
- Keep specifications separate from quantities and from measurements. A specification (16A, matte laminate, veneer finish) describes an item; it is never a count.

Determine:

## PROJECT TYPE
Closest of: Residential, Commercial, Retail, Office, Hospitality, Other.

## ARCHETYPE
Closest of: 1 BHK, 2 BHK, 3 BHK, 4 BHK, Villa, Duplex, Apartment, Shop, Office, Other. If none fits, describe the closest.

## FLOORS
Number of floors / levels represented. If unclear from the supplied drawing, say "Not assessable from supplied drawing."

## BOQ ALLOCATION
Which single part of the project does THIS drawing represent — the bucket this BOQ is for? Answer with one of: Floor 1, Floor 2, Floor 3, Floor 4, Common Area, or another clearly labelled section. If the drawing is one private floor, give the floor (e.g. "Floor 1"). Do NOT treat this as the number of floors in the whole building.

## FLOOR SCOPE
A one-line description of what this drawing covers, e.g. "First Floor / Floor 1 private apartment". Keep it to what the supplied drawing shows.

## AREA
Give built-up / carpet / covered area ONLY if it is explicitly stated or reliably measurable from the supplied drawing (say which type). Otherwise write exactly "Not provided" — do not estimate it and do not ask me to fetch it from another document.

## SPACES
Identifiable rooms / spaces and counts, e.g.
- Bedroom — 3
- Kitchen — 1
Do not present a space as more certain than the drawing supports; if unsure, lower its confidence and add a confirmation.

## DISCIPLINES
Split into two lists, based ONLY on the supplied drawing (Civil, Architectural, Electrical, Plumbing, HVAC, Fire, Furniture):
Identified in drawing: <disciplines that have actual scope/evidence in this drawing>
Not assessable: <disciplines with no clear evidence in this drawing>

## DRAWING-SPECIFIC MEASUREMENTS
Dimensions and specifications ONLY — never quantities. e.g.
- Switchboard heights — 10.5", 21", 51", 72"
- TV size — 55"
- Geyser point offset — 4" from BOS
- AC point specification — 16A, on ceiling

## DRAWING-SPECIFIC REQUIREMENTS
Every item of scope you can see in the drawing — quantified where the drawing supports it, and RETAINED but flagged where it does not. Return a markdown table with exactly these columns:
Requirement | Qty | Unit | Basis | Location / Note | Scope | Status
- Qty: the count/measure only when the drawing clearly supports it; otherwise leave BLANK (never guess, never put a spec or a dimension here).
- Basis: Counted (visible symbols), Measured (an explicit measurement), Derived (from measurements in the drawing), or "Not assessable" (the drawing does not support a number — leave Qty blank).
- Location: the room if identifiable, otherwise "Location unclear". Never guess a room.
- Scope: "Works" for contractor work (points, sockets, conduit, provisions, AND fixed joinery / built-ins such as wardrobes, feature walls, counters, TV units, panelling), "Equipment" for loose client-supplied items (the TV, projector, appliances themselves — not their electrical points or the joinery around them), or "Needs confirmation" when Works-vs-Equipment cannot be told from the drawing.
- Status: "Quantified" (Qty filled from the drawing), "Identified — Needs detail" (clearly drawn but not quantifiable yet — Qty blank), or "Not assessable" (cannot even be confirmed present).

Check each category below and return, for EACH, one of: (a) Identified + quantity, (b) None seen, or (c) Not assessable from supplied drawing. "None seen" means it is not in THIS drawing — not that the project does not need it.
- Electrical: lighting points; 6A sockets; 16A points; AC points; TV points; audio points; exhaust points; switchboards (+ module config); floor points / floor boxes; conduits; appliance points (dishwasher, washing machine, oven, fridge, geyser); projector points; blind provisions.
- Plumbing: WC; wash basin; shower; sink; floor traps; water & waste points.
- HVAC: AC units; AC points; exhaust; ducting.
- Fire: detectors; sprinklers; alarm points; extinguishers.
- Architectural / Civil: doors; windows; grills; partitions; false ceiling; flooring / skirting; wall finishes / cladding.
- Interior / Joinery (fixed works — inventory these even when unquantified): feature walls; wardrobes; TV units / TV panelling; wine racks; consoles; counters / vanities; kitchen platform & storage; entrance features; wall panelling; loose furniture (mark as Equipment).

Examples:
TV point | 1 | nos | Counted | Living / TV area | Works | Quantified
Geyser electrical point | 1 | nos | Counted | Bathroom | Works | Quantified
55" TV | 1 | nos | Counted | Living / TV area | Equipment | Quantified
Feature wall |  |  | Not assessable | Living, behind sofa | Works | Identified — Needs detail
Wardrobe |  |  | Not assessable | Master bedroom | Works | Identified — Needs detail
Entrance feature |  |  | Not assessable | Entrance / foyer | Works | Identified — Needs detail
Floor trap |  |  | Not assessable | plumbing symbols not legible | Works | Not assessable

## CONFIDENCE
High / Medium / Low for: Project type, Archetype, Floors, Area, Major space identification.

## CONFIRMATIONS
Only questions that can be resolved from the supplied drawing or by my own judgement. Base every question on what is visible in the supplied drawing. Never ask me to check a schedule, CAD file, or another drawing that was not supplied. e.g. "Confirm whether the 8 A.C annotations represent 8 electrical AC points, 8 equipment locations, or both."

## IMPORTANT
UNKNOWN IS BETTER THAN INVENTED. Retain identified scope even when you cannot quantify it (Status "Identified — Needs detail") — do not drop it. The human operator makes the final decision. Return a clean structured response that can be pasted directly into Cunstruct.`;
}

export interface EvalArea { value: number; type: string; raw: string }
export interface EvalSpace { name: string; qty: number }
export interface EvalMeasurement { label: string; value: string; note?: string }

export interface ChatGptEval {
  projectType?: string;
  archetype?: string;        // as ChatGPT phrased it, e.g. "3 BHK"
  archetypeKey?: string;     // mapped to an ARCHETYPES key, or undefined
  floors?: number;
  /** Which floor THIS drawing represents (e.g. 1 for "Floor 1"), when it is a
   *  single-floor scope. Distinct from `floors` (the building's floor count). */
  floor?: number;
  /** One-line description of what this drawing covers, e.g. "Floor 1 private apartment". */
  floorScope?: string;
  /** The BOQ allocation bucket this evaluation belongs to (Floor 1 / Common …). */
  boqAllocation?: string;
  area: EvalArea | null;     // null = not provided (never invented)
  spaces: EvalSpace[];
  disciplines: string[];
  measurements: EvalMeasurement[];
  requirements: DrawingItem[];
  /** Scope clearly identified in the drawing but not yet quantifiable (feature
   *  wall, wardrobe, entrance feature). Retained and shown — never priced until
   *  the operator adds a quantity — so identified scope is never silently dropped. */
  needsDetail: DrawingItem[];
  /** Requirements ChatGPT could not assess from the drawing — shown, never priced. */
  notAssessable: string[];
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
  "BOQ ALLOCATION": "BOQ ALLOCATION", "ALLOCATION": "BOQ ALLOCATION",
  "FLOOR SCOPE": "FLOOR SCOPE", "FLOOR DESCRIPTION": "FLOOR SCOPE", "FLOOR": "FLOOR SCOPE",
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
  // Instruction / meta blocks the operator's prompt may include and ChatGPT echoes
  // back (validation checklists, output rules, core-rules recaps). They are not
  // project data — swallow the whole block so it never leaks into a real section.
  "FINAL VALIDATION": "IGNORE", "VALIDATION": "IGNORE", "VALIDATION CHECKLIST": "IGNORE", "VERIFICATION": "IGNORE",
  "CORE RULES": "IGNORE", "OUTPUT RULES": "IGNORE", "OUTPUT FORMAT": "IGNORE", "SOURCE BOUNDARY": "IGNORE",
  "INSTRUCTIONS": "IGNORE", "HOW TO USE": "IGNORE", "DETERMINE": "IGNORE",
};
const PREFIX_CANON = ["PROJECT TYPE", "ARCHETYPE", "DISCIPLINES", "CONFIRMATIONS", "CONFIDENCE", "MEASUREMENTS", "REQUIREMENTS", "SPACES", "FLOORS", "AREA"];
// Heading prefixes whose whole section is meta/instructions, not project data.
const IGNORE_PREFIX = ["FINAL VALIDATION", "VALIDATION", "VERIFICATION", "CORE RULE", "OUTPUT", "INSTRUCTION", "HOW TO", "SOURCE BOUNDARY", "BOQ GENERATION", "GENERATION RULE", "KEY RULE"];

// A line that is only punctuation/box-drawing (====, ----, ~~~~, ****, ═══, table
// rules). It is decoration, never a heading and never section content — dropping
// it stops "====" or a table separator masquerading as a field value.
const DIVIDER = /^[=~_*#+\-—–─═\-|:.\s]{3,}$/;

/** Is this line a section heading? Returns its canonical name + any inline value. */
function headerInfo(line: string): { name: string; inline: string } | null {
  const t = line.trim();
  if (!t || /^[-*•]\s/.test(t)) return null;                   // bullets are content, never headings
  if (DIVIDER.test(t)) return null;                            // ==== / ---- / table separators
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
  let name: string | undefined = ALIAS[label];
  if (!name) name = PREFIX_CANON.find((c) => label === c || label.startsWith(c + " ") || label.startsWith(c + "/"));
  if (!name && IGNORE_PREFIX.some((p) => label === p || label.startsWith(p))) name = "IGNORE";
  return name ? { name, inline } : null;
}

// Trailing meta blocks ChatGPT sometimes echoes back — a "KEY RULE FOR CUNSTRUCT"
// header, an instruction line ("Do not convert dimensions into quantities…"), or a
// "FINAL VALIDATION / Before returning the assessment, verify…" checklist. They are
// not project data and must never leak into the last real section (usually
// CONFIRMATIONS or REQUIREMENTS). Hitting one closes the current section.
const STOP_MARKER = /^(key\s+rules?|rules?\s+for\s+cunstruct|for\s+cunstruct|final\s+validation|before\s+returning|do not\s+(convert|invent|assume|create|generate|put|drop)|unknown\s+is\s+better|where\s+qty\s+is\s+blank)\b/i;

/** Split the pasted response into { SECTION: text }, keeping inline "Field: value". */
function splitSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => { if (current && current !== "IGNORE") out[current] = ((out[current] ? out[current] + "\n" : "") + buf.join("\n")).trim(); buf.length = 0; };
  for (const line of (text || "").split(/\r?\n/)) {
    const h = headerInfo(line);
    if (h) { flush(); current = h.name; if (h.inline) buf.push(h.inline); }
    else if (STOP_MARKER.test(line.trim().replace(/^[-*•]\s*/, ""))) { flush(); current = "IGNORE"; }
    else if (DIVIDER.test(line.trim())) continue;   // decoration (====, ----) is never content
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

/** The floor a single-floor drawing represents, e.g. "Floor 1" → 1, "First
 *  Floor" → 1. Distinct from the building floor count. */
function parseFloorNumber(sec?: string): number | undefined {
  if (!sec) return undefined;
  const ord: Record<string, number> = { ground: 0, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const w = sec.match(/\b(ground|first|second|third|fourth|fifth)\b\s*floor/i);
  if (w) return ord[w[1].toLowerCase()];
  const m = sec.match(/\bfloor\s*(\d+)\b/i) || sec.match(/\b(\d+)(?:st|nd|rd|th)?\s*floor\b/i) || sec.match(/\b(\d+)\b/);
  return m ? Number(m[1]) : undefined;
}

/** A short one-line scope/allocation label (first meaningful content line). Skips
 *  blanks, "Not assessable" prose, table/legend rows and "Basis = …"-style column
 *  legends so a stray legend line can never become the allocation value. */
function parseLabelLine(sec?: string): string | undefined {
  if (!sec) return undefined;
  for (let line of sec.split(/\r?\n/)) {
    line = line.trim().replace(/^[-*•]\s*/, "").replace(/^["']|["']$/g, "").trim();
    if (!line) continue;
    if (/^not\s+(assessable|provided|available)/i.test(line)) continue;
    if (line.includes("|")) continue;                                   // table row, not a value
    if (/^(requirement|qty|unit|basis|scope|status|location|note)\b\s*[=:]/i.test(line)) continue;  // column legend
    return line;
  }
  return undefined;
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
const hasDiscipline = (l: string) => DISCIPLINE_WORDS.some((d) => new RegExp(`\\b${d}\\b`, "i").test(l));
/** Disciplines with actual evidence in the drawing — the "Identified" list, and
 *  never the "Not assessable" / negated ones (so Fire-not-seen isn't preselected). */
function parseDisciplines(sec?: string): string[] {
  if (!sec) return [];
  const found = new Set<string>();
  let mode: "include" | "exclude" = "include";
  for (const raw of sec.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    // Sub-headers that carry no discipline word switch the mode for following lines.
    if (!hasDiscipline(l)) {
      if (/identified/i.test(l)) mode = "include";
      else if (/not assessable|not identified|not present/i.test(l)) mode = "exclude";
      continue;
    }
    // Inline negation on a discipline line, e.g. "Fire — not identified" / "no fire symbols".
    const negated = /\bnot (assessable|identified|shown|present|applicable|clear)\b|\bnone\b|\bn\/a\b|\babsent\b|\bno\s+[\w/-]+\s+(symbol|scope|evidence|system|layout|point|fitting)/i.test(l);
    if (mode === "exclude" || negated) continue;
    for (const d of DISCIPLINE_WORDS) if (new RegExp(`\\b${d}\\b`, "i").test(l)) found.add(d);
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

/** The scope name from a loose "<item> — not assessable …" prose line, or null
 *  when the line is just the boilerplate phrase with no item in front of it (so
 *  "Not assessable from supplied drawing." is never recorded as a fake item).
 *  Unlike a naive split it keeps internal hyphens ("loose-furniture"), so a wrapped
 *  phrase is not truncated to a meaningless fragment. */
function looseNotAssessableName(line: string): string | null {
  const before = line.replace(/\s*\b(?:is|are|was|were|:)?\s*(?:not assessable|cannot be assessed)\b[^]*$/i, "").trim();
  const n = before.replace(/^[-*•\s]+/, "").replace(/[\s:,;—–-]+$/, "").trim();
  if (n.length < 3 || /^(requirement|approximate|exact|quantit\w*)$/i.test(n)) return null;
  return n;
}

const SCOPE_CELL = /^(works?|equipment|client(?:[-\s]*supplied)?|needs?[-\s]*confirmation)$/i;
const STATUS_CELL = /needs?[-\s]*detail|^\W*identified\b|^\W*quantified\b|not\s*assessable/i;
const NEEDS_DETAIL = /needs?[-\s]*detail|^\W*identified\b/i;

// Requirements-table columns → canonical role. A response may add an "Allocation"
// column (per-floor BOQs), rename "Location" to "Note", or reorder columns; a
// recognised header row lets us map by NAME instead of by fixed position, so an
// extra leading column can't shift every value one cell to the left (which would
// otherwise read the requirement out of the qty cell and collapse the whole table).
const COL_ROLE: [RegExp, string][] = [
  [/^(requirements?|items?|scope\s*items?|descriptions?)$/i, "req"],   // NOT "works" — that's a scope value
  [/^(qty|quantity|count)$/i, "qty"],                                  // NOT "nos"/"no." — those are unit values
  [/^(units?|uom)$/i, "unit"],
  [/^basis$/i, "basis"],
  [/^(locations?|notes?|location\s*\/?\s*note|rooms?|remarks?)$/i, "note"],
  [/^scope$/i, "scope"],
  [/^status$/i, "status"],
  [/^(allocations?|boq\s*allocation|buckets?)$/i, "alloc"],
];
function colRole(cell: string): string | undefined {
  const c = cell.trim().toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ");
  for (const [re, role] of COL_ROLE) if (re.test(c)) return role;
  return undefined;
}
/** Roles for each column when a row is a recognisable HEADER row, else null. A
 *  header names its columns in words (no digits) and must declare at least the
 *  requirement + quantity columns, so a data row can never be mistaken for one. */
function headerRoles(cols: string[]): string[] | null {
  if (cols.some((c) => /\d/.test(c))) return null;   // real data rows carry numbers; headers don't
  const roles = cols.map(colRole);
  const known = roles.filter(Boolean).length;
  if (known >= 3 && roles.includes("req") && roles.includes("qty"))
    return roles.map((r) => r ?? "");
  return null;
}

/** From the trailing table cells (after req|qty|unit|basis), tease apart the
 *  Scope column, the Status column and the free-text Location / Note — regardless
 *  of the order ChatGPT emits them in. */
function splitTail(rest: string[]): { equipment?: boolean; note?: string; status?: string } {
  let equipment: boolean | undefined;
  let status: string | undefined;
  const noteParts: string[] = [];
  for (const c of rest) {
    if (!c) continue;
    if (status === undefined && STATUS_CELL.test(c)) { status = c; continue; }
    if (equipment === undefined && SCOPE_CELL.test(c)) {
      equipment = /equip|client/i.test(c);   // "Works" / "Needs confirmation" → not equipment
      continue;
    }
    noteParts.push(c);
  }
  return { equipment, note: noteParts.join(" · ").trim() || undefined, status };
}

/** Requirements table → DrawingItems (reusing the drawing-summary schema). Splits
 *  into three buckets: priced items (a real quantity), "Identified — Needs detail"
 *  scope that is kept and shown but NEVER priced until the operator quantifies it,
 *  and the requirements ChatGPT could not assess at all. */
function parseRequirements(sec?: string): { items: DrawingItem[]; needsDetail: DrawingItem[]; notAssessable: string[] } {
  if (!sec) return { items: [], needsDetail: [], notAssessable: [] };
  const items: DrawingItem[] = [];
  const needsDetail: DrawingItem[] = [];
  const notAssessable: string[] = [];
  const loose: string[] = [];
  let header: string[] | null = null;   // column roles, once a header row is seen
  for (let line of sec.split(/\r?\n/)) {
    line = line.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;
    // "None seen / not present" answers to the category checklist are not scope.
    if (/\bnone seen\b|\bnot present\b|\bnot applicable\b/i.test(line)) continue;
    if (line.includes("|")) {
      const cols = line.split("|").map((c) => c.trim());
      if (cols[0] === "") cols.shift();
      if (cols[cols.length - 1] === "") cols.pop();
      if (cols.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;   // separator row
      // A recognisable header row defines the column layout (and is not data).
      if (!header) { const roles = headerRoles(cols); if (roles) { header = roles; continue; } }

      let req: string | undefined, qtyRaw = "", unit = "", basisRaw = "";
      let note: string | undefined, equipment: boolean | undefined, status = "", alloc: string | undefined;
      if (header) {
        const noteParts: string[] = [];
        let scopeCell = "";
        header.forEach((role, i) => {
          const v = (cols[i] ?? "").trim();
          if (!v) return;
          if (role === "req") { if (!req) req = v; }
          else if (role === "qty") qtyRaw = v;
          else if (role === "unit") unit = v;
          else if (role === "basis") basisRaw = v;
          else if (role === "scope") scopeCell = v;
          else if (role === "status") status = v;
          else if (role === "alloc") alloc = v;
          else noteParts.push(v);   // "note" and any unlabelled column → location/note
        });
        note = noteParts.join(" · ").trim() || undefined;
        if (scopeCell) equipment = /equip|client/i.test(scopeCell);
        if (req && /^(requirements?|items?|descriptions?)$/i.test(req)) continue;   // repeated header
      } else {
        // No header seen — the classic req | qty | unit | basis | …tail layout.
        if (/^requirement$/i.test(cols[0] ?? "")) continue;
        [req, qtyRaw, unit, basisRaw] = cols as [string, string, string, string];
        const tail = splitTail(cols.slice(4));
        note = tail.note; equipment = tail.equipment; status = tail.status ?? "";
      }
      if (!req) continue;
      const qty = Number((qtyRaw || "").match(/[\d.]+/)?.[0]);
      const basisNA = /\bnot\s*assessable\b/i.test(basisRaw ?? "");
      if (NEEDS_DETAIL.test(status)) {
        // Clearly drawn but not quantifiable — RETAIN as scope (qty 0 = unpriced),
        // even when the Basis cell itself reads "Not assessable". Status wins.
        needsDetail.push({ match: req, qty: 0, unit: unit?.trim() || undefined, basis: normBasis(basisRaw), equipment, note, allocation: alloc });
      } else if (qty > 0 && !basisNA) {
        // A trustworthy quantified requirement flows into the priced Drawing engine.
        items.push({ match: req, qty, unit: unit?.trim() || undefined, basis: normBasis(basisRaw), equipment, note, allocation: alloc });
      } else {
        // Blank quantity, or a quantity the drawing itself does not support
        // ("Not assessable" basis) — recorded, never priced.
        notAssessable.push(req);
      }
      continue;
    }
    // Loose (non-table) lines: "Not assessable" prose is recorded, never counted.
    if (/\bnot assessable\b|\bcannot be assessed\b/i.test(line)) { const n = looseNotAssessableName(line); if (n) notAssessable.push(n); continue; }
    loose.push(line);
  }
  if (loose.length) items.push(...parseDrawingSummary(loose.join("\n")));
  // Collapse exact duplicates (case-insensitive) — ChatGPT often repeats a
  // category both in its checklist and again in a summary line.
  const seen = new Set<string>();
  const dedupNA = notAssessable.filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { items, needsDetail, notAssessable: dedupNA };
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
  const req = parseRequirements(s["REQUIREMENTS"]);
  const requirements = req.items;
  const spaces = parseSpaces(s["SPACES"]);
  const area = parseArea(s["AREA"]);
  const floors = parseFloors(s["FLOORS"]);
  const boqAllocation = parseLabelLine(s["BOQ ALLOCATION"]);
  const floorScope = parseLabelLine(s["FLOOR SCOPE"]);
  // Which floor this drawing is for, from the allocation / scope / floors text.
  const floor = parseFloorNumber(s["BOQ ALLOCATION"]) ?? parseFloorNumber(s["FLOOR SCOPE"]);
  const eval_: ChatGptEval = {
    projectType,
    archetype,
    archetypeKey: archetypeKeyFor(archetype),
    floors,
    floor,
    floorScope,
    boqAllocation,
    area,
    spaces,
    disciplines: parseDisciplines(s["DISCIPLINES"]),
    measurements: parseMeasurements(s["MEASUREMENTS"]),
    requirements,
    needsDetail: req.needsDetail,
    notAssessable: req.notAssessable,
    keyInfo: parseKeyInfo(s["KEY INFO"]),
    confidence: parseConfidence(s["CONFIDENCE"]),
    confirmations: parseConfirmations(s["CONFIRMATIONS"]),
    ok: false,
  };
  eval_.ok = Boolean(projectType || eval_.archetypeKey || archetype || floors || area || spaces.length || requirements.length || eval_.needsDetail.length || eval_.keyInfo.length || eval_.notAssessable.length);
  return eval_;
}

/** Map the drawing's identified spaces onto BOQ room-count fields. Only rooms the
 *  drawing actually names get a count (summed across matching spaces); a room type
 *  it does not name is simply absent from the result — never defaulted — so the
 *  generic template can never invent a bedroom/bathroom count. Foyers, staircases,
 *  corridors and other non-priced circulation are deliberately not counted. */
export function roomsFromSpaces(spaces: EvalSpace[]): Partial<Record<(typeof ROOM_KEYS)[number], number>> {
  const out: Partial<Record<string, number>> = {};
  const add = (k: string, n: number) => { out[k] = (out[k] ?? 0) + n; };
  for (const s of spaces) {
    const name = (s.name || "").toLowerCase();
    const qty = Number(s.qty) || 0;
    if (!(qty > 0)) continue;
    // Order matters: the more specific/overlapping tests run first ("bathroom"
    // and "utility"/"store" before the broad room words).
    if (/\bbath|toilet|\bwc\b|w\.?c\.?\b|washroom|powder\s*room/.test(name)) add("bathrooms", qty);
    else if (/utility|wash\s*area|laundry|\bstore\b|storage/.test(name)) add("utility", qty);
    else if (/pooja|puja|prayer|mandir|\bstudy\b|home\s*office/.test(name)) add("pooja", qty);
    else if (/bed\s*room|bedroom|master|guest\s*room|kids?\s*room|children/.test(name)) add("bedrooms", qty);
    else if (/kitchen|pantry/.test(name)) add("kitchens", qty);
    else if (/balcon|\bdeck\b|sit[\s-]*out|utility\s*balcony/.test(name)) add("balconies", qty);
    else if (/living|drawing\s*room|family|dining|\bhall\b|lounge/.test(name)) add("living", qty);
    // foyer / entrance / staircase / corridor / lobby / passage → not a priced room
  }
  return out;
}

/** Build the New-BOQ spec from a parsed evaluation. This is the single mapping
 *  point where the drawing evaluation becomes the SOURCE OF TRUTH:
 *   - room counts come only from the identified spaces (blank when unnamed);
 *   - area / floor / area-type come from the drawing when it states them;
 *   - all requirements (priced + "needs detail") flow into the Drawing section;
 *   - generic template values fill ONLY genuinely-missing fields (finishes,
 *     structure, toggles), never a room count or a value the drawing established.
 *  Everything remains editable downstream — the operator's edits win over this. */
export function specFromEvaluation(e: ChatGptEval): Spec {
  const base = defaultSpec();
  // Blank the template's room counts — only the drawing may set them. What the
  // drawing does not name stays blank so the engine falls back to a clearly-marked
  // heuristic rather than showing a fabricated count as if it came from the drawing.
  for (const k of ROOM_KEYS) delete base[k];
  const rooms = roomsFromSpaces(e.spaces);
  for (const [k, v] of Object.entries(rooms)) base[k] = v;

  if (e.area?.value) base._area_sqft = e.area.value;
  if (e.area?.type) base._area_type = e.area.type;
  // A per-floor BOQ covers one floor of work; prefer the explicit floor number.
  const floors = e.floor ?? e.floors;
  if (floors != null) base._floors = floors;

  // Priced requirements + "Identified — Needs detail" scope both become editable
  // drawing rows; needs-detail rows carry qty 0 so they surface for quantifying
  // but are never priced until the operator fills them in.
  const drawItems = [...e.requirements, ...e.needsDetail];
  if (drawItems.length) (base as Record<string, unknown>)._drawing = { items: drawItems };
  if (e.measurements.length) (base as Record<string, unknown>)._measurements = e.measurements;
  if (e.spaces.length) (base as Record<string, unknown>)._spaces = e.spaces;
  if (e.floorScope) (base as Record<string, unknown>)._floor_scope = e.floorScope;
  if (e.boqAllocation) (base as Record<string, unknown>)._boq_allocation = e.boqAllocation;
  (base as Record<string, unknown>)._source = "chatgpt";
  return base;
}

/** Map ChatGPT's identified disciplines to a single BOQ discipline key for the
 *  Anchor prefill (Architectural/Civil → civil, Furniture → none), preferring
 *  the discipline with the most tangible BOQ scope. Operator can change it. */
export function disciplineForBoq(disciplines: string[]): string | undefined {
  const map: Record<string, string> = { Civil: "civil", Architectural: "civil", Electrical: "electrical", Plumbing: "plumbing", HVAC: "hvac", Fire: "fire" };
  const keys = new Set(disciplines.map((d) => map[d]).filter(Boolean));
  return ["civil", "electrical", "plumbing", "hvac", "fire"].find((k) => keys.has(k));
}

/** Classify one requirement label into a BOQ discipline (interior/architectural
 *  → civil, since interior joinery is priced under civil). Order matters: the
 *  more specific tests run first so "AC point" reads electrical, "AC unit" HVAC,
 *  and "floor trap"/"water point" plumbing rather than being swallowed by the
 *  broad electrical "point" test. */
function classifyDiscipline(label: string): string {
  const l = (label || "").toLowerCase();
  if (/\b(detector|sprinkler|fire\s*alarm|extinguisher|hose\s*reel|hydrant|smoke)\b/.test(l)) return "fire";
  if (/\b(duct|ducting|diffuser|refrigerant|vrv|vrf|cassette)\b/.test(l) || /\bac\b[^]*\bunit\b|\bunit\b[^]*\bac\b/.test(l)) return "hvac";
  if (/\b(wc|water\s*closet|wash\s*basin|basin|shower|sink|floor\s*trap|waste|drain|soil\s*pipe|faucet|tap|sanitary|cp\s*fitting)\b/.test(l) || /\bwater\b/.test(l)) return "plumbing";
  if (/\b(point|socket|switch\s*board|sb|switch|light|lighting|conduit|wiring|db|power|tv|audio|cctv|data|floor\s*box|geyser|projector|exhaust|cp)\b/.test(l) || /\b\d+\s*a\b/.test(l)) return "electrical";
  return "civil";   // doors, windows, walls, feature walls, wardrobes, flooring, joinery…
}

/** The BOQ discipline the drawing's itemised scope is actually dominated by —
 *  counted across the real requirement + needs-detail rows, not just the coarse
 *  "identified disciplines" list (which always contained Architectural and so
 *  always defaulted to Civil). Falls back to the identified-list mapping when
 *  there are no items to weigh. The operator can still change it. */
export function disciplineFromEvidence(e: Pick<ChatGptEval, "requirements" | "needsDetail" | "disciplines">): string | undefined {
  const counts: Record<string, number> = {};
  for (const it of [...e.requirements, ...e.needsDetail]) {
    if (!it.match?.trim()) continue;
    const k = classifyDiscipline(it.match);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return disciplineForBoq(e.disciplines);
  const top = ranked[0][1];
  // On a tie, keep a stable, sensible order rather than object-key order.
  const winners = ranked.filter(([, n]) => n === top).map(([k]) => k);
  return ["electrical", "plumbing", "hvac", "fire", "civil"].find((k) => winners.includes(k)) ?? winners[0];
}
