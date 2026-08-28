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
  /** The quantity, in the item's own unit. `null` = identified on the drawing but
   *  NOT yet quantifiable — a genuine unknown that must be preserved as-is (never
   *  coerced to 0 or an assumed number) so the row stays identifiable as pending. */
  qty: number | null;
  /** Unit for a requirement that has no catalogue match (defaults to nos). */
  unit?: string;
  /** Sub-head for a no-match line (defaults to "Drawing items"). */
  section?: string;
  /** Counted / Measured / Derived / Assumed. Left UNSET for a pending (qty null)
   *  item — a quantity basis is never invented for something that wasn't counted. */
  basis?: DrawingBasis;
  /** Client equipment (e.g. the TV itself) — not contractor works, not priced by default. */
  equipment?: boolean;
  /** Scope classification, kept distinct: contractor "works", loose client
   *  "equipment", or "needs_confirmation". Preserves the Works / Equipment /
   *  Needs-confirmation distinction from the evaluation. */
  scope?: "works" | "equipment" | "needs_confirmation";
  /** true when the requirement is identified but has no defensible quantity yet
   *  (qty is null). Retained as scope and shown as pending — never priced, never
   *  given an invented quantity — until the operator confirms a count. */
  pending?: boolean;
  /** Location / note, e.g. "Living / TV area" or "Bedroom 1 (4), Bedroom 2 (6)". */
  note?: string;
  /** Structured per-room breakdown preserved when identical items are consolidated. */
  rooms?: { location: string; qty: number }[];
  /** BOQ allocation bucket this requirement belongs to, e.g. "Floor 1" / "Common".
   *  Preserved from the drawing evaluation so a per-floor BOQ never mixes buckets. */
  allocation?: string;
  /** The evaluation's status verbatim ("Quantified" / "Identified — Needs detail" /
   *  "Not assessable"). Persisted on the item (in the _drawing jsonb) so quantity
   *  PROVENANCE survives storage: the parser status is the strongest signal that a
   *  supplied number is NOT a defensible count, and generation re-checks it so a
   *  stale/mis-parsed number can never leak into a priced line. */
  status?: string;
}

// --- Quantity provenance gate (single source of truth) -----------------------
// The ONLY authoritative source of a drawing quantity is the DrawingItem's OWN
// evidence. A number is a defensible count only when the item's status/basis/note
// say so; otherwise the item is PENDING and its quantity must be null — no matter
// what number was supplied, stored, or mis-parsed earlier. This gate is applied at
// BOTH parse time (new imports) and generation time (already-stored specs, which are
// never re-parsed), so no downstream layer can manufacture a quantity. It is keyed on
// evidence, never on item names, so it holds for every discipline and project.
//
// COUNT-gap vs SPEC-gap (COUNTABLE ≠ FULLY SPECIFIED): a PRESENT count is authoritative
// and is KEPT even when the item is flagged "Identified — Needs detail" for a missing
// specification / rating / model / material / dimension / running length — that gap is
// a note, never a reason to null a visible count. Only a genuine COUNT gap (the total
// itself unestablished, via COUNT_UNRESOLVED), a "Not assessable" basis/status, an
// explicit pending flag, or a null/≤0 qty makes an item pending. So "Needs detail"
// alone does NOT demote a counted item.
const NOT_ASSESSABLE = /not\s*assessable/i;
// The evaluation explicitly says the COUNT / TOTAL itself is not established (as
// opposed to a missing dimension/spec/material, which under COUNTABLE ≠ MEASURABLE
// must NOT block a count). Requires a count-word next to a not-established phrase.
const COUNT_UNRESOLVED = new RegExp([
  // A count-word directly followed by a dimension noun ("total running length not
  // established") is a MISSING DIMENSION, not a count gap — excluded via lookahead.
  String.raw`\b(?:counts?|totals?|numbers?|tall(?:y|ies)|quantit(?:y|ies)|qty)\b(?!\s+(?:running|length|area|width|height|depth|dimension|footage|size|material|thickness|volume|weight|run)s?\b)[^.;\n]{0,45}\b(?:not|cannot|can[’']?t|un(?:able)?|to\s+be|pending|await\w*)\b[^.;\n]{0,25}\b(?:establish\w*|assess\w*|confirm\w*|determin\w*|quantif\w*|count(?:ed)?|verif\w*|resolv\w*|final\w*|reliab\w*|defensib\w*)\b`,
  String.raw`\b(?:not|cannot|can[’']?t|un(?:able)?)\b[^.;\n]{0,30}\b(?:establish\w*|assess\w*|confirm\w*|determin\w*|count\w*|quantif\w*)\b[^.;\n]{0,30}\b(?:counts?|totals?|numbers?|quantit(?:y|ies)|qty)\b`,
  String.raw`\bpending\s+quantit`,
  String.raw`\bnot\s+(?:fully\s+|reliably\s+)?count(?:ed|able)?\b`,
].join("|"), "i");

