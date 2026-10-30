import { describe, it, expect } from "vitest";
import type { DrawingGeometry } from "@/lib/review/drawingGeometry";
import { segmentsFromShapes } from "./geometry";
import { calibrate, scaleSuggestions, fromScaleNote, MM_PER_POINT } from "./scale";
import { detectWallCandidates } from "./walls";
import { addManualWall, deleteWall, effectiveHeight, emptyModel, quantities, setWallLength, updateWall, wallLength, wallsFromCandidates } from "./model";
import { wallBoxes } from "./mesh";

// SYNTHETIC plans only. Page units here are chosen so 1 unit = 50 mm.
const MM = 50;
const shape = (type: DrawingGeometry["type"], points: [number, number][]): DrawingGeometry =>
  ({ type, page: 1, points, bbox: [0, 0, 0, 0], source: "PDF", confidenceTier: "deterministic" } as DrawingGeometry);
const rect = (x0: number, y0: number, x1: number, y1: number) => shape("rectangle", [[x0, y0], [x1, y1]]);
const line = (x0: number, y0: number, x1: number, y1: number) => shape("line", [[x0, y0], [x1, y1]]);

/** One room 5000 x 4000 mm outside, walls 200 mm thick. */
const room = () => [rect(0, 0, 100, 80), rect(4, 4, 96, 76)];

describe("segments from the PDF's own shapes", () => {
  it("rectangles give four edges, lines one, curves none", () => {
    const segs = segmentsFromShapes([rect(0, 0, 10, 5), line(0, 0, 3, 4), shape("path", [[0, 0], [1, 1], [2, 1], [3, 0]])]);
    expect(segs).toHaveLength(5);
    expect(segs.every((s) => s.page === 1)).toBe(true);
  });
});

describe("scale is calibrated or confirmed, never assumed", () => {
  it("calibration: 100 units measured as 5000 mm gives 50 mm per unit", () => {
    const s = calibrate([0, 0], [100, 0], 5000);
    expect(s.mmPerUnit).toBe(50);
    expect(s.source).toBe("calibration");
  });
  it("refuses a zero distance or a missing real length", () => {
    expect(() => calibrate([1, 1], [1, 1], 1000)).toThrow();
    expect(() => calibrate([0, 0], [10, 0], NaN)).toThrow();
  });
  it("a printed scale note is only a suggestion with its own evidence", () => {
    const sug = scaleSuggestions([{ text: "GROUND FLOOR PLAN  SCALE 1:100", x: 10, y: 20 }, { text: "1 : 50", x: 0, y: 0 }]);
    expect(sug.map((s) => s.ratio)).toEqual([50, 100]);
    expect(sug[1].mmPerUnit).toBeCloseTo(100 * MM_PER_POINT, 9);
    expect(fromScaleNote(sug[1]).source).toBe("scale-note");
  });
});

