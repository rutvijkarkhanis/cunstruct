import { describe, it, expect } from "vitest";
import { findNearbyContext } from "./nearbyGeometryContext";
import type { ExtractedTextRun } from "./pdfGeometry";

function run(text: string, x: number, y: number, width = 20, height = 10): ExtractedTextRun {
  return { page: 1, text, x, y, width, height };
}

describe("findNearbyContext", () => {
  it("returns an empty list when nothing is within radius", () => {
    const ctx = findNearbyContext({ x: 0, y: 0 }, [run("far away", 1000, 1000)], 50);
    expect(ctx.nearbyText).toEqual([]);
  });

  it("returns nearest-first", () => {
    const runs = [run("far", 100, 0), run("near", 10, 0), run("mid", 50, 0)];
    const ctx = findNearbyContext({ x: 0, y: 0 }, runs, 1000);
    expect(ctx.nearbyText).toEqual(["near", "mid", "far"]);
  });

  it("measures distance to the nearest point on the run's own bbox, not just its origin", () => {
    // A click landing INSIDE a wide run's bbox should read as distance 0.
    const wide = run("wide label", 0, 0, 200, 10);
    const ctx = findNearbyContext({ x: 150, y: 5 }, [wide], 10);
    expect(ctx.nearbyText).toEqual(["wide label"]);
  });

  it("caps the result count", () => {
    const runs = Array.from({ length: 30 }, (_, i) => run(`t${i}`, i, 0));
    const ctx = findNearbyContext({ x: 0, y: 0 }, runs, 1000);
    expect(ctx.nearbyText.length).toBeLessThanOrEqual(12);
  });

  it("filters out blank/whitespace-only text runs", () => {
    const ctx = findNearbyContext({ x: 0, y: 0 }, [run("   ", 0, 0), run("real", 1, 0)], 100);
    expect(ctx.nearbyText).toEqual(["real"]);
  });

  it("never invents text — only returns what was actually extracted", () => {
    const ctx = findNearbyContext({ x: 5, y: 5 }, [], 1000);
    expect(ctx.nearbyText).toEqual([]);
  });
});
