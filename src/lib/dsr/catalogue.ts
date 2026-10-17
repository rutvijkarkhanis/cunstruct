// DSR CATALOGUE MODEL — pure helpers over dsr_item rows (the schedule loaded
// by supabase/migrations/20260731001000_dsr_seed_civil.sql: source, rate_year,
// code, chapter, subhead, description, unit, rate). Nothing here invents a
// schedule item, a rate or a unit; it only reads and compares what the
// schedule states.

export interface DsrItem {
  id?: string;
  source: string;            // "DSR"
  rate_year: string | null;  // "2023"
  code: string;              // "5.1.3"
  chapter?: string | null;
  subhead: string | null;    // "RCC"
  description: string | null;
  unit: string | null;
  rate: number | null;
}

// ── Units ────────────────────────────────────────────────────────────────────

export type UnitDimension = "LENGTH" | "AREA" | "VOLUME" | "COUNT" | "MASS" | "LIQUID" | "TIME";
export interface CanonicalUnit { unit: string; dimension: UnitDimension }

/** Spelling aliases only — no conversion. Two units of the same dimension
 *  (sqm vs sqft, kg vs quintal) are "convertible", never treated as equal. */
const UNIT_ALIASES: [RegExp, CanonicalUnit][] = [
  [/^(m|mtr|mtrs|metre|metres|meter|meters|rm|rmt|r\.m|running metre|running meter|lm|linear metre)$/, { unit: "m", dimension: "LENGTH" }],
  [/^(sqm|sq\.?m|sq\.? ?mtr|m2|m²|square metre|square meter|sq metre)$/, { unit: "sqm", dimension: "AREA" }],
  [/^(sqft|sq\.?ft|sft|ft2|ft²|square feet|sq feet)$/, { unit: "sqft", dimension: "AREA" }],
  [/^(cum|cu\.?m|m3|m³|cubic metre|cubic meter)$/, { unit: "cum", dimension: "VOLUME" }],
  [/^(cft|cu\.?ft|ft3|cubic feet)$/, { unit: "cft", dimension: "VOLUME" }],
  [/^(each|no|nos|no\.|nr|number|numbers|pcs|pc|piece|pieces|unit|units|set|sets|pair|pairs)$/, { unit: "each", dimension: "COUNT" }],
  [/^(kg|kgs|kilogram|kilograms)$/, { unit: "kg", dimension: "MASS" }],
  [/^(quintal|quintals|qtl)$/, { unit: "quintal", dimension: "MASS" }],
  [/^(mt|tonne|tonnes|ton|tons|t)$/, { unit: "tonne", dimension: "MASS" }],
  [/^(litre|litres|liter|liters|l|ltr)$/, { unit: "litre", dimension: "LIQUID" }],
  [/^(hour|hours|hr|hrs)$/, { unit: "hour", dimension: "TIME" }],
];

export function canonicalUnit(unit: string | null | undefined): CanonicalUnit | null {
  const u = (unit ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!u) return null;
  // "pair" is a count of two, not one: keep it distinct from "each".
  if (/^(pair|pairs)$/.test(u)) return { unit: "pair", dimension: "COUNT" };
  for (const [re, c] of UNIT_ALIASES) if (re.test(u)) return c;
  return null;
}

export type UnitComparison = "match" | "convertible" | "mismatch" | "unknown";

/** match = same unit; convertible = same dimension, different unit (needs a
 *  stated conversion, never assumed); mismatch = different dimension;
 *  unknown = either side unrecognised or absent. */
export function compareUnit(a: string | null | undefined, b: string | null | undefined): UnitComparison {
  const x = canonicalUnit(a), y = canonicalUnit(b);
  if (!x || !y) return "unknown";
  if (x.unit === y.unit) return "match";
  return x.dimension === y.dimension ? "convertible" : "mismatch";
}

// ── Seed text clean-up ───────────────────────────────────────────────────────

/** The text of an item to MATCH on. The DSR 2023 seed was extracted from the
 *  PDF and some descriptions carry spill-over from what followed the item on
 *  the page — the next heading in capitals ("… RAIN WATER SPOUT AND PIPE",
 *  "SUB HEAD : 25.0 …") or an appendix table ("COEFFICIENTS FOR CEMENT
 *  CONSUMPTION …"). Matching stops at the first such run; the item's stored
 *  description is still shown verbatim. */
