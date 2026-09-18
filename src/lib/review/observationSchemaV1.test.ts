// Contract tests for parseObservationsV1 — pure, synthetic fixtures, no
// connection to any real drawing set (see srikakulamObservationBenchmark.ts
// for drawing-derived ground truth). Mirrors analysisSchemaV1.test.ts's
// exact rigor: never fabricate, drop what's invalid, warn rather than guess.

import { describe, it, expect } from "vitest";
import { parseObservationsV1, OBSERVATION_TYPES } from "./observationSchemaV1";

const WRAP = (observations: unknown[]) => JSON.stringify({ schema_version: "cunstruct.observation.v1", observations });

describe("parseObservationsV1 — basic shape", () => {
  it("rejects empty/whitespace input", () => {
    expect(parseObservationsV1("").ok).toBe(false);
    expect(parseObservationsV1("   ").ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    const r = parseObservationsV1("not json at all {{{");
    expect(r.ok).toBe(false);
  });

  it("rejects a payload with no observations array", () => {
    const r = parseObservationsV1(JSON.stringify({ schema_version: "cunstruct.observation.v1" }));
    expect(r.ok).toBe(false);
  });

  it("rejects an empty observations array", () => {
    const r = parseObservationsV1(WRAP([]));
    expect(r.ok).toBe(false);
  });

  it("parses a single well-formed observation", () => {
    const r = parseObservationsV1(WRAP([
      {
        observation_type: "schedule_entry", mark: "W1", scope_hint: "Ground Floor",
        location_text: "Door/Window schedule, Ground floor sheet",
        attributes: { dimension: "6'x6'9\"", specification: "UPVC" },
        evidence_completeness: "FULL",
        source: { document_id: "doc-1", page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8 }] },
      },
    ]));
    expect(r.ok).toBe(true);
    expect(r.observations).toHaveLength(1);
    const o = r.observations![0];
    expect(o.observationType).toBe("schedule_entry");
    expect(o.mark).toBe("W1");
    expect(o.attributes).toEqual({ dimension: "6'x6'9\"", specification: "UPVC" });
    expect(o.evidenceCompleteness).toBe("FULL");
    expect(o.source.documentId).toBe("doc-1");
    expect(o.source.evidence).toHaveLength(1);
  });
});

describe("parseObservationsV1 — observation_type is bounded, never invented", () => {
  it("drops an observation with an unrecognized observation_type (sole item -> whole parse fails, same precedent as parseAnalysisV1)", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "random_ocr_text_blob", evidence_completeness: "FULL", source: { evidence: [{ bbox: [0, 0, 1, 1] }] } },
    ]));
    expect(r.ok).toBe(false);
    expect(r.observations).toBeUndefined();
    expect(r.warnings.some((w) => /observation_type/i.test(w))).toBe(true);
  });

  it("drops an observation with a missing observation_type, but keeps a sibling with a valid one", () => {
    const r = parseObservationsV1(WRAP([
      { evidence_completeness: "FULL", source: { evidence: [{ bbox: [0, 0, 1, 1] }] } },
      { observation_type: "fixture", evidence_completeness: "FULL", source: { evidence: [{ bbox: [0, 0, 1, 1] }] } },
    ]));
    expect(r.ok).toBe(true);
    expect(r.observations).toHaveLength(1);
    expect(r.observations![0].observationType).toBe("fixture");
  });

  it("every value in OBSERVATION_TYPES is independently accepted", () => {
    const observations = OBSERVATION_TYPES.map((t) => ({
      observation_type: t, evidence_completeness: "FULL", source: { evidence: [{ bbox: [0, 0, 1, 1] }] },
    }));
    const r = parseObservationsV1(WRAP(observations));
    expect(r.observations?.map((o) => o.observationType)).toEqual(OBSERVATION_TYPES);
  });
});

describe("parseObservationsV1 — evidence rules (never fabricated)", () => {
  it("drops one malformed evidence box independently, keeping the observation and its remaining valid evidence", () => {
    const r = parseObservationsV1(WRAP([
      {
        observation_type: "opening", evidence_completeness: "FULL",
        source: { evidence: [{ bbox: [1, 2, 3, 4] }, { bbox: [1, 2] /* malformed: wrong length */ }] },
      },
    ]));
    expect(r.observations).toHaveLength(1);
    expect(r.observations![0].source.evidence).toHaveLength(1);
    expect(r.warnings.some((w) => /evidence/i.test(w))).toBe(true);
  });

  it("retains an observation with zero valid evidence when evidence_completeness is LIMITED", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "structural_element", evidence_completeness: "LIMITED", source: { document: "typical.pdf", page: 9, evidence: [] } },
    ]));
    expect(r.observations).toHaveLength(1);
    expect(r.observations![0].source.evidence).toEqual([]);
  });

  it("rejects an observation with zero valid evidence when evidence_completeness is FULL", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "structural_element", evidence_completeness: "FULL", source: { evidence: [] } },
    ]));
    expect(r.ok).toBe(false);
    expect(r.observations).toBeUndefined();
  });

  it("rejects an observation with zero valid evidence when evidence_completeness is PARTIAL", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "structural_element", evidence_completeness: "PARTIAL", source: { evidence: [] } },
    ]));
    expect(r.ok).toBe(false);
    expect(r.observations).toBeUndefined();
  });

  it("rejects an observation with zero valid evidence when ALL its boxes were malformed and dropped (not LIMITED)", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "opening", evidence_completeness: "FULL", source: { evidence: [{ bbox: ["a", "b", "c", "d"] }] } },
    ]));
    expect(r.ok).toBe(false);
    expect(r.observations).toBeUndefined();
  });

  it("retains an observation with NO source object at all, when evidence_completeness is LIMITED", () => {
    const r = parseObservationsV1(WRAP([{ observation_type: "room_or_space", evidence_completeness: "LIMITED" }]));
    expect(r.observations).toHaveLength(1);
    expect(r.observations![0].source.evidence).toEqual([]);
  });

  it("rejects an observation with no source object when evidence_completeness is FULL", () => {
    const r = parseObservationsV1(WRAP([{ observation_type: "room_or_space", evidence_completeness: "FULL" }]));
    expect(r.ok).toBe(false);
    expect(r.observations).toBeUndefined();
  });
});

describe("parseObservationsV1 — attributes are bounded (no quantity_hint, nothing free-form)", () => {
  it("keeps only dimension/specification/material; drops any other key silently", () => {
    const r = parseObservationsV1(WRAP([
      {
        observation_type: "opening", evidence_completeness: "FULL",
        source: { evidence: [{ bbox: [0, 0, 1, 1] }] },
        attributes: { dimension: "4x5", specification: "UPVC", material: "aluminium", quantity_hint: "7", random_extra_text: "should never appear" },
      },
    ]));
    expect(r.observations![0].attributes).toEqual({ dimension: "4x5", specification: "UPVC", material: "aluminium" });
  });

  it("defaults to an empty attributes object when none is given", () => {
    const r = parseObservationsV1(WRAP([{ observation_type: "wall_or_partition", evidence_completeness: "FULL", source: { evidence: [{ bbox: [0, 0, 1, 1] }] } }]));
    expect(r.observations![0].attributes).toEqual({});
  });
});

describe("parseObservationsV1 — evidence_completeness normalization", () => {
  it("defaults to FULL when omitted", () => {
    const r = parseObservationsV1(WRAP([{ observation_type: "fixture", source: { evidence: [{ bbox: [0, 0, 1, 1] }] } }]));
    expect(r.observations![0].evidenceCompleteness).toBe("FULL");
  });
});
