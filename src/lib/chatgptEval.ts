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
import { parseDrawingSummary, resolveDrawingProvenance, type DrawingBasis, type DrawingItem } from "./boqDrawing";

// Spec keys seeded from a ChatGPT evaluation (drawing requirements, measurements,
// spaces, provenance). They must survive a spec reset — e.g. when the operator
// changes the archetype after the evaluation — or the parsed requirements are lost.
export const SEED_CARRY_KEYS = ["_drawing", "_excluded", "_measurements", "_spaces", "_source", "_area_type", "_floor_scope", "_boq_allocation", "_disciplines"] as const;

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

// The exact JSON shape Cunstruct parses. Kept as a literal template in the prompt
// so ChatGPT fills it verbatim (null / [] for anything the drawing doesn't establish).
const PROMPT_SCHEMA = `{
  "project_type": "Residential | Commercial | Retail | Office | Hospitality | Other | null",
  "archetype": "1 BHK | 2 BHK | 3 BHK | 4 BHK | Villa | Duplex | Apartment | Shop | Office | Other | null",
  "floor": 1,
  "boq_allocation": "Floor 1 | Floor 2 | Common Area | null",
  "floor_scope": "First Floor / Floor 1 private apartment",
  "area": null,
  "area_type": "built-up | carpet | covered | null",
  "spaces": [
    { "name": "Master Bedroom", "qty": 1, "basis": "Counted", "note": "" }
  ],
  "disciplines": {
    "identified": ["Architectural", "Electrical"],
    "not_assessable": ["Fire"]
  },
  "measurements": [
    { "name": "Room dimension", "value": "10'-8\\" x 12'-4\\"", "location": "Master Bedroom" }
  ],
  "requirements": [
    { "allocation": "Floor 1", "requirement": "WC", "qty": 4, "unit": "nos", "basis": "Counted", "location": "Private bathrooms", "note": "", "scope": "Works", "status": "Quantified" },
    { "allocation": "Floor 1", "requirement": "Wardrobe", "qty": null, "unit": null, "basis": "Not assessable", "location": "Master Bedroom", "note": "", "scope": "Works", "status": "Identified — Needs detail" }
  ],
  "category_summary": {
    "electrical": { "status": "Identified", "items": [] },
    "plumbing": { "status": "Identified", "items": [] },
    "hvac": { "status": "Identified", "items": [] },
    "fire": { "status": "Not assessable", "items": [] },
    "architectural_civil": { "status": "Identified", "items": [] },
    "interior_joinery": { "status": "Identified", "items": [] }
  },
  "confidence": {
    "project_type": "High", "archetype": "High", "floor": "High",
    "area": "Low", "major_spaces": "High", "overall_scope": "Medium"
  },
  "confirmations": []
}`;

