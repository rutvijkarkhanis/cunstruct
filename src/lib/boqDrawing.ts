// Drawing-specific input: a summary of measurements/counts the operator has
// read off the project drawings. It is treated as high-confidence, project-
// specific input that OVERRIDES the generic archetype/area heuristics — but it
// feeds the SAME DSR/AOR engine (quantity basis changes, the commercial engine
// does not). Every quantity carries a basis so the final BOQ can explain where
// each number came from.
//
// This is not a drawing-processing system: the operator supplies the summary
// (typed, or later pasted from an analysed drawing). We never invent a number
// that isn't in the summary; anything the summary doesn't cover falls back to
// the existing engine and is marked as an assumption.

import type { GeneratedLine } from "./boqDsrGenerate";

/** Where a quantity came from — most trustworthy first. */
export type QtyBasis = "DRAWING_INPUT" | "DRAWING_DERIVED" | "DSR_AOR" | "HEURISTIC";

/** How the operator arrived at the quantity. */
export type DrawingBasis = "Counted" | "Measured" | "Derived" | "Assumed";

/** One requirement the operator entered from the drawing summary. */
export interface DrawingItem {
  /** The requirement — a DSR code, or a description of the work/item. */
  match: string;
  /** The quantity, in the item's own unit. */
  qty: number;
  /** Unit for a requirement that has no catalogue match (defaults to nos). */
  unit?: string;
  /** Sub-head for a no-match line (defaults to "Drawing items"). */
  section?: string;
  /** Counted / Measured / Derived / Assumed (defaults to Counted). */
  basis?: DrawingBasis;
  /** Client equipment (e.g. the TV itself) — not contractor works, not priced by default. */
  equipment?: boolean;
  /** Location / note, e.g. "Living / TV area" or "Bedroom 1 (4), Bedroom 2 (6)". */
  note?: string;
  /** Structured per-room breakdown preserved when identical items are consolidated. */
  rooms?: { location: string; qty: number }[];
}

/** Structured drawing provenance carried onto a BOQ line (persisted as jsonb). */
export interface LineDrawingMeta {
  basis: DrawingBasis;
  location?: string;
  scope: "works" | "equipment";
  rooms?: { location: string; qty: number }[];
}

/** The operator's basis → the line-level quantity provenance. */
export function toQtyBasis(b?: DrawingBasis): QtyBasis {
  if (b === "Derived") return "DRAWING_DERIVED";
  if (b === "Assumed") return "HEURISTIC";
  return "DRAWING_INPUT";   // Counted / Measured — straight from the drawing
}

// Client equipment vs contractor works. Only clear equipment nouns with no
// "work" word (point/socket/provision/wiring…) are treated as equipment, so a
// "TV point" or "55\" TV provision" stays contractor works and only a bare
// "55\" TV" / "Projector" / "Projector screen" is flagged as client-provided.
const EQUIP_WORD = /\b(tv|television|projector|screen|washing\s*machine|dishwasher|refrigerator|fridge|microwave|oven|hob|dryer|speakers?|soundbar|amplifier|home\s*theat(?:re|er))\b/i;
const WORK_WORD = /\b(point|socket|outlet|wiring|conduit|cabling|provision|switch|switchboard|board|panel|earthing|db|light|fixture|fitting|pipe|piping|plumbing|drain|tap|faucet|valve|duct)\b/i;
export function isEquipment(label: string): boolean {
  return EQUIP_WORD.test(label) && !WORK_WORD.test(label);
}

/** The drawing summary, stored on boq.spec._drawing (jsonb — no migration). */
export interface DrawingSummary {
  items?: DrawingItem[];
}

export const BASIS_META: Record<QtyBasis, { label: string; short: string; tone: "measured" | "estimated" }> = {
  DRAWING_INPUT:   { label: "From drawing — measured / counted",       short: "drawing", tone: "measured" },
  DRAWING_DERIVED: { label: "From drawing — derived from measurements", short: "drawing", tone: "measured" },
  DSR_AOR:         { label: "DSR / AOR methodology",                    short: "DSR/AOR", tone: "estimated" },
  HEURISTIC:       { label: "Estimated from built-up area (assumption)", short: "est.",   tone: "estimated" },
};

