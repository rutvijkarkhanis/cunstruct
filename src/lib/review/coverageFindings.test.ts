import { describe, it, expect } from "vitest";
import { coverageSignalToFindingInput, COVERAGE_FINDING_SOURCE, COVERAGE_FINDING_TYPE } from "./coverageFindings";
import type { CoverageSignal } from "./coverageSignals";

function signal(overrides: Partial<CoverageSignal> = {}): CoverageSignal {
  return {
    type: "POTENTIAL_GAP",
    boqId: "boq-civil",
    documentId: "doc-A",
    normalizedKey: "d-07",
    mark: "D-07",
    evidenceTypes: ["schedule_entry"],
    observationIds: ["o1"],
    signalKey: "coverage¦boq-civil¦doc-A¦d-07",
    reason: 'Evidence for "D-07" (schedule_entry) was found in this document, but no matching item exists in this BOQ.',
    ...overrides,
  };
}

describe("coverageSignalToFindingInput", () => {
  it("reuses the existing MISSING_ITEM FindingType — never a new taxonomy", () => {
    expect(COVERAGE_FINDING_TYPE).toBe("MISSING_ITEM");
    expect(coverageSignalToFindingInput(signal()).findingType).toBe("MISSING_ITEM");
  });

  it("uses the signal's own mark as item — never a fabricated description", () => {
    expect(coverageSignalToFindingInput(signal({ mark: "W-12" })).item).toBe("W-12");
  });

  it("carries the signal's reason verbatim — factual/advisory, never 'confirmed missing'", () => {
    const s = signal({ reason: "Evidence for \"D-07\" (physical) was found in this document, but no matching item exists in this BOQ." });
    expect(coverageSignalToFindingInput(s).reason).toBe(s.reason);
    expect(coverageSignalToFindingInput(s).reason).not.toMatch(/confirmed/i);
  });

  it("packs provenance (source, key, document, evidence types, observation ids) into evidence", () => {
    const s = signal({ documentId: "doc-XYZ", normalizedKey: "w-12", evidenceTypes: ["physical", "schedule_entry"], observationIds: ["o1", "o2"] });
    const evidence = coverageSignalToFindingInput(s).evidence;
    expect(evidence).toContain(COVERAGE_FINDING_SOURCE);
    expect(evidence).toContain("w-12");
    expect(evidence).toContain("doc-XYZ");
    expect(evidence).toContain("physical");
    expect(evidence).toContain("schedule_entry");
    expect(evidence).toContain("o1");
    expect(evidence).toContain("o2");
  });

  it("never fabricates a quantity or a recommended value — the input type carries neither field", () => {
    const input = coverageSignalToFindingInput(signal());
    expect(input).not.toHaveProperty("recommendedValue");
    expect(input).not.toHaveProperty("quantity");
  });

  it("carries signalKey verbatim for later idempotent persistence", () => {
    const s = signal({ signalKey: "coverage¦boq-x¦doc-y¦z-1" });
    expect(coverageSignalToFindingInput(s).signalKey).toBe("coverage¦boq-x¦doc-y¦z-1");
  });

  it("does not mutate the input signal", () => {
    const s = Object.freeze(signal());
    expect(() => coverageSignalToFindingInput(s)).not.toThrow();
  });

  it("preserves both evidence types when a signal has both, rather than collapsing to one", () => {
    const s = signal({ evidenceTypes: ["physical", "schedule_entry"] });
    const evidence = coverageSignalToFindingInput(s).evidence;
    expect(evidence).toMatch(/physical.*schedule_entry|schedule_entry.*physical/);
  });
});
