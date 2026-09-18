// Mirrors analysisValidation.test.ts exactly, for LOCATION mode: proves the
// edge function's re-exported observation parser is the same parser (zero
// drift possible), proves an OpenAI structured-output shaped response
// (openaiSchema.ts's CUNSTRUCT_OBSERVATION_JSON_SCHEMA) parses cleanly
// through it, and proves the schema's observation_type enum can never drift
// from the parser's own OBSERVATION_TYPES list.
import { describe, it, expect } from "vitest";
import { parseObservationsV1 as parseDirect, OBSERVATION_TYPES } from "../review/observationSchemaV1";
import { parseObservationsV1 as parseViaSharedReexport } from "../../../supabase/functions/_shared/observationValidation.ts";
import { CUNSTRUCT_OBSERVATION_JSON_SCHEMA } from "../../../supabase/functions/_shared/openaiSchema.ts";

describe("the edge function's re-exported observation parser is the same parser", () => {
  it("is literally the same function reference — zero drift possible", () => {
    expect(parseViaSharedReexport).toBe(parseDirect);
  });
});

describe("CUNSTRUCT_OBSERVATION_JSON_SCHEMA's observation_type enum matches OBSERVATION_TYPES exactly", () => {
  it("has the same values, in the same order, as the parser's bounded list", () => {
    const properties = CUNSTRUCT_OBSERVATION_JSON_SCHEMA.schema.properties.observations.items.properties;
    expect(properties.observation_type.enum).toEqual([...OBSERVATION_TYPES]);
  });
});

describe("an OpenAI structured-output shaped observation response parses cleanly", () => {
  it("a full-evidence observation round-trips with no warnings", () => {
    const payload = {
      schema_version: "cunstruct.observation.v1",
      observations: [
        {
          observation_type: "schedule_entry", mark: "W1", scope_hint: "Ground Floor",
          location_text: "Door/Window schedule, Ground floor sheet",
          attributes: { dimension: "6'x6'9\"", specification: "UPVC", material: null },
          evidence_completeness: "FULL",
          source: {
            document_id: "doc-1", document: null, page: 8,
            evidence: [{ bbox: [120, 340, 480, 372], page: 8, label: null, claim: "general" }],
          },
        },
      ],
    };
    const result = parseViaSharedReexport(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.observations![0].observationType).toBe("schedule_entry");
    expect(result.observations![0].attributes).toEqual({ dimension: "6'x6'9\"", specification: "UPVC" });
  });

  it("a LIMITED observation with no evidence round-trips (retained, per Phase 4's evidence rules)", () => {
    const payload = {
      schema_version: "cunstruct.observation.v1",
      observations: [
        {
          observation_type: "structural_element", mark: null, scope_hint: "Typical Floor", location_text: "Column line C-3",
          attributes: { dimension: null, specification: null, material: "RCC" },
          evidence_completeness: "LIMITED",
          source: { document_id: null, document: "typical-floor-plan.pdf", page: 9, evidence: [] },
        },
      ],
    };
    const result = parseViaSharedReexport(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    expect(result.observations![0].evidenceCompleteness).toBe("LIMITED");
    expect(result.observations![0].source.evidence).toEqual([]);
  });

  it("rejects a response missing the required observations array — never silently accepted", () => {
    const result = parseViaSharedReexport(JSON.stringify({ schema_version: "cunstruct.observation.v1" }));
    expect(result.ok).toBe(false);
  });
});
