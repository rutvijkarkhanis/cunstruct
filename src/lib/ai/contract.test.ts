// Tests the pure analysis-mode resolution used by the ai-analysis edge
// function. Imported from its actual location (supabase/functions/_shared/)
// via a relative, explicit-extension path — the same way index.ts imports
// it — so this exercises the real module, not a copy.
import { describe, it, expect } from "vitest";
import { ANALYSIS_MODES, DEFAULT_ANALYSIS_MODE, resolveAnalysisMode } from "../../../supabase/functions/_shared/contract.ts";

describe("resolveAnalysisMode", () => {
  it("omitted (undefined) resolves to the default mode, BOQ", () => {
    expect(resolveAnalysisMode(undefined)).toBe("BOQ");
    expect(DEFAULT_ANALYSIS_MODE).toBe("BOQ");
  });

  it("null resolves to BOQ the same way undefined does — both mean 'not specified'", () => {
    expect(resolveAnalysisMode(null)).toBe("BOQ");
  });

  it("explicit BOQ resolves to BOQ — identical outcome to omitting it entirely", () => {
    expect(resolveAnalysisMode("BOQ")).toBe(resolveAnalysisMode(undefined));
    expect(resolveAnalysisMode("BOQ")).toBe("BOQ");
  });

  it("LOCATION is accepted", () => {
    expect(resolveAnalysisMode("LOCATION")).toBe("LOCATION");
  });

  it("BOQ_AND_LOCATION is accepted", () => {
    expect(resolveAnalysisMode("BOQ_AND_LOCATION")).toBe("BOQ_AND_LOCATION");
  });

  it("an unknown mode string is rejected (returns null, never silently coerced)", () => {
    expect(resolveAnalysisMode("FOO")).toBeNull();
    expect(resolveAnalysisMode("boq")).toBeNull(); // case-sensitive — not silently normalized
    expect(resolveAnalysisMode("")).toBeNull(); // an explicit empty string is not "omitted"
  });

  it("ANALYSIS_MODES is exactly the three specified modes, in a stable order", () => {
    expect(ANALYSIS_MODES).toEqual(["BOQ", "LOCATION", "BOQ_AND_LOCATION"]);
  });
});
