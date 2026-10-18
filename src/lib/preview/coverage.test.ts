// SYNTHETIC drawing items only; not detections from any real drawing.
import { describe, expect, it } from "vitest";
import { coverageGaps, coverageStatus, reopenGap, resolveGap, type CoverageInput } from "./coverage";

const INPUT: CoverageInput = {
  legend: [{ id: "WC", label: "WC symbol" }, { id: "D1", label: "Door D1" }],
  regions: [
    { id: "R1", label: "Kitchen", detections: 3 },
    { id: "R2", label: "Store", detections: 0 },
    { id: "R3", label: "Balcony", detections: 0 },
  ],
  expectedScope: [{ id: "WP", label: "Terrace waterproofing" }, { id: "PL", label: "Internal plaster" }],
  lines: [
    { id: "L1", legendIds: ["D1"], regionIds: ["R1", "R3"], scopeIds: ["PL"] },
  ],
};
const by = { by: "Owner (demo)", at: "2026-10-18" };

describe("coverageGaps", () => {
  it("lists legend items with no line, regions with no detection and no line, and missing expected scope", () => {
    expect(coverageGaps(INPUT).map((g) => [g.id, g.kind, g.label])).toEqual([
      ["legend:WC", "legend", "WC symbol"],
      ["region:R2", "region", "Store"], // R3 has no detection but a line covers it; R1 has detections
      ["scope:WP", "scope", "Terrace waterproofing"],
    ]);
  });

  it("no gaps when everything is linked", () => {
    expect(coverageGaps({ ...INPUT, lines: [{ id: "L", legendIds: ["WC", "D1"], regionIds: ["R2", "R3"], scopeIds: ["WP", "PL"] }] })).toEqual([]);
  });
});

describe("resolving gaps before certification", () => {
  it("is cleared only when every gap is resolved or excluded with a reason", () => {
    let g = coverageGaps(INPUT);
    expect(coverageStatus(g)).toEqual({ open: 3, resolved: 0, excluded: 0, cleared: false });
    g = resolveGap(g, "legend:WC", { type: "resolved", reason: "Line L9 added", ...by });
    g = resolveGap(g, "region:R2", { type: "excluded", reason: "Store is outside the contract", ...by });
    expect(coverageStatus(g).cleared).toBe(false);
    g = resolveGap(g, "scope:WP", { type: "excluded", reason: "Client supplies waterproofing", ...by });
    expect(coverageStatus(g)).toEqual({ open: 0, resolved: 1, excluded: 2, cleared: true });
    expect(coverageStatus(reopenGap(g, "scope:WP")).cleared).toBe(false);
  });

  it("refuses an exclusion without a reason, a resolution without a person, and an unknown gap", () => {
    const g = coverageGaps(INPUT);
    expect(() => resolveGap(g, "scope:WP", { type: "excluded", reason: "  ", ...by })).toThrow(/written reason/);
    expect(() => resolveGap(g, "scope:WP", { type: "excluded", reason: "x", by: "", at: "t" })).toThrow(/person/);
    expect(() => resolveGap(g, "scope:XX", { type: "excluded", reason: "x", ...by })).toThrow(/No coverage gap/);
  });
});
