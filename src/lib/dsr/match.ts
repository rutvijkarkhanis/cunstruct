// BOQ LINE → DSR ITEM MATCHING — suggests which item of ONE selected schedule
// (source + year) a BOQ line corresponds to, and says how sure that is and why.
//
//   reliable  — the line's stated DSR code is in this schedule and agrees with
//               the line's unit and specification; or the description matches
//               one item clearly (strong term coverage, a clear lead over the
//               next item), the unit matches and no specification conflicts.
//   possible  — a plausible item, but something stops it being reliable: a unit
//               or specification conflict, a weaker description match, or
//               several items that fit about equally well (ambiguous).
//   none      — nothing in this schedule fits well enough to suggest.
//
// A match is a suggestion for a person to confirm. It never sets a rate or a
// quantity, never creates an item, and never converts units (sqm vs sqft is
// reported as "convertible", not equal).
import {
  compareUnit, embeddedSubItems, exclusionClauses, focusText, inSchedule, isAdjustmentItem, isAdjustmentLine, matchableDescription, measurementNotes, scheduleLabel,
  specConflicts, specFeatures, tokens,
  type DsrItem, type SpecConflict, type SpecFeatures, type UnitComparison,
} from "./catalogue";

export interface MatchableLine {
  description: string | null;
  unit: string | null;
  dsr_code?: string | null;
}

export type MatchVerdict = "reliable" | "possible" | "none";

export interface MatchCandidate {
  item: DsrItem;
  /** Ranking score (0–1): coverage, weighted towards the item's headline and variant text. */
  score: number;
  /** Share (0–1) of the line's distinctive terms the item's whole description contains, IDF-weighted. */
  coverage: number;
  /** The same share within the item's headline and variant only. */
  focus: number;
  unit: UnitComparison;
  specConflicts: SpecConflict[];
  sharedTerms: string[];
  /** The line's terms the item does not mention. */
  missingTerms: string[];
  /** The schedule's own measurement wording for the item — guidance, not evidence. */
  measurementNotes: string[];
  /** Work the item says it excludes (measured and paid separately). */
  exclusions: string[];
}

export interface MatchResult {
  verdict: MatchVerdict;
  basis: "code" | "description" | "none";
  schedule: string;
  ambiguous: boolean;
  /** Best first; at most three. */
  candidates: MatchCandidate[];
  /** Plain-language reasons for the verdict. */
  reasons: string[];
}

export const MATCH_THRESHOLDS = { reliable: 0.6, possible: 0.35, lead: 0.1, reliableCoverage: 0.85 } as const;

export interface DsrIndex {
  source: string;
  year: string | null;
  items: DsrItem[];
  idf: Map<string, number>;
  terms: Map<DsrItem, Set<string>>;
  /** Terms of the item's headline (what the item is) and its variant (the last "—" part). */
  focus: Map<DsrItem, Set<string>>;
  specs: Map<DsrItem, SpecFeatures>;
  byCode: Map<string, DsrItem>;
  /** Items that adjust another item's rate ("Extra for …") rather than being the work. */
  adjustments: Set<DsrItem>;
  /** For an item that is one variant of a family sharing its headline (5.9.1 …
   *  5.9.22 "Centering and shuttering … for — <variant>"), the terms that name
   *  its variant, and the variant text. Absent for an item with no siblings. */
  variants: Map<DsrItem, { elements: string[][]; text: string }>;
  /** Rows of the seed that hold several sub-items under one code and one rate
   *  (see embeddedSubItems): never a reliable match, by code or description. */
  merged: Map<DsrItem, string[]>;
  /** Items for work in a specialised form (arches, domes, vaults — see
   *  SPECIAL_FORMS): the forms the item names. Absent for ordinary items. */
  forms: Map<DsrItem, string[]>;
  /** Items restricted to an action other than new work ("Dismantling …",
   *  "Disconnecting damaged … tank") or to an accessory for another object
   *  ("steel roller for uPVC sliding door"): what the line must name for the
   *  item to be its work. Absent for ordinary items. */
  restrictedTo: Map<DsrItem, { label: string; re: RegExp }>;
  /** Items limited to work up to plinth level (5.22.6 "… upto plinth level. —
   *  Thermo-Mechanically Treated bars"): the line must place the work there. */
  uptoPlinth: Set<DsrItem>;
  /** Waterproofing items whose leading clause names a method ("integral cement
   *  based", "bitumen felt", "APP membrane"): the methods the line may name. */
  waterproofingMethods: Map<DsrItem, { label: string; re: RegExp }[]>;
}

