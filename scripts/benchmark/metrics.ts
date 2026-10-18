// PER-CATEGORY BENCHMARK METRICS — computed only from what the frozen scorer
// already decided (boqEndToEndScorer.ts: its pairs, quantity verdicts and
// system items) plus the DSR 2023 seed for ₹ weighting. It does not pair,
// re-match or re-tolerance anything: a line is "found" exactly when the scorer
// paired it, and "within tolerance" exactly when the scorer said so (G1).
//
// Per element category:
//   recall     measured reference lines the scorer paired / measured reference lines
//   precision  system items in the BOQ as MEASURED that are paired to a measured
//              reference line / system items in the BOQ as MEASURED
//   quantity   absolute % error |q_sys − q_ref| / q_ref on matched lines (paired,
//              in the BOQ as measured, unit convertible); median and p90.
//              Unit-family mismatches are counted, never given a % error.
//   ₹-weighted Σ|Δq|×rate / Σ q_ref×rate over PRICED measured reference lines;
//              "matched" over matched lines only, "with omissions" also counting
//              missed / ambiguous / held lines as |Δq| = q_ref. A unit-family
//              mismatch is |Δq| = q_ref (the BOQ holds no usable quantity for it).
//              Unpriced lines are excluded and their share is reported.
// Nothing here invents a quantity or a rate: a line with no reliable DSR rate is
// "unpriced" with the reason, and a ratio with a zero denominator is null.

import type { AccuracyReport, SystemItem } from "@/lib/e2e/boqEndToEndScorer";
import { canonicalUnit, convertQuantity, statusOf, type ReferenceBoqLine } from "@/lib/e2e/boqReference";
import { buildDsrIndex, matchLine, type DsrIndex } from "@/lib/dsr/match";
import type { DsrItem } from "@/lib/dsr/catalogue";

// ── Element categories ───────────────────────────────────────────────────────

