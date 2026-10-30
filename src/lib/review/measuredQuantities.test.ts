import { describe, it, expect } from "vitest";
import { buildDrawingInventory, type DrawingTextRun } from "./drawingInventory";
import { reconcileRoomDimensions, type ReconciledRoom } from "./roomDimensionReconciliation";
import { measuredQuantitiesFor, toAnalysisPayload } from "./measuredQuantities";
import { parseAnalysisV1 } from "./analysisSchemaV1";
import { validateItemCalculation } from "./calculationAdvisory";
import { syntheticPlanText } from "./__fixtures__/syntheticPlanText";

// Invented plan (see __fixtures__/syntheticPlanText.ts).
const rooms = reconcileRoomDimensions(buildDrawingInventory(syntheticPlanText("doc-plan"))).rooms;
const room = (page: number, label: string, i = 0) => rooms.filter((r) => r.page === page && r.label === label)[i];

describe("measuredQuantitiesFor — only reconciled, evidenced sizes become quantities", () => {
  it("Lift 8' × 6' on the Second Floor: 96 in × 72 in = 4.4593... m², rounded to 4.46, with the unrounded value kept", () => {
    const [q] = measuredQuantitiesFor([room(2, "LIFT")]);
    expect(q.status).toBe("ready");
    expect(q.quantity).toBe(4.46);
    expect(q.unroundedQuantity).toBeCloseTo(96 * 72 * 0.0254 ** 2, 12);
    expect(q.calculation.inputs.map((i) => [i.name, i.value, i.unit])).toEqual([["length", 96, "in"], ["width", 72, "in"]]);
    expect(q.description).toBe("Floor area — LIFT (Second Floor)");
  });
  it("in ft², the same lift is 48.00 (96 × 72 / 144 = 48 exactly)", () => {
    expect(measuredQuantitiesFor([room(2, "LIFT")], { unit: "sqft" })[0].quantity).toBe(48);
  });
  it("each repeated W.R gets the area of its own printed size", () => {
    const qs = measuredQuantitiesFor(rooms.filter((r) => r.page === 1 && r.label === "W.R"), { unit: "sqft" });
    expect(qs.map((q) => q.quantity).sort((a, b) => a! - b!)).toEqual([30, 30, 38.5]);
  });
  it("a space with no printed size stays pending with a null quantity, never zero", () => {
    const [q] = measuredQuantitiesFor([room(2, "CORRIDOR")]);
    expect(q).toMatchObject({ status: "pending", quantity: null, unroundedQuantity: null, pendingReason: "No dimension is printed beneath this label." });
  });
  it("ambiguous and medium-confidence matches stay pending", () => {
    const base = room(2, "LIFT");
    const ambiguous: ReconciledRoom = { ...base, status: "ambiguous", dimension: undefined, confidence: undefined, reason: "Several dimensions are printed beneath this label with no clear nearest." };
    const medium: ReconciledRoom = { ...base, confidence: "medium" };
    expect(measuredQuantitiesFor([ambiguous, medium]).map((q) => [q.status, q.quantity, q.pendingReason])).toEqual([
      ["pending", null, "Several dimensions are printed beneath this label with no clear nearest."],
      ["pending", null, "The dimension match is only medium confidence; confirm it first."],
    ]);
  });

  it("a length with no printed unit is not assumed; mixed metric units are converted", () => {
    const run = (text: string, y: number): DrawingTextRun => ({ text, origin: [100, y], direction: [1, 0], width: 40, height: 6 });
    const rec = (dim: string) => reconcileRoomDimensions(buildDrawingInventory([{ documentId: "d", page: 1, pageSize: { width: 595, height: 842 }, textLayer: "available", runs: [run("STORE", 100), run(dim, 108)] }])).rooms;
    expect(measuredQuantitiesFor(rec("3.5 x 4.2 m"))[0]).toMatchObject({ status: "pending", quantity: null, pendingReason: `No unit is printed for "3.5"; it is not assumed.` });
    expect(measuredQuantitiesFor(rec("3500mm x 4.2m"))[0]).toMatchObject({ status: "ready", quantity: 14.7 });
  });
});

