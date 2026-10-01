import { describe, it, expect } from "vitest";
import { parseIdentifyResultV1, IDENTIFY_SCHEMA_V1 } from "./identifySchemaV1";

const POINT = { page: 2, x: 123.4, y: 567.8 };

describe("parseIdentifyResultV1 — never fabricates", () => {
  it("returns ok:false for invalid JSON", () => {
    const r = parseIdentifyResultV1("not json", POINT);
    expect(r.ok).toBe(false);
    expect(r.result).toBeUndefined();
  });

  it("returns ok:false when candidates is missing entirely", () => {
    const r = parseIdentifyResultV1(JSON.stringify({ schema_version: IDENTIFY_SCHEMA_V1 }), POINT);
    expect(r.ok).toBe(false);
  });

  it("accepts an honest empty candidates array as a valid 'unable to identify' result", () => {
    const r = parseIdentifyResultV1(JSON.stringify({ schema_version: IDENTIFY_SCHEMA_V1, candidates: [] }), POINT);
    expect(r.ok).toBe(true);
    expect(r.result?.candidates).toEqual([]);
  });

  it("always uses the point the CALLER supplied, never one from the response", () => {
    const r = parseIdentifyResultV1(
      JSON.stringify({ schema_version: IDENTIFY_SCHEMA_V1, candidates: [], point: { page: 99, x: 0, y: 0 } }),
      POINT,
    );
    expect(r.result?.point).toEqual(POINT);
  });

  it("parses a valid candidate with evidence", () => {
    const r = parseIdentifyResultV1(
      JSON.stringify({
        schema_version: IDENTIFY_SCHEMA_V1,
        candidates: [{ label: "Door", description: "Single leaf door", confidence: 0.82, evidence: [{ bbox: [10, 20, 30, 40], page: 2, claim: "general" }] }],
      }),
      POINT,
    );
    expect(r.ok).toBe(true);
    expect(r.result?.candidates).toHaveLength(1);
    expect(r.result?.candidates[0]).toMatchObject({ label: "Door", description: "Single leaf door", confidence: 0.82 });
    expect(r.result?.candidates[0].evidence).toEqual([{ bbox: [10, 20, 30, 40], page: 2, claim: "general" }]);
  });

  it("drops a candidate with no label rather than inventing one", () => {
    const r = parseIdentifyResultV1(
      JSON.stringify({ schema_version: IDENTIFY_SCHEMA_V1, candidates: [{ label: "", confidence: 0.5, evidence: [] }] }),
      POINT,
    );
    expect(r.ok).toBe(true);
    expect(r.result?.candidates).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("never invents a confidence when absent", () => {
    const r = parseIdentifyResultV1(
      JSON.stringify({ schema_version: IDENTIFY_SCHEMA_V1, candidates: [{ label: "Window", evidence: [] }] }),
      POINT,
    );
    expect(r.result?.candidates[0].confidence).toBeNull();
  });

  it("drops a malformed evidence box rather than inventing coordinates", () => {
    const r = parseIdentifyResultV1(
      JSON.stringify({ schema_version: IDENTIFY_SCHEMA_V1, candidates: [{ label: "Column", evidence: [{ bbox: [1, 2, 3] }] }] }),
      POINT,
    );
    expect(r.result?.candidates[0].evidence).toEqual([]);
  });

  it("falls back to the schema version constant when the response omits it", () => {
    const r = parseIdentifyResultV1(JSON.stringify({ candidates: [] }), POINT);
    expect(r.result?.schemaVersion).toBe(IDENTIFY_SCHEMA_V1);
  });
});
