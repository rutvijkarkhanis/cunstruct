import { describe, it, expect } from "vitest";
import { enrichMatchesWithLocation } from "./findSimilarLocationEnrichment";
import type { LocationObservation } from "./locationObservations";
import type { SimilarMatchV1 } from "./findSimilarSchemaV1";

function match(overrides: Partial<SimilarMatchV1> & { label: string }): SimilarMatchV1 {
  return { confidence: 0.8, evidence: [], ...overrides };
}
function obs(overrides: Partial<LocationObservation> & { id: string; mark: string | null }): LocationObservation {
  return {
    observationType: "opening", scopeHint: null, locationText: null, attributes: {},
    evidence: { evidence: [] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("enrichMatchesWithLocation", () => {
  it("1. no LOCATION data — every match gets null (M4 behavior unchanged)", () => {
    const matches = [match({ label: "Door" }), match({ label: "Window" })];
    expect(enrichMatchesWithLocation(matches, [])).toEqual([null, null]);
  });

  it("2. an AI match whose label exactly equals a stored mark is enriched", () => {
    const matches = [match({ label: "D1" })];
    const observations = [obs({ id: "o1", mark: "D1" })];
    expect(enrichMatchesWithLocation(matches, observations)).toEqual([{ mark: "D1", count: 1 }]);
  });

  it("matching is case/whitespace-insensitive, same as instancesForType's own rule", () => {
    const matches = [match({ label: " d1 " })];
    const observations = [obs({ id: "o1", mark: "D1" })];
    expect(enrichMatchesWithLocation(matches, observations)).toEqual([{ mark: "D1", count: 1 }]);
  });

  it("3. a LOCATION observation with no corresponding AI match never appears — only `matches` is iterated, never `observations`", () => {
    const matches = [match({ label: "Door" })];
    const observations = [obs({ id: "o1", mark: "W1" }), obs({ id: "o2", mark: "W2" })];
    const result = enrichMatchesWithLocation(matches, observations);
    expect(result).toEqual([null]); // "Door" matches neither W1 nor W2
    expect(result).toHaveLength(matches.length); // never introduces a result for an unmatched observation
  });

  it("4. an empty AI result stays empty regardless of LOCATION data — returns [] for [] matches", () => {
    const observations = [obs({ id: "o1", mark: "D1" }), obs({ id: "o2", mark: "W1" })];
    expect(enrichMatchesWithLocation([], observations)).toEqual([]);
  });

  it("5. an unrelated LOCATION observation (no label equals its mark) is ignored", () => {
    const matches = [match({ label: "Door" }), match({ label: "Window" })];
    const observations = [obs({ id: "o1", mark: "COLUMN-7" })];
    expect(enrichMatchesWithLocation(matches, observations)).toEqual([null, null]);
  });

  it("6. an ambiguous association (multiple observations share the matched mark) is reported honestly, never merged into one pick", () => {
    const matches = [match({ label: "D1" })];
    const observations = [obs({ id: "o1", mark: "D1" }), obs({ id: "o2", mark: "D1" }), obs({ id: "o3", mark: "D1" })];
    const result = enrichMatchesWithLocation(matches, observations);
    expect(result[0]).toEqual({ mark: "D1", count: 3 });
    // Never attaches a specific observation's own identity/evidence — only the mark string and a count.
    expect(result[0]).not.toHaveProperty("observation");
    expect(result[0]).not.toHaveProperty("observationId");
  });

  it("7. multiple distinct AI matches are enriched independently — one match's enrichment never leaks onto another", () => {
    const matches = [match({ label: "D1" }), match({ label: "Door" }), match({ label: "W1" })];
    const observations = [obs({ id: "o1", mark: "D1" }), obs({ id: "o2", mark: "W1" })];
    const result = enrichMatchesWithLocation(matches, observations);
    expect(result).toEqual([{ mark: "D1", count: 1 }, null, { mark: "W1", count: 1 }]);
  });

  it("8. multiple LOCATION observations never collapse distinct AI matches — the result array length always equals matches.length", () => {
    const matches = [match({ label: "D1" }), match({ label: "D1" }), match({ label: "D2" })];
    const observations = [obs({ id: "o1", mark: "D1" }), obs({ id: "o2", mark: "D1" }), obs({ id: "o3", mark: "D2" })];
    const result = enrichMatchesWithLocation(matches, observations);
    expect(result).toHaveLength(3); // two distinct "D1"-labeled matches both stay, neither is dropped or merged
    expect(result[0]).toEqual({ mark: "D1", count: 2 });
    expect(result[1]).toEqual({ mark: "D1", count: 2 });
    expect(result[2]).toEqual({ mark: "D2", count: 1 });
  });

  it("9. an AI match with no LOCATION observation at all gets null, unchanged from M4", () => {
    const matches = [match({ label: "Skylight" })];
    const observations = [obs({ id: "o1", mark: "D1" })];
    expect(enrichMatchesWithLocation(matches, observations)).toEqual([null]);
  });

  it("never matches a match with an empty label against a null-mark observation", () => {
    const matches = [match({ label: "" })];
    const observations = [obs({ id: "o1", mark: null })];
    expect(enrichMatchesWithLocation(matches, observations)).toEqual([null]);
  });
});
