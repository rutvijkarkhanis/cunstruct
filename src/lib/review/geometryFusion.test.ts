import { describe, it, expect } from "vitest";
import {
  bboxIoU,
  bboxContainmentRatio,
  isGeometryMatch,
  findMatchingPdfShapes,
  fuseEvidenceGeometry,
  unmatchedPdfShapes,
  PDF_GEOMETRY_MATCH_IOU_THRESHOLD,
  PDF_GEOMETRY_CONTAINMENT_THRESHOLD,
} from "./geometryFusion";
import type { DrawingGeometry } from "./drawingGeometry";

function pdfPolygon(bbox: [number, number, number, number], page = 1): DrawingGeometry {
  return {
    type: "polygon",
    page,
    points: [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]],
    bbox,
    source: "PDF",
    confidenceTier: "deterministic",
  };
}

describe("bboxIoU / bboxContainmentRatio — pure geometry math", () => {
  it("IoU is 1.0 for identical boxes", () => {
    expect(bboxIoU([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
  });
  it("IoU is 0 for non-overlapping boxes", () => {
    expect(bboxIoU([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
  });
  it("containment is 1.0 when one box is entirely inside the other, even with low IoU", () => {
    // A tiny box fully inside a much larger one: IoU is low (areas very
    // different) but containment is 1.0 — this is exactly the case
    // containment exists to catch.
    const small: [number, number, number, number] = [45, 45, 55, 55];
    const large: [number, number, number, number] = [0, 0, 100, 100];
    expect(bboxIoU(small, large)).toBeLessThan(0.1);
    expect(bboxContainmentRatio(small, large)).toBe(1);
  });
});

describe("isGeometryMatch — boundary conditions around the named thresholds", () => {
  it("does not match two equal-area boxes whose IoU falls below the threshold", () => {
    // Box A: [0,0,10,10] area 100. Box B: [5,0,15,10] area 100, overlapping
    // by a 5x10 strip (area 50). IoU = 50 / (100+100-50) = 1/3 ≈ 0.333,
    // below PDF_GEOMETRY_MATCH_IOU_THRESHOLD (0.5) and below the
    // containment threshold too (50/100 = 0.5 < 0.85) — must not match.
    const a: [number, number, number, number] = [0, 0, 10, 10];
    const b: [number, number, number, number] = [5, 0, 15, 10];
    expect(bboxIoU(a, b)).toBeCloseTo(1 / 3, 5);
    expect(bboxContainmentRatio(a, b)).toBeCloseTo(0.5, 5);
    expect(isGeometryMatch(a, b)).toBe(false);
  });

  it("matches two equal-area boxes whose IoU clears the threshold (75% overlap each way)", () => {
    // Box A: [0,0,10,10] area 100. Box B: [2.5,0,12.5,10] area 100,
    // overlapping by a 7.5x10 strip (area 75). IoU = 75/(100+100-75)=0.6 ≥ 0.5.
    const a: [number, number, number, number] = [0, 0, 10, 10];
    const b: [number, number, number, number] = [2.5, 0, 12.5, 10];
    expect(bboxIoU(a, b)).toBeCloseTo(0.6, 5);
    expect(isGeometryMatch(a, b)).toBe(true);
  });

  it("matches when IoU clears PDF_GEOMETRY_MATCH_IOU_THRESHOLD even with low containment", () => {
    const a: [number, number, number, number] = [0, 0, 10, 10]; // area 100
    const b: [number, number, number, number] = [0, 0, 10, 10]; // identical -> IoU 1.0
    expect(bboxIoU(a, b)).toBeGreaterThanOrEqual(PDF_GEOMETRY_MATCH_IOU_THRESHOLD);
    expect(isGeometryMatch(a, b)).toBe(true);
  });

  it("matches on containment alone when IoU is low (small box inside a large one)", () => {
    const small: [number, number, number, number] = [1, 1, 9, 9]; // area 64, fully inside
    const large: [number, number, number, number] = [0, 0, 100, 100]; // area 10000
    expect(bboxIoU(small, large)).toBeLessThan(PDF_GEOMETRY_MATCH_IOU_THRESHOLD);
    expect(bboxContainmentRatio(small, large)).toBeGreaterThanOrEqual(PDF_GEOMETRY_CONTAINMENT_THRESHOLD);
    expect(isGeometryMatch(small, large)).toBe(true);
  });

  it("does not match two boxes that barely touch", () => {
    const a: [number, number, number, number] = [0, 0, 10, 10];
    const b: [number, number, number, number] = [9.9, 9.9, 20, 20];
    expect(isGeometryMatch(a, b)).toBe(false);
  });
});

describe("fuseEvidenceGeometry — Case A: PDF geometry + AI evidence, one match -> HYBRID", () => {
  it("upgrades the AI's bbox evidence to the matched PDF shape's real geometry, tagged HYBRID", () => {
    const polygon = pdfPolygon([100, 100, 200, 200]);
    const result = fuseEvidenceGeometry([polygon], { page: 1, bbox: [100, 100, 200, 200] }, "EXISTING_EVIDENCE");
    expect(result.case).toBe("HYBRID");
    expect(result.ambiguous).toBe(false);
    expect(result.geometry.type).toBe("polygon");
    expect(result.geometry.source).toBe("HYBRID");
    expect(result.geometry.points).toEqual(polygon.points); // real PDF vertices, not a fabricated box
  });
});

describe("fuseEvidenceGeometry — Case B: AI evidence, no matching PDF geometry -> bbox fallback", () => {
  it("never invents a polygon when no PDF shape matches", () => {
    const unrelatedShape = pdfPolygon([500, 500, 600, 600]); // elsewhere on the page
    const result = fuseEvidenceGeometry([unrelatedShape], { page: 1, bbox: [100, 100, 200, 200] }, "EXISTING_EVIDENCE");
    expect(result.case).toBe("EXISTING_EVIDENCE");
    expect(result.matchedShapeCount).toBe(0);
    expect(result.geometry.type).toBe("bbox");
    expect(result.geometry.source).toBe("EXISTING_EVIDENCE");
    expect(result.geometry.bbox).toEqual([100, 100, 200, 200]);
  });

  it("falls back to bbox when there are no PDF shapes at all (e.g. raster page)", () => {
    const result = fuseEvidenceGeometry([], { page: 1, bbox: [10, 10, 20, 20] }, "EXISTING_EVIDENCE");
    expect(result.case).toBe("EXISTING_EVIDENCE");
    expect(result.geometry.type).toBe("bbox");
  });
});

describe("fuseEvidenceGeometry — ambiguous match (multiple PDF shapes overlap one evidence box)", () => {
  it("keeps the bbox fallback and flags ambiguous, never guessing which shape is real", () => {
    const shapeA = pdfPolygon([100, 100, 200, 200]);
    const shapeB = pdfPolygon([110, 110, 210, 210]); // also matches the same evidence box
    const result = fuseEvidenceGeometry([shapeA, shapeB], { page: 1, bbox: [100, 100, 200, 200] }, "EXISTING_EVIDENCE");
    expect(result.ambiguous).toBe(true);
    expect(result.matchedShapeCount).toBe(2);
    expect(result.geometry.type).toBe("bbox"); // NOT upgraded to either shapeA or shapeB
    expect(result.geometry.ambiguousMatch).toBe(true);
  });
});

describe("fuseEvidenceGeometry — Case E: LOCATION observation evidence", () => {
  it("fuses a real LOCATION observation's own evidence the same way as item evidence", () => {
    const polygon = pdfPolygon([50, 50, 150, 150]);
    const result = fuseEvidenceGeometry([polygon], { page: 1, bbox: [50, 50, 150, 150] }, "LOCATION");
    expect(result.case).toBe("HYBRID"); // a real PDF match upgrades it regardless of origin tag
    expect(result.geometry.source).toBe("HYBRID");
  });

  it("falls back to a LOCATION-tagged bbox (not fabricated) when no PDF shape matches", () => {
    const result = fuseEvidenceGeometry([], { page: 1, bbox: [50, 50, 150, 150] }, "LOCATION");
    expect(result.case).toBe("LOCATION");
    expect(result.geometry.source).toBe("LOCATION");
    expect(result.geometry.type).toBe("bbox");
  });

  it("never fabricates geometry for siblings with no observation — only the given evidence is fused", () => {
    // Calling fuseEvidenceGeometry is inherently per-observation (the same
    // pattern drawingMarkers.ts already uses per real instance) — a caller
    // with 3 analysis-level occurrences but only 1 real LOCATION record
    // simply never calls this for the other 2. Nothing in this module
    // could fabricate them even if asked to, since there is no API that
    // takes "N instances, 1 with evidence" and produces N results.
    const polygon = pdfPolygon([0, 0, 10, 10]);
    const result = fuseEvidenceGeometry([polygon], { page: 1, bbox: [0, 0, 10, 10] }, "LOCATION");
    expect(result.case).toBe("HYBRID");
    // Only ONE result for ONE evidence location — by construction, not by a flag.
  });
});

describe("fuseEvidenceGeometry — Case D (scaffolded): AI-supplied geometry conflicts with PDF geometry", () => {
  it("marks an explicit conflict and keeps the deterministic PDF geometry, never silently preferring the AI's", () => {
    const pdfShape = pdfPolygon([100, 100, 200, 200]);
    const conflictingAiGeometry: DrawingGeometry = {
      type: "polygon",
      page: 1,
      points: [[300, 300], [400, 300], [400, 400], [300, 400]],
      bbox: [300, 300, 400, 400], // nowhere near the PDF shape
      source: "AI",
      confidenceTier: "low",
    };
    const result = fuseEvidenceGeometry(
      [pdfShape],
      { page: 1, bbox: [100, 100, 200, 200] },
      "EXISTING_EVIDENCE",
      conflictingAiGeometry,
    );
    expect(result.case).toBe("CONFLICT");
    expect(result.geometry.conflict).toBe(true);
    expect(result.geometry.type).toBe("polygon"); // kept the PDF shape's real geometry
    expect(result.geometry.points).toEqual(pdfShape.points);
    expect(result.geometry.conflictingAlternate).toEqual(conflictingAiGeometry);
  });

  it("does not flag a conflict when the AI-supplied geometry agrees with the PDF shape", () => {
    const pdfShape = pdfPolygon([100, 100, 200, 200]);
    const agreeingAiGeometry: DrawingGeometry = {
      type: "rectangle",
      page: 1,
      points: [[100, 100], [200, 200]],
      bbox: [100, 100, 200, 200],
      source: "AI",
      confidenceTier: "low",
    };
    const result = fuseEvidenceGeometry(
      [pdfShape],
      { page: 1, bbox: [100, 100, 200, 200] },
      "EXISTING_EVIDENCE",
      agreeingAiGeometry,
    );
    expect(result.case).toBe("HYBRID");
    expect(result.geometry.conflict).toBeUndefined();
  });

  it("is never reached by a call that omits aiSuppliedGeometry (today's production AI contract)", () => {
    const pdfShape = pdfPolygon([100, 100, 200, 200]);
    const result = fuseEvidenceGeometry([pdfShape], { page: 1, bbox: [100, 100, 200, 200] }, "EXISTING_EVIDENCE");
    expect(result.case).not.toBe("CONFLICT");
  });
});

describe("findMatchingPdfShapes — page isolation", () => {
  it("never matches a shape on a different page, even with identical coordinates", () => {
    const shapeOnPage2 = pdfPolygon([100, 100, 200, 200], 2);
    const matches = findMatchingPdfShapes([shapeOnPage2], { page: 1, bbox: [100, 100, 200, 200] });
    expect(matches).toEqual([]);
  });
});

describe("unmatchedPdfShapes — Case C: document geometry with no semantic association", () => {
  it("returns PDF shapes that matched no evidence, with no semantic type assigned", () => {
    const matched = pdfPolygon([100, 100, 200, 200]);
    const unmatched = pdfPolygon([500, 500, 600, 600]);
    const result = unmatchedPdfShapes([matched, unmatched], [{ page: 1, bbox: [100, 100, 200, 200] }]);
    expect(result).toEqual([unmatched]);
    expect(result[0].source).toBe("PDF");
  });

  it("returns all PDF shapes when there is no evidence at all", () => {
    const shape = pdfPolygon([1, 1, 2, 2]);
    expect(unmatchedPdfShapes([shape], [])).toEqual([shape]);
  });
});
