// MEASUREMENT VALIDATOR TESTS — Scope A only.
//
// These are PURE UNIT TESTS over hand-authored synthetic fixtures. They
// prove the arithmetic/comparison/unit-handling logic in
// measurementValidator.ts is internally correct. They prove NOTHING about
// real-world drawing-measurement accuracy, real model output, or real BOQ
// quantities — no live model call is made anywhere in this file, and none
// of this module's fixtures are read from or written to any real
// analysis_review_item row. A manually verified gold set (explicitly out of
// scope for Scope A) would be required for any real-world accuracy claim.
//
// The existing srikakulamBenchmark.ts ExpectedItem fixtures were inspected
// (this session's design-review history) and confirmed to carry NO
// structured calculation inputs — they are not reused here; every fixture
// below is newly authored for this file.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  validateCalculation,
  type CalculationInput,
  type CalculationRequest,
} from "./measurementValidator";

function input(name: string, value: number, unit: string, withEvidence = true): CalculationInput {
  return {
    name,
    value,
    unit,
    evidence: withEvidence ? [{ bbox: [0, 0, 10, 10], page: 1 }] : undefined,
  };
}

describe("validateCalculation — formula support", () => {
  // 1. Exact count match.
  it("COUNT_TIMES_MULTIPLIER: 7 x 5 = 35, stated 35 -> EXACT_MATCH", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("perFloor", 7, "count"), input("floors", 5, "count")],
      statedQuantity: 35,
      statedUnit: "count",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation).toMatchObject({ recomputed: true, resultValue: 35, resultUnit: "count" });
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // 2. Exact count mismatch.
  it("COUNT_TIMES_MULTIPLIER: 7 x 5 = 35, stated 36 -> MISMATCH", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("perFloor", 7, "count"), input("floors", 5, "count")],
      statedQuantity: 36,
      statedUnit: "count",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.resultValue).toBe(35);
    expect(comparison?.outcome).toBe("MISMATCH");
  });

  // 3. Correct quantity-per-unit multiplication (the corrected slab-total-area case).
  it("QUANTITY_PER_UNIT_TIMES_UNIT_COUNT: 4188 sqft/slab x 6 slabs = 25128 sqft, stated 25128 -> EXACT_MATCH, never classified as a count", () => {
    const req: CalculationRequest = {
      formula: "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT",
      inputs: [input("areaPerSlab", 4188, "sqft"), input("slabCount", 6, "count")],
      statedQuantity: 25128,
      statedUnit: "sqft",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true);
    expect(calculation.resultUnit).toBe("sqm"); // canonical unit for AREA, never "count"
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // 4. Same inputs, stated quantity perturbed: must remain unresolved, never
  // guessed as a mismatch via an uncalibrated "gross discrepancy" rule.
  it("QUANTITY_PER_UNIT_TIMES_UNIT_COUNT: same inputs, stated 24000 sqft -> ROUNDING_POLICY_UNRESOLVED, not MISMATCH", () => {
    const req: CalculationRequest = {
      formula: "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT",
      inputs: [input("areaPerSlab", 4188, "sqft"), input("slabCount", 6, "count")],
      statedQuantity: 24000,
      statedUnit: "sqft",
    };
    const { comparison } = validateCalculation(req);
    expect(comparison?.outcome).toBe("ROUNDING_POLICY_UNRESOLVED");
  });

  // 5. Internally consistent but incorrect input — the ACCEPTED BLIND SPOT.
  it("documents the accepted blind spot: a misread per-unit input (4000 instead of the true 4188) that is internally self-consistent still reports EXACT_MATCH, which never proves the input was read correctly", () => {
    const req: CalculationRequest = {
      formula: "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT",
      inputs: [input("areaPerSlab", 4000, "sqft"), input("slabCount", 6, "count")],
      statedQuantity: 24000,
      statedUnit: "sqft",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.resultValue).toBeCloseTo(toSqm(24000), 9);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
    // The assertion above is the blind spot itself: this module has no way
    // to know 4000 should have been 4188 — EXACT_MATCH here is proof of
    // self-consistency only, never of drawing-reading accuracy.
  });

  // 6. Length x width, valid pair.
  it("LENGTH_TIMES_WIDTH: 10m x 10m = 100 sqm, stated 100 sqm -> EXACT_MATCH", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 10, "m"), input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.resultValue).toBeCloseTo(100, 9);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // 7. Length x width x height, valid.
  it("LENGTH_TIMES_WIDTH_TIMES_HEIGHT: 2m x 3m x 4m = 24 cum, stated 24 cum -> EXACT_MATCH", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH_TIMES_HEIGHT",
      inputs: [input("l", 2, "m"), input("w", 3, "m"), input("h", 4, "m")],
      statedQuantity: 24,
      statedUnit: "cum",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.resultValue).toBeCloseTo(24, 9);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // 8. Sum of compatible segments, converting to a common unit before summing.
  it("SUM_OF_SEGMENTS: 2m + 300mm + 1m = 3.3m (common-unit conversion before summing), stated 3.3m -> EXACT_MATCH", () => {
    const req: CalculationRequest = {
      formula: "SUM_OF_SEGMENTS",
      inputs: [input("a", 2, "m"), input("b", 300, "mm"), input("c", 1, "m")],
      statedQuantity: 3.3,
      statedUnit: "m",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.resultValue).toBeCloseTo(3.3, 9);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // 9. Valid unit conversion.
  it("UNIT_CONVERSION: 12 in -> stated 1 ft -> EXACT_MATCH", () => {
    const req: CalculationRequest = {
      formula: "UNIT_CONVERSION",
      inputs: [input("length", 12, "in")],
      statedQuantity: 1,
      statedUnit: "ft",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // 10. Unsupported conversion — an unrecognized unit string is never
  // silently interpreted.
  it("UNIT_CONVERSION: unrecognized unit string -> invalid, not silently interpreted", () => {
    const req: CalculationRequest = {
      formula: "UNIT_CONVERSION",
      inputs: [input("length", 10, "furlongs")],
      statedQuantity: 10,
      statedUnit: "furlongs",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.inputsValid).toBe(false);
    expect(comparison).toBeNull();
  });

  // 11. Incompatible input dimensions within one formula.
  it("SUM_OF_SEGMENTS: mixing a length and an area input is rejected, never coerced", () => {
    const req: CalculationRequest = {
      formula: "SUM_OF_SEGMENTS",
      inputs: [input("a", 2, "m"), input("b", 5, "sqm")],
      statedQuantity: 7,
      statedUnit: "m",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(comparison).toBeNull();
  });

  // 12. Dimensionally invalid formula inputs (count formula given area inputs).
  it("COUNT_TIMES_MULTIPLIER: given two area inputs instead of counts is rejected", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", 10, "sqm"), input("b", 5, "sqm")],
      statedQuantity: 50,
      statedUnit: "sqm",
    };
    const { calculation } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.inputsValid).toBe(false);
  });

  // 13. Missing required inputs.
  it("LENGTH_TIMES_WIDTH: given only one input is rejected as incomplete, never computed from one value", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(comparison).toBeNull();
  });

  // 14. Unsupported formula identifier (outside the code-owned allowlist).
  it("an unrecognized formula identifier is rejected as unsupported, never guessed at", () => {
    const req = {
      formula: "AREA_FROM_POLYGON" as CalculationRequest["formula"],
      inputs: [input("a", 1, "m")],
      statedQuantity: 1,
      statedUnit: "m",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.formulaSupported).toBe(false);
    expect(calculation.recomputed).toBe(false);
    expect(comparison).toBeNull();
  });

  // 15. Missing or malformed evidence references — tracked as a SEPARATE
  // property from numeric/dimensional validity; arithmetic still runs.
  it("evidenceValid is false for a missing evidence array, independently of a successful recomputation", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", 7, "count", false), input("b", 5, "count")],
      statedQuantity: 35,
      statedUnit: "count",
    };
    const { calculation } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true);
    expect(calculation.evidenceValid).toBe(false);
  });

  it("evidenceValid is false for a malformed bbox (wrong length), independently of a successful recomputation", () => {
    const malformed: CalculationInput = { name: "a", value: 7, unit: "count", evidence: [{ bbox: [0, 0, 10] as unknown as [number, number, number, number] }] };
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [malformed, input("b", 5, "count")],
      statedQuantity: 35,
      statedUnit: "count",
    };
    const { calculation } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true);
    expect(calculation.evidenceValid).toBe(false);
  });

  // 16. Small and large values — floating-point behavior.
  it("SUM_OF_SEGMENTS: classic 0.1 + 0.2 floating-point artifact still compares as EXACT_MATCH against stated 0.3", () => {
    const req: CalculationRequest = {
      formula: "SUM_OF_SEGMENTS",
      inputs: [input("a", 0.1, "m"), input("b", 0.2, "m")],
      statedQuantity: 0.3,
      statedUnit: "m",
    };
    const { comparison } = validateCalculation(req);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // NOTE: 1,000,000 x 1,000,000 = 1,000,000,000,000 is an exact integer well
  // within IEEE754 double's exactly-representable range (2^53 ~ 9x10^15), so
  // this case introduces NO genuine floating-point representation error —
  // it only confirms the comparison doesn't overflow or misbehave at this
  // magnitude, not that noise is being absorbed. See the dedicated
  // noise-at-scale test immediately below for that claim.
  it("LENGTH_TIMES_WIDTH: large identical values (1,000,000 m x 1,000,000 m) compare as EXACT_MATCH — confirms no overflow or precision collapse at this magnitude", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 1_000_000, "m"), input("width", 1_000_000, "m")],
      statedQuantity: 1_000_000_000_000,
      statedUnit: "sqm",
    };
    const { comparison } = validateCalculation(req);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // This case DOES exercise genuine floating-point representation noise at
  // large magnitude: summing 100000000.1 seven times via repeated addition
  // (what the module's SUM_OF_SEGMENTS does internally) produces a bit
  // pattern that differs from computing 100000000.1 x 7 by direct
  // multiplication (what the stated quantity below uses) by ~1.19e-7 —
  // empirically verified (not guessed) to diverge at this magnitude, purely
  // from IEEE754 double representation, with no measurement imprecision
  // involved at all. FLOAT_EPSILON_RELATIVE must absorb exactly this kind
  // of noise without needing any calibrated rounding policy.
  it("SUM_OF_SEGMENTS: genuine floating-point representation noise at large magnitude (repeated addition vs. direct multiplication of the same value) is still absorbed as EXACT_MATCH", () => {
    const req: CalculationRequest = {
      formula: "SUM_OF_SEGMENTS",
      inputs: Array.from({ length: 7 }, (_, i) => input(`segment${i}`, 100000000.1, "m")),
      statedQuantity: 100000000.1 * 7,
      statedUnit: "m",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true);
    // The two values are NOT bit-identical — this is the point of the test.
    expect(calculation.resultValue).not.toBe(req.statedQuantity);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  // 17. A genuine continuous discrepancy — must not be silently accepted as
  // a match. Note: under this slice's explicit constraint against any
  // "gross discrepancy" heuristic, this is reported UNRESOLVED, not
  // MISMATCH — it is deliberately never reported as a match either.
  it("LENGTH_TIMES_WIDTH: a genuine 50 sqm discrepancy (100 vs stated 150) is never silently accepted as EXACT_MATCH", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 10, "m"), input("width", 10, "m")],
      statedQuantity: 150,
      statedUnit: "sqm",
    };
    const { comparison } = validateCalculation(req);
    expect(comparison?.outcome).not.toBe("EXACT_MATCH");
    expect(comparison?.outcome).toBe("ROUNDING_POLICY_UNRESOLVED");
  });

  // Incompatible output/stated units -> INCOMPARABLE, not a silent guess.
  it("a computed area compared against a stated count unit is INCOMPARABLE, never coerced into a numeric comparison", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 10, "m"), input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "count",
    };
    const { comparison } = validateCalculation(req);
    expect(comparison?.outcome).toBe("INCOMPARABLE");
  });
});

