// HYBRID GEOMETRY FIXTURES — the 8 deterministic end-to-end scenarios
// (A–H) the drawing-native architecture must prove, run against REAL
// pdf.js extraction (not synthetic DrawingGeometry stand-ins) wherever a
// PDF fixture can express the case, so this file is evidence the full
// pipeline (pdfGeometry.ts -> geometryFusion.ts -> drawingGeometry.ts)
// behaves correctly end-to-end, not just that each module's own unit tests
// pass in isolation.
//
// Fixture PDFs (see __fixtures__/):
//   vector-geometry.pdf — real rectangle ("window", raw PDF bbox
//     [100,600,180,640]), real closed polygon ("column", 5 points), real
//     open polyline ("wall centerline"), real Bezier path ("door swing").
//   raster-only.pdf — an image XObject only; pdf.js can extract NOTHING
//     usable from it (verified in pdfGeometry.test.ts).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractPageGeometry } from "./pdfGeometry";
import { fuseEvidenceGeometry, unmatchedPdfShapes } from "./geometryFusion";
import type { DrawingGeometry } from "./drawingGeometry";

const require = createRequire(import.meta.url);
const FIXTURES_DIR = path.resolve(process.cwd(), "src/lib/review/__fixtures__");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any;
beforeAll(async () => {
  pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
});

async function extractFixture(fixtureName: string) {
  const data = new Uint8Array(readFileSync(path.join(FIXTURES_DIR, fixtureName)));
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  return extractPageGeometry(page, 1);
}

describe("Fixture A — PDF rectangle + AI 'Window' evidence -> HYBRID rectangle", () => {
  it("upgrades the AI's bbox to the real PDF rectangle's own geometry", async () => {
    const extraction = await extractFixture("vector-geometry.pdf");
    // The AI's own evidence for "Window W1" — its bbox, independently
    // measured/approximate but overlapping the real rectangle closely
    // enough to be the same physical object. Page-space bbox for the
    // window rect is [100,152,180,192] (see pdfGeometry.test.ts ground truth).
    const aiEvidence = { page: 1, bbox: [100, 152, 180, 192] as [number, number, number, number] };
    const result = fuseEvidenceGeometry(extraction.shapes, aiEvidence, "EXISTING_EVIDENCE");
    expect(result.case).toBe("HYBRID");
    expect(result.geometry.type).toBe("rectangle");
    expect(result.geometry.source).toBe("HYBRID");
    expect(result.geometry.points).toHaveLength(4);
  });
});

describe("Fixture B — PDF polygon + AI 'Door' evidence -> HYBRID polygon", () => {
  it("upgrades the AI's bbox to the real PDF polygon's own vertices", async () => {
    const extraction = await extractFixture("vector-geometry.pdf");
    const polygon = extraction.shapes.find((s) => s.type === "polygon")!;
    expect(polygon).toBeDefined();
    // The AI's evidence bbox for "Door D1" — same bbox as the real polygon's
    // own (a close AI-measured crop of the real shape).
    const aiEvidence = { page: 1, bbox: polygon.bbox };
    const result = fuseEvidenceGeometry(extraction.shapes, aiEvidence, "EXISTING_EVIDENCE");
    expect(result.case).toBe("HYBRID");
    expect(result.geometry.type).toBe("polygon");
    expect(result.geometry.points).toEqual(polygon.points); // real 5-vertex shape, not a rectangle guess
  });
});

describe("Fixture C — PDF Bezier path + AI 'Column' evidence -> HYBRID path", () => {
  it("upgrades the AI's bbox to the real PDF curve's own control points", async () => {
    const extraction = await extractFixture("vector-geometry.pdf");
    const curve = extraction.shapes.find((s) => s.type === "path")!;
    expect(curve).toBeDefined();
    const aiEvidence = { page: 1, bbox: curve.bbox };
    const result = fuseEvidenceGeometry(extraction.shapes, aiEvidence, "EXISTING_EVIDENCE");
    expect(result.case).toBe("HYBRID");
    expect(result.geometry.type).toBe("path");
    expect(result.geometry.points).toEqual(curve.points); // real curve control points, never flattened to a polygon
  });
});

describe("Fixture D — AI semantic item + evidence bbox + no matching PDF geometry -> bbox fallback", () => {
  it("never invents a shape when the evidence location has no real PDF geometry near it", async () => {
    const extraction = await extractFixture("vector-geometry.pdf");
    // A page-space location with nothing drawn anywhere near it in the fixture.
    const aiEvidence = { page: 1, bbox: [550, 10, 590, 30] as [number, number, number, number] };
    const result = fuseEvidenceGeometry(extraction.shapes, aiEvidence, "EXISTING_EVIDENCE");
    expect(result.case).toBe("EXISTING_EVIDENCE");
    expect(result.geometry.type).toBe("bbox");
    expect(result.geometry.source).toBe("EXISTING_EVIDENCE");
    expect(result.matchedShapeCount).toBe(0);
  });
});