export function matchableDescription(description: string | null | undefined): string {
  const d = description ?? "";
  const hit = MATCHABLE_CACHE.get(d);
  if (hit != null) return hit;
  if (MATCHABLE_CACHE.size > 20000) MATCHABLE_CACHE.clear();
  const out = cutSpillOver(d);
  MATCHABLE_CACHE.set(d, out);
  return out;
}
const MATCHABLE_CACHE = new Map<string, string>();

function cutSpillOver(d: string): string {
  let end = d.length;
  const at = (re: RegExp, keep?: (m: RegExpMatchArray) => boolean) => {
    for (const m of d.matchAll(re)) {
      const i = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
      if (i >= end) return;
      if (i >= MIN_KEPT && (!keep || !keep(m))) { end = i; return; }
    }
  };
  // 1. A sub-head or appendix: everything after it belongs to other items.
  at(/\bSUB HEAD\b|\bCOEFFICIENTS FOR\b/g);
  // 2. The text of a following item the seed did not split out, introduced by
  //    its own code ("… 9.147.A1 Two track …", "… 26.50.1 A Non load …").
  //    A reference to another item ("over item 26.76.1 for …") is kept.
  at(/\s\d{1,2}\.\d{1,3}(?:[A-Z]|\.[0-9A-Z]{1,3})(?:\.[0-9A-Z]{1,3})*(?:\s[A-Z])?\s+[A-Z]/g,
    (m) => /\bitem(?:\s+no\.?)?\s*$/i.test(d.slice(0, m.index)));
  // 3. A run of three or more capitalised words: the next heading. A heading
  //    directly followed by the item's variant ("… INTERNAL WORK - EXPOSED ON
  //    WALL — 1216 (16 mm OD) pipe") is the item's own sub-heading: kept.
  at(/(?:\b[A-Z][A-Z&-]+\s+){2,}[A-Z][A-Z&-]+\b/g,
    (m) => /^[^a-z]*[—–]\s*\S/.test(d.slice((m.index ?? 0) + m[0].length)));
  let out = d.slice(0, end).trimEnd();
  // 4. A shorter heading left at the very end ("… excluding cost of hangers.
  //    STEEL REINFORCEMENT", "… pipe C.I. SLUICE VALVES/ FIRE HYDRANTS & FIXTURES").
  const tail = trailingHeading(out);
  // Kept when it is all the item says; cut after a full stop even when early
  // ("Neat cement punning. ROUGH CAST PLASTER").
  if (tail != null && (tail >= MIN_KEPT || (tail >= 10 && /\.\s*$/.test(out.slice(0, tail))))) out = out.slice(0, tail).trimEnd().replace(/[.)]\s+\d+(?:\.\d+)?\s*mm$/, (s) => s[0]);
  return out;
}

/** Sub-items the seed did not split out of an item: codes that extend the
 *  item's own code inside its text ("5.22A … 5.22A.1 Mild steel … 5.22A.6
 *  Thermo-Mechanically Treated bars …", "26.50.1 … 26.50.1 A Non load …").
 *  Such a row holds several schedule items under one code and one rate, and
 *  the seed does not say which one the rate is for. */