describe("validateCalculation — numerical safety (NaN/Infinity rejection)", () => {
  it("LENGTH_TIMES_WIDTH: a NaN input value is rejected, never propagated into a successful result", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", NaN, "m"), input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.inputsValid).toBe(false);
    expect(calculation.resultValue).toBeNull();
    expect(comparison).toBeNull();
  });

  it("LENGTH_TIMES_WIDTH: a +Infinity input value is rejected, never propagated into a successful result", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", Infinity, "m"), input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.resultValue).toBeNull();
    expect(comparison).toBeNull();
  });

  it("LENGTH_TIMES_WIDTH: a -Infinity input value is rejected, never propagated into a successful result", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", -Infinity, "m"), input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.resultValue).toBeNull();
    expect(comparison).toBeNull();
  });

  it("COUNT_TIMES_MULTIPLIER: a NaN count input is rejected (count-based formula), never propagated", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", NaN, "count"), input("b", 5, "count")],
      statedQuantity: 35,
      statedUnit: "count",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(comparison).toBeNull();
  });

  it("COUNT_TIMES_MULTIPLIER: an Infinity count input is rejected, never propagated", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", Infinity, "count"), input("b", 5, "count")],
      statedQuantity: 35,
      statedUnit: "count",
    };
    const { calculation } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
  });

  it("a NaN stated quantity is INCOMPARABLE, never MISMATCH or ROUNDING_POLICY_UNRESOLVED, even when the calculation itself succeeds", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 10, "m"), input("width", 10, "m")],
      statedQuantity: NaN,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true); // the calculation itself is unaffected
    expect(calculation.resultValue).toBeCloseTo(100, 9);
    expect(comparison?.comparable).toBe(false);
    expect(comparison?.outcome).toBe("INCOMPARABLE");
  });

  it("a +Infinity stated quantity is INCOMPARABLE, never MISMATCH or ROUNDING_POLICY_UNRESOLVED", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", 7, "count"), input("b", 5, "count")],
      statedQuantity: Infinity,
      statedUnit: "count",
    };
    const { comparison } = validateCalculation(req);
    expect(comparison?.outcome).toBe("INCOMPARABLE");
  });

  it("a -Infinity stated quantity is INCOMPARABLE, never MISMATCH or ROUNDING_POLICY_UNRESOLVED", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH_TIMES_HEIGHT",
      inputs: [input("l", 2, "m"), input("w", 3, "m"), input("h", 4, "m")],
      statedQuantity: -Infinity,
      statedUnit: "cum",
    };
    const { comparison } = validateCalculation(req);
    expect(comparison?.outcome).toBe("INCOMPARABLE");
  });

  it("negative counts are rejected without truncation, never silently made positive", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", -7, "count"), input("b", 5, "count")],
      statedQuantity: 35,
      statedUnit: "count",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.inputsValid).toBe(false);
    expect(calculation.resultValue).toBeNull();
    expect(comparison).toBeNull();
  });

  it("fractional counts are rejected without truncation — never silently floored to 7 x 5 = 35", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", 7.5, "count"), input("b", 5, "count")],
      statedQuantity: 35,
      statedUnit: "count",
    };
    const { calculation } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.inputsValid).toBe(false);
    expect(calculation.resultValue).toBeNull();
  });

  it("a negative unit count in QUANTITY_PER_UNIT_TIMES_UNIT_COUNT is rejected, never truncated", () => {
    const req: CalculationRequest = {
      formula: "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT",
      inputs: [input("areaPerSlab", 4188, "sqft"), input("slabCount", -6, "count")],
      statedQuantity: 25128,
      statedUnit: "sqft",
    };
    const { calculation } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
  });

  it("valid zero values are accepted and compute correctly — zero is never mistaken for an invalid or missing input", () => {
    const req: CalculationRequest = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", 0, "count"), input("b", 5, "count")],
      statedQuantity: 0,
      statedUnit: "count",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true);
    expect(calculation.resultValue).toBe(0);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  it("ordinary finite inputs remain unaffected by the new finiteness guard (regression check)", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH_TIMES_HEIGHT",
      inputs: [input("l", 2, "m"), input("w", 3, "m"), input("h", 4, "m")],
      statedQuantity: 24,
      statedUnit: "cum",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true);
    expect(calculation.resultValue).toBeCloseTo(24, 9);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  it("an arithmetic overflow to Infinity from two finite inputs is rejected, never returned as a successful result", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 1e200, "m"), input("width", 1e200, "m")],
      statedQuantity: 1,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.resultValue).toBeNull();
    expect(comparison).toBeNull();
  });

  it("never mutates the request object on the NaN-rejection path — immutability holds even when inputs are invalid", () => {
    const req: CalculationRequest = deepFreeze({
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", NaN, "m"), input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    });
    const before = JSON.parse(JSON.stringify(req));
    expect(() => validateCalculation(req)).not.toThrow();
    expect(JSON.parse(JSON.stringify(req))).toEqual(before);
  });
});

