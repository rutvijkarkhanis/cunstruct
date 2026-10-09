// MEASUREMENT VALIDATOR — Scope A: a standalone, pure arithmetic utility.
//
// Independently recomputes a small, fixed set of supported arithmetic
// formulas from EXPLICITLY SUPPLIED structured inputs and compares the
// result against a stated quantity. Nothing more.
//
// NOT wired into the AI-analysis pipeline. There is no caller anywhere in
// this codebase today — analysisSchemaV1.ts, openaiSchema.ts, and
// analysisPrompt.ts are all UNCHANGED by this module and carry no
// structured calculation fields. This file proves only that the
// arithmetic/comparison logic below is internally correct against
// synthetic fixtures (see measurementValidator.test.ts) — it is NOT
// evidence that any real drawing measurement or BOQ quantity has ever been
// validated.
//
// What this module does NOT and CANNOT establish, by design:
//   - that a model read a drawing dimension correctly;
//   - that the inputs belong to the intended physical element;
//   - that the chosen formula matches the BOQ measurement convention
//     (gross/net, deduction rules, etc. — explicitly out of scope);
//   - that the repeated "units" in QUANTITY_PER_UNIT_TIMES_UNIT_COUNT are
//     genuinely identical physical instances;
//   - that an evidence region actually shows what it claims to (evidence
//     validity here is STRUCTURAL ONLY — a well-formed bbox is never proof
//     the region supports the claim).
// Internally consistent arithmetic from WRONG inputs produces the exact
// same EXACT_MATCH comparison as arithmetic from correct inputs — this is
// an accepted, deliberate blind spot, not a defect (see this module's test
// file, "accepted blind spot" case).
//
// Pure: no I/O, no Supabase, no network, no persistence, never mutates its
// input. Formulas are a finite, code-owned allowlist — nothing here ever
// executes an arbitrary model-generated expression; a caller (none exists
// yet) could only ever SELECT one of the six formula ids below.

export type PhysicalDimension = "LENGTH" | "AREA" | "VOLUME" | "COUNT";

export type FormulaId =
  | "SUM_OF_SEGMENTS"
  | "LENGTH_TIMES_WIDTH"
  | "LENGTH_TIMES_WIDTH_TIMES_HEIGHT"
  | "COUNT_TIMES_MULTIPLIER"
  | "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT"
  | "UNIT_CONVERSION";

/** One evidence region supporting one calculation input. Reimplemented
 *  locally (never imported from analysisSchemaV1.ts) so this module stays
 *  fully self-contained with zero coupling to the live pipeline. */
export interface EvidenceRef {
  bbox: [number, number, number, number];
  page?: number;
}

export interface CalculationInput {
  name: string;
  value: number;
  unit: string;
  evidence?: EvidenceRef[];
}

export interface CalculationRequest {
  formula: FormulaId;
  inputs: CalculationInput[];
  statedQuantity: number;
  statedUnit: string;
}

export interface CalculationResult {
  formulaSupported: boolean;
  inputsValid: boolean;
  /** Structural validity only (well-formed bbox) — never proof the region
   *  supports the claimed value. See this module's header comment. */
  evidenceValid: boolean;
  recomputed: boolean;
  resultValue: number | null;
  resultUnit: string | null;
  reason?: string;
}

export type ComparisonOutcome = "EXACT_MATCH" | "MISMATCH" | "ROUNDING_POLICY_UNRESOLVED" | "INCOMPARABLE";

export interface ComparisonResult {
  comparable: boolean;
  outcome: ComparisonOutcome;
  explanation: string;
}

/** calculation and comparison are deliberately separate — a successful
 *  calculation never implies any particular comparison outcome, and vice
 *  versa. comparison is null exactly when calculation.recomputed is false
 *  (there is nothing to compare). */
export interface ValidationResult {
  calculation: CalculationResult;
  comparison: ComparisonResult | null;
}

// ── Unit table — finite, code-owned, reviewed. Area/volume units are
// derived from the SAME length factors (squared/cubed) rather than typed in
// independently, so they can never silently drift out of consistency with
// the length table. Only the units needed for the supported formulas/tests
// are included — this is not a generalized units library. ─────────────────
const LENGTH_TO_METERS: Record<string, number> = {
  m: 1,
  mm: 0.001,
  in: 0.0254,
  ft: 0.3048,
};