/** The prompt Cunstruct hands the operator to paste into ChatGPT (with the drawing). */
export function buildChatGptPrompt(): string {
  return `I am using Cunstruct to prepare a construction BOQ. Perform a comprehensive PROJECT SCOPE INVENTORY of the attached drawing, capturing the WHOLE scope of work it shows — not only the electrical / MEP points, but the architectural, interior and joinery scope too (feature walls, wardrobes, counters, TV units, entrance features, panelling, false ceilings, etc.). Then return the assessment as ONE STRICT JSON OBJECT.

OUTPUT CONTRACT (critical):
- Return ONLY one valid JSON object. No markdown. No code fences. No \`\`\`json. No headings. No explanatory text before or after the JSON.
- Use EXACTLY the keys shown in the schema below. If a value is unknown, use null (or an empty array []). Never guess.
- "qty" is a number or null ONLY. Never put a specification (16A, matte laminate) or a dimension (51", 10'-8") in "qty" — those belong in "measurements" or in the requirement text / "note".

Source boundary:
You may ONLY use the drawing supplied in this conversation. Do not assume any other project documents exist. Do not reference, cite, or ask me to consult CAD files, architectural schedules, legends, specifications, or any other drawing unless it has actually been supplied here. If something cannot be established from the supplied drawing, use null and set the relevant "basis"/"status" to "Not assessable". Never ask me to obtain or check another document.

Core rules:
- DO NOT generate a BOQ, prices, or DSR rates.
- COUNT WHAT YOU CAN SEE. Visually inspect the supplied drawing/image and COUNT every symbol the drawing lets you count. OCR/extracted text is only supplementary — architectural and electrical drawings contain symbols OCR cannot read, so you MUST inspect the image itself. Counting visible symbols is NOT "inventing"; refusing to count clearly-drawn symbols under-reports the project and is wrong. Return the MAXIMUM defensible quantity the drawing supports.
- COUNTABLE ≠ MEASURABLE, and COUNTABLE ≠ FULLY SPECIFIED. If an item can be COUNTED, COUNT it — even when its dimension, area, running length, model, specification, material, finish or rating is unknown. A missing measurement OR a missing specification is NEVER a reason to return "qty": null. Set "qty" to the count, "unit" to "nos", "basis" to "Counted" (or "Visually counted from drawing"), "status" to "Quantified", and put whatever is missing in "note" (e.g. "Running length not established", "Model/specification not established", "Area/material not established"). Do NOT downgrade a countable item to "Identified — Needs detail" just because a dimension, model or material is missing. Examples: the drawing clearly shows 4 WCs → qty 4 even if the WC model/specification is unknown; 3 wardrobes → qty 3 even if the run length/material is unknown; 1 feature wall → qty 1 even if the area/finish is unknown; 5 WCs → qty 5.
- BASIS MUST MATCH THE COUNT. If you provide a numeric "qty", its "basis" MUST be "Counted", "Measured" or "Derived" — NEVER "Not assessable". Reserve "basis": "Not assessable" (with "status": "Identified — Needs detail" or "Not assessable") for rows whose SYMBOL you genuinely cannot count or see; those rows keep "qty": null. Never pair a real count with a "Not assessable" basis — that number would be discarded.
- UNKNOWN IS BETTER THAN INVENTED applies ONLY to symbols you cannot actually see: never fabricate a number for a symbol that is not on the drawing. It does NOT apply to countable symbols whose specification/dimension/material is merely missing — those you MUST still count. Use "qty": null and "status": "Identified — Needs detail" ONLY when a symbol is genuinely too ambiguous or illegible to count even after a careful visual pass, or when the item is inherently area/length-based and the drawing gives no area/length to measure.
- Do NOT use generic residential assumptions, template defaults, or room-count inference. Do NOT infer a quantity from the number of rooms. Every quantity must come from the drawing itself.
- Keep quantities, dimensions and specifications separate: a dimension (51", 10'-8") or specification (16A, matte laminate) goes in "measurements" or "note", never in "qty".

Counting workflow (do this BEFORE writing the JSON):
1. Read the drawing's legend / symbol key.
2. Identify every relevant symbol type.
3. Divide the floor into rooms / zones.
4. Count each symbol room-by-room; record the room in "location".
5. Sum the per-room counts.
6. Do a SECOND visual pass to catch missed symbols.
7. Cross-check the totals against the legend and annotations.
8. Only then output the JSON.

Field guidance:
- project_type: closest of Residential, Commercial, Retail, Office, Hospitality, Other.
- archetype: closest of 1 BHK, 2 BHK, 3 BHK, 4 BHK, Villa, Duplex, Apartment, Shop, Office, Other.
- floor: which single floor / level THIS drawing represents, as a number (e.g. 1 for "Floor 1"). This is NOT the number of floors in the whole building.
- boq_allocation: the bucket this BOQ is for — "Floor 1", "Floor 2", … or "Common Area".
- floor_scope: one-line description, e.g. "First Floor / Floor 1 private apartment".
- area / area_type: only if explicitly stated or reliably measurable (area_type is "built-up" | "carpet" | "covered"); otherwise BOTH null. Never estimate the area.
- spaces[]: every identifiable room / space, with "qty" when the drawing supports a count.
- disciplines: "identified" lists ONLY disciplines with actual scope/evidence in this drawing (from Civil, Architectural, Electrical, Plumbing, HVAC, Fire, Furniture); "not_assessable" lists the rest. Do NOT list a discipline as identified just because it could exist.
- measurements[]: dimensions and specifications ONLY (switchboard heights, TV size, offsets) — never quantities.
- requirements[]: EVERY item of scope you can see — QUANTIFIED wherever the drawing lets you count it. Count each symbol type SEPARATELY; do NOT collapse different symbols into one generic "electrical point". For EACH category below make a COUNT DECISION: count the symbols/units when they are visible (a missing spec/material/length does not block the count); use "qty": null with "status": "Identified — Needs detail" ONLY when the symbol is absent/illegible or the item is inherently area/length-based with no area/length given. Cover at least:
  - Electrical: 5A/6A sockets; 15A/16A sockets; combined sockets; switchboards (SB1/SB2/SB3…); DB / distribution board; ceiling lamps / lights; tube lights; ceiling fans; tower / wall fans; AC points; TV / plasma points; cable-TV points; audio points; calling bell; floor points / floor boxes; geyser points; exhaust / inline exhaust; conduits; appliance points; projector; screen; blind provisions.
  - Plumbing: WC; wash basin; shower; bathtub; CP fittings; floor drain / floor trap; kitchen sink; kitchen & wet-kitchen plumbing points; water points; waste points; geyser connections; washing-machine provision; refrigerator provision; dishwasher; other visible fixtures.
  - Architectural: main doors; internal doors; sliding/folding/UPVC doors; windows; ventilators; internal walls / partitions; balconies; green pocket / planter; gates; railings; stairs; lifts. Area-based finishes — flooring; wall finishes; false ceiling — carry a count ONLY where the drawing states/permits an area (basis "Measured"/"Derived"); otherwise "qty": null (area not established).
  - Interior / joinery (fixed works — COUNT each unit even when running length / material is unknown): wardrobes; walk-in closets (WICs); dress units; mirror units; study units; TV / media units & panels; consoles / fixed storage; kitchen platform; kitchen base & overhead / tall storage; kitchen island; wet-kitchen storage; overhead storage; utility / locker-room storage; feature walls; pooja units; bed-back panels; vanity; crockery units; media-room screen / projection provision; other fixed joinery.
  - Loose equipment (still count): TV; projector; projector screen; audio equipment; blinds; loose furniture — mark "scope": "Equipment" when clearly loose / client-supplied.
  Per requirement:
  - allocation: the BOQ bucket. Private apartment scope → "Floor X" (this drawing: "Floor 1"). Shared/common scope (lifts, lobbies, common corridors, staircases, security, common services) → "Common Area" — identify it but keep it out of the private-floor buckets.
  - basis: "Counted" | "Measured" | "Derived" | "Not assessable".
  - scope: "Works" (contractor work incl. fixed joinery / built-ins) | "Equipment" (loose client-supplied items) | "Needs confirmation".
  - status: "Quantified" (a count is present) | "Identified — Needs detail" (genuinely uncountable) | "Not assessable".
- category_summary: per discipline, a "status" ("Identified" | "None seen" | "Not assessable") plus any "items" you want to flag.
- confidence: "High" | "Medium" | "Low" for project_type, archetype, floor, area, major_spaces, overall_scope.
- confirmations[]: only questions resolvable from the supplied drawing.

Return EXACTLY this JSON shape, filled from the drawing (use null / [] for anything the drawing does not establish):
${PROMPT_SCHEMA}

Remember: return ONLY the JSON object, nothing else. UNKNOWN IS BETTER THAN INVENTED.`;
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

// The evaluation explicitly says the QUANTITY / COUNT / TOTAL itself is not
// established (as opposed to a missing dimension / spec / material — which under
// COUNTABLE ≠ MEASURABLE must NOT block a count). When it does, a number that came
// along is an undefensible guess and must NOT be promoted to a counted quantity —
// the item stays pending (qty null). Requires a count-word (count/total/number/
// quantity) next to a not-established phrase, so "running length not established"
// / "material not established" (dimension/spec) still keep their count.
const COUNT_UNRESOLVED = new RegExp([
  // "<count-word> … not/cannot/to-be/pending … established/confirmed/counted/…"
  String.raw`\b(?:counts?|totals?|numbers?|tall(?:y|ies)|quantit(?:y|ies)|qty)\b[^.;\n]{0,45}\b(?:not|cannot|can[’']?t|un(?:able)?|to\s+be|pending|await\w*)\b[^.;\n]{0,25}\b(?:establish\w*|assess\w*|confirm\w*|determin\w*|quantif\w*|count(?:ed)?|verif\w*|resolv\w*|final\w*|reliab\w*|defensib\w*)\b`,
  // "not/unable to establish/confirm/count … a total/count/number/quantity"
  String.raw`\b(?:not|cannot|can[’']?t|un(?:able)?)\b[^.;\n]{0,30}\b(?:establish\w*|assess\w*|confirm\w*|determin\w*|count\w*|quantif\w*)\b[^.;\n]{0,30}\b(?:counts?|totals?|numbers?|quantit(?:y|ies)|qty)\b`,
  String.raw`\bpending\s+quantit`,
  String.raw`\bnot\s+(?:fully\s+|reliably\s+)?count(?:ed|able)?\b`,
].join("|"), "i");
/** Did the evaluation's note/status flag the COUNT itself as unestablished? Then a
 *  stray number is not a defensible count and the requirement is retained as pending
 *  (needs-detail). Kept separate from basis "Not assessable" (which routes to the
 *  not-assessable bucket as before) so only the count-not-established case is new. */
function countNotEstablished(note: string | undefined, status: string): boolean {
  return COUNT_UNRESOLVED.test(note ?? "") || COUNT_UNRESOLVED.test(status);
}

/** Classify a scope cell into the Works / Equipment / Needs-confirmation trichotomy
 *  (undefined when no scope was stated, so downstream auto-detection can apply). */
type DrawingScope = "works" | "equipment" | "needs_confirmation";
function scopeClass(raw?: string): DrawingScope | undefined {
  const s = (raw || "").trim();
  if (!s) return undefined;
  if (/equip|client/i.test(s)) return "equipment";
  if (/needs?[-\s]*confirm/i.test(s)) return "needs_confirmation";
  return "works";
}
/** Works/Equipment/Needs-confirmation → the legacy equipment boolean (kept for the
 *  pricing engine). undefined scope → undefined, so auto-detection still runs. */
const equipFromScope = (scope?: DrawingScope): boolean | undefined =>
  scope === "equipment" ? true : scope ? false : undefined;

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
function splitTail(rest: string[]): { equipment?: boolean; scope?: DrawingScope; note?: string; status?: string } {
  let scopeRaw: string | undefined;
  let status: string | undefined;
  const noteParts: string[] = [];
  for (const c of rest) {
    if (!c) continue;
    if (status === undefined && STATUS_CELL.test(c)) { status = c; continue; }
    if (scopeRaw === undefined && SCOPE_CELL.test(c)) { scopeRaw = c; continue; }
    noteParts.push(c);
  }
  const scope = scopeClass(scopeRaw);
  return { equipment: equipFromScope(scope), scope, note: noteParts.join(" · ").trim() || undefined, status };
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
      let note: string | undefined, equipment: boolean | undefined, scope: DrawingScope | undefined, status = "", alloc: string | undefined;
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
        scope = scopeClass(scopeCell);
        equipment = equipFromScope(scope);
        if (req && /^(requirements?|items?|descriptions?)$/i.test(req)) continue;   // repeated header
      } else {
        // No header seen — the classic req | qty | unit | basis | …tail layout.
        if (/^requirement$/i.test(cols[0] ?? "")) continue;
        [req, qtyRaw, unit, basisRaw] = cols as [string, string, string, string];
        const tail = splitTail(cols.slice(4));
        note = tail.note; equipment = tail.equipment; scope = tail.scope; status = tail.status ?? "";
      }
      if (!req) continue;
      const qtyNum = Number((qtyRaw || "").match(/[\d.]+/)?.[0]);
      const qty = Number.isFinite(qtyNum) ? qtyNum : null;
      // STRICT quantity provenance: the DrawingItem STATUS is authoritative. A
      // "Identified — Needs detail" (or "Not assessable") status MUST remain
      // unquantified regardless of any number the evaluation supplied alongside it —
      // that number is not a defensible drawing count. A count-not-established
      // note/status, or a "Not assessable" basis, blocks quantification too. Only a
      // positive number under a NON-pending status becomes a counted quantity.
      const basisNA = /\bnot\s*assessable\b/i.test(basisRaw ?? "");
      const statusNeedsDetail = NEEDS_DETAIL.test(status);
      const statusNA = /\bnot\s*assessable\b/i.test(status);
      const countUnresolved = countNotEstablished(note, status);
      const blockCount = basisNA || statusNeedsDetail || statusNA || countUnresolved;
      if (qty != null && qty > 0 && !blockCount) {
        items.push({ match: req, qty, unit: unit?.trim() || undefined, basis: normBasis(basisRaw), equipment, scope, note, allocation: alloc, status: status || undefined });
      } else if (statusNeedsDetail || countUnresolved) {
        // Identified scope with no usable count yet — RETAINED as pending: qty stays
        // null (never coerced to 0/assumed) and no basis is invented, so the row is
        // clearly "identified, quantity to be confirmed" rather than "0 counted".
        needsDetail.push({ match: req, qty: null, unit: unit?.trim() || undefined, equipment, scope, note, allocation: alloc, pending: true, status: status || undefined });
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

// --- JSON contract (primary) -------------------------------------------------
// The evaluator returns a single strict JSON object (see buildChatGptPrompt).
// JSON is unambiguous, so it is the preferred path; the markdown/prose parser
// below is kept only as a fallback for a response that isn't valid JSON.

const jstr = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const jnum = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "").match(/-?[\d.]+/)?.[0] ?? "") : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const jarr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const jobj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// The exact JSON object the evaluation produces is what we want — but real model
// output is rarely byte-perfect JSON: it may wrap the object in prose or a ```json
// fence, add a trailing comma, use // or /* */ comments, emit smart quotes, or —
// most commonly for this drawing eval — leave an inch-mark quote unescaped inside a
// dimension string ("10'-8" x 12'-4""). A single strict JSON.parse of a
// first-brace…last-brace slice fails on all of these and the evaluation is rejected.
// So we (1) find each object by a STRING-AWARE brace scan (prose braces before/after
// can't corrupt it), then (2) parse it leniently: strict first, then a repaired form.
// This only ADDS tolerance — well-formed JSON still parses on the first attempt, and
// the internal shape the rest of the parser consumes is unchanged.

