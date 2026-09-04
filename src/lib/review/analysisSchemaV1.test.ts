import { describe, it, expect } from "vitest";
import { parseAnalysisV1, parseEvidenceBox, normalizeConfidenceNumber } from "./analysisSchemaV1";

const V1 = JSON.stringify({
  schema_version: "cunstruct.analysis.v1",
  project: { project_type: "Residential" },
  items: [
    {
      item: "W1", quantity: 3, unit: "nos", dimension: "6' x 6'9\"",
      specification: "UPVC casement", location: "First Floor",
      source: { document: "floor-plan.pdf", page: 4, evidence: [{ bbox: [1240, 850, 1370, 980] }, { bbox: [1400, 850, 1530, 980] }] },
      confidence: 0.94, status: "MEASURED",
    },
    { item: "Wardrobe", quantity: null, status: "PENDING", location: "Bedroom 2" },
  ],
});

describe("parseAnalysisV1 — valid v1", () => {
  const r = parseAnalysisV1(V1);
  it("loads items with structured source + evidence", () => {
    expect(r.ok).toBe(true);
    expect(r.analysis?.schemaVersion).toBe("cunstruct.analysis.v1");
    const w1 = r.analysis!.items[0];
    expect(w1.key).toBe("W1");
    expect(w1.quantity).toBe(3);
    expect(w1.source?.page).toBe(4);
    expect(w1.source?.evidence).toHaveLength(2);
    expect(w1.source?.evidence[0].bbox).toEqual([1240, 850, 1370, 980]);
    expect(w1.confidence).toBeCloseTo(0.94, 2);
    expect(w1.aiStatus).toBe("MEASURED");
  });
  it("keeps a null quantity as PENDING (never fabricated)", () => {
    const wr = r.analysis!.items[1];
    expect(wr.quantity).toBeNull();
    expect(wr.aiStatus).toBe("PENDING");
  });
});

describe("parseAnalysisV1 — never fabricates coordinates", () => {
  it("drops an invalid bbox with a warning, keeps the item", () => {
    const r = parseAnalysisV1(JSON.stringify({ items: [
      { item: "D1", quantity: 2, source: { document: "d.pdf", page: 1, evidence: [{ bbox: [1, 2, 3] }, { bbox: [10, 10, 40, 40] }] } },
    ] }));
    expect(r.ok).toBe(true);
    expect(r.analysis!.items[0].source?.evidence).toHaveLength(1); // the 3-element bbox dropped
    expect(r.warnings.some((w) => /no valid bbox/i.test(w))).toBe(true);
  });

  it("normalizes bbox ordering so x1<x2, y1<y2", () => {
    const box = parseEvidenceBox({ bbox: [100, 200, 40, 80] });
    expect(box?.bbox).toEqual([40, 80, 100, 200]);
  });

  it("accepts a legacy string source without evidence (no fake coords)", () => {
    const r = parseAnalysisV1(JSON.stringify({ items: [{ item: "F1", quantity: 100, unit: "sqft", source: "Floor Plan — Page 4" }] }));
    expect(r.ok).toBe(true);
    expect(r.analysis!.items[0].source?.document).toBe("Floor Plan — Page 4");
    expect(r.analysis!.items[0].source?.evidence).toEqual([]);
  });
});

describe("normalizeConfidenceNumber", () => {
  it("keeps a 0..1 value", () => {
    expect(normalizeConfidenceNumber(0.8)).toEqual({ value: 0.8, wasPercent: false });
  });
  it("treats 0..100 as a percentage", () => {
    expect(normalizeConfidenceNumber(94)).toEqual({ value: 0.94, wasPercent: true });
  });
  it("returns null for non-numeric (never invented)", () => {
    expect(normalizeConfidenceNumber("high").value).toBeNull();
  });
});

describe("parseAnalysisV1 — invalid input", () => {
  it("rejects malformed JSON", () => {
    expect(parseAnalysisV1("{ nope").ok).toBe(false);
  });
  it("rejects a missing items array with a clear message", () => {
    const r = parseAnalysisV1(JSON.stringify({ schema_version: "cunstruct.analysis.v1" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/items.*array/i);
  });
  it("explains exactly which items lack a required name", () => {
    const r = parseAnalysisV1(JSON.stringify({ items: [{ quantity: 1 }, { item: "OK", quantity: 2 }] }));
    expect(r.ok).toBe(true); // one valid item remains
    expect(r.warnings.join(" ")).toMatch(/missing "item"/i);
  });
  it("rejects when NO item has a name", () => {
    const r = parseAnalysisV1(JSON.stringify({ items: [{ quantity: 1 }] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no valid items/i);
  });
});
