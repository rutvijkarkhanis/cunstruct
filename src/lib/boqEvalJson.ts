// DETERMINISTIC JSON → BOQ conversion. NO AI, no network, no drawing analysis.
//
// The operator produces a structured drawing-evaluation JSON *outside* Cunstruct
// (e.g. with ChatGPT) and pastes the finished, validated JSON here. This module does
// exactly one thing: parse and validate that JSON, then convert its `requirements[]`
// into BOQ lines — verbatim. It NEVER understands a drawing, proposes scope, or
// invents a quantity. It is a pure function of its input string.
//
// The JSON contract (the shape the evaluation produces):
//   {
//     "requirements": [
//       { "requirement": "WC", "qty": 4, "unit": "nos", "basis": "Counted",
//         "location": "Bathrooms", "note": "", "scope": "Works",
//         "status": "Quantified", "measurement_method": "counted",
//         "calculation": "", "allocation": "Floor 1" },
//       { "requirement": "Wardrobe", "qty": null, "unit": null, ... }
//     ]
//   }
// `requirements` may also be named `items`. Each requirement's name may be under
// `requirement`, `name`, `item`, or `description`; the quantity under `qty` or
// `quantity`. A numeric qty is kept exactly; a null/absent qty becomes a
// quantity-pending line — a count is NEVER fabricated.

export type EvalScope = "works" | "equipment" | "needs_confirmation";

export interface EvalLine {
  /** Sub-head for the line — the requirement's allocation, else a default. */
  section?: string;
  /** The requirement text → the BOQ line description. */
  description: string;
  unit?: string;
  /** Numeric quantity, or null for a quantity-pending line (never coerced to 0). */
  qty: number | null;
  /** Quantity basis as given (Counted / Measured / Derived / …). */
  basis?: string;
  /** Location · note · status · measurement metadata, preserved for the operator. */
  note?: string;
  /** Contractor works, client equipment, or scope-to-confirm. */
  scope?: EvalScope;
  status?: string;
  measurement_method?: string;
  calculation?: string;
  allocation?: string;
  /** Stable external identity from the analysis, carried onto the BOQ line so an
   *  external audit can match this exact line later. */
  external_key?: string;
}

export interface EvalImportResult {
  ok: boolean;
  /** Present when the JSON is invalid or fails the schema check (nothing imported). */
  error?: string;
  lines: EvalLine[];
  warnings: string[];
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}
/** A finite number, or null. A string like "4" is accepted; anything else → null.
 *  Never returns 0 for a null/blank/non-numeric input — pending stays pending. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normScope(v: unknown): EvalScope | undefined {
  const s = str(v).toLowerCase();
  if (!s) return undefined;
  if (/equip/.test(s)) return "equipment";
  if (/needs?[\s_-]*conf|to confirm|unconfirmed/.test(s)) return "needs_confirmation";
  if (/work/.test(s)) return "works";
  return undefined;
}

function tryParse(s: string): unknown | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}

/** Deterministically normalise the punctuation that word processors, chat UIs and
 *  copy-paste substitute for JSON's ASCII delimiters — smart/curly quotes, primes,
 *  fullwidth quotes, non-breaking and zero-width spaces, and a BOM. This ONLY maps
 *  characters to their ASCII equivalents; it never restructures the JSON, so
 *  genuinely malformed JSON still fails to parse. */
function normalizePunct(s: string): string {
  return s
    .replace(/\uFEFF/g, "")                                    // byte-order mark
    .replace(/[\u200B-\u200D\u2060]/g, "")                     // zero-width spaces / joiners
    .replace(/[\u00A0\u2007\u202F]/g, " ")                     // non-breaking / narrow spaces -> space
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036\uFF02]/g, String.fromCharCode(34))  // smart/prime/fullwidth double -> "
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\uFF07]/g, String.fromCharCode(39)); // smart/prime/fullwidth single -> '
}

/** When the JSON's string delimiters are CURLY quotes (as ChatGPT emits), a STRAIGHT
 *  double-quote can only be content \u2014 an inch mark inside a value (e.g. 9' x 19'6").
 *  Those would break the string once the curly delimiters are mapped to ASCII ", so
 *  escape the straight quotes first, THEN normalise. Deterministic and only applied
 *  when curly delimiters are actually present. */