/** "upto plinth level": the schedule prices the same work separately above
 *  plinth level (5.22.6 vs 5.22A), so a line that does not place its work at or
 *  below plinth is not reliably this item. "plinth" and "level" are stopwords
 *  for scoring, so the check reads the text directly. */
const UPTO_PLINTH_ITEM = /\b(?:upto|up\s+to)\s+plinth\s+level\b/i;
const lineIsUptoPlinth = (text: string) =>
  /\b(?:upto|up\s*to|below)\s+plinth\b|\bfoundations?\b|\bfootings?\b|\bsub-?structure\b/i.test(text)
  || (/\bplinth\b/i.test(text) && !/\babove\s+plinth\b/i.test(text));

/** Methods of waterproofing the schedule prices separately for the same roofs
 *  and terraces: 22.7.1 integral cement based (₹1,684.60/sqm), 22.6 cement
 *  slurry (₹688.90), 22.9 bitumen felt (₹806.45). A line that names none of
 *  the item's methods has not said which treatment it is. */
const WATERPROOFING_METHODS: { label: string; re: RegExp }[] = [
  { label: "integral cement based", re: /\bintegral\b/i },
  { label: "cement slurry", re: /\bslurry\b/i },
  { label: "bitumen felt", re: /\bbitum|\bfelt\b/i },
  { label: "APP membrane", re: /\bmembe?rane\b|\bAPP\b|\bpoly-?propylene\b/i },
  { label: "crystalline", re: /\bcrystalline\b/i },
  { label: "elastomeric", re: /\belastomeric\b/i },
];
/** The methods named in a waterproofing item's leading clause (before
 *  "consisting", "including" …). Grading and deduction items are not treatments. */
function waterproofingMethodsOf(text: string): { label: string; re: RegExp }[] {
  const head = text.split(/\b(?:consisting|including|comprising)\b/i)[0];
  if (!/water\s*-?\s*proofing\s+(?:treatment|membrane|coating)|treatment\s+for\s+water\s*-?\s*proofing/i.test(head)) return [];
  if (/^\s*(?:grading|deduct)\b/i.test(head)) return [];
  return WATERPROOFING_METHODS.filter((m) => m.re.test(head));
}

/** Forms of construction an item can be restricted to. Work "in plain arches"
 *  (6.9) is priced well above the same brickwork in walls (6.4.x), so an item
 *  naming a RESTRICTING form is the line's work only when the line names one of
 *  the forms the item lists. The other entries only satisfy that: 5.5 is RCC
 *  "in arches, archribs, domes, vaults, shells, folded plate and roofs having
 *  slope more than 15°" — any of these on the line names it. */
const SPECIAL_FORMS: { form: string; re: RegExp; restricts: boolean }[] = [
  { form: "arches", re: /\barch(?:es|ribs?)?\b/i, restricts: true },
  { form: "domes", re: /\bdomes?\b/i, restricts: true },
  { form: "vaults", re: /\bvaults?\b/i, restricts: true },
  { form: "shells", re: /\bshells?\b/i, restricts: false },
  { form: "folded plates", re: /\bfolded\s+plates?\b/i, restricts: false },
  { form: "sloping roofs", re: /\bslop(?:e|es|ed|ing)\b/i, restricts: false },
];
const formsIn = (text: string | null | undefined) => SPECIAL_FORMS.filter((f) => f.re.test(text ?? ""));