export const CATEGORIES = ["floor_areas", "finishes", "doors_windows", "structural", "masonry", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Item name as matched by the category rules: lower case, every run of
 *  non-alphanumerics a single space ("R.C.C. Slab" → "r c c slab"). */
export const categoryText = (name: string | null | undefined) => ` ${(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const words = (ws: string[]) => new RegExp(` (${ws.join("|")}) `);

/** Ordered: the FIRST rule that holds gives the category; none → "other".
 *  Deterministic, from the item name and its unit only. */
export const CATEGORY_RULES: { category: Category; rule: string; test: (text: string, unitFamily: string | null) => boolean }[] = [
  {
    category: "floor_areas",
    rule: "name contains floor/carpet/built up/plinth/room/covered area (or starts with 'area') AND the unit is an area (sqm, sqft, …)",
    test: (t, f) => f === "area" && (/ (floor|carpet|built up|builtup|plinth|room|covered) area /.test(t) || /^ area /.test(t)),
  },
  {
    category: "finishes",
    rule: "name contains plaster(ing), paint(ing), tile(s)/tiling, flooring, skirting, dado, putty, distemper, emulsion, polish(ing), cladding, granite, marble, kota, terrazzo, screed, pointing, whitewash(ing), primer, ceiling",
    test: (t) => words(["plaster", "plastering", "paint", "painting", "tile", "tiles", "tiling", "flooring", "skirting", "dado", "putty", "distemper", "emulsion", "polish", "polishing", "cladding", "granite", "marble", "kota", "terrazzo", "screed", "pointing", "whitewash", "whitewashing", "primer", "ceiling"]).test(t),
  },
  {
    category: "doors_windows",
    rule: "name contains door(s), window(s), ventilator(s), shutter(s), louver(s)/louvre(s)",
    test: (t) => words(["door", "doors", "window", "windows", "ventilator", "ventilators", "shutter", "shutters", "louver", "louvers", "louvre", "louvres"]).test(t),
  },
  {
    category: "structural",
    rule: "name contains rcc / r c c, pcc / p c c, concrete, footing(s), foundation(s), column(s), beam(s), slab(s), lintel(s), reinforcement, rebar, tmt, steel, shuttering, centering, formwork",
    test: (t) => words(["rcc", "r c c", "pcc", "p c c", "concrete", "footing", "footings", "foundation", "foundations", "column", "columns", "beam", "beams", "slab", "slabs", "lintel", "lintels", "reinforcement", "rebar", "tmt", "steel", "shuttering", "centering", "formwork"]).test(t),
  },
  {
    category: "masonry",
    rule: "name contains brick(s), brickwork, block(s), blockwork, masonry, wall(s)",
    test: (t) => words(["brick", "bricks", "brickwork", "block", "blocks", "blockwork", "masonry", "wall", "walls"]).test(t),
  },
];

export function categoryOf(name: string | null | undefined, unit: string | null | undefined): Category {
  const t = categoryText(name), family = canonicalUnit(unit)?.family ?? null;
  return CATEGORY_RULES.find((r) => r.test(t, family))?.category ?? "other";
}

// ── DSR pricing of reference lines ───────────────────────────────────────────

export const PRICING_SCHEDULE = { source: "DSR", year: "2023" } as const;

export type LinePrice =
  | { priced: true; rate: number; dsrCode: string; dsrUnit: string | null; basis: "reference_dsr_code" | "matcher_reliable" }
  | { priced: false; reason: string };

/** The DSR code a reference line states, if any. Not part of the v1 reference
 *  schema (the validator ignores it); the preparer may add `dsrCode`. */
export const referenceDsrCode = (line: ReferenceBoqLine): string | null => {
  const raw = (line as unknown as Record<string, unknown>).dsrCode ?? (line as unknown as Record<string, unknown>).dsr_code;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
};

export const buildPricingIndex = (catalogue: DsrItem[]): DsrIndex => buildDsrIndex(catalogue, PRICING_SCHEDULE.source, PRICING_SCHEDULE.year);

/** Rate one reference line: by its own stated DSR code when it gives one (and
 *  the matcher calls that code reliable for the line), otherwise by the
 *  matcher's reliable description match. Anything else is unpriced. */
export function priceReferenceLine(line: ReferenceBoqLine, ix: DsrIndex): LinePrice {
  const code = referenceDsrCode(line);
  const m = matchLine({ description: line.item, unit: line.unit, dsr_code: code }, ix);
  const best = m.candidates[0];
  if (code && m.basis !== "code") return { priced: false, reason: `Reference code ${code} is not an item in DSR ${PRICING_SCHEDULE.year}; no other item is substituted.` };
  if (m.verdict !== "reliable" || !best) {
    return { priced: false, reason: `${code ? `Reference code ${code}` : "Matcher"}: verdict ${m.verdict} — ${m.reasons.join(" ")}`.trim() };
  }
  if (best.unit !== "match") return { priced: false, reason: `DSR ${best.item.code} is in ${best.item.unit}, the line in ${line.unit}; no conversion is assumed.` };
  if (best.item.rate == null) return { priced: false, reason: `DSR ${best.item.code} has no rate in the seed.` };
  return { priced: true, rate: best.item.rate, dsrCode: best.item.code, dsrUnit: best.item.unit, basis: code ? "reference_dsr_code" : "matcher_reliable" };
}

// ── Per-line records ─────────────────────────────────────────────────────────

/** What became of one measured reference line. */
export type LineOutcome =
  | "within_tolerance"   // in the BOQ as measured, scorer: within tolerance
  | "outside_tolerance"  // in the BOQ as measured, scorer: outside tolerance, units convertible
  | "unit_mismatch"      // in the BOQ as measured, unit family differs (no conversion)
  | "no_quantity"        // in the BOQ as measured but no number
  | "held"               // paired, but not in the BOQ as a measured quantity
  | "missed"             // scorer: missed
  | "ambiguous";         // scorer: ambiguous to pair

export interface RefRecord {
  setId: string;
  referenceId: string;
  item: string;
  unit: string;
  category: Category;
  outcome: LineOutcome;
  referenceQuantity: number;
  systemQuantity: number | null;
  systemUnit: string | null;
  /** System quantity in the reference unit (sqm ↔ sqft only), or null. */
  systemQuantityInReferenceUnit: number | null;
  /** |q_sys − q_ref| / q_ref × 100 on a matched, convertible line with q_ref > 0; else null. */
  absPctError: number | null;
  price: LinePrice;
}

/** How one system item stands against the reference. */
export type SystemStanding = "paired_measured_reference" | "paired_non_measured_reference" | "no_reference" | "duplicate" | "location_disagrees" | "ambiguous";

export interface SysRecord {
  setId: string;
  reviewItemId: string;
  item: string;
  unit: string | null;
  category: Category;
  fate: SystemItem["fate"];
  standing: SystemStanding;
}

const label = (s: SystemItem) => `${s.item}${s.floor ? ` [${s.floor}]` : ""}`;

/** Build the per-line records for one scored run. `accuracy` and `items` must
 *  come from the same run (scoreEndToEnd / systemItemsOf). */
export function recordsOf(setId: string, referenceLines: ReferenceBoqLine[], accuracy: AccuracyReport, items: SystemItem[], ix: DsrIndex): { refs: RefRecord[]; systems: SysRecord[] } {
  const sysById = new Map(items.map((s) => [s.reviewItemId, s]));
  const refById = new Map(referenceLines.map((r) => [r.id, r]));
  const matchByRef = new Map(accuracy.matches.map((m) => [m.referenceId, m]));
  const ambiguous = new Set(accuracy.scope.ambiguousIds);

  const refs: RefRecord[] = referenceLines.filter((r) => statusOf(r) === "measured").map((r) => {
    const refQty = r.quantity as number;
    const m = matchByRef.get(r.id);
    const s = m ? sysById.get(m.reviewItemId) ?? null : null;
    let outcome: LineOutcome;
    let inRef: number | null = null;
    if (!m || !s) outcome = ambiguous.has(r.id) ? "ambiguous" : "missed";
    else if (s.fate !== "in_boq_measured") outcome = "held";
    else if (s.quantity == null) outcome = "no_quantity";
    else {
      inRef = convertQuantity(s.quantity, s.unit, r.unit);
      outcome = inRef == null ? "unit_mismatch" : m.quantityCorrect ? "within_tolerance" : "outside_tolerance";
    }
    const matched = outcome === "within_tolerance" || outcome === "outside_tolerance";
    return {
      setId, referenceId: r.id, item: r.item, unit: r.unit, category: categoryOf(r.item, r.unit), outcome,
      referenceQuantity: refQty, systemQuantity: s?.quantity ?? null, systemUnit: s?.unit ?? null,
      systemQuantityInReferenceUnit: inRef,
      absPctError: !matched || inRef == null ? null : refQty > 0 ? (Math.abs(inRef - refQty) / refQty) * 100 : inRef === 0 ? 0 : null,
      price: priceReferenceLine(r, ix),
    };
  });

  // Unpaired system items: why, from the scorer's own unmatched lists (by label, as a multiset).
  const pool = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
  const take = (m: Map<string, number>, k: string) => { const n = m.get(k) ?? 0; if (n > 0) { m.set(k, n - 1); return true; } return false; };
  const dup = pool(accuracy.unmatched.duplicate), loc = pool(accuracy.unmatched.locationDisagrees), amb = pool(accuracy.unmatched.ambiguous);
  const pairedRefOf = new Map(accuracy.matches.map((m) => [m.reviewItemId, m]));
  const systems: SysRecord[] = items.map((s) => {
    const m = pairedRefOf.get(s.reviewItemId);
    const ref = m ? refById.get(m.referenceId) : undefined;
    const l = label(s);
    const standing: SystemStanding = m
      ? (m.status === "measured" ? "paired_measured_reference" : "paired_non_measured_reference")
      : take(dup, l) ? "duplicate" : take(loc, l) ? "location_disagrees" : take(amb, l) ? "ambiguous" : "no_reference";
    // A paired item takes its reference line's category, so recall and precision count it in the same place.
    const category = ref ? categoryOf(ref.item, ref.unit) : categoryOf(s.item, s.unit);
    return { setId, reviewItemId: s.reviewItemId, item: s.item, unit: s.unit, category, fate: s.fate, standing };
  });
  return { refs, systems };
}

// ── Summaries ────────────────────────────────────────────────────────────────

export interface Ratio { n: number; of: number; value: number | null }
const ratio = (n: number, of: number): Ratio => ({ n, of, value: of > 0 ? n / of : null });

/** Median: middle value, or the mean of the two middle values. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
/** Nearest-rank percentile: the smallest value with at least p of the values at or below it. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}

export interface RupeeError { errorRs: number; baseRs: number; value: number | null; lines: number }

export interface CategoryMetrics {
  category: Category | "all";
  recall: Ratio & { missedIds: string[]; ambiguousIds: string[]; heldIds: string[] };
  precision: Ratio & {
    /** System items in the BOQ as measured, by how they stand against the reference. */
    measuredInBoqBy: Record<SystemStanding, number>;
    /** Not in the precision ratio: items in the BOQ as pending, and items never applied. */
    pendingInBoq: number;
    notInBoq: number;
  };
  quantity: {
    /** Paired lines in the BOQ as measured. */
    compared: number;
    withinTolerance: number;
    outsideTolerance: number;
    unitMismatchIds: string[];
    noQuantityIds: string[];
    /** Lines contributing a % error. */
    withPctError: number;
    medianAbsPctError: number | null;
    p90AbsPctError: number | null;
  };
  rupeeWeighted: {
    /** Matched lines (paired, in the BOQ as measured), priced. */
    matched: RupeeError;
    /** Every priced measured reference line; missed/ambiguous/held count as the whole line. */
    withOmissions: RupeeError;
    pricedLines: number;
    unpricedLines: number;
    /** Unpriced measured reference lines / measured reference lines. */
    unpricedShare: number | null;
    unpriced: { referenceId: string; reason: string }[];
  };
}

const STANDINGS: SystemStanding[] = ["paired_measured_reference", "paired_non_measured_reference", "no_reference", "duplicate", "location_disagrees", "ambiguous"];

export function summarize(category: Category | "all", refs: RefRecord[], systems: SysRecord[]): CategoryMetrics {
  const ids = (o: LineOutcome) => refs.filter((r) => r.outcome === o).map((r) => r.referenceId);
  const found = refs.filter((r) => r.outcome !== "missed" && r.outcome !== "ambiguous").length;
  const measuredInBoq = systems.filter((s) => s.fate === "in_boq_measured");
  const by = Object.fromEntries(STANDINGS.map((k) => [k, measuredInBoq.filter((s) => s.standing === k).length])) as Record<SystemStanding, number>;
  const compared = refs.filter((r) => ["within_tolerance", "outside_tolerance", "unit_mismatch", "no_quantity"].includes(r.outcome));
  const pcts = refs.map((r) => r.absPctError).filter((x): x is number => x != null);

  const priced = refs.filter((r) => r.price.priced);
  const rate = (r: RefRecord) => (r.price as Extract<LinePrice, { priced: true }>).rate;
  const delta = (r: RefRecord) => r.outcome === "within_tolerance" || r.outcome === "outside_tolerance"
    ? Math.abs((r.systemQuantityInReferenceUnit as number) - r.referenceQuantity)
    : r.referenceQuantity; // unit mismatch, no quantity, held, missed, ambiguous: the BOQ holds no usable quantity
  const rupee = (rs: RefRecord[]): RupeeError => {
    const errorRs = rs.reduce((s, r) => s + delta(r) * rate(r), 0), baseRs = rs.reduce((s, r) => s + r.referenceQuantity * rate(r), 0);
    return { errorRs, baseRs, value: baseRs > 0 ? errorRs / baseRs : null, lines: rs.length };
  };
  const unpriced = refs.filter((r) => !r.price.priced);
  return {
    category,
    recall: { ...ratio(found, refs.length), missedIds: ids("missed"), ambiguousIds: ids("ambiguous"), heldIds: ids("held") },
    precision: {
      ...ratio(by.paired_measured_reference, measuredInBoq.length),
      measuredInBoqBy: by,
      pendingInBoq: systems.filter((s) => s.fate === "in_boq_pending").length,
      notInBoq: systems.filter((s) => s.fate === "held_in_review" || s.fate === "not_applied").length,
    },
    quantity: {
      compared: compared.length,
      withinTolerance: ids("within_tolerance").length,
      outsideTolerance: ids("outside_tolerance").length,
      unitMismatchIds: ids("unit_mismatch"),
      noQuantityIds: ids("no_quantity"),
      withPctError: pcts.length,
      medianAbsPctError: median(pcts),
      p90AbsPctError: percentile(pcts, 0.9),
    },
    rupeeWeighted: {
      matched: rupee(priced.filter((r) => compared.includes(r))),
      withOmissions: rupee(priced),
      pricedLines: priced.length,
      unpricedLines: unpriced.length,
      unpricedShare: refs.length ? unpriced.length / refs.length : null,
      unpriced: unpriced.map((r) => ({ referenceId: r.referenceId, reason: (r.price as Extract<LinePrice, { priced: false }>).reason })),
    },
  };
}

export interface MetricsBlock {
  /** Every category in CATEGORIES order, then "all". Categories with no lines and no items are kept (all ratios null). */
  byCategory: CategoryMetrics[];
  lines: RefRecord[];
  systemItems: SysRecord[];
}

export function metricsOf(refs: RefRecord[], systems: SysRecord[]): MetricsBlock {
  return {
    byCategory: [
      ...CATEGORIES.map((c) => summarize(c, refs.filter((r) => r.category === c), systems.filter((s) => s.category === c))),
      summarize("all", refs, systems),
    ],
    lines: refs,
    systemItems: systems,
  };
}

/** How the categories and prices were derived, written next to every metrics file. */
export const METRICS_METHOD = {
  categories: CATEGORY_RULES.map((r) => ({ category: r.category, rule: r.rule })).concat([{ category: "other", rule: "no rule above holds" }]),
  categoryAssignment: "Reference lines by their own item name and unit. A system item paired to a reference line takes that line's category; an unpaired system item is categorised by its own name and unit.",
  recall: "Measured reference lines the frozen scorer paired (found) / measured reference lines.",
  precision: "System items in the BOQ as MEASURED that the scorer paired to a measured reference line / system items in the BOQ as MEASURED. Pending and never-applied items are reported, not in the ratio.",
  quantityError: "Absolute % error |q_sys − q_ref| / q_ref × 100 on paired lines in the BOQ as measured whose units convert (sqm ↔ sqft only). Unit-family mismatches are listed, never given a % error. Median: middle value (mean of the two middle values); p90: nearest rank.",
  rupeeWeighted: "Σ|Δq|×rate / Σ q_ref×rate over priced measured reference lines. 'matched': paired lines in the BOQ as measured (a unit mismatch counts |Δq| = q_ref). 'withOmissions': every priced measured line; missed, ambiguous and held lines count |Δq| = q_ref. False positives have no reference line and are not priced; see precision.",
  pricing: `DSR ${PRICING_SCHEDULE.year} seed (supabase/migrations/20260731001000_dsr_seed_civil.sql) through src/lib/dsr/match.ts. A line is priced by the code it states (reference field dsrCode) when the matcher calls that code reliable for the line, else by the matcher's reliable description match; the DSR unit must equal the line's unit. Anything else is unpriced, with the reason. No rate is invented.`,
};
