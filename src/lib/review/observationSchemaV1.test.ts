// Contract tests for parseObservationsV1 — pure, synthetic fixtures, no
// connection to any real drawing set. Mirrors analysisSchemaV1.test.ts's
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

  it("accepts a genuinely empty observations array as an honest zero-result, not a validation failure", () => {
    const r = parseObservationsV1(WRAP([]));
    expect(r.ok).toBe(true);
    expect(r.observations).toEqual([]);
  });

  it("parses a single well-formed observation", () => {
    const r = parseObservationsV1(WRAP([
      {
        observation_type: "schedule_entry", mark: "W1", scope_hint: "Ground Floor",
        location_text: "Door/Window schedule, Ground floor sheet",
        attributes: { dimension: "5'x6'", specification: "UPVC" },
        evidence_completeness: "FULL",
        source: { document_id: "doc-1", page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8 }] },
      },
    ]));
    expect(r.ok).toBe(true);
    expect(r.observations).toHaveLength(1);
    const o = r.observations![0];
    expect(o.observationType).toBe("schedule_entry");
    expect(o.mark).toBe("W1");
    expect(o.attributes).toEqual({ dimension: "5'x6'", specification: "UPVC" });
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

// ── Diagnostics: every refused observation is visible to the caller as data,
// not only as warning text. Acceptance rules are unchanged. ─────────────────
describe("parseObservationsV1 — rejection diagnostics", () => {
  const box = (bbox: unknown) => ({ bbox, page: 1 });

  it("a room claimed FULL with no evidence box is rejected as recoverable, keeping its mark, floor and page", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "room_or_space", mark: "Dining", scope_hint: "First Floor", evidence_completeness: "FULL", source: { page: 1, evidence: [box([10, 10, 20, 20])] } },
      { observation_type: "room_or_space", mark: "W.R", scope_hint: "First Floor", evidence_completeness: "FULL", source: { page: 1, evidence: [] } },
    ]));
    expect(r.ok).toBe(true);
    expect(r.observations).toHaveLength(1);
    expect(r.diagnostics).toEqual({
      received: 2, accepted: 1, needsReview: 0, droppedEvidenceBoxesFromKept: 0,
      rejected: [{ index: 1, reason: "no_valid_evidence", recoverable: true, observationType: "room_or_space", mark: "W.R", scopeHint: "First Floor", page: 1, declaredCompleteness: "FULL", droppedEvidenceBoxes: 0 }],
    });
  });

  it("PARTIAL whose every box is malformed is rejected, and the dropped boxes are counted", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "room_or_space", mark: "Pooja", evidence_completeness: "PARTIAL", source: { page: 2, evidence: [box([1, 2, 3]), box(["a", 1, 2, 3])] } },
    ]));
    expect(r.ok).toBe(false);
    expect(r.diagnostics?.rejected).toEqual([
      expect.objectContaining({ reason: "no_valid_evidence", recoverable: true, mark: "Pooja", page: 2, droppedEvidenceBoxes: 2 }),
    ]);
  });

  it("an unrecognized type is rejected as unrecoverable, with its context", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "electrical_point", mark: "Plasma", scope_hint: "First Floor", evidence_completeness: "LIMITED", source: { page: 1, evidence: [] } },
    ]));
    expect(r.diagnostics?.rejected).toEqual([
      { index: 0, reason: "missing_or_unrecognized_type", recoverable: false, observationType: "electrical_point", mark: "Plasma", scopeHint: "First Floor", page: 1, droppedEvidenceBoxes: 0 },
    ]);
  });

  it("an entry that isn't an object is rejected as unrecoverable", () => {
    const r = parseObservationsV1(WRAP(["Kitchen 21'2\" x 11'"]));
    expect(r.ok).toBe(false);
    expect(r.diagnostics?.rejected).toEqual([{ index: 0, reason: "not_an_object", recoverable: false, droppedEvidenceBoxes: 0 }]);
  });

  it("LIMITED observations are kept but counted as needing review, separately from accepted ones", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "room_or_space", mark: "Lift", evidence_completeness: "LIMITED", source: { page: 2, evidence: [] } },
      { observation_type: "room_or_space", mark: "Kitchen", evidence_completeness: "FULL", source: { page: 2, evidence: [box([1, 1, 5, 5]), box([1])] } },
    ]));
    expect(r.diagnostics).toMatchObject({ received: 2, accepted: 1, needsReview: 1, rejected: [], droppedEvidenceBoxesFromKept: 1 });
  });

  it("every received entry is accounted for exactly once", () => {
    const r = parseObservationsV1(WRAP([
      { observation_type: "room_or_space", mark: "A", evidence_completeness: "FULL", source: { evidence: [box([1, 1, 2, 2])] } },
      { observation_type: "room_or_space", mark: "B", evidence_completeness: "LIMITED" },
      { observation_type: "room_or_space", mark: "C", evidence_completeness: "FULL" },
      { observation_type: "nonsense" },
      42,
    ]));
    const d = r.diagnostics!;
    expect(d.accepted + d.needsReview + d.rejected.length).toBe(d.received);
    expect(d.rejected.map((x) => x.reason)).toEqual(["no_valid_evidence", "missing_or_unrecognized_type", "not_an_object"]);
  });

  it("an empty array reports zero of everything; unparseable JSON has no diagnostics", () => {
    expect(parseObservationsV1(WRAP([])).diagnostics).toEqual({ received: 0, accepted: 0, needsReview: 0, rejected: [], droppedEvidenceBoxesFromKept: 0 });
    expect(parseObservationsV1("not json").diagnostics).toBeUndefined();
  });
});