function normalizeSmartJson(s: string): string {
  const DQUOTE = String.fromCharCode(34), CURLY_OPEN = String.fromCharCode(0x201C), CURLY_CLOSE = String.fromCharCode(0x201D);
  const hasCurlyDelims = s.indexOf(CURLY_OPEN) >= 0 || s.indexOf(CURLY_CLOSE) >= 0;
  let t = s;
  if (hasCurlyDelims) {
    // Escape every unescaped straight double-quote (content inch marks), leaving any
    // already-escaped \" alone.
    t = t.replace(/\\?"/g, (m) => (m === "\\" + DQUOTE ? m : "\\" + DQUOTE));
  }
  return normalizePunct(t);
}

/** Index of the char that closes the JSON value opening at `start` ({ or [),
 *  honouring string literals and escapes so braces inside strings don't count.
 *  Returns -1 if the value never closes (unbalanced). */
function matchEnd(s: string, start: number): number {
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
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Every top-level balanced { … } / [ … ] region in the text, in order. Prose
 *  between regions (even prose containing stray braces) is skipped. */
function balancedRegions(s: string): string[] {
  const out: string[] = [];
  let i = 0, inStr = false, esc = false;
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; i++; continue; }
    if (c === "{" || c === "[") {
      const end = matchEnd(s, i);
      if (end > i) { out.push(s.slice(i, end + 1)); i = end + 1; continue; }
    }
    i++;
  }
  return out;
}

/**
 * Deterministically pull the JSON value out of pasted text. Handles raw JSON, JSON
 * inside a ```json … ``` (or bare ```` ``` ````) fence, leading/trailing whitespace,
 * smart/curly quotes and other pasted punctuation, and a valid JSON object
 * accidentally surrounded by explanatory prose (even prose that itself contains stray
 * braces). Only punctuation is normalised — the JSON's *structure* is never repaired,
 * so genuinely invalid JSON yields `undefined`. Returns the parsed value, or
 * `undefined` if no valid JSON object/array is present.
 */
export function extractJson(text: string): unknown | undefined {
  let t = (text ?? "").trim();
  if (!t) return undefined;
  // Prefer a fenced block's contents when present (```json … ``` or ``` … ```).
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence && fence[1].trim()) t = fence[1].trim();
  // Try the raw text first so already-valid JSON is returned byte-for-byte; only if
  // that fails do we normalise. `n` maps smart quotes / stray spaces to ASCII; `c`
  // additionally escapes straight-quote inch marks when the delimiters are curly.
  const n = normalizePunct(t);
  const c = normalizeSmartJson(t);
  const candidates = [...new Set([t, n, c])];
  for (const cand of candidates) {
    const whole = tryParse(cand);
    if (whole !== undefined) return whole;
  }
  // A JSON value is embedded in surrounding prose: scan every balanced region on the
  // fully-normalised text and take the first that parses, preferring requirements/items.
  const parsed = balancedRegions(c).map(tryParse).filter((v) => v !== undefined);
  if (!parsed.length) return undefined;
  const withReq = parsed.find((v) => {
    if (Array.isArray(v)) return v.length > 0;
    const o = v as Record<string, unknown>;
    return !!o && typeof o === "object" && (Array.isArray(o.requirements) || Array.isArray(o.items));
  });
  return withReq ?? parsed[0];
}

/**
 * Parse and validate a drawing-evaluation JSON string, converting its requirements
 * into BOQ lines. Pure and deterministic — no AI, no I/O.
 *
 * - Invalid JSON → `ok:false` with an error (nothing imported).
 * - No `requirements`/`items` array, or an empty one → `ok:false` (schema error).
 * - Each requirement with a name becomes a line; numeric qty is preserved exactly,
 *   a null/absent qty yields a quantity-pending line (`qty:null`).
 */
export function parseBoqEvalJson(text: string): EvalImportResult {
  const warnings: string[] = [];
  if (!(text ?? "").trim()) return { ok: false, error: "Paste the evaluation JSON to import.", lines: [], warnings };

  // Robust, deterministic extraction: raw JSON, fenced JSON, whitespace, or a valid
  // JSON object surrounded by explanatory prose. Genuinely invalid JSON → rejected.
  const parsed = extractJson(text);
  if (parsed === undefined) {
    return { ok: false, error: "Invalid JSON — no JSON object found in the pasted text.", lines: [], warnings };
  }

  // Accept either the full evaluation object ({ requirements: [...] }) or a bare
  // array of requirements.
  let arr: unknown;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else {
    const obj = asObj(parsed);
    arr = obj.requirements ?? obj.items;
  }
  if (!Array.isArray(arr)) {
    return { ok: false, error: "JSON schema error — expected a \"requirements\" (or \"items\") array.", lines: [], warnings };
  }
  if (arr.length === 0) {
    return { ok: false, error: "The \"requirements\" array is empty — nothing to import.", lines: [], warnings };
  }

  const lines: EvalLine[] = [];
  arr.forEach((r, i) => {
    const o = asObj(r);
    const description = str(o.requirement) || str(o.name) || str(o.item) || str(o.description);
    if (!description) { warnings.push(`Requirement ${i + 1}: no requirement/name — skipped.`); return; }

    // qty: numeric preserved exactly; null/absent → pending (never fabricated).
    const hasQtyKey = "qty" in o || "quantity" in o;
    const qty = num("qty" in o ? o.qty : o.quantity);
    if (hasQtyKey && qty == null && (o.qty != null || o.quantity != null)) {
      // A present-but-non-numeric qty (e.g. a stray string) is treated as pending.
      warnings.push(`"${description}": quantity "${str("qty" in o ? o.qty : o.quantity)}" isn't a number — imported as quantity-pending.`);
    }

    const unit = str(o.unit);
    const basis = str(o.basis);
    const location = str(o.location);
    const noteRaw = str(o.note);
    const status = str(o.status);
    const measurement_method = str(o.measurement_method);
    const calculation = str(o.calculation);
    const allocation = str(o.allocation);
    const external_key = str(o.external_key) || str(o.externalKey) || str(o.key) || str(o.id);
    const scope = normScope(o.scope);

    // Preserve location / note / status / measurement metadata for the operator
    // (every part here is a plain string, never undefined).
    const note = [location, noteRaw, status, measurement_method ? `method: ${measurement_method}` : "", calculation ? `calc: ${calculation}` : ""]
      .map((s) => s.trim()).filter(Boolean).join(" · ") || undefined;

    lines.push({
      section: allocation || undefined,
      description,
      unit: unit || undefined,
      qty,
      basis: basis || undefined,
      note,
      scope,
      status: status || undefined,
      measurement_method: measurement_method || undefined,
      calculation: calculation || undefined,
      allocation: allocation || undefined,
      external_key: external_key || undefined,
    });
  });

  if (lines.length === 0) {
    return { ok: false, error: "No named requirements found in the JSON.", lines: [], warnings };
  }
  return { ok: true, lines, warnings };
}