/** The balanced { … } object beginning at `start`, respecting string literals, or
 *  null. String-aware, so braces inside strings (or trailing prose) don't mislead it. */
function balancedObject(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** Remove line and block comments that appear outside string literals. */
function stripJsonComments(s: string): string {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (inStr) { out += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { while (i < s.length && s[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return out;
}

/** Escape stray inner quotes: a " inside a string is a terminator only when the next
 *  non-space char continues JSON (: , } ] or end); otherwise it is a literal (e.g. an
 *  inch mark) and is escaped. Fixes unescaped dimension strings like "10'-8" x 12'-4"". */
function escapeInnerQuotes(s: string): string {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) { out += c; if (c === '"') inStr = true; continue; }
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c === '"') {
      let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;
      const nx = s[j];
      if (nx === undefined || nx === ":" || nx === "," || nx === "}" || nx === "]") { out += '"'; inStr = false; }
      else out += '\\"';               // literal quote inside the string → escape it
      continue;
    }
    out += c;
  }
  return out;
}

/** Best-effort repairs applied only when strict parsing fails: smart quotes → ASCII,
 *  comments removed, trailing commas dropped, stray control chars neutralised. */
function repairJson(s: string): string {
  return stripJsonComments(s)
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")   // smart quotes
    .replace(/,(\s*[}\]])/g, "$1")                                     // trailing commas
    // eslint-disable-next-line no-control-regex -- deliberately neutralising stray control chars in pasted JSON
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");   // stray control chars
}

