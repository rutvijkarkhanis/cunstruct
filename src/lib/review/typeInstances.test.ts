import { describe, it, expect } from "vitest";
import { instancesForType } from "./typeInstances";
import type { LocationObservation } from "./locationObservations";

function obs(overrides: Partial<LocationObservation> & { id: string; mark: string }): LocationObservation {
  return {
    observationType: "opening",
    scopeHint: null,
    locationText: null,
    attributes: {},
    evidence: { evidence: [{ bbox: [0, 0, 1, 1] }] },
    evidenceCompleteness: "FULL",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("instancesForType", () => {
  it("maps observations to a type by matching mark, case/whitespace-insensitively", () => {
    const observations = [
      obs({ id: "1", mark: "W1" }),
      obs({ id: "2", mark: " w1 " }),
      obs({ id: "3", mark: "W2" }),
    ];
    const result = instancesForType({ key: "W1" }, observations);
    expect(result.map((r) => r.observation.id)).toEqual(["1", "2"]);
  });

  it("returns no instances (not undefined) when the type has no key", () => {
    expect(instancesForType({ key: "" }, [obs({ id: "1", mark: "W1" })])).toEqual([]);
  });

  it("returns no instances when nothing matches — never fabricates a placement", () => {
    expect(instancesForType({ key: "W9" }, [obs({ id: "1", mark: "W1" })])).toEqual([]);
  });

  it("flags an instance whose observed dimension genuinely disagrees with the type's declared dimension", () => {
    const observations = [obs({ id: "1", mark: "W1", attributes: { dimension: "4' x 5'" } })];
    const result = instancesForType({ key: "W1", dimension: "3' x 4'" }, observations);
    expect(result[0].differsFromType).toBe(true);
  });

  it("does not flag a difference when the observation states no dimension of its own", () => {
    const observations = [obs({ id: "1", mark: "W1", attributes: {} })];
    const result = instancesForType({ key: "W1", dimension: "3' x 4'" }, observations);
    expect(result[0].differsFromType).toBe(false);
  });

  it("does not flag a difference when the two dimensions match, ignoring case/whitespace", () => {
    const observations = [obs({ id: "1", mark: "W1", attributes: { dimension: " 3' X 4' " } })];
    const result = instancesForType({ key: "W1", dimension: "3' x 4'" }, observations);
    expect(result[0].differsFromType).toBe(false);
  });

  it("flags a specification disagreement independently of dimension", () => {
    const observations = [obs({ id: "1", mark: "W1", attributes: { specification: "Aluminium" } })];
    const result = instancesForType({ key: "W1", specification: "UPVC" }, observations);
    expect(result[0].differsFromType).toBe(true);
  });
});
