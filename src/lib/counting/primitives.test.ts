// SYNTHETIC TESTS for the counting engine's building blocks: tag parsing,
// door-swing geometry and sheet classification.

import { describe, it, expect } from "vitest";
import { canonicalMark, categoryOfDescription, parseTag } from "./categories";
import { fitArc, findDoorSwings, groupDoorSymbols, samplePath } from "./doorSwings";
import { classifyView, canonicalJson, fnv1a } from "./sheets";
import { door, doubleDoor, line, quarterArc } from "./__fixtures__/syntheticPlans";
import type { DrawingGeometry } from "../review/drawingGeometry";

describe("tag parsing", () => {
  it("reads clean tags and canonicalises their spelling", () => {
    expect(parseTag("D1")).toEqual({ status: "readable", mark: "D1", category: "door" });
    expect(parseTag("D-1")).toMatchObject({ mark: "D1" });
    expect(parseTag("W 12")).toMatchObject({ mark: "W12", category: "window" });
    expect(parseTag("SD3")).toMatchObject({ mark: "SD3", category: "door" });
    expect(parseTag("V1")).toMatchObject({ category: "ventilator" });
    expect(canonicalMark("d-1")).toBe("D1");
  });

  it("does not map OCR confusions to a mark", () => {
    expect(parseTag("WI")).toMatchObject({ status: "unreadable", category: "window" });
    expect(parseTag("D?")).toMatchObject({ status: "unreadable" });
    expect(parseTag("D1?")).toMatchObject({ status: "unreadable" });
  });

  it("keeps a two-mark label as both, never one", () => {
    expect(parseTag("W1/W2")).toEqual({ status: "multiple", marks: ["W1", "W2"], category: "window" });
    expect(parseTag("D1, W1")).toEqual({ status: "multiple", marks: ["D1", "W1"], category: null });
  });

  it("ignores words, notes and lower case", () => {
    for (const t of ["DOOR", "DO", "WALL", "KITCHEN", "d1", "Do", "ALL DOORS TO BE FLUSH", "900 x 2100", ""]) expect(parseTag(t)).toBeNull();
  });

  it("category from a schedule description only when it names one category", () => {
    expect(categoryOfDescription("TOILET DOOR")).toBe("door");
    expect(categoryOfDescription("DOOR WITH WINDOW")).toBeNull();
    expect(categoryOfDescription("FRAME")).toBeNull();
  });
});

describe("door swing geometry", () => {
  it("fits a 90° arc and finds its centre", () => {
    const arc = fitArc(samplePath(quarterArc(100, 100, 25, 270))!)!;
    expect(arc.centre[0]).toBeCloseTo(100, 3);
    expect(arc.centre[1]).toBeCloseTo(100, 3);
    expect(arc.r).toBeCloseTo(25, 3);
    expect(arc.sweepDeg).toBeCloseTo(90, 0);
  });

  it("rejects a straight path and an irregular curve", () => {
    const straight: DrawingGeometry = { type: "path", page: 1, points: [[0, 0], [1, 1], [2, 2], [3, 3]], bbox: [0, 0, 3, 3], source: "PDF", confidenceTier: "deterministic" };
    expect(fitArc(samplePath(straight)!)).toBeNull();
    const wobbly: DrawingGeometry = { ...straight, points: [[0, 0], [10, 40], [20, -40], [30, 0]] };
    expect(fitArc(samplePath(wobbly)!)).toBeNull();
  });

  it("accepts an arc flattened into a polyline (CAD export)", () => {
    const pts: [number, number][] = Array.from({ length: 9 }, (_, i) => {
      const a = ((270 + (i * 90) / 8) * Math.PI) / 180;
      return [100 + 25 * Math.cos(a), 100 + 25 * Math.sin(a)];
    });
    const poly: DrawingGeometry = { type: "polyline", page: 1, points: pts, bbox: [100, 75, 125, 100], source: "PDF", confidenceTier: "deterministic" };
    const { swings } = findDoorSwings([poly, line([100, 100], [100, 75])]);
    expect(swings).toHaveLength(1);
  });

  it("needs the leaf line, from the centre to one arc end", () => {
    expect(findDoorSwings(door(100, 100)).swings).toHaveLength(1);
    expect(findDoorSwings([door(100, 100)[0]])).toEqual({ swings: [], arcsWithoutLeaf: 1 });
    // A line from the centre to nowhere on the arc is not a leaf.
    expect(findDoorSwings([door(100, 100)[0], line([100, 100], [80, 80])]).swings).toHaveLength(0);
  });

  it("finds a swing at any orientation", () => {
    for (const deg of [0, 90, 180, 270]) expect(findDoorSwings(door(200, 200, 30, deg)).swings).toHaveLength(1);
  });

  it("groups two leaves meeting at one opening into one double door", () => {
    const { swings } = findDoorSwings(doubleDoor(100, 100));
    expect(swings).toHaveLength(2);
    const symbols = groupDoorSymbols(swings);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe("double_swing_geometry");
  });

  it("two separate doors side by side are not a double door", () => {
    const symbols = groupDoorSymbols(findDoorSwings([...door(100, 100), ...door(200, 100)]).swings);
    expect(symbols.map((s) => s.kind)).toEqual(["door_swing_geometry", "door_swing_geometry"]);
  });

  it("a leaf line is used by one swing only", () => {
    const arcs = [quarterArc(100, 100, 25, 270), quarterArc(100, 100, 25, 270)];
    const { swings, arcsWithoutLeaf } = findDoorSwings([...arcs, line([100, 100], [100, 75])]);
    expect(swings).toHaveLength(1);
    expect(arcsWithoutLeaf).toBe(1);
  });
});

describe("sheet view classification", () => {
  it.each([
    [["GROUND FLOOR PLAN"], "plan"],
    [["FRONT ELEVATION"], "elevation"],
    [["SECTION A-A"], "section"],
    [["DOOR DETAIL"], "detail"],
    [["DOOR & WINDOW SCHEDULE"], "schedule"],
    [["GROUND FLOOR PLAN", "DOOR & WINDOW SCHEDULE"], "plan"],
    [["GROUND FLOOR PLAN", "TOILET DETAIL"], "mixed"],
    [["NOTES"], "unknown"],
  ])("%j → %s", (texts, view) => {
    expect(classifyView(texts).view).toBe(view);
  });
});

describe("digest", () => {
  it("is independent of key order", () => {
    expect(fnv1a(canonicalJson({ a: 1, b: [1, 2] }))).toBe(fnv1a(canonicalJson({ b: [1, 2], a: 1 })));
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });
});
