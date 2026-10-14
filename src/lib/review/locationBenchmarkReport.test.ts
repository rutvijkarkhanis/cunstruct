import { describe, it, expect } from "vitest";
import { buildLocationBenchmarkReport } from "./locationBenchmarkReport";
import { parseObservationsV1 } from "./observationSchemaV1";
import { SYNTHETIC_PLAN_REFERENCE as REF } from "./__fixtures__/syntheticPlanText";

// A synthetic response shaped like a new run (boxes present), scored against the
// invented plan's reference — exercises parser diagnostics, location pairing,
// duplicates, and a matched room reported without a dimension.
describe("buildLocationBenchmarkReport — a run with evidence boxes and parse diagnostics", () => {
  const at = (mark: string, floor: string, i = 0) => REF.filter((e) => e.mark === mark && e.scopeHint === floor)[i];
  const obs = (mark: string, floor: string, i: number, dimension: string | null, completeness = "FULL") => {
    const e = at(mark, floor, i);
    return {
      observation_type: "room_or_space", mark, scope_hint: floor, evidence_completeness: completeness,
      attributes: dimension ? { dimension } : {},
      source: { page: e.expectedPage, evidence: [{ bbox: e.expectedBox!.bbox, page: e.expectedPage }] },
    };
  };
  const raw = JSON.stringify({ schema_version: "cunstruct.observation.v1", observations: [
    obs("W.R", "First Floor", 1, `7' X 5'6"`),      // as printed on the drawing
    obs("W.R", "First Floor", 0, `6' X 5'`),
    obs("W.R", "First Floor", 0, `6' X 5'`),        // same box again: a true duplicate
    obs("Kitchen", "Second Floor", 0, null),         // matched, dimension not reported
    { observation_type: "room_or_space", mark: "Study", scope_hint: "First Floor", evidence_completeness: "FULL", source: { page: 1, evidence: [] } },
  ] });
  const parsed = parseObservationsV1(raw);
  const report = buildLocationBenchmarkReport(REF, parsed.observations!, parsed.diagnostics!);

  it("pairs repeated W.R by location and grades each against its own dimension", () => {
    expect(report.matched.filter((m) => m.mark === "W.R").map((m) => [m.expectedDimension, m.dimensionCorrect])).toEqual([
      ["6'x5'", true], ["7'x5'6\"", true],
    ]);
    expect(report.dimensions.notReported.map((m) => m.mark)).toEqual(["Kitchen"]);
  });

  it("reports the duplicate copy as both a duplicate and an extra", () => {
    expect(report.duplicates.map((d) => d.index)).toEqual([1, 2]);
    expect(report.extras.map((x) => x.index)).toEqual([2]);
  });

  it("carries the parser's rejection of the box-less Study, and has nothing it can't compute", () => {
    expect(report.parser?.rejected).toEqual([expect.objectContaining({ reason: "no_valid_evidence", mark: "Study", recoverable: true })]);
    expect(report.floorLabels).toEqual({ correct: 4, of: 4 });
    expect(report.notComputable).toEqual([]);
  });
});
