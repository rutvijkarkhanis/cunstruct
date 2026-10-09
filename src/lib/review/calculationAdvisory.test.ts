import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { toCalculationRequest, validateItemCalculation, calculationAdvisoryText } from "./calculationAdvisory";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

function item(overrides: Partial<AnalysisItemV1>): AnalysisItemV1 {
  return {
    key: "W1", item: "Window", quantity: null, confidence: null, aiStatus: "MEASURED",
    ...overrides,
  };
}

describe("toCalculationRequest — maps ONLY item.quantity/item.unit, never a reviewer-adjusted value", () => {
  it("returns null when calculationData is absent (the normal case)", () => {
    expect(toCalculationRequest(item({ quantity: 18, unit: "sqm" }))).toBeNull();
  });

  it("returns null when quantity is null, even with calculationData present", () => {
    const it_ = item({
      quantity: null, unit: "sqm",
      calculationData: { formula: "LENGTH_TIMES_WIDTH", inputs: [{ name: "l", value: 6, unit: "m" }, { name: "w", value: 3, unit: "m" }] },
    });
    expect(toCalculationRequest(it_)).toBeNull();
  });

  it("returns null when unit is missing, even with calculationData present", () => {
    const it_ = item({
      quantity: 18, unit: undefined,
      calculationData: { formula: "LENGTH_TIMES_WIDTH", inputs: [{ name: "l", value: 6, unit: "m" }, { name: "w", value: 3, unit: "m" }] },
    });
    expect(toCalculationRequest(it_)).toBeNull();
  });

  it("maps quantity/unit straight from the AI item's own fields", () => {
    const it_ = item({
      quantity: 18, unit: "sqm",
      calculationData: { formula: "LENGTH_TIMES_WIDTH", inputs: [{ name: "l", value: 6, unit: "m" }, { name: "w", value: 3, unit: "m" }] },
    });
    const req = toCalculationRequest(it_);
    expect(req).toEqual({
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [{ name: "l", value: 6, unit: "m" }, { name: "w", value: 3, unit: "m" }],
      statedQuantity: 18,
      statedUnit: "sqm",
    });
  });

  it("never reads item.reviewer — StoredReviewItem's reviewer field does not even exist on AnalysisItemV1", () => {
    // Structural guarantee: AnalysisItemV1 has no "reviewer" field for this
    // function to accidentally read — the reviewer-exclusion is enforced by
    // the type itself, not just by this function's behavior.
    const it_ = item({ quantity: 18, unit: "sqm" });
    expect("reviewer" in it_).toBe(false);
  });
});

describe("validateItemCalculation — wraps the unmodified Scope A validator", () => {
  it("returns null when there is nothing to recompute (no calculationData)", () => {
    expect(validateItemCalculation(item({ quantity: 18, unit: "sqm" }))).toBeNull();
  });

  it("recomputes and compares for a well-formed, matching claim", () => {
    const it_ = item({
      quantity: 18, unit: "sqm",
      calculationData: { formula: "LENGTH_TIMES_WIDTH", inputs: [{ name: "l", value: 6, unit: "m" }, { name: "w", value: 3, unit: "m" }] },
    });
    const result = validateItemCalculation(it_);
    expect(result?.calculation.recomputed).toBe(true);
    expect(result?.comparison?.outcome).toBe("EXACT_MATCH");
  });

  it("an unsupported formula degrades safely to no comparison, never throws", () => {
    const it_ = item({
      quantity: 18, unit: "sqm",
      calculationData: { formula: "NOT_A_REAL_FORMULA" as never, inputs: [] },
    });
    expect(() => validateItemCalculation(it_)).not.toThrow();
    expect(validateItemCalculation(it_)?.comparison).toBeNull();
  });
});

describe("adapter-to-validator path — an unknown STATED unit (valid formula, valid inputs) is INCOMPARABLE, end to end", () => {
  // A real AnalysisItemV1: a valid, well-formed calculationData (a supported
  // formula with valid, unit-recognized inputs), but a stated unit the
  // validator's unit table does not know. Only item.unit is unknown — not
  // the formula, not the inputs. This drives the REAL, unmocked
  // validateCalculation() (measurementValidator.ts, unmodified) via the
  // REAL adapter functions — no hand-built ValidationResult.
  const it_ = item({
    quantity: 18,
    unit: "parsecs", // not in measurementValidator.ts's unit table
    calculationData: {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [{ name: "length", value: 6, unit: "m" }, { name: "width", value: 3, unit: "m" }],
    },
  });

  it("toCalculationRequest does NOT discard the item merely because the stated unit is unknown — it is the validator's job to judge the unit, not the adapter's", () => {
    const req = toCalculationRequest(it_);
    expect(req).not.toBeNull();
    expect(req).toEqual({
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [{ name: "length", value: 6, unit: "m" }, { name: "width", value: 3, unit: "m" }],
      statedQuantity: 18,
      statedUnit: "parsecs", // item.unit verbatim — never a reviewer value (none exists on AnalysisItemV1)
    });
  });

  it("validateItemCalculation (the real, unmocked validateCalculation()) still recomputes the arithmetic successfully", () => {
    const result = validateItemCalculation(it_);
    // The calculation itself succeeds — a valid formula with valid,
    // recognized INPUT units recomputes fine; only the comparison against
    // the unrecognized STATED unit fails. Proves the adapter/validator
    // distinguish "can't recompute" from "can't compare".
    expect(result?.calculation.recomputed).toBe(true);
    expect(result?.calculation.resultValue).toBe(18);
    expect(result?.calculation.resultUnit).toBe("sqm");
  });

  it("the real validateCalculation() reports INCOMPARABLE — never a false EXACT_MATCH or MISMATCH", () => {
    const result = validateItemCalculation(it_);
    expect(result?.comparison?.comparable).toBe(false);
    expect(result?.comparison?.outcome).toBe("INCOMPARABLE");
    expect(result?.comparison?.outcome).not.toBe("EXACT_MATCH");
    expect(result?.comparison?.outcome).not.toBe("MISMATCH");
    expect(result?.comparison?.outcome).not.toBe("ROUNDING_POLICY_UNRESOLVED");
  });

  it("calculationAdvisoryText renders exactly the required string for this real result", () => {
    const result = validateItemCalculation(it_);
    expect(calculationAdvisoryText(result)).toBe("Cannot compare safely.");
  });

  it("uses item.unit itself, never a reviewer-effective unit or quantity — AnalysisItemV1 has no reviewer field for either value to come from", () => {
    expect("reviewer" in it_).toBe(false);
    const req = toCalculationRequest(it_)!;
    expect(req.statedQuantity).toBe(it_.quantity);
    expect(req.statedUnit).toBe(it_.unit);
  });
});

