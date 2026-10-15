// Door / window / ventilator schedules print sizes in the same "W x H" form
// as room sizes, often beneath a description that contains a room word
// ("TOILET DOOR"). Those sizes must never become room areas — even on a page
// whose units ARE established by a note.
import { describe, it, expect } from "vitest";
import { buildDrawingInventory, type DrawingTextRun } from "./drawingInventory";
import { reconcileRoomDimensions } from "./roomDimensionReconciliation";
import { measuredQuantitiesFor } from "./measuredQuantities";

const run = (text: string, x: number, y: number, width = 30, height = 6): DrawingTextRun =>
  ({ text, origin: [x, y], direction: [1, 0], width, height });

// A plan with one real room, and a schedule: mark column, description, size beneath it.
const RUNS: DrawingTextRun[] = [
  run("ALL DIMENSIONS ARE IN MM", 300, 30, 120),
  run("KITCHEN", 100, 100, 40),
  run("3000 x 2400", 95, 108, 50),
  run("DOOR & WINDOW SCHEDULE", 300, 300, 120),
  run("D1", 300, 320, 10), run("TOILET DOOR", 330, 320, 55), run("900 x 2100", 330, 328, 50),
  run("W1", 300, 345, 10), run("KITCHEN WINDOW", 330, 345, 65), run("1200 x 900", 330, 353, 50),
  run("V1", 300, 370, 10), run("BATH VENTILATOR", 330, 370, 70), run("600 x 450", 330, 378, 45),
];
const SCHEDULE_SIZES = ["900 x 2100", "1200 x 900", "600 x 450"];

const evaluate = (runs: DrawingTextRun[]) => {
  const inventory = buildDrawingInventory([{ documentId: "doc", page: 1, pageSize: { width: 595, height: 842 }, textLayer: "available", runs }]);
  const reconciliation = reconcileRoomDimensions(inventory);
  return { inventory, reconciliation, quantities: measuredQuantitiesFor(reconciliation.rooms) };
};

describe("opening schedules are not room measurements", () => {
  const { inventory, reconciliation, quantities } = evaluate(RUNS);
  const byText = (t: string) => inventory.candidates.find((c) => c.text === t)!;

  it("units are established on this page, so only the schedule rule stands between these sizes and an area", () => {
    for (const t of SCHEDULE_SIZES) expect(byText(t).dimension!.unitBasis).toMatchObject({ kind: "page_note" });
  });

  it("schedule sizes are opening sizes, each with the structure that shows it", () => {
    for (const t of SCHEDULE_SIZES) expect(byText(t)).toMatchObject({ kind: "opening_size", opening: { reason: expect.any(String) } });
    expect(byText("900 x 2100").opening!.reason).toContain("TOILET DOOR");
  });

  it("descriptions naming an opening are kept, as openings — not as spaces and not dropped", () => {
    for (const t of ["TOILET DOOR", "KITCHEN WINDOW", "BATH VENTILATOR"]) {
      expect(byText(t)).toMatchObject({ kind: "opening_label", opening: { reason: expect.stringContaining(t) } });
      expect(byText(t).spaceClass).toBeUndefined();
    }
  });

  it("no schedule size reaches a room, an unmatched room-size list, or a ready quantity", () => {
    const used = reconciliation.rooms.flatMap((r) => [r.dimension?.text, ...r.alternatives.map((a) => a.text)]);
    for (const t of SCHEDULE_SIZES) expect(used).not.toContain(t);
    expect(reconciliation.unmatchedDimensions).toEqual([]);
    expect(quantities.filter((q) => q.status === "ready").map((q) => [q.description, q.quantity])).toEqual([["Floor area — KITCHEN (page 1)", 7.2]]);
    expect(quantities.every((q) => !SCHEDULE_SIZES.includes(q.provenance.dimension?.text ?? ""))).toBe(true);
  });

  it("the real room keeps its own size and its unit from the page note", () => {
    expect(reconciliation.rooms.map((r) => [r.label, r.status, r.dimension?.text ?? null])).toEqual([["KITCHEN", "dimensioned", "3000 x 2400"]]);
  });
});

describe("when the structure can't settle it, the label stays unresolved with a reason", () => {
  // A schedule row whose description is only a room name: "W2 | KITCHEN", size beneath.
  const { inventory, reconciliation, quantities } = evaluate([
    run("ALL DIMENSIONS ARE IN MM", 300, 30, 120),
    run("W2", 300, 400, 10), run("KITCHEN", 330, 400, 35), run("1200 x 1200", 330, 408, 50),
  ]);

  it("the label is kept as a space but marked as sitting on a schedule row", () => {
    const [room] = reconciliation.rooms;
    expect(room).toMatchObject({ label: "KITCHEN", status: "ambiguous", alternatives: [] });
    expect(room.dimension).toBeUndefined();
    expect(room.reason).toContain("W2");
  });

  it("the size beneath it is an opening size, and no area is produced", () => {
    expect(inventory.candidates.find((c) => c.text === "1200 x 1200")).toMatchObject({ kind: "opening_size" });
    expect(quantities.map((q) => [q.status, q.quantity])).toEqual([["pending", null]]);
  });
});

describe("ordinary plans are unchanged", () => {
  it("a door tag elsewhere on the page doesn't affect a room's own size", () => {
    const { reconciliation, quantities } = evaluate([
      run("ALL DIMENSIONS ARE IN MM", 300, 30, 120),
      run("TOILET", 100, 100, 30), run("1350 x 980", 95, 108, 45), run("D2", 200, 140, 10),
    ]);
    expect(reconciliation.rooms.map((r) => [r.label, r.status, r.dimension?.text])).toEqual([["TOILET", "dimensioned", "1350 x 980"]]);
    expect(quantities[0]).toMatchObject({ status: "ready", quantity: 1.32 });
  });

  it("a room whose only size beneath it is an opening size says so, rather than 'no dimension printed'", () => {
    const { reconciliation } = evaluate([
      run("BED ROOM", 100, 100, 45),
      run("TOILET DOOR", 100, 106, 50), run("900 x 2100", 100, 114, 50),
    ]);
    const bed = reconciliation.rooms.find((r) => r.label === "BED ROOM")!;
    expect(bed).toMatchObject({ status: "ambiguous", alternatives: [] });
    expect(bed.reason).toContain("900 x 2100");
  });
});
