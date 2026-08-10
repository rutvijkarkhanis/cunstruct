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

/** One measured/counted override the operator entered from a drawing. */
export interface DrawingItem {
  /** Exact DSR code, or a case-insensitive substring of the item description. */
  match: string;
  /** The measured or counted quantity, in the item's own unit. */
  qty: number;
  /** true = calculated from drawing measurements; false = explicitly counted/stated. */
  derived?: boolean;
  /** Operator note, e.g. "8×6A + 2×16A sockets across living + 2 beds". */
  note?: string;
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

const matchesLine = (it: DrawingItem, l: GeneratedLine): boolean => {
  const key = it.match.trim().toLowerCase();
  if (!key) return false;
  if (l.code && l.code.toLowerCase() === key) return true;
  return (l.label ?? "").toLowerCase().includes(key);
};

/**
 * Apply the operator's drawing summary to already-generated lines: wherever a
 * summary item matches a line, use its quantity directly and stamp the basis.
 * Lines the summary doesn't touch keep their (already-stamped) fallback basis.
 * We only override what the summary explicitly provides — never invent counts.
 */
export function applyDrawing(lines: GeneratedLine[], summary?: DrawingSummary | null): GeneratedLine[] {
  const items = summary?.items?.filter((i) => i.match?.trim() && Number.isFinite(i.qty) && i.qty > 0);
  if (!items?.length) return lines;
  return lines.map((l) => {
    const hit = items.find((it) => matchesLine(it, l));
    if (!hit) return l;
    return { ...l, qty: hit.qty, basis: hit.derived ? "DRAWING_DERIVED" : "DRAWING_INPUT", note: hit.note?.trim() || undefined };
  });
}

/** How many summary items didn't match any generated line (so didn't apply). */
export function unmatchedItems(lines: GeneratedLine[], summary?: DrawingSummary | null): DrawingItem[] {
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
const SINGLE_QTY = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(?:${UNIT})?\\.?$`, "i");
const TRAILING_QTY = new RegExp(`^(.+?)[\\s:\\u2013-]+(\\d+(?:\\.\\d+)?)\\s*(?:${UNIT})?\\.?$`, "i");

interface RawHit { qty: number; label: string; context?: string }

const stripBullet = (s: string) => s.replace(/^[\s\-*\u2022]+/, "").replace(/^\(?\d+[.)]\s+/, "").trim();
const cleanLabel = (s: string) => s.replace(/^[\s:\u2013,;.-]+|[\s:\u2013,;.-]+$/g, "").replace(/\s{2,}/g, " ").trim();
const firstNumber = (s: string): number | null => { const m = s.match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };

// Drawing metadata that reads like "<word> <number>" but is a reference, not a
// quantity ("page 1", "sheet 3", "rev 2") — never turn these into BOQ items.
const REF_WORD = /^(pages?|sheets?|figs?|figures?|drawings?|dwg|revs?|revisions?|plates?|details?|scales?|grids?|levels?|notes?|refs?|items?|sr|s\.?\s?no|no)$/i;

function pushHit(out: RawHit[], qty: number, rawLabel: string, context?: string) {
  const label = cleanLabel(rawLabel);
  if (!label || label.length < 2 || REF_WORD.test(label) || !(qty > 0)) return;
  out.push({ qty, label, context });
}

function parseSegment(seg: string, context: string | undefined, out: RawHit[]) {
  const s = stripBullet(seg);
  if (!s) return;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*[\u00d7x*]\s*(.+)$/i);           // "8 × 6A sockets"
  if (m) return pushHit(out, Number(m[1]), m[2], context);
  m = s.match(TRAILING_QTY);                                            // "6M switchboards: 8 nos"
  if (m) return pushHit(out, Number(m[2]), m[1], context);
  m = s.match(/^(\d+(?:\.\d+)?)\s+([A-Za-z].*)$/);                      // "8 sockets" (label starts with a letter)
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
    const anyCtx = hs.some((h) => h.context);
    let note: string | undefined;
    if (hs.length > 1 && anyCtx) note = hs.map((h) => `${h.qty}${h.context ? " " + h.context : ""}`).join(" + ");
    else if (hs.length === 1 && hs[0].context) note = hs[0].context;
    items.push({ match: hs[0].label, qty, derived: false, note });
  }
  return items;
}

/** Parse a pasted drawing summary into editable, reviewable DrawingItems. */
export function parseDrawingSummary(text: string): DrawingItem[] {
  const out: RawHit[] = [];
  let context: string | undefined;
  for (const rawLine of (text || "").split(/\r?\n/)) {
    const line = stripBullet(rawLine);
    if (!line) continue;
    const ci = line.indexOf(":");
    if (ci >= 0) {
      const head = line.slice(0, ci).trim();
      const rest = line.slice(ci + 1).trim();
      if (!rest) { context = head || undefined; continue; }              // "Electrical:" / "Bedroom 1:" header
      if (SINGLE_QTY.test(rest)) { pushHit(out, firstNumber(rest)!, head, context); continue; }  // "4M switchboards: 6 nos"
      const local = head || context;                                     // "Living room: 8 × …" → head is the room
      for (const seg of rest.split(/[,;]|\band\b/i)) parseSegment(seg, local, out);
      continue;
    }
    for (const seg of line.split(/[,;]|\band\b/i)) parseSegment(seg, context, out);
  }
  return aggregate(out);
}