describe("toAnalysisPayload — provenance survives the existing analysis import", () => {
  const qs = measuredQuantitiesFor([room(2, "LIFT"), room(2, "CORRIDOR")]);
  const parsed = parseAnalysisV1(JSON.stringify(toAnalysisPayload(qs)));

  it("parses with the existing parser, keeping document, page and both evidence regions", () => {
    expect(parsed.ok).toBe(true);
    const [lift] = parsed.analysis!.items;
    expect(lift.source).toMatchObject({ documentId: "doc-plan", page: 2 });
    expect(lift.source!.evidence.map((e) => [e.claim, e.label, e.page])).toEqual([["location", "LIFT", 2], ["dimension", `8' X 6'`, 2]]);
    expect(lift.dimension).toBe(`8' X 6'`);
    expect(lift.location).toBe("Second Floor");
  });

  it("the ready item is MEASURED with calculation data the existing validator recomputes; it never reports a mismatch", () => {
    const [lift] = parsed.analysis!.items;
    expect(lift.aiStatus).toBe("MEASURED");
    expect(lift.calculationData).toEqual({ formula: "LENGTH_TIMES_WIDTH", inputs: [{ name: "length", value: 96, unit: "in" }, { name: "width", value: 72, unit: "in" }] });
    const v = validateItemCalculation(lift)!;
    expect(v.calculation.resultValue).toBeCloseTo(qs[0].unroundedQuantity!, 12);
    expect(v.comparison!.outcome).not.toBe("MISMATCH");
  });

  it("the pending item stays PENDING with no quantity and no calculation data", () => {
    const corridor = parsed.analysis!.items[1];
    expect(corridor).toMatchObject({ aiStatus: "PENDING", quantity: null });
    expect(corridor.calculationData).toBeUndefined();
    expect(corridor.notes).toBe("Pending: No dimension is printed beneath this label.");
  });
});

describe("unitless sizes become areas only with established units", () => {
  const rec = (texts: string[]) => reconcileRoomDimensions(buildDrawingInventory([{
    documentId: "d", page: 1, pageSize: { width: 1191, height: 842 }, textLayer: "available",
    runs: texts.map((t, i) => ({ text: t, origin: [100, i === 0 ? 700 : 100 + (i - 1) * 8] as [number, number], direction: [1, 0] as [number, number], width: 44, height: 6 })),
  }])).rooms;

  it("with an mm note: BED ROOM 3500 X 3850 → 13.48 sqm, from 3.5 m × 3.85 m", () => {
    const [q] = measuredQuantitiesFor(rec(["ALL DIMENSIONS ARE IN MM", "BED ROOM", "3500 X 3850"]));
    expect(q).toMatchObject({ status: "ready", quantity: 13.48 });
    expect(q.unroundedQuantity).toBeCloseTo(13.475, 9);
    expect(q.calculation.inputs.map((i) => [i.value, i.unit])).toEqual([[3500, "mm"], [3850, "mm"]]);
  });

  it("without a note the room is paired with its size but stays pending, with the reason, and no quantity", () => {
    const rooms = rec(["SCALE 1:100", "BED ROOM", "3500 X 3850"]);
    expect(rooms[0]).toMatchObject({ status: "dimensioned", dimension: { text: "3500 X 3850" } });
    expect(measuredQuantitiesFor(rooms)[0]).toMatchObject({
      status: "pending", quantity: null,
      pendingReason: "Units not established: No unit is printed with this size, and this page has no note stating the dimension unit.",
    });
  });
});

