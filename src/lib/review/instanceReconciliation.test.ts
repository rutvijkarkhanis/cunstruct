import { describe, it, expect } from "vitest";
import { reconcileInstances, type ReconciliationInput } from "./instanceReconciliation";

/** A fully-specified, GREEN-eligible countable baseline — each test
 *  overrides exactly the field(s) its scenario is about, so a failure
 *  points at the one rule under test rather than an unrelated omission. */
function countableInput(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    countable: true,
    expectedQuantity: 7,
    locationRan: true,
    physicalLocatedCount: 7,
    hasScheduleEntry: true,
    hasEvidence: true,
    criticalReasons: [],
    explicitlyFlagged: false,
    ...overrides,
  };
}

describe("reconcileInstances — countable items", () => {
  it("exact match + schedule evidence + no critical reasons -> GREEN (W2: expected 3, located 3, schedule yes)", () => {
    expect(reconcileInstances(countableInput({ expectedQuantity: 3, physicalLocatedCount: 3 }))).toBe("GREEN");
  });

  it("mismatch + schedule evidence -> AMBER, never GREEN (W1: expected 7, located 6, schedule yes)", () => {
    expect(reconcileInstances(countableInput({ expectedQuantity: 7, physicalLocatedCount: 6, hasScheduleEntry: true }))).toBe("AMBER");
  });

  it("exact match + NO schedule evidence -> AMBER, not independently verified (W1: expected 7, located 7, schedule no)", () => {
    expect(reconcileInstances(countableInput({ expectedQuantity: 7, physicalLocatedCount: 7, hasScheduleEntry: false }))).toBe("AMBER");
  });

  it("LOCATION has not run -> AMBER, regardless of how clean everything else looks", () => {
    expect(reconcileInstances(countableInput({ locationRan: false }))).toBe("AMBER");
  });

  it("a resolvable AI conflict (non-empty criticalReasons) holds GREEN back even with a perfect count+schedule match", () => {
    expect(reconcileInstances(countableInput({ criticalReasons: ["Conflicting sources (2 candidates)"] }))).toBe("AMBER");
  });

  it("no expected quantity -> RED", () => {
    expect(reconcileInstances(countableInput({ expectedQuantity: null }))).toBe("RED");
  });

  it("no usable evidence -> RED", () => {
    expect(reconcileInstances(countableInput({ hasEvidence: false }))).toBe("RED");
  });

  it("explicit conflict/flag (reviewer-flagged) -> RED, even with a perfect count+schedule match", () => {
    expect(reconcileInstances(countableInput({ explicitlyFlagged: true }))).toBe("RED");
  });

  it("RED (missing quantity) takes priority over every AMBER-only condition", () => {
    expect(reconcileInstances(countableInput({ expectedQuantity: null, locationRan: false, hasScheduleEntry: false }))).toBe("RED");
  });
});

describe("reconcileInstances — non-countable items", () => {
  it("usable evidence + no critical reason -> GREEN (no instance count invented)", () => {
    const input: ReconciliationInput = {
      countable: false, expectedQuantity: 450, locationRan: false, physicalLocatedCount: 0,
      hasScheduleEntry: false, hasEvidence: true, criticalReasons: [], explicitlyFlagged: false,
    };
    expect(reconcileInstances(input)).toBe("GREEN");
  });

  it("a critical reason holds a non-countable item at AMBER, never RED by itself", () => {
    const input: ReconciliationInput = {
      countable: false, expectedQuantity: 450, locationRan: false, physicalLocatedCount: 0,
      hasScheduleEntry: false, hasEvidence: true, criticalReasons: ["Low confidence"], explicitlyFlagged: false,
    };
    expect(reconcileInstances(input)).toBe("AMBER");
  });

  it("missing quantity is RED for a non-countable item too — the RED checks apply uniformly", () => {
    const input: ReconciliationInput = {
      countable: false, expectedQuantity: null, locationRan: false, physicalLocatedCount: 0,
      hasScheduleEntry: false, hasEvidence: true, criticalReasons: [], explicitlyFlagged: false,
    };
    expect(reconcileInstances(input)).toBe("RED");
  });

  it("missing evidence is RED for a non-countable item too", () => {
    const input: ReconciliationInput = {
      countable: false, expectedQuantity: 450, locationRan: false, physicalLocatedCount: 0,
      hasScheduleEntry: false, hasEvidence: false, criticalReasons: [], explicitlyFlagged: false,
    };
    expect(reconcileInstances(input)).toBe("RED");
  });

  it("locationRan/physicalLocatedCount/hasScheduleEntry are never consulted for a non-countable item", () => {
    // Deliberately "wrong-looking" location fields — must have zero effect.
    const input: ReconciliationInput = {
      countable: false, expectedQuantity: 450, locationRan: true, physicalLocatedCount: 999,
      hasScheduleEntry: false, hasEvidence: true, criticalReasons: [], explicitlyFlagged: false,
    };
    expect(reconcileInstances(input)).toBe("GREEN");
  });
});