interface UnitDef {
  dimension: PhysicalDimension;
  /** Multiply a raw value by this to get the canonical unit for its dimension. */
  toCanonical: number;
}

const UNIT_TABLE: Record<string, UnitDef> = {};
for (const [unit, factor] of Object.entries(LENGTH_TO_METERS)) {
  UNIT_TABLE[unit] = { dimension: "LENGTH", toCanonical: factor };
}
UNIT_TABLE.sqm = { dimension: "AREA", toCanonical: 1 };
UNIT_TABLE.sqft = { dimension: "AREA", toCanonical: LENGTH_TO_METERS.ft ** 2 };
UNIT_TABLE.cum = { dimension: "VOLUME", toCanonical: 1 };
UNIT_TABLE.cuft = { dimension: "VOLUME", toCanonical: LENGTH_TO_METERS.ft ** 3 };
UNIT_TABLE.count = { dimension: "COUNT", toCanonical: 1 };

/** The fixed canonical unit this module always reports a calculated result
 *  in, per dimension — never ambiguous, never caller-chosen. */
const CANONICAL_UNIT: Record<PhysicalDimension, string> = {
  LENGTH: "m",
  AREA: "sqm",
  VOLUME: "cum",
  COUNT: "count",
};
const CANONICAL_UNIT_DIMENSION: Record<string, PhysicalDimension> = {
  m: "LENGTH",
  sqm: "AREA",
  cum: "VOLUME",
  count: "COUNT",
};

function unitDef(unit: string): UnitDef | null {
  return UNIT_TABLE[unit] ?? null;
}

/** Convert a value from `unit` to its dimension's canonical unit. Caller
 *  must have already confirmed `unit` resolves via unitDef(). */
