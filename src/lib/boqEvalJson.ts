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

/** Strip a leading/trailing markdown code fence (```json … ```) if present. The JSON
 *  itself is NOT otherwise repaired — invalid JSON is rejected, not guessed at. */
function stripFence(text: string): string {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  return t;
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
  const raw = stripFence(text ?? "");
  if (!raw) return { ok: false, error: "Paste the evaluation JSON to import.", lines: [], warnings };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid JSON — ${e instanceof Error ? e.message : "could not parse"}.`, lines: [], warnings };
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
}

/** The sentinel `basis` value marking a quantity-pending line (qty unknown). */
export const PENDING_BASIS = "PENDING";

/** Convert parsed EvalLines into boq_line insert rows for a given BOQ. Deterministic:
 *  numeric qty is kept; a null qty becomes a pending line (qty 0, basis PENDING);
 *  client equipment is added but left out of the priced total (included:false). */
export function evalLinesToRows(boqId: string, lines: EvalLine[], startSort = 0): EvalBoqRow[] {
  return lines.map((l, i) => {
    const pending = l.qty == null;
    const equipment = l.scope === "equipment";
    const basis_note = [l.note, equipment ? "Client equipment" : ""].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ") || null;
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
    };
  });
}
