// The LOCATION extraction prompt must actually enforce the bounded scope and
// BOQ-independence this feature exists for — otherwise those constraints
// only live in the schema/parser, and the model is never actually told them.

import { describe, it, expect } from "vitest";
import { buildObservationPrompt } from "./analysisPrompt";
import { OBSERVATION_TYPES } from "./observationSchemaV1";

describe("observation prompt — bounded scope", () => {
  const p = buildObservationPrompt();

  it("names every controlled observation type", () => {
    for (const t of OBSERVATION_TYPES) expect(p).toContain(t);
  });

  it("explicitly forbids generic OCR / arbitrary text transcription", () => {
    expect(p).toMatch(/do not (transcribe|extract).*(text|ocr)/i);
  });

  it("explicitly states LOCATION analyses the drawing independently of any BOQ", () => {
    expect(p).toMatch(/independent(ly)? of (any|the) (existing )?boq/i);
    expect(p).toMatch(/do not (filter|limit).*boq/i);
  });

  it("explicitly instructs the model NOT to report a quantity or count", () => {
    expect(p).toMatch(/do not report a quantity/i);
  });
});

describe("observation prompt — evidence honesty, same discipline as the BOQ prompt", () => {
  const p = buildObservationPrompt();

  it("forbids inventing evidence coordinates", () => {
    expect(p).toMatch(/never invent evidence coordinates/i);
  });

  it("states the rendered/rotation-safe coordinate convention", () => {
    expect(p).toMatch(/rendered coordinate space/i);
  });

  it("instructs LIMITED evidence_completeness rather than fabricating a region", () => {
    expect(p).toMatch(/evidence_completeness/i);
    expect(p).toMatch(/limited/i);
  });
});