describe("validateCalculation — input-shape safety (malformed/missing inputs)", () => {
  it("inputs: undefined is rejected via the structured result, never throws", () => {
    const req = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: undefined,
      statedQuantity: 100,
      statedUnit: "sqm",
    } as unknown as CalculationRequest;
    let result: ReturnType<typeof validateCalculation> | undefined;
    expect(() => { result = validateCalculation(req); }).not.toThrow();
    expect(result!.calculation.recomputed).toBe(false);
    expect(result!.calculation.resultValue).toBeNull();
    expect(result!.comparison).toBeNull();
  });

  it("inputs: null is rejected via the structured result, never throws", () => {
    const req = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: null,
      statedQuantity: 100,
      statedUnit: "sqm",
    } as unknown as CalculationRequest;
    let result: ReturnType<typeof validateCalculation> | undefined;
    expect(() => { result = validateCalculation(req); }).not.toThrow();
    expect(result!.calculation.recomputed).toBe(false);
    expect(result!.comparison).toBeNull();
  });

  it("inputs: a string (even one whose .length happens to match the required count) is rejected via the structured result, never throws", () => {
    const req = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: "ab", // .length === 2, same as LENGTH_TIMES_WIDTH's required count — the exact case that previously reached .some() and threw
      statedQuantity: 100,
      statedUnit: "sqm",
    } as unknown as CalculationRequest;
    let result: ReturnType<typeof validateCalculation> | undefined;
    expect(() => { result = validateCalculation(req); }).not.toThrow();
    expect(result!.calculation.recomputed).toBe(false);
    expect(result!.comparison).toBeNull();
  });

  it("inputs: a plain object (not an array) is rejected via the structured result, never throws", () => {
    const req = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: { length: 10, width: 10 },
      statedQuantity: 100,
      statedUnit: "sqm",
    } as unknown as CalculationRequest;
    let result: ReturnType<typeof validateCalculation> | undefined;
    expect(() => { result = validateCalculation(req); }).not.toThrow();
    expect(result!.calculation.recomputed).toBe(false);
    expect(result!.comparison).toBeNull();
  });

  it("inputs: an empty array is rejected via each formula's own existing input-count check, never crashes and never computed from zero inputs", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [],
      statedQuantity: 100,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(false);
    expect(calculation.resultValue).toBeNull();
    expect(comparison).toBeNull();
  });

  it("a null element within an otherwise well-formed inputs array is rejected safely, never throws on property access", () => {
    const req = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [null, input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    } as unknown as CalculationRequest;
    let result: ReturnType<typeof validateCalculation> | undefined;
    expect(() => { result = validateCalculation(req); }).not.toThrow();
    expect(result!.calculation.recomputed).toBe(false);
  });

  it("an undefined element within an otherwise well-formed inputs array is rejected safely, never throws on property access", () => {
    const req = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [undefined, input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    } as unknown as CalculationRequest;
    let result: ReturnType<typeof validateCalculation> | undefined;
    expect(() => { result = validateCalculation(req); }).not.toThrow();
    expect(result!.calculation.recomputed).toBe(false);
  });

  it("a raw array nested as an element (not a valid input object) is rejected safely, never throws", () => {
    const req = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [[10], input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    } as unknown as CalculationRequest;
    let result: ReturnType<typeof validateCalculation> | undefined;
    expect(() => { result = validateCalculation(req); }).not.toThrow();
    expect(result!.calculation.recomputed).toBe(false);
  });

  it("malformed inputs on COUNT_TIMES_MULTIPLIER (a different formula family) are rejected the same safe way", () => {
    const req = {
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: undefined,
      statedQuantity: 35,
      statedUnit: "count",
    } as unknown as CalculationRequest;
    let result: ReturnType<typeof validateCalculation> | undefined;
    expect(() => { result = validateCalculation(req); }).not.toThrow();
    expect(result!.calculation.recomputed).toBe(false);
  });

  it("valid inputs are completely unaffected by the new shape guard (regression check)", () => {
    const req: CalculationRequest = {
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 10, "m"), input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    };
    const { calculation, comparison } = validateCalculation(req);
    expect(calculation.recomputed).toBe(true);
    expect(calculation.resultValue).toBeCloseTo(100, 9);
    expect(comparison?.outcome).toBe("EXACT_MATCH");
  });

  it("never mutates the request object when inputs is malformed", () => {
    const req = deepFreeze({
      formula: "LENGTH_TIMES_WIDTH",
      inputs: null,
      statedQuantity: 100,
      statedUnit: "sqm",
    }) as unknown as CalculationRequest;
    const before = JSON.parse(JSON.stringify(req));
    expect(() => validateCalculation(req)).not.toThrow();
    expect(JSON.parse(JSON.stringify(req))).toEqual(before);
  });
});

