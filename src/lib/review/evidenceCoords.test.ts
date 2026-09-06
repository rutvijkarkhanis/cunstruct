import { describe, it, expect } from "vitest";
import { transformBox, transformBoxes, unionBox, fitToEvidence, hasPlaceableEvidence, detectPageSizeMismatch } from "./evidenceCoords";
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

describe("fitToEvidence — canonical scale calculation", () => {
  it("computes a scale that fills the target fraction of the viewport", () => {
    // A 200-unit-wide box on a 2000-unit page (same as pageBase — no declared
    // pageSize override), fit into a 500px-wide viewport at the default 80% fill.
    const fit = fitToEvidence([box([900, 400, 1100, 600])], { width: 2000, height: 1000 }, { width: 2000, height: 1000 }, 500);
    expect(fit).not.toBeNull();
    expect(fit!.scale).toBeCloseTo(2, 5); // (500*0.8*2000) / (200*2000) = 2
  });

  it("uses `space` (declared pageSize) separately from `pageBase` (PDF native size) when they differ", () => {
    // Same box/viewport as above, but the analysis declares a pageSize twice
    // the PDF's native size (e.g. coordinates given at 2x DPI) — the scale
    // must be computed relative to pageBase, not space, per resolvePageSpace's
    // own priority order.
    const fit = fitToEvidence([box([1800, 800, 2200, 1200])], { width: 4000, height: 2000 }, { width: 2000, height: 1000 }, 500);
    expect(fit).not.toBeNull();
    expect(fit!.scale).toBeCloseTo(2, 5); // (500*0.8*4000) / (400*2000) = 2
  });

  it("clamps to minScale/maxScale rather than zooming without bound", () => {
    const tiny = fitToEvidence([box([0, 0, 1, 1])], { width: 2000, height: 1000 }, { width: 2000, height: 1000 }, 500);
    expect(tiny!.scale).toBeLessThanOrEqual(8);
    const huge = fitToEvidence([box([0, 0, 1900, 900])], { width: 2000, height: 1000 }, { width: 2000, height: 1000 }, 10);
    expect(huge!.scale).toBeGreaterThanOrEqual(0.2);
  });

  it("returns null with no boxes (keep current view rather than guess)", () => {
    expect(fitToEvidence([], { width: 100, height: 100 }, { width: 100, height: 100 }, 500)).toBeNull();
  });

  it("returns null for a degenerate viewport width", () => {
    expect(fitToEvidence([box([0, 0, 10, 10])], { width: 100, height: 100 }, { width: 100, height: 100 }, 0)).toBeNull();
  });
});

describe("detectPageSizeMismatch — rotation heuristic (generic, no specific drawing)", () => {
  it("returns null when declared and actual sizes share the same orientation", () => {
    expect(detectPageSizeMismatch({ width: 595, height: 842 }, { width: 595, height: 842 })).toBeNull();
    // Minor real-world size difference, same orientation family — not a rotation issue.
    expect(detectPageSizeMismatch({ width: 600, height: 850 }, { width: 595, height: 842 })).toBeNull();
  });

  it("flags a declared size that looks rotated 90° relative to the PDF's actual rendered page", () => {
    const warning = detectPageSizeMismatch({ width: 595, height: 842 }, { width: 842, height: 595 });
    expect(warning).not.toBeNull();
    expect(warning).toMatch(/rotated/i);
  });

  it("returns null when either size is unknown (never guesses)", () => {
    expect(detectPageSizeMismatch(undefined, { width: 842, height: 595 })).toBeNull();
    expect(detectPageSizeMismatch({ width: 595, height: 842 }, null)).toBeNull();
    expect(detectPageSizeMismatch(undefined, undefined)).toBeNull();
  });
});

describe("hasPlaceableEvidence", () => {
  it("is true only when evidence boxes exist", () => {
    expect(hasPlaceableEvidence({ evidence: [box([0, 0, 1, 1])] })).toBe(true);
    expect(hasPlaceableEvidence({ evidence: [] })).toBe(false);
    expect(hasPlaceableEvidence(undefined)).toBe(false);
  });
});

describe("REGRESSION: Srikakulam W1 opening evidence overlay positioning", () => {
  it("positions upper-right W1 window opening correctly on 595×842 page", () => {
    // Ground Floor upper-right W1 opening at [354, 133, 360, 173] on page 595×842.
    // When rendered at 50% (e.g., 297.5×421), the overlay should maintain proportional positioning.
    const w1Box = box([354, 133, 360, 173]);
    const pageSize = { width: 595, height: 842 };
    const renderedSize = { width: 297, height: 421 }; // ~50% scale

    const result = transformBox(w1Box, pageSize, renderedSize);

    // Expected: proportional scaling
    // x: 354 * (297/595) ≈ 176.7, width: 6 * (297/595) ≈ 3
    // y: 133 * (421/842) ≈ 66.5, height: 40 * (421/842) ≈ 20
    expect(result).not.toBeNull();
    expect(result!.left).toBeCloseTo(176.7, 1);
    expect(result!.top).toBeCloseTo(66.5, 1);
    expect(result!.width).toBeCloseTo(3, 1);
    expect(result!.height).toBeCloseTo(20, 1);
  });

  it("maintains overlay dimensions at full page scale (1:1)", () => {
    // At 1:1 scale (same as page coordinates), bbox should map directly.
    const w1Box = box([354, 133, 360, 173]);
    const pageSize = { width: 595, height: 842 };
    const renderedSize = { width: 595, height: 842 }; // 1:1 scale

    const result = transformBox(w1Box, pageSize, renderedSize);

    // At 1:1, output should match input coordinates
    expect(result).toEqual({ left: 354, top: 133, width: 6, height: 40 });
  });
});