export function embeddedSubItems(code: string, description: string | null | undefined): string[] {
  const d = description ?? "";
  if (!code.trim() || !d.includes(code.trim())) return [];
  const c = code.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)(${c}(?:\\.[0-9A-Z]+|\\s?[A-Z](?![a-z]))(?:\\.[0-9A-Z]+)*)(?=\\s)`, "g");
  return [...new Set([...d.matchAll(re)].map((m) => m[1].replace(/\s+/g, " ")))];
}

/** Text kept before any cut: a heading this early is the item's own. */
const MIN_KEPT = 30;

/** Start of a trailing run of capitalised words (at least two, one of four or
 *  more letters) with no lower-case text after it — or null. */
function trailingHeading(s: string): number | null {
  const words = [...s.matchAll(/\S+/g)];
  let start: number | null = null, capsWords = 0, long = false;
  for (let k = words.length - 1; k >= 0; k--) {
    const w = words[k][0];
    if (/[a-z0-9]/.test(w)) break;
    // "M.S.", "C.I." are abbreviations inside a heading; they do not count as its words.
    if (/[A-Z]{2,}/.test(w)) { capsWords++; if (/[A-Z]{4,}/.test(w)) long = true; } else if (/[A-Z]/.test(w) && !/^\(?([A-Z]\.)+[,)]?$/.test(w)) break;
    start = words[k].index ?? 0;
  }
  return start != null && capsWords >= 2 && long ? start : null;
}

// ── Text ─────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set((
  "providing laying fixing including include includes included complete completed work works all and the for with from into upto up "
  + "level levels specified specification as per directed engineer charge incharge the of to in on at by or etc any other any its it "
  + "this that these those be is are was were has have had all such required approved make makes manner position necessary "
  + "cost rate item items extra over corresponding basic supplying supply plinth floor five excluding exclusive than not exceeding "
  + "thick thickness below above under"
).split(/\s+/));

/** Domain spellings normalised to one form before comparing. */
const SYNONYMS: [RegExp, string][] = [
  [/\br\.?\s?c\.?\s?c\.?(?=\s|$|,)/g, "reinforced cement concrete"],
  // The schedule calls plain concrete just "cement concrete".
  [/\bp\.?\s?c\.?\s?c\.?(?=\s|$|,)/g, "cement concrete"],
  [/\bplain cement concrete\b/g, "cement concrete"],
  [/\bbrickwork\b/g, "brick work"],
  [/\bb\.?\s?w\.?(?=\s|$)/g, "brick work"],
  [/\bshuttering\b/g, "shuttering formwork"],
  [/\bformwork\b/g, "formwork shuttering"],
  [/\bcentring\b/g, "centering"],
  [/\bplastering\b/g, "plaster"],
  [/\btiles\b/g, "tile"],
  [/\bflooring\b/g, "floor"],
  [/\bvitrified\b/g, "vitrified"],
  [/\bwaterproofing\b/g, "water proofing"],
  [/\bexcavating\b/g, "excavation"],
  // The schedule writes "Earth work"; "earthwork" is the same word.
  [/\bearthwork\b/g, "earth work"],
  [/\btmt\b/g, "thermo mechanically treated"],
];

export function normalizeText(s: string | null | undefined): string {
  let t = ` ${(s ?? "").toLowerCase()} `;
  t = t.replace(/[–—]/g, " ").replace(/[“”"'`]/g, "");
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  return t.replace(/[^a-z0-9.:/\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokens(s: string | null | undefined): string[] {
  return normalizeText(s).split(/[\s/,-]+/).map((w) => singular(w.replace(/^[.:]+|[.:]+$/g, "")))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+(\.\d+)?$/.test(w));
}

/** A plain plural "s" is dropped so "dados" meets "dado" and "slabs" "slab".
 *  Applied to both sides alike; "-ss", "-us" and "-is" words are left alone. */
const singular = (w: string) => (w.length >= 4 && /^[a-z]+s$/.test(w) && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);

/** Schedule descriptions are "<what the item is>, <how> … : — <variant>".
 *  The headline (up to the first comma or colon) and the variant say what the
 *  item IS; the middle is method boilerplate that long items repeat widely. */
export function focusText(description: string | null | undefined): string {
  const d = description ?? "";
  const parts = d.split(/\s[—–]\s|:\s*[—–]/);
  const head = parts[0].split(/[,:;(]/)[0];
  return parts.length > 1 ? `${head} ${parts[parts.length - 1]}` : head;
}

/** An item that adjusts another item's rate ("Extra for …", "Add for …",
 *  "Deduct for …", "— Add/Deduct over item …") rather than being the work. */
export const isAdjustmentItem = (description: string | null | undefined) => {
  const parts = matchableDescription(description).split(/\s[—–]\s|:\s*[—–]/);
  const starts = (s: string | undefined) => /^\s*(extra\s+(for|over)|add(\s*\/\s*deduct)?\s+(for|over)|deduct\s+(for|over))\b/i.test(s ?? "");
  return starts(parts[0]) || (parts.length > 1 && starts(parts[parts.length - 1]));
};
/** A BOQ line that itself is such an adjustment. */
export const isAdjustmentLine = (description: string | null | undefined) => /\b(extra|add|deduct)\b/i.test(description ?? "");

// ── Specification features ───────────────────────────────────────────────────

export interface SpecFeatures {
  ratios: string[];     // "1:2:4", "1:6"
  grades: string[];     // "M20"
  thicknessMm: number[];
  diameterMm: number[];
  /** Plain or reinforced concrete, where the text says which (its headline or variant). */
  concrete: ("plain" | "reinforced")[];
}

export function specFeatures(s: string | null | undefined): SpecFeatures {
  const t = (s ?? "").toLowerCase();
  const ratios = [...t.matchAll(/\b1\s*:\s*(\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))?/g)]
    .map((m) => `1:${m[1]}${m[2] ? `:${m[2]}` : ""}`);
  const grades = [...t.matchAll(/\bm\s?-?\s?(10|15|20|25|30|35|40|45|50)\b(?!\s*mm)/g)].map((m) => `M${m[1]}`);
  const thicknessMm = [
    ...t.matchAll(/(\d+(?:\.\d+)?)\s*mm\s*(?:thick|thickness)\b/g),
    ...t.matchAll(/\bthick(?:ness)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/g),
    // "12 mm cement plaster …": a leading size is the layer's thickness.
    ...t.matchAll(/^\s*(\d+(?:\.\d+)?)\s*mm\s+(?!dia|diameter|nominal|size)[a-z]/g),
  ]
    .map((m) => Number(m[1]));
  const diameterMm = [...t.matchAll(/(\d+(?:\.\d+)?)\s*mm\s*(?:dia|diameter|ø)/g)].map((m) => Number(m[1]));
  const uniq = <T,>(a: T[]) => [...new Set(a)];
  // Only what the text says the work IS: "Water proofing … of RCC sunshade" is
  // headline wording, "fixed to … RCC soffit" deep in the method is not.
  const f = focusText(s).toLowerCase();
  const concrete: SpecFeatures["concrete"] = [];
  if (/\bp\.?\s?c\.?\s?c\b|\bplain (cement )?concrete\b/.test(f)) concrete.push("plain");
  if (/\br\.?\s?c\.?\s?c\b|\breinforced (cement )?concrete\b/.test(f)) concrete.push("reinforced");
  return { ratios: uniq(ratios), grades: uniq(grades), thicknessMm: uniq(thicknessMm), diameterMm: uniq(diameterMm), concrete };
}

export interface SpecConflict { feature: "mix ratio" | "concrete grade" | "thickness" | "diameter" | "concrete type"; line: string; schedule: string }

/** A conflict only when BOTH state the feature and they share no value. */
export function specConflicts(line: SpecFeatures, item: SpecFeatures): SpecConflict[] {
  const out: SpecConflict[] = [];
  const check = (feature: SpecConflict["feature"], a: (string | number)[], b: (string | number)[], fmt = (v: string | number) => String(v)) => {
    if (a.length && b.length && !a.some((v) => b.includes(v))) out.push({ feature, line: a.map(fmt).join(", "), schedule: b.map(fmt).join(", ") });
  };
  check("mix ratio", line.ratios, item.ratios);
  check("concrete grade", line.grades, item.grades);
  check("thickness", line.thicknessMm, item.thicknessMm, (v) => `${v} mm`);
  check("diameter", line.diameterMm, item.diameterMm, (v) => `${v} mm`);
  check("concrete type", line.concrete ?? [], item.concrete ?? [], (v) => `${v} concrete`);
  return out;
}

// ── What the schedule says about an item ─────────────────────────────────────

/** Work an item explicitly leaves out ("excluding the cost of centering,
 *  shuttering, finishing and reinforcement") — measured and paid separately. */
export function exclusionClauses(description: string | null | undefined): string[] {
  const d = matchableDescription(description);
  return [...d.matchAll(/(?:excluding|exclusive of)\s+(?:the\s+)?(?:cost\s+of\s+)?([^.;:()]{3,140})/gi)].map((m) => m[1].trim());
}

/** The schedule's own measurement wording for an item (verbatim fragments),
 *  e.g. "(Measurements to be taken of the face area timbered)". Guidance on
 *  how to measure — never a quantity. */
export function measurementNotes(description: string | null | undefined): string[] {
  const d = matchableDescription(description);
  const notes = [
    ...[...d.matchAll(/\(([^()]*(?:measure|measured|measurement)[^()]*)\)/gi)].map((m) => m[1].trim()),
    ...[...d.matchAll(/\(([^()]*rate is over[^()]*)\)/gi)].map((m) => m[1].trim()),
  ];
  return [...new Set(notes)];
}

/** Items in a given schedule (source + year). */
export const inSchedule = (items: DsrItem[], source: string, year: string | null) =>
  items.filter((i) => i.source === source && (i.rate_year ?? null) === (year ?? null));

/** "DSR 2023" */
export const scheduleLabel = (source: string, year: string | null) => [source, year].filter(Boolean).join(" ");