/** Actions other than new work an item can be restricted to. "Disconnecting
 *  damaged overhead PVC water storage tank" (14.79) contains every term of a
 *  line "Overhead water tank", but it prices taking a tank out, not providing one. */
const RESTRICTING_ACTIONS: { label: string; re: RegExp }[] = [
  { label: "dismantling", re: /\bdismantl/i },
  { label: "demolishing", re: /\bdemolish/i },
  { label: "disconnecting", re: /\bdisconnect/i },
  { label: "cleaning", re: /\bclean/i },
  { label: "removing", re: /\bremov/i },
  { label: "renewing", re: /\brenew/i },
  { label: "repairing", re: /\brepair/i },
  { label: "repainting", re: /\brepaint/i },
  { label: "re-fixing", re: /\bre-?fix/i },
];
/** "Providing and fixing <accessory> for <object>": the accessory's head noun
 *  (the last word before a qualifier such as "as", "of" or a comma). */
const ACCESSORY_RE = /^\s*providing\s+(?:and|&)\s+fixing\s+(?:in\s+position\s+)?(?:of\s+)?(.{1,60}?)\s+for\s/i;
function restrictionOf(text: string): { label: string; re: RegExp } | null {
  const action = RESTRICTING_ACTIONS.find((a) => new RegExp("^\\s*" + a.re.source.slice(2), "i").test(text));
  if (action) return action;
  const m = ACCESSORY_RE.exec(text);
  if (!m) return null;
  const words = m[1].split(/,|\b(?:as|of|with|in|to|having|conforming|including)\b/i)[0].trim().split(/\s+/).filter((w) => /^[a-z]{4,}$/i.test(w));
  // A generic head ("aluminium work", "expansion joint system") is named by the word before it.
  const named = words.filter((w) => !/^(?:work|works|system|systems)$/i.test(w));
  const head = named[named.length - 1];
  return head ? { label: head.toLowerCase(), re: new RegExp("\\b" + head.slice(0, 5), "i") } : null;
}

/** Index one schedule. Items of other schedules are ignored. */
export function buildDsrIndex(all: DsrItem[], source: string, year: string | null): DsrIndex {
  const items = inSchedule(all, source, year);
  const terms = new Map<DsrItem, Set<string>>();
  const focus = new Map<DsrItem, Set<string>>();
  const specs = new Map<DsrItem, SpecFeatures>();
  const df = new Map<string, number>();
  const byCode = new Map<string, DsrItem>();
  const adjustments = new Set<DsrItem>();
  const merged = new Map<DsrItem, string[]>();
  const forms = new Map<DsrItem, string[]>();
  const restrictedTo = new Map<DsrItem, { label: string; re: RegExp }>();
  const uptoPlinth = new Set<DsrItem>();
  const waterproofingMethods = new Map<DsrItem, { label: string; re: RegExp }[]>();
  for (const it of items) {
    const subs = embeddedSubItems(it.code, it.description);
    if (subs.length) merged.set(it, subs);
    if (isAdjustmentItem(it.description)) adjustments.add(it);
    const text = matchableDescription(it.description);
    const named = formsIn(text);
    if (named.some((f) => f.restricts)) forms.set(it, named.map((f) => f.form));
    const restriction = restrictionOf(text);
    if (restriction) restrictedTo.set(it, restriction);
    if (UPTO_PLINTH_ITEM.test(text)) uptoPlinth.add(it);
    const methods = waterproofingMethodsOf(text);
    if (methods.length) waterproofingMethods.set(it, methods);
    const t = new Set(tokens(text));
    terms.set(it, t);
    focus.set(it, new Set(tokens(focusText(text))));
    specs.set(it, specFeatures(text));
    for (const w of t) df.set(w, (df.get(w) ?? 0) + 1);
    byCode.set(normCode(it.code), it);
  }
  const n = Math.max(items.length, 1);
  const idf = new Map<string, number>();
  for (const [w, d] of df) idf.set(w, Math.log(1 + n / d));
  // Families: items whose text before the first "—" is the same.
  const parts = new Map(items.map((it) => [it, matchableDescription(it.description).split(/\s[—–]\s|:\s*[—–]/)] as const));
  const familySize = new Map<string, number>();
  for (const p of parts.values()) if (p.length > 1) familySize.set(p[0].trim(), (familySize.get(p[0].trim()) ?? 0) + 1);
  const variants = new Map<DsrItem, { elements: string[][]; text: string }>();
  for (const [it, p] of parts) {
    if (p.length < 2 || (familySize.get(p[0].trim()) ?? 0) < 2) continue;
    // The first variant level is what tells the family's items apart. A list
    // ("Lintels, beams, plinth beams, …") names alternatives: each is an element.
    const text = p[1].trim();
    // An element's name ends where its method begins ("… using chemical
    // emulsion @ …"); words the family headline already says do not name it.
    const headline = new Set(tokens(p[0]));
    const elements = text.split(/[,;]/)
      .map((e) => tokens(e.split("(")[0].split(/\s(?:including|using|with|@)\s/i)[0]).filter((w) => !headline.has(w)))
      .filter((e) => e.length > 0);
    if (elements.length) variants.set(it, { elements, text });
  }
  return { source, year, items, idf, terms, focus, specs, byCode, adjustments, variants, merged, forms, restrictedTo, uptoPlinth, waterproofingMethods };
}