/** Did the item's note or status flag the COUNT itself as unestablished? */
export function countNotEstablished(note: string | undefined, status: string | undefined): boolean {
  return COUNT_UNRESOLVED.test(note ?? "") || COUNT_UNRESOLVED.test(status ?? "");
}

/** The generic provenance rule: is this DrawingItem's quantity NOT a defensible
 *  drawing count — so it must stay pending (qty null)? True when the item is already
 *  pending / has no number, when its basis or status is "Not assessable", or when its
 *  note/status say the COUNT itself is unestablished. A missing spec/rating/model/
 *  material/dimension — even tagged "Identified — Needs detail" — does NOT make a
 *  PRESENT count pending (COUNTABLE ≠ FULLY SPECIFIED): a visible count is kept and the
 *  gap stays a note. So a positive qty establishes a count unless the count itself is
 *  in doubt (count gap) or the drawing does not support it ("Not assessable"). */
export function drawingItemIsPending(it: Pick<DrawingItem, "qty" | "pending" | "basis" | "status" | "note">): boolean {
  if (it.pending) return true;
  if (it.qty == null || !Number.isFinite(it.qty) || (it.qty as number) <= 0) return true;
  if (NOT_ASSESSABLE.test(it.basis ?? "")) return true;
  const status = it.status ?? "";
  if (NOT_ASSESSABLE.test(status)) return true;
  if (countNotEstablished(it.note, status)) return true;   // the COUNT itself is unestablished
  return false;
}

/** Enforce quantity provenance on a set of DrawingItems: any item whose own evidence
 *  does not establish a defensible count is forced to pending (qty null, no invented
 *  basis) — nulling a stored/mis-parsed number rather than letting it flow downstream.
 *  Defensible counts pass through untouched. Idempotent and item-name-agnostic. */
export function resolveDrawingProvenance<T extends DrawingItem>(items: T[] | undefined): T[] {
  return (items ?? []).map((it) =>
    drawingItemIsPending(it) ? ({ ...it, qty: null, pending: true, basis: undefined }) : it,
  );
}

