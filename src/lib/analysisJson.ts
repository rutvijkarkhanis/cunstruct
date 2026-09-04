// STANDARD ANALYSIS JSON CONTRACT (provider-agnostic).
//
// Cunstruct consumes a structured drawing-analysis JSON produced OUTSIDE the app
// (today: pasted from ChatGPT; tomorrow: a human, CAD/BIM export, or an
// automated integration — Cunstruct neither knows nor cares which). There is NO
// AI, PDF parsing, OCR or drawing interpretation in here: this module only
// PARSES, VALIDATES and NORMALISES already-supplied structured data.
//
// It builds on the existing deterministic extractor in `boqEvalJson.ts`
// (`extractJson`, which already survives fenced/smart-quoted/prose-wrapped
// paste) and adds an enum-validated, methodology-aware layer on top so every
// item carries a canonical measurement methodology and status. A missing or
// non-numeric quantity is ALWAYS preserved as PENDING — a count is never
// fabricated, and "1 nos" is never a fallback.
//
// Canonical item shape (all fields optional except an item name):
//   {
//     "scope": "Finishes", "category": "Flooring", "item": "Floor finish",
//     "location": "First Floor", "quantity": 1200, "unit": "sqft",
//     "measurement_method": "AREA", "status": "MEASURED",
//     "source": "First Floor Plan", "basis": "Room areas summed",
//     "confidence": "HIGH", "specification": "Vitrified 600x600",
//     "reason": null, "formula": "L×W", "external_key": "FF-FLR-01"
//   }
// The array may be named `items`, `requirements`, or `analysis`. Field aliases
// mirror boqEvalJson (`requirement`/`name`/`description` for the item name;
// `qty` for quantity; `allocation` for location).

import { extractJson } from "./boqEvalJson";
import {
  classifyMethod,
  canonicalUnit,
  pendingReason,
  type QuantityMethod,
  type QuantityStatus,
} from "./quantityMethod";

export interface AnalysisItem {
  scope?: string;
  category?: string;
  item: string;
  location?: string;
  /** Numeric quantity, or null for a quantity-pending item (never coerced to 0/1). */
  quantity: number | null;
  unit?: string;
  method: QuantityMethod;
  status: QuantityStatus;
  source?: string;
  basis?: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  specification?: string;
  /** Why the quantity is pending (only when status is PENDING). */
  reason?: string;
  /** Formula/dependency for a derived quantity, when supplied. */
  formula?: string;
  /** Stable external identity for matching audit findings back to this item. */
  externalKey?: string;
  /** True when a later item duplicates an earlier (scope·category·item·location). */
  duplicate?: boolean;
}

export interface AnalysisProject {
  projectType?: string;
  name?: string;
}

export interface AnalysisParseResult {
  ok: boolean;
  /** Set when the JSON is malformed or fails the top-level schema check. */
  error?: string;
  project?: AnalysisProject;
  items: AnalysisItem[];
  /** Non-fatal, per-item issues (kept, not rejected). */
  warnings: string[];
}

// ── Small typed helpers (mirror boqEvalJson's conventions) ───────────────────
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── Enum normalisation — deterministic alias maps, documented and total ──────
const METHOD_ALIASES: [RegExp, QuantityMethod][] = [
  [/^count(ed)?$|^\s*nos?\.?\s*$|number/i, "COUNT"],
  [/area|sq\.?\s?(ft|m)|sqft|sqm|sft/i, "AREA"],
  [/length|running|rft|rmt|r\.?ft|linear|\bl\.?m\b|\bmtr?\b/i, "LENGTH"],
  [/volume|cu\.?\s?(m|ft)|cum|cft|m3|cubic/i, "VOLUME"],
  [/weight|\bkg\b|\bmt\b|tonne?|\bton\b|quintal/i, "WEIGHT"],
  [/coverage|consumption|per\s?(sqft|sqm|coat)/i, "COVERAGE"],
  [/derived|calc|computed/i, "DERIVED"],
  [/spec(ification)?|lump\s?sum|\bls\b|item rate|as per/i, "SPECIFICATION"],
  [/pending|unquantified|tbd|to be|unknown/i, "PENDING"],
];