/** How many of the parsed lines are quantity-pending (qty null). */
export function pendingCount(lines: EvalLine[]): number {
  return lines.filter((l) => l.qty == null).length;
}

/** A boq_line insert row produced from an EvalLine. Kept as a plain object (no DB
 *  client here) so this module stays pure and testable. */
export interface EvalBoqRow {
  boq_id: string;
  section: string;
  dsr_code: null;
  description: string;
  unit: string | null;
  /** boq_line.qty is NOT NULL, so a pending line is stored as 0 and marked via
   *  `basis: "PENDING"` — a real count is never coerced to 0. */
  qty: number;
  custom_rate: null;
  included: boolean;
  basis: string | null;
  basis_note: string | null;
  source: "manual";
  sort: number;
  /** Stable external key from the analysis, for later exact audit matching. */
  external_key: string | null;
  /** Canonical measurement methodology, when the analysis supplied a known one. */
  measurement_method: string | null;
  /** Canonical quantity status; PENDING whenever the quantity is unknown. */
  quantity_status: string | null;
}

/** The sentinel `basis` value marking a quantity-pending line (qty unknown). */
export const PENDING_BASIS = "PENDING";

// Canonical enum vocabularies, matched case-insensitively. Kept inline (no
// imports) so this module stays a self-contained, dependency-free consumer; the
// alias-tolerant normalisers live in quantityMethod.ts for the audit path.
const CANON_METHODS = ["COUNT", "AREA", "LENGTH", "VOLUME", "WEIGHT", "COVERAGE", "DERIVED", "SPECIFICATION", "PENDING"];
const CANON_STATUSES = ["MEASURED", "COUNTED", "DERIVED", "ESTIMATED", "PENDING", "NOT_APPLICABLE"];
const canonMethod = (v?: string): string | null => {
  const u = (v ?? "").toUpperCase().trim();
  return CANON_METHODS.includes(u) ? u : null;
};
const canonStatus = (v?: string): string | null => {
  const u = (v ?? "").toUpperCase().replace(/[\s-]+/g, "_").trim();
  return CANON_STATUSES.includes(u) ? u : null;
};

/** Convert parsed EvalLines into boq_line insert rows for a given BOQ. Deterministic:
 *  numeric qty is kept; a null qty becomes a pending line (qty 0, basis PENDING);
 *  client equipment is added but left out of the priced total (included:false). */
export function evalLinesToRows(boqId: string, lines: EvalLine[], startSort = 0): EvalBoqRow[] {
  return lines.map((l, i) => {
    const pending = l.qty == null;
    const equipment = l.scope === "equipment";
    const basis_note = [l.note, equipment ? "Client equipment" : ""].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ") || null;
    // A pending line is ALWAYS status PENDING (a count is never fabricated).
    const quantity_status = pending ? "PENDING" : canonStatus(l.status);
    return {
      boq_id: boqId,
      section: l.section || "Drawing requirements",
      dsr_code: null,
      description: l.description,
      unit: l.unit ?? null,
      qty: pending ? 0 : (l.qty as number),
      custom_rate: null,
      included: !equipment,
      basis: pending ? PENDING_BASIS : (l.basis ?? null),
      basis_note,
      source: "manual",
      sort: startSort + i,
      external_key: l.external_key ?? null,
      measurement_method: canonMethod(l.measurement_method),
      quantity_status,
    };
  });
}
