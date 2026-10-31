import { describe, it, expect } from "vitest";
import type { DrawingGeometry } from "./drawingGeometry";
import { chooseEndpoints, findTerminators } from "./dimensionTerminators";

// SYNTHETIC geometry only. A horizontal dimension line along y = 100 from x = 0 to x = 200;
// text height h = 4, text middle at x = 100.
const H = 4;
const LINE = { a: [0, 100] as [number, number], u: [1, 0] as [number, number], length: 200 };
const shape = (type: DrawingGeometry["type"], points: [number, number][]): DrawingGeometry => {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { type, page: 1, points, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], source: "PDF", confidenceTier: "deterministic" };
};
const line = (x0: number, y0: number, x1: number, y1: number) => shape("line", [[x0, y0], [x1, y1]]);
/** Straight edges as linearDimensions.drawingSegments produces them (closed outlines flagged). */
const segsOf = (shapes: DrawingGeometry[]) => shapes.flatMap((s, i) => {
  const closed = s.type === "polygon" || s.type === "rectangle";
  if (!closed && s.type !== "line" && s.type !== "polyline") return [];
  const p = s.points as [number, number][], n = closed ? p.length : p.length - 1;
  return Array.from({ length: n }, (_, k) => ({ a: p[k], b: p[(k + 1) % p.length], shape: i, ...(closed ? { closed: true } : {}) }));
});
const marksOn = (shapes: DrawingGeometry[]) => findTerminators(LINE, H, shapes, segsOf(shapes));
/** A filled oblique bar crossing the line at x, drawn as two triangles (as CAD exports emit it). */
const filledTick = (x: number, dy = 1.5) => [
  shape("polygon", [[x + 1.8, 100 - dy], [x + 1.4, 100 - dy - 0.4], [x - 1.8, 100 + dy]]),
  shape("polygon", [[x + 1.4, 100 - dy - 0.4], [x - 1.8, 100 + dy], [x - 2.2, 100 + dy - 0.4]]),
];
const dimLine = line(0, 100, 200, 100);

describe("terminator recognition", () => {
  it("a filled oblique bar straddling the line is one filled tick at its crossing", () => {
    const m = marksOn([dimLine, ...filledTick(20)]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "filled-tick" });
    expect(m[0].at).toBeCloseTo(20, 0);
  });

  it("a tick that only touches the line with its tip (a neighbouring dimension's) is not a terminator", () => {
    // the whole bar lies above the line, its lowest corner exactly on it
    const touching = shape("polygon", [[20, 100], [23, 97], [23.4, 97.4]]);
    expect(marksOn([dimLine, touching])).toEqual([]);
  });

  it("a short oblique stroke straddling the line is a stroke tick; a family of parallel strokes is hatching", () => {
    expect(marksOn([dimLine, line(18.5, 101.5, 21.5, 98.5)])[0]).toMatchObject({ kind: "stroke-tick" });
    const hatch = [0, 3, 6, 9].map((d) => line(18.5 + d, 101.5, 21.5 + d, 98.5));
    expect(marksOn([dimLine, ...hatch])).toEqual([]);
  });

  it("an arrowhead's tip on the line, axis along it, is the terminator position", () => {
    const m = marksOn([dimLine, shape("polygon", [[20, 100], [24, 98.8], [24, 101.2]])]);
    expect(m[0]).toMatchObject({ kind: "arrowhead", at: 20 });
  });

  it("a small round mark centred on the line is a dot", () => {
    const m = marksOn([dimLine, shape("path", [[19.4, 99.4], [20.6, 99.4], [20.6, 100.6], [19.4, 100.6]])]);
    expect(m[0]).toMatchObject({ kind: "dot", at: 20 });
  });

  it("a perpendicular stroke counts only where the dimension line itself ends", () => {
    // line drawn in two pieces meeting at x=60, with a short perpendicular stroke there
    const pieces = [line(0, 100, 60, 100), line(60, 100, 200, 100)];
    expect(marksOn([...pieces, line(60, 92, 60, 102)])[0]).toMatchObject({ kind: "extension-stub", at: 60 });
    // the same stroke across an unbroken line is someone else's extension line
    expect(marksOn([dimLine, line(60, 92, 60, 102)])).toEqual([]);
    // a wall running straight through is never a terminator
    expect(marksOn([...pieces, line(60, 40, 60, 160)])).toEqual([]);
  });
});

describe("choosing the endpoint pair", () => {
  const pick = (shapes: DrawingGeometry[]) => chooseEndpoints(LINE, 100, H, marksOn(shapes));

  it("one mark either side of the text, nothing between them: a valid pair with its evidence", () => {
    const e = pick([dimLine, ...filledTick(20), ...filledTick(180)]);
    expect(e.decision).toBe("valid-pair");
    expect(e.ends!.map((t) => t.kind)).toEqual(["filled-tick", "filled-tick"]);
    expect(e.length!).toBeCloseTo(160, 0);
    expect(e.reason).toMatch(/either side of the text/);
  });

  it("the nearest mark on each side wins over marks further out (a chain)", () => {
    const e = pick([dimLine, ...filledTick(5), ...filledTick(20), ...filledTick(180), ...filledTick(195)]);
    expect(e.start![0]).toBeCloseTo(20, 0);
    expect(e.end![0]).toBeCloseTo(180, 0);
  });

  it("the line's own ends are never terminators: no marks means unresolved", () => {
    expect(pick([dimLine])).toMatchObject({ decision: "unresolved", start: null, reason: expect.stringMatching(/No terminator/) });
  });

  it("a mark on one side only is one-sided, and no pair is reported", () => {
    expect(pick([dimLine, ...filledTick(20)])).toMatchObject({ decision: "one-sided", start: null, end: null });
  });

  it("two different marks too close to tell apart on one side make the end ambiguous", () => {
    // the bar's two triangles cross at ~19.1 and 20.0; an arrowhead tip at 17.5 is a distinct mark
    // (> 1.5 from both crossings) yet within 1.5 + h/4 of the bar: either could be the end
    const e = pick([dimLine, ...filledTick(20), shape("polygon", [[17.5, 100], [21.5, 98.8], [21.5, 101.2]]), ...filledTick(180)]);
    expect(e.decision).toBe("ambiguous");
  });

  it("text that is not between its nearest terminators is held as unresolved, with the position recorded", () => {
    const e = chooseEndpoints(LINE, 30, H, marksOn([dimLine, ...filledTick(20), ...filledTick(180)]));
    expect(e.decision).toBe("unresolved");
    expect(e.textPosition).toBeLessThan(-0.35);
    expect(e.reason).toMatch(/not between its nearest terminators/);
  });
});
