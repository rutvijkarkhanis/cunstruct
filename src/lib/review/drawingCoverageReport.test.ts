import { describe, it, expect } from "vitest";
import { buildDrawingInventory, type DrawingTextRun } from "./drawingInventory";
import { reconcileRoomDimensions } from "./roomDimensionReconciliation";
import { buildDrawingCoverageReport, type CoverageObservation } from "./drawingCoverageReport";
import { parseObservationsV1 } from "./observationSchemaV1";
import { syntheticPlanText } from "./__fixtures__/syntheticPlanText";

// Invented two-page plan (see __fixtures__/syntheticPlanText.ts): page 1 has
// three W.R, page 2 two W.I.C, a Kitchen and a Lift; Store and Corridor have no size.
const inventory = buildDrawingInventory(syntheticPlanText("doc"));
const reconciliation = reconcileRoomDimensions(inventory);
const report = (obs: CoverageObservation[], diagnostics: Parameters<typeof buildDrawingCoverageReport>[3] = null) =>
  buildDrawingCoverageReport(inventory, reconciliation, obs, diagnostics);
const obs = (mark: string, page: number, scopeHint?: string, dimension?: string, bbox?: [number, number, number, number]): CoverageObservation => ({
  observationType: "room_or_space", mark, scopeHint, attributes: dimension ? { dimension } : {},
  source: { page, evidence: bbox ? [{ bbox, page }] : [] },
});

// A model-style output with no evidence boxes, room names as scope hints, and
// one item that is not a space.
const BOXLESS_RUN: CoverageObservation[] = [
  obs("W.R", 1, "Bedroom", `6'x5'`),
  obs("Dining", 1, "Dining Room", `14'x12'`),
  obs("Kitchen", 2, "Kitchen", `11'x9'`),
  { observationType: "finish_or_material", mark: "Plasma", scopeHint: "Living Room", attributes: {}, source: { page: 1, evidence: [] } },
  { observationType: "equipment", mark: "Lift", scopeHint: "Building Lift", attributes: { dimension: `8'x6'` }, source: { page: 2, evidence: [] } },
];

describe("coverage of a box-less run against the drawing's own text", () => {
  const r = report(BOXLESS_RUN);

  it("is provisional, never complete, and says why", () => {
    expect(r.status).toBe("provisional");
    expect(r.provisionalReasons).toContain("The parser's rejections for this run are not available, so rejected observations are unknown rather than zero.");
    expect(r.rejectionsKnown).toBe(false);
  });

  it("observed 3 of the drawing's labelled spaces; the box-less W.R can't be placed among three", () => {
    expect(r.observed.count).toBe(3);
    expect(r.observations.map((o) => o.outcome.status)).toEqual(["unresolved", "matched", "matched", "not_in_inventory", "matched"]);
    expect(r.observations[0].outcome).toEqual({ status: "unresolved", reason: `"W.R" appears 3 times on page 1, and the observation has no evidence box to say which.` });
    expect(r.notObserved).toHaveLength(r.spaces.total - 3);
  });

  it("flags every matched observation's floor label against the sheet title", () => {
    expect(r.conflicts.floorLabels.map((c) => [c.label, c.drawingFloor, c.observedFloor])).toEqual([
      ["DINING", "First Floor", "Dining Room"], ["KITCHEN", "Second Floor", "Kitchen"], ["LIFT", "Second Floor", "Building Lift"],
    ]);
    expect(r.conflicts.dimensions).toEqual([]);
  });

  it("every space with a printed size is ready for quantity; none is left ambiguous", () => {
    expect(r.spaces.ambiguous).toEqual([]);
    expect(r.spaces.dimensioned).toHaveLength(10);
    expect(r.readyForQuantity).toHaveLength(r.spaces.dimensioned.length);
    expect(r.unmatchedDimensions).toEqual([]);
  });
});

