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

// Regression — a real LOCATION run (shaped as run C in
// locationBenchmarkRuns.test.ts) returned scope_hint values that
// were room names ("Master Bedroom", "Dining Room", "Kitchen", "Building
// Lift"), never the floor its two sheets are titled with (First / Second
// Floor), so floor identity was lost for every observation. It also reported
// the wardrobe "W.R" with scope_hint "Master Bedroom" and the bedroom's own
// dimension. The prompt never said what scope_hint means.
describe("observation prompt — scope_hint semantics", () => {
  const p = buildObservationPrompt();

  it("defines scope_hint as the floor/level/zone the drawing covers", () => {
    expect(p).toMatch(/"scope_hint" (is|must be) the (floor|level)/i);
  });

  it("forbids putting a room or space name in scope_hint", () => {
    expect(p).toMatch(/never (a|the) room/i);
  });

  it("requires a dimension to belong to the observation's own element, not its containing room", () => {
    expect(p).toMatch(/dimension.*(own|that) element/i);
  });
});
