import { describe, it, expect } from "vitest";
import { associateEndpoints, type GridTag } from "./dimensionAssociation";

// SYNTHETIC geometry only. A horizontal dimension along y = 100 with ends at x = 20 and x = 120.
type P = [number, number];
const seg = (a: P, b: P, shape = 0) => ({ a, b, shape });
const S: P = [20, 100], E: P = [120, 100], U: P = [1, 0];
const bubble = (label: string, x: number, y: number): GridTag => ({ label, center: [x, y], radius: 4 });
/** A grid line drawn from a bubble's outline (bubble centred at y=60, radius 4) down past the dimension. */
const gridLine = (x: number, shape: number) => seg([x, 64], [x, 160], shape);

describe("grid association", () => {
  it("both ends on grid lines drawn from their bubbles: grid-to-grid, with the labels", () => {
    const a = associateEndpoints(S, E, U, 4, [gridLine(20, 1), gridLine(120, 2)], [bubble("6", 20, 60), bubble("7", 120, 60)]);
    expect(a).toMatchObject({ decision: "associated", measures: "grid-to-grid" });
    expect(a.ends.map((e) => (e.kind === "grid" ? e.labels : null))).toEqual([["6"], ["7"]]);
  });

  it("a bubble merely nearby, with no grid line drawn from it, is not a grid association", () => {
    const a = associateEndpoints(S, E, U, 4, [], [bubble("6", 20, 60), bubble("7", 120, 60)]);
    expect(a.decision).toBe("unassociated");
  });

  it("a bubble far away whose axis is only crossed by scattered unrelated lines is not a grid association", () => {
    // pieces cover more than 40% of the way but with gaps far longer than a dashed grid line has
    const lines = [seg([20, -396], [20, -250], 1), seg([20, -100], [20, 40], 2), gridLine(120, 3)];
    const a = associateEndpoints(S, E, U, 4, lines, [bubble("A", 20, -400), bubble("7", 120, 60)]);
    expect(a.ends[0].kind).not.toBe("grid");
  });

  it("a tick visibly on a grid line but not exactly on it is a near miss: held, with the offset stated", () => {
    // h = 8: a quarter text height is 2; the bubble's line is 1.5 off the end's axis
    const a = associateEndpoints(S, E, U, 8, [seg([21.5, 64], [21.5, 160], 1), gridLine(120, 2)], [bubble("9", 21.5, 60), bubble("10", 120, 60)]);
    expect(a.decision).toBe("ambiguous");
    expect(a.ends[0]).toMatchObject({ kind: "ambiguous", reason: expect.stringMatching(/1\.50 off grid 9's line/) });
  });
});

describe("edge association", () => {
  it("a drawn line through the endpoint (the face a tick sits on) is the edge measured to", () => {
    const a = associateEndpoints(S, E, U, 4, [seg([20, 50], [20, 150], 1), seg([120, 50], [120, 150], 2)], []);
    expect(a).toMatchObject({ decision: "associated", measures: "edge-to-edge" });
    expect(a.ends[0]).toMatchObject({ kind: "edge", via: "through", shape: 1 });
  });

  it("an extension line leads to the FIRST drawn geometry beyond its end; lines further on are irrelevant", () => {
    const lines = [
      seg([20, 50], [20, 150], 1),
      seg([120, 98], [120, 140], 2), // extension line: 2 past the dimension line, ends at y=140
      seg([100, 142], [140, 142], 3), // the element face, 2 beyond its end
      seg([100, 145], [140, 145], 4), // another line further on
    ];
    const a = associateEndpoints(S, E, U, 4, lines, []);
    expect(a.ends[1]).toMatchObject({ kind: "edge", via: "extension", shape: 3 });
  });

  it("an end tied to nothing is unassociated, and says so", () => {
    const a = associateEndpoints(S, E, U, 4, [seg([20, 50], [20, 150], 1)], []);
    expect(a).toMatchObject({ decision: "unassociated", measures: null, reason: expect.stringMatching(/One end cannot be tied/) });
  });

  it("a grid-to-face dimension whose grid end also lies on a drawn face is ambiguous (the face may be what is measured)", () => {
    const lines = [gridLine(20, 1), seg([20, 80], [20, 130], 5), seg([120, 50], [120, 150], 2)];
    const a = associateEndpoints(S, E, U, 4, lines, [bubble("101", 20, 60)]);
    expect(a.decision).toBe("ambiguous");
    expect(a.reason).toMatch(/may measure the face, not the grid/);
  });
});