/**
 * The basis a freshly generated quantity has before any drawing override:
 * - measured room dimensions present  → DRAWING_DERIVED (driven by the drawing)
 * - a scheduled (coded) item          → DSR_AOR (coefficient-derived)
 * - anything else                     → HEURISTIC (archetype/area assumption)
 */
export function defaultBasis(line: GeneratedLine, hasRooms: boolean): QtyBasis {
  if (hasRooms) return "DRAWING_DERIVED";
  return line.code ? "DSR_AOR" : "HEURISTIC";
}

// --- Catalogue matching (semantic, not exact) --------------------------------
// A BOQ item is what the project requires; a catalogue (DSR) item is a priceable
// product; a match is the (optional) link between them. Matching normalises
// wording so synonyms line up — "16 amp power point" ≈ "Power plug points (16A)"
// — but stays conservative: if there's no clear signal we DON'T force a match,
// we let the requirement stand as its own line (No Catalogue Match).
const GENERIC = new Set([
  "point", "and", "with", "the", "for", "of", "modular", "concealed", "complete",
  "supply", "install", "installation", "fittings", "fitting", "dedicated", "type", "nos", "no",
]);
function norm(s: string): string {
  return (s || "").toLowerCase()
    .replace(/\bamp(ere)?s?\b/g, "a")            // 16 amp → 16 a
    .replace(/(\d+)\s*a\b/g, "$1a")               // 16 a → 16a
    .replace(/(\d+)\s*m\b/g, "$1m")               // 4 m → 4m
    .replace(/&/g, " and ")
    .replace(/\b(sockets?|plugs?|outlets?|receptacles?)\b/g, "point")  // unify power outlets
    .replace(/\bpower\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Does a requirement description confidently correspond to a catalogue item? */
export function matchesCandidate(matchText: string, cand: { code: string | null; label: string }): boolean {
  const key = matchText.trim().toLowerCase();
  if (!key) return false;
  if (cand.code && cand.code.toLowerCase() === key) return true;      // exact DSR code typed
  const it = norm(matchText), ln = norm(cand.label);
  if (!it || !ln) return false;
  if (ln.includes(it)) return true;                                   // normalised substring
  const sizes = it.match(/\d+[am]\b/g) ?? [];
  if (sizes.length) return sizes.every((t) => ln.includes(t));        // amperage/size must all appear
  const words = it.split(" ").filter((w) => w.length >= 2 && !GENERIC.has(w));
  return words.length > 0 && words.every((w) => ln.includes(w));      // else all distinctive words must appear
}

/** The best catalogue (DSR) match for a requirement, or null (No Catalogue Match). */
export function findCatalogueMatch<T extends { code: string | null; label: string }>(matchText: string, candidates: T[]): T | null {
  return candidates.find((c) => matchesCandidate(matchText, c)) ?? null;
}

const matchesLine = (it: DrawingItem, l: GeneratedLine): boolean =>
  matchesCandidate(it.match, { code: l.code, label: l.label });

/**
 * Apply the operator's drawing summary to generated lines. Every requirement the
 * summary names becomes a BOQ line: if it links to a catalogue (DSR) item that
 * line's quantity is set from the drawing; if it has no catalogue match it is
 * still added as a valid, priceable line (null code = No Catalogue Match) rather
 * than being dropped or forced into a wrong item. We never invent a quantity.
 */
// Generic catch-all MEP allowance the itemised drawing points replace (so it
// isn't double-counted): the "concealed wiring for light/fan/… points" line.
const GENERIC_POINTS = /(light|fan|call).{0,20}point|concealed wiring.{0,30}point|point.{0,20}modular switch/i;
const looksLikePoint = (label: string) =>
  /\b(\d+\s*a\b|socket|light\s*point|fan\s*point|power\s*point|floor\s*point|tv\s*point|projector\s*point|audio\s*point|conduit)\b/i.test(label);

export function applyDrawing(lines: GeneratedLine[], summary?: DrawingSummary | null): GeneratedLine[] {
  const items = summary?.items?.filter((i) => i.match?.trim() && Number.isFinite(i.qty) && i.qty > 0);
  if (!items?.length) return lines;
  const metaOf = (it: DrawingItem, equip: boolean): LineDrawingMeta => ({
    basis: it.basis ?? "Counted",
    location: it.note?.trim() || undefined,
    scope: equip ? "equipment" : "works",
    rooms: it.rooms,
  });
  const used = new Set<number>();
  const out = lines.map((l) => {
    const idx = items.findIndex((it) => matchesLine(it, l));
    if (idx < 0) return l;
    used.add(idx);
    const it = items[idx];
    const equip = it.equipment ?? isEquipment(it.match);
    return { ...l, qty: it.qty, basis: toQtyBasis(it.basis), note: it.note?.trim() || undefined, drawing: metaOf(it, equip), included: equip ? false : l.included };
  });
  items.forEach((it, i) => {
    if (used.has(i)) return;
    const equip = it.equipment ?? isEquipment(it.match);
    out.push({
      section: it.section?.trim() || (equip ? "Client equipment (excluded)" : "Drawing items"),
      code: null, qty: it.qty, label: it.match.trim(), unit: it.unit?.trim() || "nos", ns: true,
      basis: toQtyBasis(it.basis), note: it.note?.trim() || undefined, drawing: metaOf(it, equip),
      included: equip ? false : undefined,   // client equipment isn't contractor works
    });
  });
  // #5 — prevent double-counting: when the drawing itemises electrical points, the
  // generic catch-all points allowance is superseded. Mark it Assumed and drop it
  // from the total (operator can re-include if it is genuinely separate scope).
  const itemisesPoints = items.some((it) => looksLikePoint(it.match) && !(it.equipment ?? isEquipment(it.match)));
  if (itemisesPoints) {
    for (let i = 0; i < out.length; i++) {
      const l = out[i];
      if (l.drawing || !l.label) continue;            // never touch drawing-derived lines
      if (GENERIC_POINTS.test(l.label)) {
        out[i] = { ...l, included: false, basis: "HEURISTIC", note: "Superseded by itemised drawing points" };
      }
    }
  }
  return out;
}

/** Requirements with no catalogue (DSR) match — added as their own BOQ lines. */
export function noCatalogueMatch(lines: GeneratedLine[], summary?: DrawingSummary | null): DrawingItem[] {
  const items = summary?.items?.filter((i) => i.match?.trim() && Number.isFinite(i.qty) && i.qty > 0) ?? [];
  return items.filter((it) => !lines.some((l) => matchesLine(it, l)));
}

// --- Paste-a-summary parsing -------------------------------------------------
// The operator usually gets a drawing summary out of ChatGPT and pastes it in.
// This turns that free text into editable DrawingItems: it pulls out (quantity,
// item, room) triples from the common list shapes, sums the same item across
// rooms, and records the breakdown as a note. It is deliberately forgiving and
// never guesses a number that isn't written down — anything it can't read is
// simply skipped, and every row it produces is reviewed before it's applied.

const UNIT = "nos?|no\\.?|units?|pcs?|points?|locations?|places?|runs?|sets?|m|mtr|rmt|met(?:re|er)s?|sq\\.?\\s?ft|sqft|sq\\.?\\s?m|sqm";
const SINGLE_QTY = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${UNIT})?\\.?$`, "i");
// separators include hyphen, en-dash and em-dash ("TV point — 1")
const TRAILING_QTY = new RegExp(`^(.+?)[\\s:\\u2013\\u2014-]+(\\d+(?:\\.\\d+)?)\\s*(${UNIT})?\\.?$`, "i");
const SEG_SPLIT = /[,;]|\band\b/i;

const WORDNUM: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};
const wordsToDigits = (s: string) =>
  s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi, (m) => WORDNUM[m.toLowerCase()]);

interface RawHit { qty: number; label: string; context?: string; unit?: string }

const stripBullet = (s: string) => s.replace(/^[\s\-*\u2022]+/, "").replace(/^\(?\d+[.)]\s+/, "").trim();
const cleanLabel = (s: string) => s.replace(/^[\s:\u2013,;.-]+|[\s:\u2013,;.-]+$/g, "").replace(/\s{2,}/g, " ").trim();
function unitFrom(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const u = raw.toLowerCase().replace(/\./g, "").trim();
  if (/^(m|mtr|rmt|met(re|er)s?)$/.test(u)) return "metre";
  if (/^(sq\s?ft|sqft)$/.test(u)) return "sqft";
  if (/^(sq\s?m|sqm)$/.test(u)) return "sqm";
  return "nos";
}

// Drawing metadata that reads like "<word> <number>" but is a reference, not a
// quantity ("page 1", "sheet 3", "rev 2") — never turn these into BOQ items.
const REF_WORD = /^(pages?|sheets?|figs?|figures?|drawings?|dwg|revs?|revisions?|plates?|details?|scales?|grids?|levels?|notes?|refs?|items?|sr|s\.?\s?no|no)$/i;

function pushHit(out: RawHit[], qty: number, rawLabel: string, context?: string, unit?: string) {
  const label = cleanLabel(rawLabel);
  if (!label || label.length < 2 || REF_WORD.test(label) || !(qty > 0)) return;
  out.push({ qty, label, context, unit });
}

function parseSegment(seg: string, context: string | undefined, out: RawHit[]) {
  const s = stripBullet(seg);
  if (!s) return;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*[\u00d7x*]\s*(.+)$/i);           // "8 × 6A sockets"
  if (m) return pushHit(out, Number(m[1]), m[2], context);
  m = s.match(TRAILING_QTY);                                            // "TV point — 1" / "Conduit: 185 m"
  if (m) return pushHit(out, Number(m[2]), m[1], context, unitFrom(m[3]));
  m = s.match(/^(\d+(?:\.\d+)?)\s+(\S.*)$/);                            // "8 6A sockets" / "1 TV point" (item may start with a digit)
  if (m) return pushHit(out, Number(m[1]), m[2], context);
}

function aggregate(hits: RawHit[]): DrawingItem[] {
  const groups = new Map<string, RawHit[]>();
  for (const h of hits) {
    const key = h.label.toLowerCase().replace(/\s+/g, "").replace(/s$/, "");   // merge plural/singular
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(h); else groups.set(key, [h]);
  }
  const items: DrawingItem[] = [];
  for (const hs of groups.values()) {
    const qty = hs.reduce((s, h) => s + h.qty, 0);
    const unit = hs.find((h) => h.unit)?.unit ?? "nos";
    const withCtx = hs.filter((h) => h.context);
    // Preserve the room-wise breakdown whenever identical items are consolidated
    // across locations: one hit → its place; several → each place with its count.
    let note: string | undefined;
    if (hs.length > 1 && withCtx.length) note = hs.map((h) => `${h.context ?? "unspecified"} (${h.qty})`).join(", ");
    else if (hs.length === 1 && hs[0].context) note = hs[0].context;
    const rooms = withCtx.length ? withCtx.map((h) => ({ location: h.context as string, qty: h.qty })) : undefined;
    items.push({
      match: hs[0].label, qty, unit, basis: "Counted",
      equipment: isEquipment(hs[0].label) || undefined, note, rooms,
    });
  }
  return items;
}

/** Parse a pasted drawing summary (list or prose) into editable DrawingItems. */
export function parseDrawingSummary(text: string): DrawingItem[] {
  const out: RawHit[] = [];
  let context: string | undefined;
  for (const rawLine of (text || "").split(/\r?\n/)) {
    // Split prose into sentences too ("…AC point. Bedroom 1 has…"), but never at
    // a decimal/DSR-code dot (only split when a non-digit precedes the dot).
    for (const chunk of rawLine.split(/(?<=\D)\.\s+/)) {
      const line = wordsToDigits(stripBullet(chunk));
      if (!line) continue;
      const ci = line.indexOf(":");
      if (ci >= 0) {
        const head = line.slice(0, ci).trim();
        const rest = line.slice(ci + 1).trim();
        if (!rest) { context = head || undefined; continue; }            // "Electrical:" / "Bedroom 1:" header
        const sm = rest.match(SINGLE_QTY);
        if (sm) { pushHit(out, Number(sm[1]), head, context, unitFrom(sm[2])); continue; }  // "Conduit: 185 m"
        const local = head || context;                                   // "Living room: 8 × …" → head is the room
        for (const seg of rest.split(SEG_SPLIT)) parseSegment(seg, local, out);
        continue;
      }
      // Natural language: "Living room has 8 6A sockets, 2 16A sockets and one TV point"
      const hm = line.match(/^(.{2,50}?)\s+(?:has|have|contains?|with)\s+(.+)$/i);
      if (hm && /\d/.test(hm[2])) {
        for (const seg of hm[2].split(SEG_SPLIT)) parseSegment(seg, hm[1].trim(), out);
        continue;
      }
      for (const seg of line.split(SEG_SPLIT)) parseSegment(seg, context, out);
    }
  }
  return aggregate(out);
}
