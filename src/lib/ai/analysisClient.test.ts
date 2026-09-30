import { describe, it, expect } from "vitest";
import { friendlyGenerateError } from "./analysisClient";

describe("friendlyGenerateError — human-friendly extraction error messages", () => {
  it("maps an empty-items validation failure to the empty-extraction message", () => {
    expect(friendlyGenerateError('OpenAI response failed validation: The "items" array is empty — nothing to review.'))
      .toBe("No BOQ quantities were found in these drawings. Try another drawing or run the analysis again.");
  });

  it("maps a 'no valid items found' failure to the empty-extraction message too", () => {
    expect(friendlyGenerateError('OpenAI response failed validation: No valid items found. item 1: missing "item"/"name"'))
      .toBe("No BOQ quantities were found in these drawings. Try another drawing or run the analysis again.");
  });

  it("maps a malformed/invalid-JSON validation failure to the processing-failed message", () => {
    expect(friendlyGenerateError("OpenAI response failed validation: Invalid JSON — no JSON object found in the pasted text."))
      .toBe("The analysis result couldn't be processed. Please try again.");
  });

  it("maps a schema-shape validation failure to the processing-failed message", () => {
    expect(friendlyGenerateError('OpenAI response failed validation: JSON schema error — expected an "items" array.'))
      .toBe("The analysis result couldn't be processed. Please try again.");
  });

  it("maps an OpenAI transport/HTTP-status failure to the generic couldn't-complete message", () => {
    expect(friendlyGenerateError("OpenAI analysis request failed (status 500)"))
      .toBe("Analysis couldn't be completed. Please try again.");
  });

  it("maps a server configuration failure to the generic couldn't-complete message", () => {
    expect(friendlyGenerateError("AI generation is not configured on the server."))
      .toBe("Analysis couldn't be completed. Please try again.");
  });

  it("maps a persistence failure to the generic couldn't-complete message", () => {
    expect(friendlyGenerateError("Failed to persist the analysis run."))
      .toBe("Analysis couldn't be completed. Please try again.");
  });

  it("falls back to the generic message for a missing/undefined error", () => {
    expect(friendlyGenerateError(undefined)).toBe("Analysis couldn't be completed. Please try again.");
    expect(friendlyGenerateError(null)).toBe("Analysis couldn't be completed. Please try again.");
  });
});