export { focusText };

/** The schedule's own measurement and exclusion wording for an item — read
 *  once per item, not once per line compared. */
const NOTES = new WeakMap<DsrItem, { measurementNotes: string[]; exclusions: string[] }>();
const itemNotes = (it: DsrItem) => {
  let n = NOTES.get(it);
  if (!n) NOTES.set(it, (n = { measurementNotes: measurementNotes(it.description), exclusions: exclusionClauses(it.description) }));
  return n;
};

const normCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, "");
/** A term the schedule never uses is the strongest sign it does not cover the
 *  work: it counts double. */
const weight = (ix: DsrIndex, w: string) => ix.idf.get(w) ?? 2 * Math.log(1 + ix.items.length);

function candidate(ix: DsrIndex, line: MatchableLine, lineTerms: string[], lineSpec: SpecFeatures, it: DsrItem): MatchCandidate {
  const t = ix.terms.get(it) ?? new Set<string>(), f = ix.focus.get(it) ?? new Set<string>();
  const shared = lineTerms.filter((w) => t.has(w)), missing = lineTerms.filter((w) => !t.has(w));
  const total = lineTerms.reduce((s, w) => s + weight(ix, w), 0);
  const share = (ws: string[]) => (total > 0 ? ws.reduce((s, w) => s + weight(ix, w), 0) / total : 0);
  const coverage = share(shared), focus = share(lineTerms.filter((w) => f.has(w)));
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    item: it, score: r3(0.6 * coverage + 0.4 * focus), coverage: r3(coverage), focus: r3(focus),
    unit: compareUnit(line.unit, it.unit),
    specConflicts: specConflicts(lineSpec, ix.specs.get(it) ?? specFeatures(matchableDescription(it.description))),
    sharedTerms: shared, missingTerms: missing,
    ...itemNotes(it),
  };
}

const UNIT_REASON: Record<UnitComparison, (l: string | null, s: string | null) => string | null> = {
  match: () => null,
  convertible: (l, s) => `Unit differs: the line is in ${l}, the schedule item in ${s}. A stated conversion is needed — none is assumed.`,
  mismatch: (l, s) => `Unit conflict: the line is in ${l}, the schedule item in ${s} — they measure different things.`,
  unknown: (l, s) => (l ? `The line's unit "${l}" could not be compared with the schedule's "${s ?? "—"}".` : "The line has no unit to check against the schedule."),
};
const specReason = (c: SpecConflict) => `Specification conflict on ${c.feature}: the line says ${c.line}, the schedule item ${c.schedule}.`;