function toCanonicalValue(value: number, unit: string): number {
  return value * UNIT_TABLE[unit].toCanonical;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegativeInteger(v: number): boolean {
  return Number.isInteger(v) && v >= 0;
}

function isValidEvidenceBox(e: EvidenceRef): boolean {
  return Array.isArray(e.bbox) && e.bbox.length === 4 && e.bbox.every((n) => isFiniteNumber(n));
}

/** True when `candidate` is at least shaped like a usable input object —
 *  not null/undefined (the only element shapes that throw on property
 *  access below) and not an array (which passes `typeof === "object"` but
 *  is never a valid input). Deliberately does not duplicate
 *  isFiniteNumber()'s own value-type check or unitDef()'s own unit-type
 *  check — both already degrade safely (never throw) for a malformed
 *  `value`/`unit` on an otherwise object-shaped element. */
function isUsableInputShape(candidate: unknown): candidate is CalculationInput {
  return candidate != null && typeof candidate === "object" && !Array.isArray(candidate);
}

/** Non-null when `inputs` itself is not an array, or contains an element
 *  that isn't a usable input object — rejected explicitly, before any
 *  handler ever calls `.length`/`.map`/`.some`/`.every` or reads a
 *  property off an individual element. Missing, null, or non-array
 *  `inputs` is never silently substituted with an empty array. */
function inputsShapeReason(inputs: unknown): string | null {
  if (!Array.isArray(inputs)) {
    return "inputs must be an array — missing, null, or non-array inputs are rejected, never substituted with an empty array.";
  }
  if (!inputs.every(isUsableInputShape)) {
    return "One or more array elements are not usable input objects — malformed elements are rejected, never accessed unsafely.";
  }
  return null;
}

/** Non-null when one or more inputs' numeric value is NaN/Infinity/-Infinity
 *  — these are rejected explicitly, never propagated into arithmetic. Called
 *  at the top of every formula handler, before any unit/dimension check. */
function nonFiniteInputReason(inputs: CalculationInput[]): string | null {
  return inputs.some((i) => !isFiniteNumber(i.value))
    ? "One or more input values are not finite numbers (NaN, Infinity, or -Infinity are rejected explicitly, never propagated into a result)."
    : null;
}

/** Structural only — never proof the region shows what it claims. */
function inputEvidenceValid(input: CalculationInput): boolean {
  return Array.isArray(input.evidence) && input.evidence.length > 0 && input.evidence.every(isValidEvidenceBox);
}

function invalidCalculation(reason: string): CalculationResult {
  return { formulaSupported: true, inputsValid: false, evidenceValid: false, recomputed: false, resultValue: null, resultUnit: null, reason };
}

function unsupportedFormula(reason: string): CalculationResult {
  return { formulaSupported: false, inputsValid: false, evidenceValid: false, recomputed: false, resultValue: null, resultUnit: null, reason };
}

// ── Per-formula recomputation. Each handler is a small, explicit,
// hand-written function — never a generic expression evaluator, never
// chained with another formula (no formula chaining in this slice). ───────

function computeSumOfSegments(inputs: CalculationInput[]): CalculationResult {
  const shapeReason = inputsShapeReason(inputs);
  if (shapeReason) return invalidCalculation(shapeReason);
  if (inputs.length < 2) return invalidCalculation("SUM_OF_SEGMENTS requires at least two inputs.");
  const nonFinite = nonFiniteInputReason(inputs);
  if (nonFinite) return invalidCalculation(nonFinite);
  const defs = inputs.map((i) => unitDef(i.unit));
  if (defs.some((d) => d == null)) return invalidCalculation("One or more inputs use an unrecognized unit.");
  const dimension = defs[0]!.dimension;
  if (defs.some((d) => d!.dimension !== dimension)) {
    return invalidCalculation("SUM_OF_SEGMENTS requires every input to share the same physical dimension — incompatible dimensions are rejected, never coerced.");
  }
  const evidenceValid = inputs.every(inputEvidenceValid);
  const total = inputs.reduce((sum, i) => sum + toCanonicalValue(i.value, i.unit), 0);
  return { formulaSupported: true, inputsValid: true, evidenceValid, recomputed: true, resultValue: total, resultUnit: CANONICAL_UNIT[dimension] };
}

function computeLengthTimesWidth(inputs: CalculationInput[]): CalculationResult {
  const shapeReason = inputsShapeReason(inputs);
  if (shapeReason) return invalidCalculation(shapeReason);
  if (inputs.length !== 2) return invalidCalculation("LENGTH_TIMES_WIDTH requires exactly two inputs.");
  const nonFinite = nonFiniteInputReason(inputs);
  if (nonFinite) return invalidCalculation(nonFinite);
  const defs = inputs.map((i) => unitDef(i.unit));
  if (defs.some((d) => d == null) || defs.some((d) => d!.dimension !== "LENGTH")) {
    return invalidCalculation("LENGTH_TIMES_WIDTH requires two length inputs — area, volume, count, or otherwise invalid input dimensions are rejected.");
  }
  const evidenceValid = inputs.every(inputEvidenceValid);
  const metres = inputs.map((i) => toCanonicalValue(i.value, i.unit));
  return { formulaSupported: true, inputsValid: true, evidenceValid, recomputed: true, resultValue: metres[0] * metres[1], resultUnit: CANONICAL_UNIT.AREA };
}

function computeLengthTimesWidthTimesHeight(inputs: CalculationInput[]): CalculationResult {
  const shapeReason = inputsShapeReason(inputs);
  if (shapeReason) return invalidCalculation(shapeReason);
  if (inputs.length !== 3) return invalidCalculation("LENGTH_TIMES_WIDTH_TIMES_HEIGHT requires exactly three inputs.");
  const nonFinite = nonFiniteInputReason(inputs);
  if (nonFinite) return invalidCalculation(nonFinite);
  const defs = inputs.map((i) => unitDef(i.unit));
  if (defs.some((d) => d == null) || defs.some((d) => d!.dimension !== "LENGTH")) {
    return invalidCalculation("LENGTH_TIMES_WIDTH_TIMES_HEIGHT requires three length inputs.");
  }
  const evidenceValid = inputs.every(inputEvidenceValid);
  const metres = inputs.map((i) => toCanonicalValue(i.value, i.unit));
  return { formulaSupported: true, inputsValid: true, evidenceValid, recomputed: true, resultValue: metres[0] * metres[1] * metres[2], resultUnit: CANONICAL_UNIT.VOLUME };
}

function computeCountTimesMultiplier(inputs: CalculationInput[]): CalculationResult {
  const shapeReason = inputsShapeReason(inputs);
  if (shapeReason) return invalidCalculation(shapeReason);
  if (inputs.length !== 2) return invalidCalculation("COUNT_TIMES_MULTIPLIER requires exactly two inputs.");
  const nonFinite = nonFiniteInputReason(inputs);
  if (nonFinite) return invalidCalculation(nonFinite);
  const defs = inputs.map((i) => unitDef(i.unit));
  if (defs.some((d) => d == null) || defs.some((d) => d!.dimension !== "COUNT")) {
    return invalidCalculation("COUNT_TIMES_MULTIPLIER requires two dimensionless count inputs.");
  }
  if (inputs.some((i) => !isNonNegativeInteger(i.value))) {
    return invalidCalculation("COUNT_TIMES_MULTIPLIER requires non-negative integer counts — never silently truncated.");
  }
  const evidenceValid = inputs.every(inputEvidenceValid);
  return { formulaSupported: true, inputsValid: true, evidenceValid, recomputed: true, resultValue: inputs[0].value * inputs[1].value, resultUnit: CANONICAL_UNIT.COUNT };
}

function computeQuantityPerUnitTimesUnitCount(inputs: CalculationInput[]): CalculationResult {
  const shapeReason = inputsShapeReason(inputs);
  if (shapeReason) return invalidCalculation(shapeReason);
  if (inputs.length !== 2) {
    return invalidCalculation("QUANTITY_PER_UNIT_TIMES_UNIT_COUNT requires exactly two inputs: a per-unit quantity and a unit count.");
  }
  const nonFinite = nonFiniteInputReason(inputs);
  if (nonFinite) return invalidCalculation(nonFinite);
  const [perUnit, unitCount] = inputs;
  const perUnitDef = unitDef(perUnit.unit);
  const unitCountDef = unitDef(unitCount.unit);
  if (!perUnitDef || !unitCountDef) return invalidCalculation("One or more inputs use an unrecognized unit.");
  if (perUnitDef.dimension === "COUNT") {
    return invalidCalculation("The first input must be a continuous quantity (length, area, or volume) — it is never classified as a count.");
  }
  if (unitCountDef.dimension !== "COUNT") {
    return invalidCalculation("The second input must be a dimensionless unit count.");
  }
  if (!isNonNegativeInteger(unitCount.value)) {
    return invalidCalculation("The unit count must be a non-negative integer — never silently truncated.");
  }
  const evidenceValid = inputs.every(inputEvidenceValid);
  const canonicalPerUnit = toCanonicalValue(perUnit.value, perUnit.unit);
  // This result says nothing about whether the `unitCount` repeated units
  // are genuinely identical physical instances — that is not establishable
  // here (see this module's header comment).
  return {
    formulaSupported: true,
    inputsValid: true,
    evidenceValid,
    recomputed: true,
    resultValue: canonicalPerUnit * unitCount.value,
    resultUnit: CANONICAL_UNIT[perUnitDef.dimension],
  };
}

function computeUnitConversion(inputs: CalculationInput[]): CalculationResult {
  const shapeReason = inputsShapeReason(inputs);
  if (shapeReason) return invalidCalculation(shapeReason);
  if (inputs.length !== 1) return invalidCalculation("UNIT_CONVERSION requires exactly one input.");
  const nonFinite = nonFiniteInputReason(inputs);
  if (nonFinite) return invalidCalculation(nonFinite);
  const [input] = inputs;
  const def = unitDef(input.unit);
  if (!def) {
    return invalidCalculation(`Unrecognized unit "${input.unit}" — unsupported conversions are never silently interpreted.`);
  }
  const evidenceValid = inputEvidenceValid(input);
  return { formulaSupported: true, inputsValid: true, evidenceValid, recomputed: true, resultValue: toCanonicalValue(input.value, input.unit), resultUnit: CANONICAL_UNIT[def.dimension] };
}

function dispatchFormula(request: CalculationRequest): CalculationResult {
  switch (request.formula) {
    case "SUM_OF_SEGMENTS": return computeSumOfSegments(request.inputs);
    case "LENGTH_TIMES_WIDTH": return computeLengthTimesWidth(request.inputs);
    case "LENGTH_TIMES_WIDTH_TIMES_HEIGHT": return computeLengthTimesWidthTimesHeight(request.inputs);
    case "COUNT_TIMES_MULTIPLIER": return computeCountTimesMultiplier(request.inputs);
    case "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT": return computeQuantityPerUnitTimesUnitCount(request.inputs);
    case "UNIT_CONVERSION": return computeUnitConversion(request.inputs);
    default:
      return unsupportedFormula("Unknown formula identifier — not in the code-owned allowlist.");
  }
}

/** Every finite-input guard above prevents a non-finite VALUE from ever
 *  reaching arithmetic, but even finite inputs can combine (e.g. two very
 *  large finite values multiplied together) into a non-finite RESULT
 *  (overflow). This is the single place that guarantees a non-finite
 *  result is never returned as a successful calculation, regardless of
 *  which formula produced it. */
function computeCalculation(request: CalculationRequest): CalculationResult {
  const result = dispatchFormula(request);
  if (result.recomputed && !isFiniteNumber(result.resultValue)) {
    return invalidCalculation("The computed result is not a finite number (arithmetic overflow) — never returned as a successful calculation.");
  }
  return result;
}

// ── Comparison. FLOAT_EPSILON_RELATIVE exists ONLY to absorb IEEE754
// double's own representation noise (~1e-16 relative) with generous
// headroom — chosen many orders of magnitude below any plausible
// real-world measurement precision, specifically so it can never mask a
// genuine quantity discrepancy. It is NOT a measurement-rounding policy.
// No measurement-rounding tolerance is implemented in this slice — any
// non-floating-point-noise difference on a continuous (non-COUNT) result
// is reported as ROUNDING_POLICY_UNRESOLVED, deliberately never guessed at
// as either a match or a mismatch via an invented "gross discrepancy"
// threshold. ────────────────────────────────────────────────────────────
const FLOAT_EPSILON_RELATIVE = 1e-9;

function computeComparison(request: CalculationRequest, calculation: CalculationResult): ComparisonResult | null {
  if (!calculation.recomputed || calculation.resultValue == null || calculation.resultUnit == null) {
    return null;
  }
  if (!isFiniteNumber(request.statedQuantity)) {
    return {
      comparable: false,
      outcome: "INCOMPARABLE",
      explanation: "The stated quantity is not a finite number (NaN, Infinity, or -Infinity) — no meaningful comparison is possible. Never reported as MISMATCH or ROUNDING_POLICY_UNRESOLVED.",
    };
  }
  const statedDef = unitDef(request.statedUnit);
  const resultDimension = CANONICAL_UNIT_DIMENSION[calculation.resultUnit];
  if (!statedDef || !resultDimension || statedDef.dimension !== resultDimension) {
    return {
      comparable: false,
      outcome: "INCOMPARABLE",
      explanation: "The stated unit's physical dimension does not match the computed result's dimension, or the stated unit is unrecognized.",
    };
  }
  const canonicalStated = toCanonicalValue(request.statedQuantity, request.statedUnit);
  const diff = Math.abs(canonicalStated - calculation.resultValue);
  const scale = Math.max(1, Math.abs(canonicalStated), Math.abs(calculation.resultValue));
  if (diff <= FLOAT_EPSILON_RELATIVE * scale) {
    return {
      comparable: true,
      outcome: "EXACT_MATCH",
      explanation: "The stated quantity matches the recomputed value (within floating-point representation noise only).",
    };
  }
  if (resultDimension === "COUNT") {
    return {
      comparable: true,
      outcome: "MISMATCH",
      explanation: "The stated count does not equal the recomputed count. A discrete count has no rounding concept, so any difference beyond floating-point noise is a real mismatch.",
    };
  }
  return {
    comparable: true,
    outcome: "ROUNDING_POLICY_UNRESOLVED",
    explanation: "The stated quantity differs from the recomputed value, but no calibrated measurement-rounding policy exists yet to determine whether this difference is legitimate rounding or a genuine error. Deliberately not classified as a match or a mismatch.",
  };
}

/**
 * Independently recompute `request.formula` from `request.inputs` and
 * compare the result against `request.statedQuantity`/`statedUnit`.
 *
 * Pure: never mutates `request` or anything inside it; performs no I/O.
 * Returns calculation status and comparison status as two separate
 * objects — a successful calculation never implies any particular
 * comparison outcome, and arithmetic consistency never implies the
 * drawing was read correctly, the inputs belong to the intended element,
 * or the formula matches the BOQ measurement convention.
 */
export function validateCalculation(request: CalculationRequest): ValidationResult {
  const calculation = computeCalculation(request);
  const comparison = computeComparison(request, calculation);
  return { calculation, comparison };
}