/** Map a free-text measurement_method to the canonical methodology, or null. */
export function normalizeMethod(v: unknown): QuantityMethod | null {
  const s = str(v);
  if (!s) return null;
  const upper = s.toUpperCase();
  const direct: QuantityMethod[] = [
    "COUNT", "AREA", "LENGTH", "VOLUME", "WEIGHT", "COVERAGE", "DERIVED", "SPECIFICATION", "PENDING",
  ];
  if ((direct as string[]).includes(upper)) return upper as QuantityMethod;
  for (const [re, m] of METHOD_ALIASES) if (re.test(s)) return m;
  return null;
}

const STATUS_ALIASES: [RegExp, QuantityStatus][] = [
  [/not[\s_-]*applicable|^\s*n[./]?a\.?\s*$/i, "NOT_APPLICABLE"],
  [/measured/i, "MEASURED"],
  [/counted/i, "COUNTED"],
  [/derived|calculated/i, "DERIVED"],
  [/estimated|assumed|coverage|rule/i, "ESTIMATED"],
  [/pending|unquantified|quantity[\s_-]*pending|tbd|to confirm/i, "PENDING"],
  [/quantified|complete|ok/i, "COUNTED"], // a generic "quantified" → counted-equivalent
];

/** Map a free-text status to the canonical status, or null. */
export function normalizeStatus(v: unknown): QuantityStatus | null {
  const s = str(v);
  if (!s) return null;
  const upper = s.toUpperCase().replace(/[\s-]+/g, "_");
  const direct: QuantityStatus[] = [
    "MEASURED", "COUNTED", "DERIVED", "ESTIMATED", "PENDING", "NOT_APPLICABLE",
  ];
  if ((direct as string[]).includes(upper)) return upper as QuantityStatus;
  for (const [re, st] of STATUS_ALIASES) if (re.test(s)) return st;
  return null;
}

function normalizeConfidence(v: unknown): AnalysisItem["confidence"] {
  const s = str(v).toUpperCase();
  if (s.startsWith("H")) return "HIGH";
  if (s.startsWith("M")) return "MEDIUM";
  if (s.startsWith("L")) return "LOW";
  return undefined;
}

// Which units are sensible for each methodology (lower-cased, punctuation-stripped).
const UNIT_BY_METHOD: Record<QuantityMethod, RegExp | null> = {
  COUNT: /^(nos?|no|each|ea|pcs?|sets?|pairs?|points?|job)$/,
  AREA: /^(sqft|sft|sqm|sqyd|sq|m2|ft2)$/,
  LENGTH: /^(rft|rmt|rm|m|ft|mm|lm|mtr|nos)?$/, // some length items ship counts of modules
  VOLUME: /^(cum|cft|m3|ft3|brass|ltr|l)$/,
  WEIGHT: /^(kg|mt|ton|tonne|quintal|g)$/,
  COVERAGE: null, // coverage carries product-specific units (bag, L, …) — don't police
  DERIVED: null,
  SPECIFICATION: null,
  PENDING: null,
};

const stripUnit = (u: string) => u.toLowerCase().replace(/[.\s/]/g, "");

/** True when a unit is plausibly compatible with a methodology (blank = ok). */
export function unitMatchesMethod(unit: string | undefined, method: QuantityMethod): boolean {
  const u = stripUnit(str(unit));
  if (!u) return true; // no unit supplied — nothing to contradict
  const re = UNIT_BY_METHOD[method];
  if (!re) return true; // methodology doesn't constrain units
  return re.test(u);
}

const dupeKey = (i: Pick<AnalysisItem, "scope" | "category" | "item" | "location">) =>
  [i.scope, i.category, i.item, i.location].map((s) => (s ?? "").toLowerCase().trim()).join("¦");

/**
 * Parse, validate and normalise a drawing-analysis JSON string. Pure and
 * deterministic. Malformed JSON or a missing items array → `ok:false` (nothing
 * imported). Per-item problems (unknown enum, incompatible unit, duplicate) are
 * collected as warnings and the item is still returned, normalised.
 */