/** Provenance-resolved copy of a drawing summary (see resolveDrawingProvenance). */
export function resolveDrawingSummary(summary: DrawingSummary | null | undefined): DrawingSummary {
  return { ...(summary ?? {}), items: resolveDrawingProvenance(summary?.items) };
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

/** How confidently a requirement corresponds to a catalogue item — 0 = no match,
 *  higher = more specific. Used to pick the BEST catalogue line for a drawing item
 *  (so "Geyser points" claims "Geyser power points…" ahead of a generic "Power
 *  points"), never just the first that loosely matches. A drawing quantity may only
 *  ever transfer onto the line that is genuinely its counterpart. */
export function matchScore(matchText: string, cand: { code: string | null; label: string }): number {
  const key = matchText.trim().toLowerCase();
  if (!key) return 0;
  if (cand.code && cand.code.toLowerCase() === key) return 1000;      // exact DSR code typed
  const it = norm(matchText), ln = norm(cand.label);
  if (!it || !ln) return 0;
  if (ln.includes(it)) return 500 + it.length;                        // full normalised phrase in label (longer = better)
  const word = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(ln);
  const sizes = it.match(/\d+[am]\b/g) ?? [];
  // Whole-word matching only — otherwise "AC point" wrongly matches "compACtion"
  // / "accessories" and silently overrides an unrelated line's quantity.
  if (sizes.length) return sizes.every((t) => word(t)) ? 200 + sizes.length : 0;   // amperage/size (16a, 4m)
  const words = it.split(" ").filter((w) => w.length >= 2 && !GENERIC.has(w));
  return words.length > 0 && words.every((w) => word(w)) ? 100 + words.length : 0; // all distinctive words present
}

/** Does a requirement description confidently correspond to a catalogue item? */
export function matchesCandidate(matchText: string, cand: { code: string | null; label: string }): boolean {
  return matchScore(matchText, cand) > 0;
}

/** The best catalogue (DSR) match for a requirement, or null (No Catalogue Match). */
export function findCatalogueMatch<T extends { code: string | null; label: string }>(matchText: string, candidates: T[]): T | null {
  return candidates.find((c) => matchesCandidate(matchText, c)) ?? null;
}

const matchesLine = (it: DrawingItem, l: GeneratedLine): boolean =>
  matchesCandidate(it.match, { code: l.code, label: l.label });

// Unit dimensionality — a drawing quantity may only OVERRIDE a catalogue line
// when they measure the same kind of thing. A drawing COUNT ("Kitchen platform —
// 1 nos") must never be written into an AREA line ("Granite platform — sqm"): the
// count does not establish the area, so that would fabricate a wrong-unit quantity.
type UnitClass = "count" | "area" | "length" | "volume" | "weight";
function unitClass(unit: string | null | undefined): UnitClass {
  const u = (unit ?? "").toLowerCase().replace(/[.\s]/g, "");
  if (/^(sqm|sqft|sqmt|m2|squaremet(re|er)s?|squarefeet|squarefoot)$/.test(u)) return "area";
  if (/^(cum|cft|m3|cubicmet(re|er)s?|cubicfeet|brass)$/.test(u)) return "volume";
  if (/^(kg|kgs|kilogram?s?|tonne?s?|mt|quintals?|ton)$/.test(u)) return "weight";
  if (/^(m|mtr|rmt|rm|met(re|er)s?|running?met(re|er)s?|feet|foot|ft|inch|inches)$/.test(u)) return "length";
  return "count";   // nos, each, point, job, set, pcs, unit, blank → a count
}
/** May a drawing item's quantity override this catalogue line? Only when the two
 *  units are the same dimensionality (a count can't set an area/length/volume). */
const unitsCompatible = (a: string | null | undefined, b: string | null | undefined): boolean =>
  unitClass(a) === unitClass(b);

/**
 * Apply the operator's drawing summary to generated lines. Every requirement the
 * summary names becomes a BOQ line: if it links to a catalogue (DSR) item that
 * line's quantity is set from the drawing; if it has no catalogue match it is
 * still added as a valid, priceable line (null code = No Catalogue Match) rather
 * than being dropped or forced into a wrong item. We never invent a quantity.
 */
// Collective (category) precedence. A generic template line covers a whole
// category with a single room-count-sized quantity (a "90 light/fan/socket
// points" allowance, a "flooring ≈ 0.85 × area" line, an interior-paint area).
// Once the drawing itemises that category — even as pending, qty null — the
// drawing becomes the source of truth for it, so the bundled template quantity
// must NOT stand in for the drawing's (as-yet-unquantified) scope. Each bridge is
// { heuristic: the template line it supersedes, item: the drawing signal that a
// category is itemised }. These are category families, NOT per-item exclusions.
const CATEGORY_BRIDGES: { heuristic: RegExp; item: RegExp }[] = [
  {
    // Electrical: generic points allowance / plug points / MCB DB / geyser-AC
    // points / light fittings, superseded once the drawing itemises any point.
    heuristic: /(light|fan|call)[^]{0,20}point|concealed[^]{0,40}point|point[^]{0,20}modular switch|power\s*plug\s*point|plug\s*point|distribution board|\bmcb\b|geyser\s*power\s*point|dedicated\s*power\s*point|light fixtures?,?\s*fans|light fittings?,?\s*ceiling fans/i,
    item: /\b(\d+\s*a\b|socket|switch\s*board|switchboard|distribution board|\bdb\b|geyser|ceiling\s*(lamp|light|fan)|tube\s*light|\bfan\b|\blamp\b|light\s*point|fan\s*point|floor\s*point|tv\s*point|ac\s*point|audio\s*point|power\s*point|conduit)\b/i,
  },
  {
    // Interior wall finishes: generic internal plaster / putty / primer / emulsion
    // area, superseded once the drawing itemises wall finishes / painting scope.
    heuristic: /internal\s*plaster|wall\s*putty|interior\s*(primer|emulsion|paint)/i,
    item: /wall\s*finish|\bpaint(?:ing)?\b|\bplaster\b|\bputty\b|\bemulsion\b/i,
  },
  {
    // Flooring: generic floor-area allowance, superseded once the drawing itemises
    // flooring scope (but NOT floor traps / floor points, which are not flooring).
    heuristic: /flooring|anti-?skid\s*ceramic|vitrified|floor\s*tile/i,
    item: /\bfloor(?:ing)?\b(?!\s*(?:trap|drain|point|box|spring|outlet))/i,
  },
];

/**
 * DrawingItem precedence: is this template/heuristic line superseded by a drawing
 * requirement? The drawing evaluation is authoritative, so a generic template
 * quantity must never duplicate or stand in for a requirement the drawing owns —
 * whether that requirement is priced or still pending (qty null). Two match modes:
 *   - specific: the line names the same requirement as a DrawingItem (matchesCandidate);
 *   - collective: a bundled electrical points allowance (e.g. "90 light/fan/socket
 *     points"), superseded once the drawing itemises electrical scope, so a single
 *     lump line can't imply the per-symbol quantities have been established.
 * Equipment DrawingItems don't suppress works lines. Callers must skip lines that
 * are themselves drawing-derived. Pure and idempotent — safe to run at render time.
 */
export function isSupersededByDrawing(label: string | null | undefined, code: string | null | undefined, summary?: DrawingSummary | null): boolean {
  const lbl = (label ?? "").trim();
  if (!lbl) return false;
  const items = (summary?.items ?? []).filter((i) => !!i.match?.trim() && !(i.equipment ?? isEquipment(i.match)));
  if (!items.length) return false;
  if (items.some((it) => matchesCandidate(it.match, { code: code ?? null, label: lbl }))) return true;
  for (const b of CATEGORY_BRIDGES)
    if (b.heuristic.test(lbl) && items.some((it) => b.item.test(it.match))) return true;
  return false;
}

export function applyDrawing(lines: GeneratedLine[], summary?: DrawingSummary | null): GeneratedLine[] {
  // Only requirements with a real, positive quantity become priced BOQ lines.
  // Pending items (qty null) carry no quantity — pricing them would mean inventing
  // one — so they are retained upstream as null-qty drawing rows and rendered
  // separately as unpriced/pending rows. They still supersede template scope below.
  const named = (summary?.items ?? []).filter((i) => !!i.match?.trim());
  if (!named.length) return lines;
  const items = named.filter(
    (i): i is DrawingItem & { qty: number } => i.qty != null && Number.isFinite(i.qty) && i.qty > 0,
  );
  const metaOf = (it: DrawingItem, equip: boolean): LineDrawingMeta => ({
    basis: it.basis ?? "Counted",
    location: it.note?.trim() || undefined,
    scope: equip ? "equipment" : "works",
    rooms: it.rooms,
  });
  // Bind each drawing item to the catalogue line that is genuinely its counterpart:
  // a BEST-match, ONE-TO-ONE assignment (not first-match). A drawing quantity may
  // only ever transfer onto the line it most specifically matches — so a generic
  // "Power points" can never claim "Geyser power points…" and overwrite the geyser
  // requirement's quantity. Units must be the same dimensionality (a count never
  // sets an area/length). The CATALOGUE contributes the line's description/code/rate;
  // the QUANTITY is always the bound drawing item's own quantity, never a template's.
  const usedItems = new Set<number>();
  const pairs: { li: number; ii: number; score: number }[] = [];
  lines.forEach((l, li) => items.forEach((it, ii) => {
    if (!unitsCompatible(it.unit, l.unit)) return;
    const score = matchScore(it.match, { code: l.code, label: l.label });
    if (score > 0) pairs.push({ li, ii, score });
  }));
  pairs.sort((a, b) => b.score - a.score);   // strongest match first
  const boundItem = new Map<number, number>();   // line index → drawing-item index
  for (const p of pairs) {
    if (boundItem.has(p.li) || usedItems.has(p.ii)) continue;
    boundItem.set(p.li, p.ii);
    usedItems.add(p.ii);
  }
  const out = lines.map((l, li) => {
    const ii = boundItem.get(li);
    if (ii === undefined) return l;
    const it = items[ii];
    const equip = it.equipment ?? isEquipment(it.match);
    return { ...l, qty: it.qty, basis: toQtyBasis(it.basis), note: it.note?.trim() || undefined, drawing: metaOf(it, equip), included: equip ? false : l.included };
  });
  items.forEach((it, i) => {
    if (usedItems.has(i)) return;
    const equip = it.equipment ?? isEquipment(it.match);
    out.push({
      section: it.section?.trim() || (equip ? "Client equipment (excluded)" : "Drawing items"),
      code: null, qty: it.qty, label: it.match.trim(), unit: it.unit?.trim() || "nos", ns: true,
      basis: toQtyBasis(it.basis), note: it.note?.trim() || undefined, drawing: metaOf(it, equip),
      included: equip ? false : undefined,   // client equipment isn't contractor works
    });
  });
  // DrawingItem precedence: the drawing evaluation is authoritative. Any template/
  // heuristic line a drawing requirement supersedes — a requirement the drawing
  // names (priced or pending), or a bundled electrical points allowance once the
  // drawing itemises electrical — is withheld here: kept in the doc, excluded from
  // the total, marked superseded, so a template default can never duplicate or
  // fabricate a quantity for a requirement the drawing owns. Drawing-derived lines
  // are never touched, and template lines with no matching requirement are left as-is.
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    if (l.drawing || !l.label) continue;
    if (isSupersededByDrawing(l.label, l.code, summary)) {
      out[i] = { ...l, included: false, basis: "HEURISTIC", note: "Superseded by drawing requirement" };
    }
  }
  return out;
}