/** Strict parse, then progressively repaired parse — returns a plain object or null. */
function parseLenient(candidate: string): Record<string, unknown> | null {
  const repaired = repairJson(candidate);
  for (const attempt of [candidate, repaired, escapeInnerQuotes(repaired)]) {
    try {
      const o = JSON.parse(attempt);
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch { /* try the next repair */ }
  }
  return null;
}

/** Pull a single JSON object out of the raw response — tolerating ```json fences,
 *  stray prose/braces before or after, trailing commas, comments, smart quotes and
 *  unescaped inner quotes — or null when there is no parseable object. */
export function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Try each "{" as a possible object start; the first that yields a real object wins.
  // (Prose like "see {SB1}" fails to parse, so the actual evaluation object is used.)
  let tries = 0;
  for (let start = t.indexOf("{"); start >= 0 && tries < 200; start = t.indexOf("{", start + 1), tries++) {
    const candidate = balancedObject(t, start);
    if (!candidate) continue;
    const obj = parseLenient(candidate);
    if (obj) return obj;
  }
  return null;
}

function areaFromJson(area: unknown, areaType: unknown): EvalArea | null {
  if (area == null) return null;
  let value: number | undefined;
  let raw = "";
  if (typeof area === "object") {
    const o = area as Record<string, unknown>;
    value = jnum(o.value);
    raw = jstr(o.raw) || jstr(o.value);
    if (o.type != null) areaType = o.type;
  } else {
    const s = jstr(area);
    if (/^(not|null|n\/a|-|none)\b/i.test(s)) return null;
    value = jnum(area);
    raw = s;
  }
  if (!(value != null && value > 0)) return null;
  const t = jstr(areaType);
  const type = t && !/^(null|n\/a|-)$/i.test(t) ? t : /carpet/i.test(raw) ? "carpet" : /covered/i.test(raw) ? "covered" : "built-up";
  return { value, type, raw: raw || String(value) };
}

