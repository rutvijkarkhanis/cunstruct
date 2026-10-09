// The edge function does NOT run a second/looser validator — it re-exports
// the actual src/lib/review/analysisSchemaV1.ts + reviewQueue.ts (see
// supabase/functions/_shared/analysisValidation.ts). This test proves that
// re-export resolves and behaves identically to importing the parser
// directly, and separately proves a response shaped exactly like
// openaiSchema.ts's strict JSON Schema parses cleanly — i.e. the schema we
// ask OpenAI to conform to is actually compatible with the existing parser,
// not just superficially similar to it.
import { describe, it, expect } from "vitest";
import { parseAnalysisV1 as parseDirect, CALCULATION_FORMULA_IDS } from "./../review/analysisSchemaV1";
import { parseAnalysisV1 as parseViaSharedReexport, buildReviewItems } from "../../../supabase/functions/_shared/analysisValidation.ts";
import { CUNSTRUCT_ANALYSIS_JSON_SCHEMA } from "../../../supabase/functions/_shared/openaiSchema.ts";

describe("the edge function's re-exported parser is the same parser", () => {
  it("is literally the same function reference — zero drift possible", () => {
    expect(parseViaSharedReexport).toBe(parseDirect);
  });

  it("parses identically on a representative payload", () => {
    const text = JSON.stringify({
      schema_version: "cunstruct.analysis.v1",
      items: [{ key: "W1", item: "Window", quantity: 3, unit: "nos", status: "MEASURED", confidence: 0.9 }],
    });
    expect(parseViaSharedReexport(text)).toEqual(parseDirect(text));
  });
});

describe("an OpenAI structured-output shaped response (openaiSchema.ts) parses cleanly", () => {
  it("a normal MEASURED item with full evidence round-trips with no warnings", () => {
    const payload = {
      schema_version: "cunstruct.analysis.v1",
      items: [
        {
          key: "W1", item: "Window", description: null, quantity: 3, unit: "nos",
          dimension: "6x6", specification: "UPVC", location: "First Floor",
          source: {
            document_id: null, document: "floor-plan.pdf", page: 4,
            evidence: [{ bbox: [10, 10, 50, 50], page: 4, label: null, claim: "quantity" }],
          },
          confidence: 0.94, status: "MEASURED", calculation: null, notes: null, candidates: [],
        },
      ],
    };
    const result = parseViaSharedReexport(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.analysis!.items[0].quantity).toBe(3);
    expect(result.analysis!.items[0].source?.evidence[0].claim).toBe("quantity");
  });

  it("a PENDING item with conflicting candidates round-trips and stays PENDING/null", () => {
    const payload = {
      schema_version: "cunstruct.analysis.v1",
      items: [
        {
          key: "SLAB", item: "Total slab area", description: null, quantity: null, unit: "sq ft",
          dimension: null, specification: null, location: null,
          source: { document_id: null, document: null, page: null, evidence: [] },
          confidence: null, status: "PENDING", calculation: null, notes: null,
          candidates: [
            { value: 25176, unit: "sq ft", basis: "Arithmetic sum", source: { document_id: null, document: null, page: null, evidence: [] } },
            { value: 25101, unit: "sq ft", basis: "Printed total", source: { document_id: null, document: null, page: null, evidence: [] } },
          ],
        },
      ],
    };
    const result = parseViaSharedReexport(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    const item = result.analysis!.items[0];
    expect(item.quantity).toBeNull();
    expect(item.aiStatus).toBe("PENDING");
    expect(item.candidates).toHaveLength(2);
  });

  it("buildReviewItems accepts the parsed items and produces one review item per item", () => {
    const payload = { schema_version: "cunstruct.analysis.v1", items: [{ key: "A", item: "A" }, { key: "B", item: "B" }] };
    const result = parseViaSharedReexport(JSON.stringify(payload));
    const reviewItems = buildReviewItems(result.analysis!.items);
    expect(reviewItems).toHaveLength(2);
    expect(reviewItems[0].reviewStatus).toBe("PENDING_REVIEW");
  });

  it("rejects a response missing the required items array — never silently accepted", () => {
    const result = parseViaSharedReexport(JSON.stringify({ schema_version: "cunstruct.analysis.v1" }));
    expect(result.ok).toBe(false);
  });

  it("a MEASURED item with a structured calculation_data claim round-trips with no warnings", () => {
    const payload = {
      schema_version: "cunstruct.analysis.v1",
      items: [
        {
          key: "W1", item: "Window", description: null, quantity: 18, unit: "sqm",
          dimension: null, specification: null, location: null,
          source: { document_id: null, document: null, page: null, evidence: [] },
          confidence: null, status: "MEASURED", calculation: null,
          calculation_data: {
            formula: "LENGTH_TIMES_WIDTH",
            inputs: [{ name: "length", value: 6, unit: "m" }, { name: "width", value: 3, unit: "m" }],
          },
          notes: null, candidates: [],
        },
      ],
    };
    const result = parseViaSharedReexport(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.analysis!.items[0].calculationData).toEqual({
      formula: "LENGTH_TIMES_WIDTH",
      inputs: [{ name: "length", value: 6, unit: "m" }, { name: "width", value: 3, unit: "m" }],
    });
  });

  it("a null calculation_data (the common case) round-trips with no warnings", () => {
    const payload = {
      schema_version: "cunstruct.analysis.v1",
      items: [
        {
          key: "W1", item: "Window", description: null, quantity: 3, unit: "nos",
          dimension: null, specification: null, location: null,
          source: { document_id: null, document: null, page: null, evidence: [] },
          confidence: null, status: "MEASURED", calculation: null, calculation_data: null,
          notes: null, candidates: [],
        },
      ],
    };
    const result = parseViaSharedReexport(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.analysis!.items[0].calculationData).toBeUndefined();
  });
});

describe("CUNSTRUCT_ANALYSIS_JSON_SCHEMA's calculation_data formula enum matches CALCULATION_FORMULA_IDS exactly", () => {
  it("has the same values, in the same order, as the parser's bounded list", () => {
    const itemProps = CUNSTRUCT_ANALYSIS_JSON_SCHEMA.schema.properties.items.items.properties;
    expect(itemProps.calculation_data.properties.formula.enum).toEqual([...CALCULATION_FORMULA_IDS]);
  });

  it("calculation_data is nullable and listed in the item's required fields (strict-mode optional field convention)", () => {
    const itemSchema = CUNSTRUCT_ANALYSIS_JSON_SCHEMA.schema.properties.items.items;
    expect(itemSchema.properties.calculation_data.type).toEqual(["object", "null"]);
    expect(itemSchema.required).toContain("calculation_data");
  });
});