describe("validateCalculation — immutability", () => {
  // 18. Input-object immutability.
  it("never mutates the request object, even when deeply frozen", () => {
    const req: CalculationRequest = deepFreeze({
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [input("length", 10, "m"), input("width", 10, "m")],
      statedQuantity: 100,
      statedUnit: "sqm",
    });
    const before = JSON.parse(JSON.stringify(req));
    expect(() => validateCalculation(req)).not.toThrow();
    expect(JSON.parse(JSON.stringify(req))).toEqual(before);
  });
});

describe("measurementValidator — safety boundary (no I/O, no persistence responsibilities)", () => {
  // Structural check (text-based) — one layer, not the only layer.
  it("the module source imports nothing related to Supabase, network, or filesystem I/O", () => {
    const modulePath = resolve(process.cwd(), "src/lib/review/measurementValidator.ts");
    const source = readFileSync(modulePath, "utf8");
    const importLines = source.split("\n").filter((l) => l.trim().startsWith("import"));
    for (const line of importLines) {
      expect(line).not.toMatch(/supabase|node-fetch|axios|fs["']|path["']/i);
    }
    // No .insert(/.update( call sites of any kind — nothing to write.
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  // Behavioral check (not text-based) — the exported function is a plain,
  // synchronous function: it cannot be awaiting any network/DB call, since
  // async I/O in this codebase is uniformly expressed as a Promise-returning
  // async function, never a synchronous one.
  it("validateCalculation is a plain synchronous function, never async, never returning a Promise", () => {
    expect(validateCalculation.constructor.name).toBe("Function");
    const result = validateCalculation({
      formula: "COUNT_TIMES_MULTIPLIER",
      inputs: [input("a", 1, "count"), input("b", 1, "count")],
      statedQuantity: 1,
      statedUnit: "count",
    });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("the module's only exported value surface is the validator function and its types — nothing resembling a client/connection export", async () => {
    const mod = await import("./measurementValidator");
    const valueExports = Object.keys(mod).filter((k) => typeof (mod as Record<string, unknown>)[k] !== "undefined");
    expect(valueExports).toEqual(["validateCalculation"]);
  });
});

function toSqm(sqft: number): number {
  const FT_TO_M = 0.3048;
  return sqft * FT_TO_M * FT_TO_M;
}

function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  if (obj && typeof obj === "object") {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) deepFreeze(value);
    }
  }
  return obj;
}