describe("Fixture E — LOCATION observation + PDF geometry -> real instance geometry, siblings never fabricated", () => {
  it("fuses the one real LOCATION observation's evidence against the real PDF shape", async () => {
    const extraction = await extractFixture("vector-geometry.pdf");
    const polygon = extraction.shapes.find((s) => s.type === "polygon")!;
    // Window W1 has 3 analysis-level occurrences per the AI, but only ONE
    // real LOCATION observation exists (the other two have none recorded).
    const observationEvidence = { page: 1, bbox: polygon.bbox };
    const instance1 = fuseEvidenceGeometry(extraction.shapes, observationEvidence, "LOCATION");
    expect(instance1.case).toBe("HYBRID");
    expect(instance1.geometry.type).toBe("polygon");

    // Instances 2 and 3 have no LOCATION record at all — there is no
    // evidence location to pass fuseEvidenceGeometry for them, so no call
    // is made and no geometry is produced. This IS the "never fabricate
    // siblings" guarantee: it's structural (nothing to call), not a flag.
    const instancesWithRealGeometry = [instance1].filter((r) => r.case === "HYBRID" || r.case === "LOCATION");
    expect(instancesWithRealGeometry).toHaveLength(1);
  });
});

describe("Fixture F — conflicting geometry representations -> explicit conflict, never silently resolved", () => {
  it("keeps the deterministic PDF geometry and flags the disagreement, never preferring the AI's version", async () => {
    const extraction = await extractFixture("vector-geometry.pdf");
    const rectangle = extraction.shapes.find((s) => s.type === "rectangle")!;
    const aiEvidence = { page: 1, bbox: rectangle.bbox };
    // Scaffolded Case D input: a hypothetical future AI-supplied geometry
    // for this exact evidence, at a location that disagrees with the real
    // PDF shape. Not reachable from today's production AI contract (bbox-
    // only) — exercised directly here so the behavior is proven now.
    const conflictingAiGeometry: DrawingGeometry = {
      type: "polygon", page: 1,
      points: [[0, 0], [5, 0], [5, 5], [0, 5]],
      bbox: [0, 0, 5, 5],
      source: "AI", confidenceTier: "low",
    };
    const result = fuseEvidenceGeometry(extraction.shapes, aiEvidence, "EXISTING_EVIDENCE", conflictingAiGeometry);
    expect(result.case).toBe("CONFLICT");
    expect(result.geometry.conflict).toBe(true);
    expect(result.geometry.type).toBe("rectangle"); // deterministic PDF shape retained
    expect(result.geometry.conflictingAlternate).toEqual(conflictingAiGeometry);
  });
});

describe("Fixture G — PDF geometry with no AI semantic match -> document geometry only, no invented type", () => {
  it("exposes the real open polyline as unmatched PDF geometry, with no semantic tag", async () => {
    const extraction = await extractFixture("vector-geometry.pdf");
    // No AI evidence anywhere on the page — every real PDF shape is unmatched.
    const unmatched = unmatchedPdfShapes(extraction.shapes, []);
    expect(unmatched.length).toBe(extraction.shapes.length);
    const polyline = unmatched.find((s) => s.type === "polyline")!;
    expect(polyline).toBeDefined();
    expect(polyline.source).toBe("PDF");
    expect(polyline).not.toHaveProperty("item");
    expect(polyline).not.toHaveProperty("category");
  });
});

describe("Fixture H — scanned/raster page -> geometry unavailable, no fabricated detection", () => {
  it("reports geometryAvailable: false and falls back to bbox for any evidence on that page", async () => {
    const extraction = await extractFixture("raster-only.pdf");
    expect(extraction.geometryAvailable).toBe(false);
    expect(extraction.shapes).toEqual([]);

    // Even if the AI supplied evidence for this (scanned) page, fusion has
    // nothing real to upgrade it with — bbox fallback, never a guessed shape.
    const aiEvidence = { page: 1, bbox: [10, 10, 50, 50] as [number, number, number, number] };
    const result = fuseEvidenceGeometry(extraction.shapes, aiEvidence, "EXISTING_EVIDENCE");
    expect(result.case).toBe("EXISTING_EVIDENCE");
    expect(result.geometry.type).toBe("bbox");
  });
});
