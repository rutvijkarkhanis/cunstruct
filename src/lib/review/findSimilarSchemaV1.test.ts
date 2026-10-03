import { describe, it, expect } from "vitest";
import { parseFindSimilarResultV1, SIMILAR_SCHEMA_V1 } from "./findSimilarSchemaV1";

const REFERENCE = {
  label: "Door",
  description: "Single leaf door",
  evidence: [{ bbox: [10, 20, 30, 40] as [number, number, number, number], page: 2 }],
};

describe("parseFindSimilarResultV1 — never fabricates", () => {
  it("returns ok:false for invalid JSON", () => {
    const r = parseFindSimilarResultV1("not json", REFERENCE);
    expect(r.ok).toBe(false);
    expect(r.result).toBeUndefined();
  });

  it("returns ok:false when matches is missing entirely", () => {
    const r = parseFindSimilarResultV1(JSON.stringify({ schema_version: SIMILAR_SCHEMA_V1 }), REFERENCE);
    expect(r.ok).toBe(false);
  });

  it("accepts an honest empty matches array as a valid 'no similar occurrences' result", () => {
    const r = parseFindSimilarResultV1(JSON.stringify({ schema_version: SIMILAR_SCHEMA_V1, matches: [] }), REFERENCE);
    expect(r.ok).toBe(true);
    expect(r.result?.matches).toEqual([]);
  });

  it("always uses the reference the CALLER supplied, never one from the response", () => {
    const r = parseFindSimilarResultV1(
      JSON.stringify({
        schema_version: SIMILAR_SCHEMA_V1,
        matches: [],
        reference: { label: "Fabricated", description: "should be ignored", evidence: [] },
      }),
      REFERENCE,
    );
    expect(r.result?.reference).toEqual(REFERENCE);
  });

  it("parses a valid match with evidence, independent of other matches", () => {
    const r = parseFindSimilarResultV1(
      JSON.stringify({
        schema_version: SIMILAR_SCHEMA_V1,
        matches: [
          { label: "Door", description: "Matching door on page 5", confidence: 0.74, evidence: [{ bbox: [50, 60, 70, 80], page: 5 }] },
          { label: "Door", description: "Matching door on page 7", confidence: 0.6, evidence: [{ bbox: [15, 25, 35, 45], page: 7 }] },
        ],
      }),
      REFERENCE,
    );
    expect(r.ok).toBe(true);
    expect(r.result?.matches).toHaveLength(2);
    expect(r.result?.matches[0]).toMatchObject({ label: "Door", description: "Matching door on page 5", confidence: 0.74 });
    expect(r.result?.matches[0].evidence).toEqual([{ bbox: [50, 60, 70, 80], page: 5 }]);
    expect(r.result?.matches[1].evidence).toEqual([{ bbox: [15, 25, 35, 45], page: 7 }]);
  });

  it("matches can span multiple distinct pages in a single result", () => {
    const r = parseFindSimilarResultV1(
      JSON.stringify({
        schema_version: SIMILAR_SCHEMA_V1,
        matches: [
          { label: "Door", confidence: 0.9, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] },
          { label: "Door", confidence: 0.8, evidence: [{ bbox: [3, 3, 4, 4], page: 9 }] },
        ],
      }),
      REFERENCE,
    );
    const pages = r.result?.matches.map((m) => m.evidence[0]?.page);
    expect(pages).toEqual([1, 9]);
  });

  it("drops a match with no label rather than inventing one", () => {
    const r = parseFindSimilarResultV1(
      JSON.stringify({ schema_version: SIMILAR_SCHEMA_V1, matches: [{ label: "", confidence: 0.5, evidence: [] }] }),
      REFERENCE,
    );
    expect(r.ok).toBe(true);
    expect(r.result?.matches).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("never invents a confidence when absent — uncertain matches are kept, not dropped", () => {
    const r = parseFindSimilarResultV1(
      JSON.stringify({ schema_version: SIMILAR_SCHEMA_V1, matches: [{ label: "Window", evidence: [] }] }),
      REFERENCE,
    );
    expect(r.result?.matches).toHaveLength(1);
    expect(r.result?.matches[0].confidence).toBeNull();
  });

  it("drops a malformed evidence box rather than inventing coordinates", () => {
    const r = parseFindSimilarResultV1(
      JSON.stringify({ schema_version: SIMILAR_SCHEMA_V1, matches: [{ label: "Column", evidence: [{ bbox: [1, 2, 3] }] }] }),
      REFERENCE,
    );
    expect(r.result?.matches[0].evidence).toEqual([]);
  });

  it("falls back to the schema version constant when the response omits it", () => {
    const r = parseFindSimilarResultV1(JSON.stringify({ matches: [] }), REFERENCE);
    expect(r.result?.schemaVersion).toBe(SIMILAR_SCHEMA_V1);
  });

  it("a malformed match among valid ones is dropped without discarding the rest (never collapses or merges)", () => {
    const r = parseFindSimilarResultV1(
      JSON.stringify({
        schema_version: SIMILAR_SCHEMA_V1,
        matches: [
          { label: "Door", confidence: 0.7, evidence: [] },
          { label: "", confidence: 0.9, evidence: [] },
          { label: "Door", confidence: 0.3, evidence: [] },
        ],
      }),
      REFERENCE,
    );
    expect(r.result?.matches).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
  });
});