describe("buildDrawingCoverageReport — rules", () => {
  const wr = reconciliation.rooms.filter((x) => x.page === 1 && x.label === "W.R");

  it("two boxed observations of the same W.R are a duplicate; two of different W.R are two spaces", () => {
    const r = report([obs("W.R", 1, "First Floor", undefined, wr[0].box), obs("W.R", 1, "First Floor", undefined, wr[0].box), obs("W.R", 1, "First Floor", undefined, wr[1].box)]);
    expect(r.observations.map((o) => o.outcome.status)).toEqual(["matched", "duplicate", "matched"]);
    expect(r.observed.count).toBe(2);
  });

  it("boxes in a declared, scaled page space are normalised before locating", () => {
    const scaled: CoverageObservation = { ...obs("W.R", 1, "First Floor"), source: { page: 1, pageSize: { width: 1190, height: 1684 }, evidence: [{ bbox: wr[2].box.map((v) => v * 2) as [number, number, number, number], page: 1 }] } };
    const r = report([scaled]);
    expect(r.observations[0].outcome).toEqual({ status: "matched", roomId: wr[2].candidateId, via: "location" });
  });

  it("an observation on the wrong page is not matched to a same-named space on another page", () => {
    expect(report([obs("Kitchen", 1, "First Floor")]).observations[0].outcome.status).toBe("not_in_inventory");
  });

  it("a dimension that disagrees with the drawing is a conflict; formatting differences are not", () => {
    const bedroom = reconciliation.rooms.find((x) => x.page === 1 && x.label === "BEDROOM")!;
    const r = report([obs("Bedroom", 1, "First Floor", `12'x10'`, bedroom.box), obs("Dining", 1, "First Floor", `14' X 13'`)]);
    expect(r.conflicts.dimensions.map((c) => [c.label, c.drawingDimension, c.observedDimension])).toEqual([["DINING", `14' X 12'`, `14' X 13'`]]);
    expect(r.conflicts.floorLabels).toEqual([]);
  });

  it("carries the parser's rejections and unpinned observations when supplied", () => {
    const parsed = parseObservationsV1(JSON.stringify({ observations: [
      { observation_type: "room_or_space", mark: "Study", evidence_completeness: "FULL", source: { page: 1, evidence: [] } },
    ] }));
    const r = report([], { ...parsed.diagnostics!, unpinned: [{ index: 0, observationType: "room_or_space", mark: "Lift" }] });
    expect(r.rejectionsKnown).toBe(true);
    expect(r.rejected.map((x) => [x.mark, x.reason])).toEqual([["Study", "no_valid_evidence"]]);
    expect(r.unpinned.map((x) => x.mark)).toEqual(["Lift"]);
    expect(r.observed.count).toBe(0);
  });

  it("with no text layer at all, coverage is unavailable, not 100%", () => {
    const inv = buildDrawingInventory([{ documentId: "d", page: 1, pageSize: { width: 595, height: 842 }, textLayer: "absent", runs: [] }]);
    const r = buildDrawingCoverageReport(inv, reconcileRoomDimensions(inv), [obs("Kitchen", 1)], null);
    expect(r.status).toBe("unavailable");
    expect(r.observed).toMatchObject({ count: 0, of: 0 });
    expect(r.provisionalReasons).toContain("Page 1 has no text layer (scanned or raster) — its spaces are unknown.");
  });

  it("sheet-title conflicts are reported and the page's spaces get no floor", () => {
    const run = (text: string, x: number, y: number): DrawingTextRun => ({ text, origin: [x, y], direction: [1, 0], width: 60, height: 6 });
    const inv = buildDrawingInventory([{ documentId: "d", page: 1, pageSize: { width: 595, height: 842 }, textLayer: "available", runs: [run("FIRST FLOOR PLAN", 10, 800), run("SECOND FLOOR PLAN", 300, 800), run("KITCHEN", 100, 100)] }]);
    const r = buildDrawingCoverageReport(inv, reconcileRoomDimensions(inv), [], null);
    expect(r.conflicts.pageFloors).toEqual([{ page: 1, floors: ["First Floor", "Second Floor"] }]);
    expect(r.spaces.noDimension[0].floor).toBeNull();
  });
});