function spacesFromJson(v: unknown): EvalSpace[] {
  return jarr(v)
    .map((s) => { const o = jobj(s); const name = jstr(o.name) || jstr(o.space); return name ? { name, qty: jnum(o.qty) ?? jnum(o.count) ?? 0 } : null; })
    .filter((s): s is EvalSpace => s != null);
}

function disciplinesFromJson(v: unknown): string[] {
  const ids = Array.isArray(v) ? v : jarr(jobj(v).identified);
  const found = new Set<string>();
  for (const x of ids) { const s = jstr(x); for (const d of DISCIPLINE_WORDS) if (new RegExp(`\\b${d}\\b`, "i").test(s)) found.add(d); }
  return DISCIPLINE_WORDS.filter((d) => found.has(d));
}

function measurementsFromJson(v: unknown): EvalMeasurement[] {
  return jarr(v)
    .map((m) => { const o = jobj(m); return { label: jstr(o.name) || jstr(o.label), value: jstr(o.value), note: (jstr(o.location) || jstr(o.note)) || undefined }; })
    .filter((m) => m.label && m.value);
}

/** Requirements JSON → the same three buckets the markdown parser produces
 *  (priced items, retained "needs detail" scope, and not-assessable names). */
function requirementsFromJson(v: unknown): { items: DrawingItem[]; needsDetail: DrawingItem[]; notAssessable: string[] } {
  const items: DrawingItem[] = [];
  const needsDetail: DrawingItem[] = [];
  const notAssessable: string[] = [];
  for (const r of jarr(v)) {
    const o = jobj(r);
    const match = jstr(o.requirement) || jstr(o.name) || jstr(o.item);
    if (!match) continue;
    const allocation = jstr(o.allocation) || undefined;
    const unit = jstr(o.unit) || undefined;
    const basisRaw = jstr(o.basis);
    const basis = normBasis(basisRaw);
    const status = jstr(o.status);
    const scope = scopeClass(jstr(o.scope));
    const equipment = equipFromScope(scope);
    const note = [jstr(o.location), jstr(o.note)].filter(Boolean).join(" · ") || undefined;
    const qty = jnum(o.qty);
    const basisNA = /not\s*assessable/i.test(basisRaw);
    const statusNeedsDetail = NEEDS_DETAIL.test(status);
    const statusNA = /not\s*assessable/i.test(status);
    const countUnresolved = countNotEstablished(note, status);
    // STATUS is authoritative for provenance. A "Quantified" status (or a counted
    // row with no needs-detail/not-assessable status) yields the drawing's number;
    // a "Identified — Needs detail" / "Not assessable" status, or a note/basis that
    // says the COUNT is not established, is pending — a supplied number is NOT a
    // defensible count and is never promoted. (A missing dimension/spec stays a
    // note; the correct evaluator marks a defensible count "Quantified".)
    const blockCount = basisNA || statusNeedsDetail || statusNA || countUnresolved;
    // The status verbatim is carried onto the item so the quantity's provenance
    // survives storage — generation re-checks it (drawingItemIsPending) so a stored
    // number can never outlive the evidence that it is not a defensible count.
    if (qty != null && qty > 0 && !blockCount) items.push({ match, qty, unit, basis, equipment, scope, note, allocation, status: status || undefined });
    else if (statusNeedsDetail || countUnresolved) needsDetail.push({ match, qty: null, unit, equipment, scope, note, allocation, pending: true, status: status || undefined });
    else notAssessable.push(match);
  }
  const seen = new Set<string>();
  const dedupNA = notAssessable.filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { items, needsDetail, notAssessable: dedupNA };
}