describe("calculationAdvisoryText — exact required wording, per outcome", () => {
  it("returns null (no badge) for a null result", () => {
    expect(calculationAdvisoryText(null)).toBeNull();
  });

  it("returns null (no badge) when comparison itself is null (unsupported/malformed/failed recomputation)", () => {
    expect(calculationAdvisoryText({ calculation: { formulaSupported: false, inputsValid: false, evidenceValid: false, recomputed: false, resultValue: null, resultUnit: null }, comparison: null })).toBeNull();
  });

  it("EXACT_MATCH", () => {
    const text = calculationAdvisoryText({
      calculation: { formulaSupported: true, inputsValid: true, evidenceValid: false, recomputed: true, resultValue: 18, resultUnit: "sqm" },
      comparison: { comparable: true, outcome: "EXACT_MATCH", explanation: "x" },
    });
    expect(text).toBe("Arithmetic matches — not drawing verification.");
  });

  it("MISMATCH", () => {
    const text = calculationAdvisoryText({
      calculation: { formulaSupported: true, inputsValid: true, evidenceValid: false, recomputed: true, resultValue: 5, resultUnit: "count" },
      comparison: { comparable: true, outcome: "MISMATCH", explanation: "x" },
    });
    expect(text).toBe("Count calculation differs — advisory only.");
  });

  it("ROUNDING_POLICY_UNRESOLVED", () => {
    const text = calculationAdvisoryText({
      calculation: { formulaSupported: true, inputsValid: true, evidenceValid: false, recomputed: true, resultValue: 18.2, resultUnit: "sqm" },
      comparison: { comparable: true, outcome: "ROUNDING_POLICY_UNRESOLVED", explanation: "x" },
    });
    expect(text).toBe("Continuous quantity difference; rounding policy unresolved.");
  });

  it("INCOMPARABLE", () => {
    const text = calculationAdvisoryText({
      calculation: { formulaSupported: true, inputsValid: true, evidenceValid: false, recomputed: true, resultValue: 18, resultUnit: "sqm" },
      comparison: { comparable: false, outcome: "INCOMPARABLE", explanation: "x" },
    });
    expect(text).toBe("Cannot compare safely.");
  });

  it("never uses the words 'verified' to describe the drawing or quantity", () => {
    const outcomes = ["EXACT_MATCH", "MISMATCH", "ROUNDING_POLICY_UNRESOLVED", "INCOMPARABLE"] as const;
    for (const outcome of outcomes) {
      const text = calculationAdvisoryText({
        calculation: { formulaSupported: true, inputsValid: true, evidenceValid: false, recomputed: true, resultValue: 1, resultUnit: "count" },
        comparison: { comparable: outcome !== "INCOMPARABLE", outcome, explanation: "x" },
      })!;
      expect(text).not.toMatch(/quantity verified/i);
      expect(text).not.toMatch(/drawing verified/i);
    }
  });
});

describe("calculationAdvisory.ts — structural no-write, no-mutation guard", () => {
  it("never mutates the item it's given", () => {
    const it_ = item({
      quantity: 18, unit: "sqm",
      calculationData: { formula: "LENGTH_TIMES_WIDTH", inputs: [{ name: "l", value: 6, unit: "m" }, { name: "w", value: 3, unit: "m" }] },
    });
    const before = JSON.stringify(it_);
    validateItemCalculation(it_);
    expect(JSON.stringify(it_)).toBe(before);
  });

  it("the module source contains no Supabase client, no .insert(/.update(/.upsert(, and no reference to effectiveQuantity", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/lib/review/calculationAdvisory.ts"), "utf8");
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
    expect(src).not.toMatch(/import .*supabase/i);
    // The actual exclusion is behavior-tested above (toCalculationRequest
    // maps only item.quantity/item.unit) — this just confirms the code never
    // CALLS effectiveQuantity() (a doc comment mentioning why not is fine).
    expect(src).not.toMatch(/effectiveQuantity\(item/);
  });
});
