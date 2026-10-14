import { describe, it, expect } from "vitest";
import { buildDrawingInventory, labelKey, type DrawingTextRun } from "./drawingInventory";
import { reconcileRoomDimensions } from "./roomDimensionReconciliation";
import { normalizeDimension } from "./observationBenchmarkScorer";
import { syntheticPlanText, SYNTHETIC_PLAN_REFERENCE } from "./__fixtures__/syntheticPlanText";

const run = (text: string, x: number, y: number, width = 30, height = 6, direction: [number, number] = [1, 0]): DrawingTextRun =>
  ({ text, origin: [x, y], direction, width, height });
const reconcile = (runs: DrawingTextRun[], pages: number[] = runs.map(() => 1)) => {
  const byPage = new Map<number, DrawingTextRun[]>();
  runs.forEach((r, i) => byPage.set(pages[i], [...(byPage.get(pages[i]) ?? []), r]));
  return reconcileRoomDimensions(buildDrawingInventory([...byPage].map(([page, rs]) => ({
    documentId: "doc", page, pageSize: { width: 595, height: 842 }, textLayer: "available" as const, runs: rs,
  }))));
};
const roomsByLabel = (r: ReturnType<typeof reconcile>) => r.rooms.map((x) => [x.label, x.status, x.dimension?.text ?? null]);

describe("reconcileRoomDimensions — a whole plan against its reference", () => {
  // Invented plan and reference (see __fixtures__/syntheticPlanText.ts).
  const rec = reconcileRoomDimensions(buildDrawingInventory(syntheticPlanText("plan")));
  const centre = (b: number[]) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

  it("every reference room is found at its own location, on its own floor, with its own dimension", () => {
    const results = SYNTHETIC_PLAN_REFERENCE.map((e) => {
      const [ex, ey] = centre(e.expectedBox!.bbox);
      const nearest = rec.rooms
        .filter((r) => r.page === e.expectedPage && labelKey(r.label) === labelKey(e.mark))
        .map((r) => ({ r, d: Math.hypot(centre(r.box)[0] - ex, centre(r.box)[1] - ey) }))
        .sort((a, b) => a.d - b.d)[0];
      return {
        id: e.id,
        found: !!nearest && nearest.d < 5,
        floor: nearest?.r.floor === e.scopeHint,
        dimension: nearest?.r.status === "dimensioned" && normalizeDimension(nearest.r.dimension!.text) === normalizeDimension(e.attributes!.dimension),
      };
    });
    expect(results.filter((x) => !(x.found && x.floor && x.dimension))).toEqual([]);
    expect(results).toHaveLength(10);
  });

  it("no dimension is given to two rooms, and every printed room dimension is accounted for", () => {
    const used = rec.rooms.filter((r) => r.dimension).map((r) => r.dimension!.candidateId);
    expect(new Set(used).size).toBe(used.length);
    expect(rec.unmatchedDimensions).toEqual([]);
  });

  it("repeated W.R on the First Floor get their own sizes, not each other's", () => {
    expect(rec.rooms.filter((r) => r.page === 1 && r.label === "W.R").map((r) => r.dimension?.text).sort())
      .toEqual([`6' X 5'`, `6' X 5'`, `7' X 5'6"`]);
  });
});

describe("reconcileRoomDimensions — rules", () => {
  it("a label with nothing printed beneath it stays without a dimension; nothing is borrowed from a same-named room", () => {
    const r = reconcile([run("W.R", 100, 100), run(`8' X 6'3"`, 98, 108), run("W.R", 300, 100)]);
    expect(roomsByLabel(r)).toEqual([["W.R", "dimensioned", `8' X 6'3"`], ["W.R", "no_dimension", null]]);
  });

  it("a dimension sitting just above label B but beneath label A belongs to A, even though it is closer to B", () => {
    const r = reconcile([run("KITCHEN", 100, 100), run(`10' X 8'`, 100, 110), run("DINING", 100, 113)]);
    expect(roomsByLabel(r)).toEqual([["KITCHEN", "dimensioned", `10' X 8'`], ["DINING", "no_dimension", null]]);
  });

  it("one dimension equally beneath two labels is left ambiguous for both, and listed as unmatched", () => {
    const r = reconcile([run("W.R", 100, 100, 20), run("W.I.C", 116, 100, 20), run(`8' X 6'3"`, 108, 108, 20)]);
    expect(r.rooms.map((x) => x.status)).toEqual(["ambiguous", "ambiguous"]);
    expect(r.rooms[0].alternatives.map((a) => a.text)).toEqual([`8' X 6'3"`]);
    expect(r.unmatchedDimensions.map((u) => u.reason)).toEqual(["Could belong to W.R or W.I.C; not assigned."]);
  });

  it("two dimensions at nearly the same distance beneath one label are ambiguous, with both offered", () => {
    const r = reconcile([run("STORE", 100, 100, 40), run(`5' X 4'`, 95, 108, 20), run(`6' X 4'`, 125, 108, 20)]);
    expect(r.rooms[0].status).toBe("ambiguous");
    expect(r.rooms[0].alternatives.map((a) => a.text).sort()).toEqual([`5' X 4'`, `6' X 4'`]);
  });

  it("a dimension on another page is never matched, even at identical coordinates", () => {
    const r = reconcile([run("KITCHEN", 100, 100), run(`10' X 8'`, 100, 108)], [1, 2]);
    expect(r.rooms[0].status).toBe("no_dimension");
    expect(r.unmatchedDimensions.map((u) => u.page)).toEqual([2]);
  });

  it("text read in a different direction is not paired", () => {
    const r = reconcile([run("KITCHEN", 100, 100), run(`10' X 8'`, 110, 140, 30, 6, [0, -1])]);
    expect(r.rooms[0].status).toBe("no_dimension");
  });

  it("vertical labels pair with vertical dimensions printed beside them in their own frame", () => {
    // bottom-to-top text: "beneath" is to the right on the page
    const r = reconcile([run("BALCONY", 372, 179, 30, 6, [0, -1]), run(`12'5"x4'`, 378, 174, 21, 5, [0, -1])]);
    expect(roomsByLabel(r)).toEqual([["BALCONY", "dimensioned", `12'5"x4'`]]);
  });

  it("the result does not depend on the order text arrives in", () => {
    const runs = [run("W.R", 100, 100), run(`8' X 6'3"`, 98, 108), run("W.R", 100, 300), run(`8'10" X 3'9"`, 95, 308), run("DRESS", 300, 100), run(`5' X 3'9"`, 298, 108)];
    const key = (r: ReturnType<typeof reconcile>) => r.rooms.map((x) => `${x.box.join(",")}=${x.dimension?.text}`).sort();
    expect(key(reconcile([...runs].reverse()))).toEqual(key(reconcile(runs)));
  });
});