function confidenceFromJson(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(jobj(v))) {
    const s = jstr(val);
    if (!s) continue;
    out[k.toLowerCase().replace(/_/g, " ")] = s[0].toUpperCase() + s.slice(1).toLowerCase();
  }
  if (out["floor"] && !out["floors"]) out["floors"] = out["floor"];           // UI reads "floors"
  if (out["major spaces"] && !out["major space identification"]) out["major space identification"] = out["major spaces"];
  return out;
}

/** category_summary is a reminder block, not a second requirements list — surface
 *  any flagged items as key-info reminders (never as priced quantities). */
function keyInfoFromCategorySummary(v: unknown): string[] {
  const out: string[] = [];
  for (const val of Object.values(jobj(v))) {
    for (const it of jarr(jobj(val).items)) {
      const s = typeof it === "string" ? it.trim() : jstr(jobj(it).requirement) || jstr(jobj(it).name);
      if (s) out.push(s);
    }
  }
  return out;
}

/** Convert the strict-JSON evaluation into the internal ChatGptEval type. */
export function evalFromJson(j: Record<string, unknown>): ChatGptEval {
  const projectType = firstOf(jstr(j.project_type), ["Residential", "Commercial", "Retail", "Office", "Hospitality", "Other"]) || (jstr(j.project_type) || undefined);
  const archetype = jstr(j.archetype) || undefined;
  const floor = jnum(j.floor);
  const req = requirementsFromJson(j.requirements);
  const spaces = spacesFromJson(j.spaces);
  const measurements = measurementsFromJson(j.measurements);
  const disciplines = disciplinesFromJson(j.disciplines);
  const eval_: ChatGptEval = {
    projectType,
    archetype,
    archetypeKey: archetypeKeyFor(archetype),
    floors: jnum(j.floors),
    floor,
    floorScope: jstr(j.floor_scope) || undefined,
    boqAllocation: jstr(j.boq_allocation) || undefined,
    area: areaFromJson(j.area, j.area_type),
    spaces,
    disciplines,
    measurements,
    requirements: req.items,
    needsDetail: req.needsDetail,
    notAssessable: req.notAssessable,
    keyInfo: keyInfoFromCategorySummary(j.category_summary),
    confidence: confidenceFromJson(j.confidence),
    confirmations: jarr(j.confirmations).map((c) => jstr(c)).filter((c) => c.length > 0),
    ok: false,
  };
  eval_.ok = Boolean(projectType || eval_.archetypeKey || archetype || floor != null || eval_.area || spaces.length || req.items.length || req.needsDetail.length || req.notAssessable.length || measurements.length || disciplines.length);
  return eval_;
}