export function parseAnalysisJson(text: string): AnalysisParseResult {
  const warnings: string[] = [];
  if (!(text ?? "").trim()) {
    return { ok: false, error: "Paste the analysis JSON to import.", items: [], warnings };
  }

  const parsed = extractJson(text);
  if (parsed === undefined) {
    return { ok: false, error: "Invalid JSON — no JSON object found in the pasted text.", items: [], warnings };
  }

  let arr: unknown;
  let project: AnalysisProject | undefined;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else {
    const obj = asObj(parsed);
    arr = obj.items ?? obj.requirements ?? obj.analysis;
    const p = asObj(obj.project);
    const projectType = str(p.project_type ?? p.projectType ?? p.type) || undefined;
    const name = str(p.name) || undefined;
    if (projectType || name) project = { projectType, name };
  }

  if (!Array.isArray(arr)) {
    return { ok: false, error: 'JSON schema error — expected an "items" (or "requirements") array.', items: [], warnings };
  }
  if (arr.length === 0) {
    return { ok: false, error: 'The "items" array is empty — nothing to import.', items: [], warnings };
  }

  const seen = new Set<string>();
  const items: AnalysisItem[] = [];

  arr.forEach((raw, idx) => {
    const o = asObj(raw);
    const item = str(o.item) || str(o.requirement) || str(o.name) || str(o.description);
    if (!item) { warnings.push(`Item ${idx + 1}: no item/name — skipped.`); return; }

    const scope = str(o.scope) || undefined;
    const category = str(o.category) || undefined;
    const location = str(o.location) || str(o.allocation) || undefined;

    const hasQtyKey = "quantity" in o || "qty" in o;
    const quantity = num("quantity" in o ? o.quantity : o.qty);
    if (hasQtyKey && quantity == null && (o.quantity != null || o.qty != null)) {
      warnings.push(`"${item}": quantity "${str(o.quantity ?? o.qty)}" isn't a number — imported as PENDING.`);
    }

    // Methodology: use the supplied one if recognised, else classify by name.
    const rawMethod = o.measurement_method ?? o.method;
    let method = normalizeMethod(rawMethod);
    if (rawMethod != null && str(rawMethod) && method == null) {
      warnings.push(`"${item}": unknown measurement_method "${str(rawMethod)}" — inferred from the item name.`);
    }
    if (method == null) method = classifyMethod(item, category);

    // Status: supplied if recognised, else inferred from quantity + methodology.
    const rawStatus = o.status;
    let status = normalizeStatus(rawStatus);
    if (rawStatus != null && str(rawStatus) && status == null) {
      warnings.push(`"${item}": unknown status "${str(rawStatus)}" — inferred.`);
    }
    if (status == null) status = quantity == null ? "PENDING" : method === "COVERAGE" ? "ESTIMATED" : "COUNTED";

    // A null quantity is ALWAYS pending, whatever the supplied status claimed.
    if (quantity == null && status !== "NOT_APPLICABLE") status = "PENDING";

    const unit = str(o.unit) || undefined;
    if (!unitMatchesMethod(unit, method)) {
      warnings.push(`"${item}": unit "${unit}" looks inconsistent with method ${method}.`);
    }

    const reason = str(o.reason) || (status === "PENDING" ? pendingReason(method) : "") || undefined;
    const key = dupeKey({ scope, category, item, location });
    const duplicate = seen.has(key);
    if (duplicate) warnings.push(`Duplicate item: "${item}"${location ? ` @ ${location}` : ""}.`);
    seen.add(key);

    items.push({
      scope, category, item, location,
      quantity,
      unit: unit ?? (method !== "COVERAGE" ? canonicalUnit(method) || undefined : undefined),
      method, status,
      source: str(o.source) || undefined,
      basis: str(o.basis) || str(o.calculation) || undefined,
      confidence: normalizeConfidence(o.confidence),
      specification: str(o.specification ?? o.spec) || undefined,
      reason,
      formula: str(o.formula ?? o.dependency ?? o.calculation) || undefined,
      externalKey: str(o.external_key ?? o.externalKey ?? o.key ?? o.id) || undefined,
      duplicate: duplicate || undefined,
    });
  });

  if (items.length === 0) {
    return { ok: false, error: "No named items found in the JSON.", items: [], warnings };
  }
  return { ok: true, project, items, warnings };
}

/** Count of items left PENDING (no reliable quantity). */
export function analysisPendingCount(items: AnalysisItem[]): number {
  return items.filter((i) => i.status === "PENDING").length;
}