describe("a printed size that can't be a room is held, not priced", () => {
  const rec = (texts: string[]) => reconcileRoomDimensions(buildDrawingInventory([{
    documentId: "d", page: 1, pageSize: { width: 1191, height: 842 }, textLayer: "available",
    runs: texts.map((t, i) => ({ text: t, origin: [100, i === 0 ? 700 : 100 + (i - 1) * 8] as [number, number], direction: [1, 0] as [number, number], width: 44, height: 6 })),
  }])).rooms;

  // Regression from a real development drawing: a room tag printed "7000M X 7000M"
  // on a sheet noted "ALL DIMENSIONS ARE IN MILLIMETERS" was priced at 49,000,000 m².
  it("a metre suffix that contradicts the page's millimetre note is held with both readings", () => {
    const [q] = measuredQuantitiesFor(rec(["ALL DIMENSIONS ARE IN MILLIMETERS", "COMMON ROOM", "7000M X 7000M"]));
    expect(q).toMatchObject({ status: "pending", quantity: null, unroundedQuantity: null });
    expect(q.pendingReason).toContain("7,000 m × 7,000 m, which is not a plausible room size");
    expect(q.pendingReason).toContain("states mm, which would give 7 m × 7 m (49 m²)");
  });

  it("the same impossible size with no note is held too, without a substitute", () => {
    const [q] = measuredQuantitiesFor(rec(["SCALE 1:100", "COMMON ROOM", "7000M X 7000M"]));
    expect(q).toMatchObject({ status: "pending", quantity: null });
    expect(q.pendingReason).toBe('"7000M X 7000M" reads as 7,000 m × 7,000 m, which is not a plausible room size. Check the printed unit before this area is used.');
  });

  it("a printed metre size on a millimetre-noted sheet is kept when it is plausible (the printed unit wins)", () => {
    const [q] = measuredQuantitiesFor(rec(["ALL DIMENSIONS ARE IN MILLIMETERS", "BED ROOM", "3.5M X 4.2M"]));
    expect(q).toMatchObject({ status: "ready", quantity: 14.7 });
  });

  it("small but real spaces stay measurable", () => {
    const [q] = measuredQuantitiesFor(rec(["ALL DIMENSIONS ARE IN MM", "STORE", "900 X 1200"]));
    expect(q).toMatchObject({ status: "ready", quantity: 1.08 });
  });
});

describe("a services drawing of a plan does not add its rooms' areas again", () => {
  const page = (n: number, texts: [string, number, number][]) => ({
    documentId: "d", page: n, pageSize: { width: 1191, height: 842 }, textLayer: "available" as const,
    runs: texts.map(([t, x, y]) => ({ text: t, origin: [x, y] as [number, number], direction: [1, 0] as [number, number], width: 44, height: 6 })),
  });
  const plan: [string, number, number][] = [["ALL DIMENSIONS ARE IN MM", 900, 800], ["GROUND FLOOR PLAN", 900, 780], ["CLASS ROOM", 100, 100], ["7000 X 7000", 100, 108]];

  // Regression from a real development drawing: the electrical layouts of four
  // floors were measured as more floor area on top of the architectural plans.
  it("rooms on an ELECTRICAL LAYOUT sheet are held with the reason; the plan's rooms are measured", () => {
    const rooms = reconcileRoomDimensions(buildDrawingInventory([page(1, plan), page(2, [["ELECTRICAL LAYOUT OF", 900, 760], ...plan])])).rooms;
    const q = measuredQuantitiesFor(rooms);
    expect(q.map((x) => [x.provenance.page, x.status, x.quantity])).toEqual([[1, "ready", 49], [2, "pending", null]]);
    expect(q[1].pendingReason).toContain("electrical drawing (\"ELECTRICAL LAYOUT OF\")");
  });

  it("a note that only mentions a services drawing does not change an architectural plan", () => {
    const rooms = reconcileRoomDimensions(buildDrawingInventory([page(1, [["REFER ELECTRICAL LAYOUT FOR POINTS", 900, 700], ...plan])])).rooms;
    expect(measuredQuantitiesFor(rooms)[0]).toMatchObject({ status: "ready", quantity: 49 });
  });
});

