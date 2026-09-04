import { describe, it, expect } from "vitest";
import { transformBox, transformBoxes, unionBox, fitToEvidence, hasPlaceableEvidence } from "./evidenceCoords";
import type { EvidenceBox } from "./analysisSchemaV1";

const box = (b: [number, number, number, number]): EvidenceBox => ({ bbox: b });

describe("transformBox — page space → rendered pixels", () => {
  it("scales a bbox to the rendered display size (not raw coords)", () => {
    // Page is 2000x1000 units; rendered at 1000x500 (0.5x). A box at [200,100,400,300].
    const r = transformBox(box([200, 100, 400, 300]), { width: 2000, height: 1000 }, { width: 1000, height: 500 });
    expect(r).toEqual({ left: 100, top: 50, width: 100, height: 100 });
  });

  it("returns null for a degenerate page/rendered size (never guesses)", () => {
    expect(transformBox(box([0, 0, 1, 1]), { width: 0, height: 0 }, { width: 100, height: 100 })).toBeNull();
  });
});

describe("transformBoxes", () => {
  it("maps multiple boxes and keeps them aligned to the same scale", () => {
    const rects = transformBoxes([box([0, 0, 100, 100]), box([100, 100, 200, 200])], { width: 200, height: 200 }, { width: 400, height: 400 });
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ left: 0, top: 0, width: 200, height: 200 });
    expect(rects[1]).toEqual({ left: 200, top: 200, width: 200, height: 200 });
  });
});

describe("unionBox", () => {
  it("computes the enclosing box over several evidence regions", () => {
    expect(unionBox([box([10, 20, 30, 40]), box([5, 25, 35, 60])])).toEqual([5, 20, 35, 60]);
  });
  it("is null when there are no boxes", () => {
    expect(unionBox([])).toBeNull();
  });
});

describe("fitToEvidence", () => {
  it("returns a zoom and center that frames the evidence", () => {
    const fit = fitToEvidence([box([900, 400, 1100, 600])], { width: 2000, height: 1000 }, { width: 2000, height: 1000 });
    expect(fit).not.toBeNull();
    expect(fit!.centerX).toBe(1000);
    expect(fit!.centerY).toBe(500);
    expect(fit!.zoom).toBeGreaterThan(1);
  });
  it("returns null with no boxes (keep current view rather than guess)", () => {
    expect(fitToEvidence([], { width: 100, height: 100 }, { width: 100, height: 100 })).toBeNull();
  });
});

describe("hasPlaceableEvidence", () => {
  it("is true only when evidence boxes exist", () => {
    expect(hasPlaceableEvidence({ evidence: [box([0, 0, 1, 1])] })).toBe(true);
    expect(hasPlaceableEvidence({ evidence: [] })).toBe(false);
    expect(hasPlaceableEvidence(undefined)).toBe(false);
  });
});