describe("wall candidates from parallel line pairs", () => {
  it("a room drawn as two nested rectangles gives four 200 mm walls meeting at the corners", () => {
    const walls = detectWallCandidates(segmentsFromShapes(room()), MM);
    expect(walls).toHaveLength(4);
    for (const w of walls) expect(w.thicknessMm).toBeCloseTo(200, 6);
    const lengths = walls.map((w) => Math.round(Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]))).sort((a, b) => a - b);
    expect(lengths).toEqual([3800, 3800, 4800, 4800]); // centreline, corners joined
    expect(walls.every((w) => w.evidence.length === 2)).toBe(true);
  });

  it("a gap in one face (a door opening) stays a gap", () => {
    const segs = segmentsFromShapes([line(0, 0, 100, 0), line(0, 4, 40, 4), line(60, 4, 100, 4)]);
    const walls = detectWallCandidates(segs, MM);
    expect(walls).toHaveLength(2);
    const xs = walls.map((w) => [Math.min(w.start[0], w.end[0]), Math.max(w.start[0], w.end[0])]).sort((a, b) => a[0] - b[0]);
    expect(xs).toEqual([[0, 2000], [3000, 5000]]);
  });

  it("lines too close or too far apart are not walls", () => {
    expect(detectWallCandidates(segmentsFromShapes([line(0, 0, 100, 0), line(0, 1, 100, 1)]), MM)).toHaveLength(0); // 50 mm
    expect(detectWallCandidates(segmentsFromShapes([line(0, 0, 100, 0), line(0, 20, 100, 20)]), MM)).toHaveLength(0); // 1000 mm
  });

  it("only nearest neighbours pair: hatching never makes a wall across it", () => {
    const walls = detectWallCandidates(segmentsFromShapes([line(0, 0, 100, 0), line(0, 2, 100, 2), line(0, 4, 100, 4)]), MM);
    expect(walls.map((w) => Math.round(w.thicknessMm))).toEqual([100, 100]); // never the 200 mm pair across the middle line
  });

  it("a small closed box (a fixture or symbol) is not a wall; a long thin one is", () => {
    expect(detectWallCandidates(segmentsFromShapes([rect(0, 0, 12, 10)]), MM)).toHaveLength(0); // 600 x 500 mm box
    const thin = detectWallCandidates(segmentsFromShapes([rect(0, 0, 60, 4)]), MM); // 3000 x 200 mm
    expect(thin.map((w) => Math.round(w.thicknessMm))).toEqual([200]);
  });

  it("refuses to measure without a scale", () => {
    expect(() => detectWallCandidates(segmentsFromShapes(room()), 0)).toThrow();
  });

  it("is deterministic", () => {
    const a = JSON.stringify(detectWallCandidates(segmentsFromShapes(room()), MM));
    expect(JSON.stringify(detectWallCandidates(segmentsFromShapes(room()), MM))).toBe(a);
  });
});

describe("the editable model and its quantities", () => {
  const base = () => ({ ...emptyModel(), walls: wallsFromCandidates(detectWallCandidates(segmentsFromShapes(room()), MM)) });

  it("detected walls start as candidates and are not measured until confirmed", () => {
    const q = quantities(base());
    expect([q.walls, q.confirmed, q.candidates, q.lengthM]).toEqual([4, 0, 4, 0]);
  });

  it("no height is invented: without a storey or wall height there is no area or volume", () => {
    let m = base();
    for (const w of m.walls) m = updateWall(m, w.id, { status: "confirmed" });
    expect(quantities(m)).toMatchObject({ lengthM: 17.2, faceAreaM2: null, volumeM3: null });
    m = { ...m, storeyHeightMm: 3000 };
    expect(quantities(m)).toMatchObject({ lengthM: 17.2, faceAreaM2: 51.6, volumeM3: 10.32 });
  });

  it("edits: own height overrides storey height; length and thickness change; delete and add", () => {
    let m = { ...base(), storeyHeightMm: 3000 };
    const id = m.walls[0].id;
    m = updateWall(m, id, { heightMm: 2400 });
    expect(effectiveHeight(m, m.walls[0])).toBe(2400);
    m = setWallLength(m, id, 1234);
    expect(wallLength(m.walls[0])).toBeCloseTo(1234, 6);
    expect(() => updateWall(m, id, { thicknessMm: 0 })).toThrow();
    m = deleteWall(m, id);
    expect(m.walls).toHaveLength(3);
    m = addManualWall(m, [0, 0], [0, 2500], 115);
    const added = m.walls[m.walls.length - 1];
    expect([added.id, added.source, added.status, added.thicknessMm]).toEqual(["W5", "manual", "confirmed", 115]);
  });
});

describe("3D boxes", () => {
  it("only walls with a height are extruded; the rest are listed", () => {
    let m = { ...emptyModel(), walls: wallsFromCandidates(detectWallCandidates(segmentsFromShapes(room()), MM)) };
    expect(wallBoxes(m).boxes).toHaveLength(0);
    expect(wallBoxes(m).withoutHeight).toHaveLength(4);
    m = { ...m, storeyHeightMm: 3000 };
    const { boxes } = wallBoxes(m);
    expect(boxes).toHaveLength(4);
    const top = boxes.find((b) => Math.abs(b.center[2] - 0.1) < 1e-9)!;
    expect(top.size.map((v) => Math.round(v * 1000) / 1000)).toEqual([4.8, 3, 0.2]);
    expect(top.center[1]).toBeCloseTo(1.5, 9);
  });
});