/** Match one BOQ line against one indexed schedule. */
export function matchLine(line: MatchableLine, ix: DsrIndex): MatchResult {
  const schedule = scheduleLabel(ix.source, ix.year);
  // Tags and sizes the schedule never uses ("D1", "900x2100") identify the
  // line, not the work — they are left out (sizes are still compared as
  // specification features).
  // A label ("type 1", "mark W2") names the line on a drawing, not the work.
  const unlabelled = (line.description ?? "").replace(/\b(type|mark)\s*[-:#.]?\s*[a-z]{0,2}\d+[a-z]?\b/gi, " ");
  const lineTerms = [...new Set(tokens(unlabelled))].filter((w) => !(/\d/.test(w) && !ix.idf.has(w)));
  const lineSpec = specFeatures(line.description);
  const problems = (c: MatchCandidate) => [UNIT_REASON[c.unit](line.unit, c.item.unit), ...c.specConflicts.map(specReason)].filter((r): r is string => !!r);

  // 1. A code stated on the line is checked first — and only in this schedule.
  const code = line.dsr_code?.trim();
  if (code) {
    const it = ix.byCode.get(normCode(code));
    if (!it) {
      const text = byDescription();
      return { ...text, reasons: [`The line's code ${code} is not an item in ${schedule}.`, ...text.reasons] };
    }
    const c = candidate(ix, line, lineTerms, lineSpec, it);
    const issues = problems(c);
    const subs = ix.merged.get(it);
    if (subs) issues.push(mergedReason(it, subs));
    const weakText = lineTerms.length > 0 && c.coverage < MATCH_THRESHOLDS.possible;
    if (weakText) issues.push(`The line's description shares little with item ${it.code} (${pct(c.coverage)} of its terms) — check the code was meant for this line.`);
    const reliable = issues.length === 0 && c.unit === "match";
    return {
      verdict: reliable ? "reliable" : "possible", basis: "code", schedule, ambiguous: false, candidates: [c],
      reasons: reliable ? [`The line states code ${it.code}, which is in ${schedule}; unit and specification agree.`] : [`The line states code ${it.code} (in ${schedule}), but:`, ...issues],
    };
  }
  return byDescription();

  function neverUsed(): string[] {
    const unknown = lineTerms.filter((w) => !ix.idf.has(w));
    return unknown.length ? [`${schedule} never uses: ${unknown.join(", ")} — this work may not be in this schedule.`] : [];
  }

  function byDescription(): MatchResult {
    if (!lineTerms.length) {
      return { verdict: "none", basis: "none", schedule, ambiguous: false, candidates: [], reasons: ["The line's description has no distinctive terms to match on."] };
    }
    // One word ("window", "plastering") cannot pick one item out of a schedule.
    if (lineTerms.length === 1) {
      return {
        verdict: "none", basis: "none", schedule, ambiguous: false, candidates: [],
        reasons: [`The line does not describe the work enough to match: “${lineTerms[0]}” alone does not identify an item in ${schedule}.`, ...neverUsed()],
      };
    }
    // An item is a candidate only if it shares at least two of the line's
    // distinctive terms and at least one of them names what
    // the item IS (headline or variant): "Window type 1" must not land on a
    // window fastener, nor "External door" on a panel item that mentions doors.
    const needed = 2;
    // "Extra for …" / "Add for …" items price an adjustment to other work; they
    // are not the work itself, so only a line that is itself an extra meets them.
    const adjustmentLine = isAdjustmentLine(line.description);
    const all = ix.items.filter((it) => adjustmentLine || !ix.adjustments.has(it))
      .map((it) => candidate(ix, line, lineTerms, lineSpec, it)).filter((c) => c.score > 0);
    const scored = all.filter((c) => c.sharedTerms.length >= needed && c.focus > 0);
    // Rank: description score first; among near-equals prefer no conflicts and a matching unit.
    const penalty = (c: MatchCandidate) => (c.unit === "mismatch" ? 0.15 : c.unit === "convertible" ? 0.05 : 0) + 0.1 * c.specConflicts.length;
    scored.sort((a, b) => b.score - penalty(b) - (a.score - penalty(a)) || a.item.code.localeCompare(b.item.code, undefined, { numeric: true }));
    const top = scored.slice(0, 3);
    const best = top[0];
    // The line's most distinctive term ("solar" in "solar panel installation").
    const key = [...lineTerms].sort((a, b) => weight(ix, b) - weight(ix, a))[0];
    // An item without it is not the same work when anything else also fails
    // (a conflict, a term the schedule never uses, or weak coverage); otherwise
    // it stays a possible match and the gap is stated.
    const missesKey = !!best && best.missingTerms.includes(key) && best.coverage < MATCH_THRESHOLDS.reliable
      && (best.unit === "mismatch" || best.specConflicts.length > 0 || !ix.idf.has(key) || best.coverage < 0.5);
    if (!best || best.score < MATCH_THRESHOLDS.possible || missesKey) {
      return {
        verdict: "none", basis: "none", schedule, ambiguous: false, candidates: top,
        reasons: [!best
          ? all.length
            ? `The line does not describe the work enough to match: no item in ${schedule} names it with more than one of its terms (${lineTerms.join(", ")}).`
            : `No item in ${schedule} shares any distinctive term with the line.`
          : missesKey
            ? `No item in ${schedule} covers this work: the closest (${best.item.code}) does not mention "${key}", the line's most distinctive term.`
            : `No item in ${schedule} covers enough of the line's description (best: ${best.item.code}, ${pct(best.coverage)} of its terms).`,
        ...neverUsed()],
      };
    }
    // Ambiguous: another item that is (nearly) as good and has no more conflicts
    // — looked for among all candidates, not only the runner-up.
    const close = scored.filter((c) => c !== best && best.score - c.score < MATCH_THRESHOLDS.lead && penalty(c) <= penalty(best));
    const ambiguous = close.length > 0;
    const issues = problems(best);
    // The line must name what the item is, not only share its boilerplate:
    //  - its most distinctive term must be in the item;
    //  - for one variant of a family ("… removal of form for — Edges of slabs
    //    and breaks in floors and walls"), the line must say which variant —
    //    at least half (IDF-weighted) of one of its elements.
    const variant = ix.variants.get(best.item);
    const lineSet = new Set(lineTerms);
    const variantShare = variant ? Math.max(...variant.elements.map((e) => share(ix, e.filter((w) => lineSet.has(w)), e))) : 1;
    // A stated mix, grade, thickness or diameter the item shares also names it.
    const itemSpec = ix.specs.get(best.item);
    const sharesSpec = !!itemSpec && (["ratios", "grades", "thicknessMm", "diameterMm"] as const)
      .some((k) => (lineSpec[k] as (string | number)[]).some((v) => (itemSpec[k] as (string | number)[]).includes(v)));
    const unnamedVariant = variantShare < 0.5 && !sharesSpec;
    //  - for an item restricted to a specialised form ("in plain arches"), the
    //    line must name one of the forms the item lists.
    const itemForms = ix.forms.get(best.item);
    const lineForms = new Set(formsIn(line.description).map((f) => f.form));
    const unstatedForm = !!itemForms && !itemForms.some((f) => lineForms.has(f));
    //  - for an item restricted to an action or an accessory, the line must name it.
    const restriction = ix.restrictedTo.get(best.item);
    const unstatedRestriction = !!restriction && !restriction.re.test(line.description ?? "");
    //  - for an item limited to work up to plinth level, the line must place it there;
    //  - for a waterproofing item of one method, the line must name that method.
    const unstatedStage = ix.uptoPlinth.has(best.item) && !lineIsUptoPlinth(line.description ?? "");
    const itemMethods = ix.waterproofingMethods.get(best.item);
    const unstatedMethod = !!itemMethods && !itemMethods.some((m) => m.re.test(line.description ?? ""));
    const reliable = !ambiguous && issues.length === 0 && best.unit === "match" && best.score >= MATCH_THRESHOLDS.reliable
      && !best.missingTerms.includes(key) && !unnamedVariant && best.coverage >= MATCH_THRESHOLDS.reliableCoverage
      && !ix.merged.has(best.item) && !unstatedForm && !unstatedRestriction && !unstatedStage && !unstatedMethod;
    const reasons = [`Description match: item ${best.item.code} contains ${pct(best.coverage)} of the line's distinctive terms (${best.sharedTerms.slice(0, 6).join(", ")}).`];
    if (best.missingTerms.length) reasons.push(`Not in the item: ${best.missingTerms.slice(0, 6).join(", ")}${best.missingTerms.includes(key) ? ` — including "${key}", the line's most distinctive term` : ""}.`);
    reasons.push(...neverUsed());
    reasons.push(...issues);
    const subs = ix.merged.get(best.item);
    if (subs) reasons.push(mergedReason(best.item, subs));
    if (unstatedForm && itemForms) reasons.push(`Item ${best.item.code} is for work in ${itemForms.join(", ")}; the line does not say so — check it is not ordinary work priced under another item.`);
    if (unstatedRestriction && restriction) reasons.push(`Item ${best.item.code} is for ${restriction.label}; the line does not say so — check it is not other work priced under another item.`);
    if (unstatedStage) reasons.push(`Item ${best.item.code} is for work up to plinth level; the line does not place the work there — the schedule prices work above plinth level under another item.`);
    if (unstatedMethod && itemMethods) reasons.push(`Item ${best.item.code} is ${itemMethods.map((m) => m.label).join(" / ")} waterproofing; the line does not say which method — the schedule prices other methods under other items.`);
    if (unnamedVariant && variant) reasons.push(`Item ${best.item.code} is one variant of a family of schedule items (“${clip(variant.text)}”); the line does not say which variant.`);
    if (ambiguous) {
      const codes = [best, ...close].slice(0, 3).map((c) => c.item.code);
      reasons.push(`Several items fit about equally well (${codes.join(", ")}${close.length > 2 ? ` and ${close.length - 2} more` : ""}); the line does not say enough to choose — check the specification.`);
    } else if (!reliable && best.score < MATCH_THRESHOLDS.reliable) reasons.push("The description match is not strong enough to rely on without checking.");
    else if (!reliable && issues.length === 0 && best.missingTerms.includes(key)) reasons.push(`The item does not mention "${key}", so the match cannot be relied on without checking.`);
    else if (!reliable && issues.length === 0 && !unnamedVariant && best.coverage < MATCH_THRESHOLDS.reliableCoverage) reasons.push("Part of the line's description is not in the item, so the match cannot be relied on without checking.");
    // When ambiguous, the items listed are the ones the reason names.
    const candidates = ambiguous ? [best, ...close].slice(0, 3) : top;
    return { verdict: reliable ? "reliable" : "possible", basis: "description", schedule, ambiguous, candidates, reasons };
  }
}

const pct = (s: number) => `${Math.round(s * 100)}%`;
const mergedReason = (it: DsrItem, subs: string[]) =>
  `In the loaded schedule, ${it.code} holds several sub-items (${subs.slice(0, 4).join(", ")}${subs.length > 4 ? ", …" : ""}) under one code and one rate; which sub-item that rate is for is not stated — check the printed schedule.`;
const clip = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);
/** IDF-weighted share of `all` that `some` makes up. */
const share = (ix: DsrIndex, some: string[], all: string[]) => {
  const total = all.reduce((s, w) => s + weight(ix, w), 0);
  return total > 0 ? some.reduce((s, w) => s + weight(ix, w), 0) / total : 1;
};