/** Parse a pasted ChatGPT evaluation. JSON (the current contract) is preferred;
 *  a non-JSON response falls back to the legacy markdown/prose parser so older
 *  pasted responses still work. */
export function parseChatGptEvaluation(text: string): ChatGptEval {
  const json = extractJson(text);
  if (json) { const e = evalFromJson(json); if (e.ok) return e; }
  return parseMarkdownEvaluation(text);
}

/** Legacy markdown/prose parser — fallback only. */
function parseMarkdownEvaluation(text: string): ChatGptEval {
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

/** Render a parsed evaluation as a plain-text digest — everything the evaluation
 *  page surfaces, in one copyable block (project setup, spaces, measurements,
 *  every requirement with its quantity/basis/allocation, the identified-for-review
 *  scope, and what the drawing could not establish). Used by the "Copy result"
 *  action so the operator can paste the structured output elsewhere. */
export function evalToText(e: ChatGptEval): string {
  const L: string[] = [];
  const line = (label: string, value?: string | number | null) => {
    if (value == null || value === "" ) return;
    L.push(`${label}: ${value}`);
  };
  const heading = (h: string) => { L.push("", h); };
  const req = (it: DrawingItem) => {
    const scopeLabel = it.scope === "equipment" ? "client equipment"
      : it.scope === "needs_confirmation" ? "needs confirmation" : null;
    const bits = [
      it.qty != null && it.qty > 0 ? `${it.qty}${it.unit ? " " + it.unit : ""}` : null,
      (it.pending || it.qty == null) ? "pending quantity" : null,
      it.basis,
      it.allocation,
      scopeLabel ?? (it.equipment ? "client equipment" : null),
      it.note,
    ].filter(Boolean);
    return `- ${it.match}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
  };

  L.push("DRAWING EVALUATION");
  line("Project type", e.projectType);
  line("Archetype", e.archetype);
  line("Floor", e.floor != null ? e.floor : e.floors != null ? e.floors : undefined);
  line("Area", e.area ? `${e.area.value} sqft (${e.area.type})` : "Not provided");
  line("BOQ allocation", e.boqAllocation);
  line("Floor scope", e.floorScope);
  if (e.disciplines.length) line("Disciplines identified", e.disciplines.join(", "));

  if (e.spaces.length) {
    heading("SPACES");
    for (const s of e.spaces) L.push(`- ${s.name}${s.qty ? ` — ${s.qty}` : ""}`);
  }
  if (e.measurements.length) {
    heading("MEASUREMENTS");
    for (const m of e.measurements) L.push(`- ${m.label}: ${m.value}${m.note ? ` (${m.note})` : ""}`);
  }
  if (e.requirements.length) {
    heading(`REQUIREMENTS — QUANTIFIED (${e.requirements.length})`);
    for (const it of e.requirements) L.push(req(it));
  }
  if (e.needsDetail.length) {
    heading(`REQUIREMENTS — IDENTIFIED FOR REVIEW (${e.needsDetail.length})`);
    for (const it of e.needsDetail) L.push(req(it));
  }
  if (e.keyInfo.length) {
    heading("KEY DRAWING INFORMATION");
    for (const k of e.keyInfo) L.push(`- ${k}`);
  }
  if (e.notAssessable.length) {
    heading("NOT ASSESSABLE FROM DRAWING");
    for (const n of e.notAssessable) L.push(`- ${n}`);
  }
  if (e.confirmations.length) {
    heading("CONFIRM BEFORE GENERATING");
    for (const c of e.confirmations) L.push(`- ${c}`);
  }
  const conf = Object.entries(e.confidence);
  if (conf.length) {
    heading("CONFIDENCE");
    for (const [k, v] of conf) L.push(`- ${k}: ${v}`);
  }
  return L.join("\n").trim();
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

/** The BOQ allocation bucket this evaluation is for (e.g. "Floor 1"). */
export function boqBucketOf(e: Pick<ChatGptEval, "boqAllocation" | "floor">): string | undefined {
  return e.boqAllocation?.trim() || (e.floor != null ? `Floor ${e.floor}` : undefined);
}

/** Does a requirement's allocation belong in THIS BOQ's bucket? Unallocated items
 *  belong everywhere; a named bucket that differs (another floor, or "Common Area"
 *  when this BOQ is a private floor) is excluded — so a per-floor BOQ never prices
 *  common-area or other-floor scope. Matching is loose ("Floor 1" ≈ "floor1"). */
export function itemBelongsToBoq(itemAllocation: string | undefined, boqBucket: string | undefined): boolean {
  const a = (itemAllocation ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!a) return true;                     // unallocated → belongs to whatever BOQ this is
  const b = (boqBucket ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!b) return true;                     // BOQ itself has no bucket → keep everything
  return a === b;
}

/** Build the New-BOQ spec from a parsed evaluation. This is the single mapping
 *  point where the drawing evaluation becomes the SOURCE OF TRUTH:
 *   - room counts come only from the identified spaces (blank when unnamed);
 *   - area / floor / area-type come from the drawing when it states them;
 *   - only requirements allocated to THIS BOQ's bucket flow in (common-area and
 *     other-floor scope is identified but never priced into a private floor);
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
  // but are never priced until the operator fills them in. Only rows allocated to
  // THIS BOQ's bucket are included — common-area / other-floor scope is dropped.
  const bucket = boqBucketOf(e);
  const all = [...e.requirements, ...e.needsDetail];
  // Enforce quantity provenance at the source: any item whose own evidence does not
  // establish a defensible count is stored as pending (qty null), so the persisted
  // _drawing can never carry an undefensible number into a later regeneration.
  const drawItems = resolveDrawingProvenance(all.filter((it) => itemBelongsToBoq(it.allocation, bucket)));
  if (drawItems.length) (base as Record<string, unknown>)._drawing = { items: drawItems };
  // Requirements the drawing identified but that belong to ANOTHER allocation
  // (e.g. Common Area on a private-floor BOQ) are retained — never priced here —
  // so they stay auditable as "seen in drawing → excluded from this BOQ".
  const excluded = all.filter((it) => !itemBelongsToBoq(it.allocation, bucket));
  if (excluded.length) (base as Record<string, unknown>)._excluded = { items: excluded };
  if (e.measurements.length) (base as Record<string, unknown>)._measurements = e.measurements;
  if (e.spaces.length) (base as Record<string, unknown>)._spaces = e.spaces;
  if (e.floorScope) (base as Record<string, unknown>)._floor_scope = e.floorScope;
  if (e.boqAllocation) (base as Record<string, unknown>)._boq_allocation = e.boqAllocation;
  // Carry the drawing's identified disciplines so downstream generation can gate
  // each discipline on real evidence (a discipline with no drawing is withheld).
  if (e.disciplines.length) (base as Record<string, unknown>)._disciplines = e.disciplines;
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
export function classifyDiscipline(label: string): string {
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