/** Requirements with no catalogue (DSR) match — added as their own BOQ lines. */
export function noCatalogueMatch(lines: GeneratedLine[], summary?: DrawingSummary | null): DrawingItem[] {
  const items = (summary?.items ?? []).filter((i) => i.match?.trim() && i.qty != null && Number.isFinite(i.qty) && i.qty > 0);
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

// --- Completeness checklist --------------------------------------------------
// A reminder of categories commonly visible on a drawing that operators forget.
// It is NOT an estimation engine: it never creates a BOQ item or a quantity —
// picking a category only drops an empty row for the operator to fill.
export const DRAWING_CHECKLIST: { discipline: string; key: string; categories: string[] }[] = [
  { discipline: "Electrical", key: "electrical", categories: ["Lighting point", "6A socket", "16A socket", "AC point", "TV point", "Audio point", "Exhaust point", "Switchboard", "Floor point", "Floor box", "Conduit", "Appliance point", "Geyser point"] },
  { discipline: "Plumbing", key: "plumbing", categories: ["WC", "Wash basin", "Shower", "Sink", "Floor trap", "Water point", "Waste point", "Pipe length"] },
  { discipline: "HVAC", key: "hvac", categories: ["AC unit", "AC point", "Refrigerant piping", "Drain piping", "Ducting", "Diffuser", "Exhaust point"] },
  { discipline: "Fire", key: "fire", categories: ["Detector", "Sprinkler", "Fire alarm point", "Hose reel", "Extinguisher"] },
  { discipline: "Architectural / Civil", key: "civil", categories: ["Flooring", "Wall tiles", "Skirting", "Plaster", "Paint", "Ceiling", "Door", "Window", "Grill", "Waterproofing"] },
];

const catKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/s$/, "");
/** Has the operator already entered a row for this checklist category? (loose) */
export function categoryCovered(category: string, rowMatches: string[]): boolean {
  const c = catKey(category);
  if (!c) return false;
  return rowMatches.some((m) => { const k = catKey(m); return !!k && (k.includes(c) || c.includes(k)); });
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
